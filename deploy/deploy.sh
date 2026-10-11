#!/usr/bin/env bash
#
# Deploy the lead database to a server you run (Postgres + the mail filer,
# next to an existing n8n).
#
#   REMOTE_HOST=user@your-server bash deploy/deploy.sh   # from a checkout, over SSH
#   bash deploy/deploy.sh --local                        # on the server itself
#
# Settings (environment):
#   REMOTE_HOST    ssh target, required for the SSH mode
#   REMOTE_DIR     where the stack lives on the server   (default /srv/n8n-client-hunt)
#   N8N_CONTAINER  name of the n8n container, for the reachability check (default n8n)
#
# REMOTE_DIR must hold a .env with POSTGRES_PASSWORD and the mailbox settings
# (see .env.example). It never leaves the server and is never synced.
#
# Safety model, in order. Steps 1 and 2 exist because the host is assumed to
# run other stacks too (at least the n8n these workflows run on), and a deploy
# that breaks one of those is far more expensive than a deploy that does not
# happen.
#
#   1. Refuse to start if the neighbours are already unhealthy. Never deploy
#      on top of somebody else's incident - you will be blamed for it and,
#      worse, you will not be able to tell your breakage from theirs.
#   2. Snapshot every foreign container, network and volume; compare at the
#      end. "It cannot have touched anything" is a belief. This is a check.
#   3. Back up our own database before migrating.
#   4. Migrate. Every file is idempotent, so a partial previous run is fine.
#   5. Verify the database actually answers, not merely that it started.
#
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-/srv/n8n-client-hunt}"
N8N_CONTAINER="${N8N_CONTAINER:-n8n}"
LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# --- the part that runs ON the server -------------------------------------
# DIR and N8N_CONTAINER are prepended by the caller (see run_remote below);
# the heredoc itself is quoted so nothing in it expands on the wrong machine.
remote_script() {
cat <<'REMOTE'
set -euo pipefail
cd "$DIR"

echo "--- 1. are the neighbours healthy BEFORE we touch anything? ---"
unhealthy=$(docker ps --filter health=unhealthy --format '{{.Names}}' | grep -v '^clienthunt-' || true)
if [ -n "$unhealthy" ]; then
  echo "REFUSING TO DEPLOY. These containers are already unhealthy:" >&2
  echo "$unhealthy" >&2
  echo "Fix that first - deploying on top of an existing incident makes both harder to diagnose." >&2
  exit 1
fi
echo "    all healthy"

echo "--- 2. baseline of everything that is not ours ---"
docker ps -a --format '{{.Names}}\t{{.State}}' | grep -v '^clienthunt-' | sort > /tmp/ch-before-containers
docker network ls --format '{{.Name}}' | grep -v '^clienthunt' | sort > /tmp/ch-before-networks
docker volume ls --format '{{.Name}}' | grep -v '^clienthunt' | sort > /tmp/ch-before-volumes
echo "    $(wc -l < /tmp/ch-before-containers) foreign containers recorded"

echo "--- 3. back up our database if it already exists ---"
if docker ps --format '{{.Names}}' | grep -q '^clienthunt-postgres$'; then
  mkdir -p backups
  f="backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  docker exec clienthunt-postgres pg_dump -U clienthunt clienthunt | gzip > "$f"
  echo "    $f  ($(du -h "$f" | cut -f1))"
  # Keep a fortnight. The disk is shared; an unbounded backup directory is
  # somebody else's outage.
  find backups -name 'pre-deploy-*.sql.gz' -mtime +14 -delete
else
  echo "    (first deploy, nothing to back up)"
fi

echo "--- 4. start / update the database ---"
docker compose up -d --wait
# The filer reads its script once at start, from a bind mount compose does
# not watch: without a restart a changed tools/file_sent_copies.py would sit
# unused until the next reboot. Ours alone, and it holds no state.
docker compose restart mail-filer >/dev/null
echo "    up"

echo "--- 5. migrate (every file is idempotent) ---"
# Globbed and sorted, NOT a written-down list. The first version named three
# files explicitly and then silently skipped 004 the day it was added: the
# deploy reported success while the schema it deployed was a version behind,
# and 004 was only present at all because it had been applied by hand.
#
# The numeric prefixes are what make sort order the apply order.
shopt -s nullglob
migrations=(db/*.sql)
if [ ${#migrations[@]} -eq 0 ]; then
  echo "no migrations found in db/ - refusing to call this a successful deploy" >&2
  exit 1
fi
for f in $(printf '%s\n' "${migrations[@]}" | sort); do
  printf '    %-36s' "$(basename "$f")"
  docker exec -i clienthunt-postgres \
    psql -v ON_ERROR_STOP=1 -q -U clienthunt -d clienthunt < "$f"
  echo "ok"
done

# The database must end up holding exactly the migrations that are on disk.
# A file that forgets its own INSERT INTO schema_migrations would otherwise
# apply silently and leave no record that it had.
applied=$(docker exec clienthunt-postgres psql -U clienthunt -d clienthunt -At \
            -c "SELECT count(*) FROM schema_migrations")
if [ "$applied" != "${#migrations[@]}" ]; then
  echo "    MISMATCH: ${#migrations[@]} migration file(s) on disk, $applied recorded applied." >&2
  exit 1
fi
echo "    ${#migrations[@]} migration(s) on disk, all recorded as applied"

echo "--- 6. does it actually answer? ---"
docker exec clienthunt-postgres psql -U clienthunt -d clienthunt -At -c "
  SELECT 'migrations: ' || count(*) FROM schema_migrations
  UNION ALL SELECT 'search_targets: ' || count(*) || ' (' ||
                   count(*) FILTER (WHERE enabled) || ' enabled)' FROM search_targets
  UNION ALL SELECT 'platform_domains: ' || count(*) FROM platform_domains
  UNION ALL SELECT 'businesses: ' || count(*) FROM businesses
  UNION ALL SELECT 'reference places: ' ||
                   (SELECT count(*) FROM ref_overture_places) + (SELECT count(*) FROM ref_fsq_places);
" | sed 's/^/    /'

echo "--- 7. can n8n reach us? ---"
if docker exec "$N8N_CONTAINER" sh -c 'nc -z clienthunt-postgres 5432' 2>/dev/null; then
  echo "    $N8N_CONTAINER -> clienthunt-postgres:5432 OK"
else
  echo "    WARNING: the n8n container ($N8N_CONTAINER) cannot reach clienthunt-postgres." >&2
  echo "    The Postgres credential in n8n must use host 'clienthunt-postgres' port 5432," >&2
  echo "    not localhost - n8n is in a container and localhost means itself. Check that" >&2
  echo "    N8N_NETWORK in .env names the network n8n is on." >&2
fi

# The greps exclude our OWN objects. The first run of this script reported
# "FOREIGN networks CHANGED: + clienthunt_default" - our own network, created
# by our own compose, flagged as somebody else's. A check that cries wolf on
# its own first successful run is a check that gets ignored by the third.
echo "--- 8. did we disturb anything? ---"
docker ps -a --format '{{.Names}}\t{{.State}}' | grep -v '^clienthunt-' | sort > /tmp/ch-after-containers
docker network ls --format '{{.Name}}' | grep -v '^clienthunt' | sort > /tmp/ch-after-networks
docker volume ls --format '{{.Name}}' | grep -v '^clienthunt' | sort > /tmp/ch-after-volumes
rc=0
for what in containers networks volumes; do
  if ! diff -q "/tmp/ch-before-$what" "/tmp/ch-after-$what" >/dev/null; then
    echo "    !!! FOREIGN $what CHANGED:" >&2
    diff "/tmp/ch-before-$what" "/tmp/ch-after-$what" >&2 || true
    rc=1
  else
    echo "    $what unchanged"
  fi
done
exit $rc
REMOTE
}

# The script, with the two settings it needs defined ahead of it.
remote_payload() {
  printf 'DIR=%q\nN8N_CONTAINER=%q\n' "$REMOTE_DIR" "$N8N_CONTAINER"
  remote_script
}

# What has to reach REMOTE_DIR before the migrations run. The remote script
# does `cd "$DIR"` and works from THERE, not from the checkout, so anything
# missing here is silently absent from the deploy.
sync_local() {
  install -d "$REMOTE_DIR/db" "$REMOTE_DIR/tools" "$REMOTE_DIR/n8n/sql"
  cp -f deploy/docker-compose.yml "$REMOTE_DIR/"
  cp -f db/*.sql                  "$REMOTE_DIR/db/"
  cp -f n8n/sql/*.sql             "$REMOTE_DIR/n8n/sql/"
  cp -f tools/load_reference_data.py "$REMOTE_DIR/tools/"
  cp -f tools/file_sent_copies.py  "$REMOTE_DIR/tools/"
  echo "    synced $(ls db/*.sql | wc -l) migration(s) into $REMOTE_DIR"
}

if [ "$LOCAL" = 1 ]; then
  # --- THIS STEP WAS MISSING AND THE DEPLOY DID NOT SAY SO -----------------
  #
  # In --local mode (on the server, e.g. from a CI runner there) the script
  # used to go straight to remote_script, which cds to the stack directory
  # and migrates whatever is already sitting there. The fresh checkout was
  # never copied in.
  #
  # So every such deploy reported "6 migration(s), all recorded as applied"
  # and was telling the truth about a directory nobody had updated. Migration
  # 008 existed in git, passed CI, deployed green - and was not on the server
  # at all. The earlier ones had only arrived because they were copied by hand
  # during development, which is exactly what hid the bug.
  #
  # A deploy that reports success without deploying is worse than one that
  # fails, because nothing ever prompts you to look.
  say "Syncing the checkout into $REMOTE_DIR"
  sync_local
  say "Deploying locally"
  remote_payload | bash
else
  [ -n "$REMOTE_HOST" ] || die "set REMOTE_HOST (e.g. REMOTE_HOST=user@your-server), or run with --local on the server"
  say "Syncing to $REMOTE_HOST:$REMOTE_DIR"
  ssh "$REMOTE_HOST" "sudo mkdir -p '$REMOTE_DIR' && sudo chown \"\$(id -un):\$(id -gn)\" '$REMOTE_DIR'"
  # -c compares by checksum, not mtime: a CI checkout has fresh mtimes on
  # every file and would otherwise re-copy everything each run.
  rsync -az --checksum --delete \
    --exclude '.env' --exclude 'backups/' \
    deploy/docker-compose.yml "$REMOTE_HOST:$REMOTE_DIR/"
  rsync -az --checksum --delete db/ "$REMOTE_HOST:$REMOTE_DIR/db/"
  rsync -az --checksum --delete n8n/sql/ "$REMOTE_HOST:$REMOTE_DIR/n8n/sql/"
  rsync -az --checksum tools/load_reference_data.py tools/file_sent_copies.py "$REMOTE_HOST:$REMOTE_DIR/tools/"

  say "Running the deploy"
  remote_payload | ssh "$REMOTE_HOST" 'bash -s'
fi

say "Done"
