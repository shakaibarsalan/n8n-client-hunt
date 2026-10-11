#!/usr/bin/env python3
"""
Import the built workflows into n8n.

    python tools/import-workflows.py             # dry run: show what would change
    python tools/import-workflows.py --apply
    python tools/import-workflows.py --apply --activate

Everything is imported INACTIVE. Activating a workflow is a deliberate act
that starts spending money, and it should not be a side effect of a deploy.

--activate is that deliberate act, made explicit and auditable rather than
left as a step someone has to remember to do in the UI after every single
deploy. It publishes the scheduled workflows and VERIFIES each one came back
active, because an unverified activation claim is what previously let this
pipeline run while everyone believed it was off. CH-05 - the only workflow
that sends email - is activated too, since the owner asked for sending
without a click: it sends only rows CH-04 auto-approved after every guard
passed (or a human approved), one per run, under its own brake.

Before and after, this records the state of every workflow that is not ours
and diffs the two. The instance is shared and at least one foreign workflow is
actively sending email; "the import cannot have touched it" is a belief, and
this turns it into a check.
"""

import json
import os
import pathlib
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import n8n_api  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILT = ROOT / "n8n" / "workflows"


# Workflows --activate must never publish. Empty since 3 Oct 2026, when CH-05
# gained a schedule and automatic sending at the owner's request; to make
# sending human-gated again, put "CH-05" back here AND set CH-04's
# auto_approve to false.
NEVER_ACTIVATE = ()


def activate(imported):
    """Publish the scheduled workflows, verifying rather than assuming.

    This is deliberately opt-in and separate from importing. Every import
    forces the CH-* workflows inactive (see n8n_api.upsert), which is the
    right default - but it also means every deploy silently stops the
    pipeline, and turning it back on by hand in the UI after each one is a
    step that will eventually be forgotten. This makes it an explicit,
    auditable action instead.
    """
    failures = []
    for name, wid in imported:
        if any(name.startswith(p) for p in NEVER_ACTIVATE):
            print(f"  skipped   {name}  (listed in NEVER_ACTIVATE)")
            continue
        try:
            n8n_api.call("POST", f"/api/v1/workflows/{wid}/activate")
            after = n8n_api.call("GET", f"/api/v1/workflows/{wid}")
            if bool(after.get("active")):
                print(f"  ACTIVE    {name}")
            else:
                # Do not report success on an unverified write - that is the
                # exact mistake that let this pipeline run believed-off.
                print(f"  FAILED    {name}: still inactive after activate", file=sys.stderr)
                failures.append(name)
        except n8n_api.N8nError as e:
            print(f"  FAILED    {name}: {e}", file=sys.stderr)
            failures.append(name)
    return failures


def main():
    apply = "--apply" in sys.argv
    want_activate = "--activate" in sys.argv

    # Never import a stale build. The workflow JSON is generated from the
    # snippets, and importing an out-of-date copy would put code into n8n that
    # does not match what the tests just checked.
    r = subprocess.run(["node", str(ROOT / "tools" / "build-workflows.js"), "--check"],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout + r.stderr)
        print("Build is stale. Run: node tools/build-workflows.js", file=sys.stderr)
        return 1

    # And never import code the preflight rejects.
    r = subprocess.run(["node", str(ROOT / "tests" / "n8n-node-preflight.js")],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout + r.stderr)
        print("Preflight failed. Not importing.", file=sys.stderr)
        return 1
    print(r.stdout.strip())

    files = sorted(BUILT.glob("CH-*.json"))
    if not files:
        print("no built CH-* workflows found", file=sys.stderr)
        return 1

    try:
        before = n8n_api.snapshot_others()
    except n8n_api.N8nError as e:
        print(str(e), file=sys.stderr)
        return 1

    print(f"\n{len(before)} workflow(s) on this instance belong to other projects.")
    for name, s in sorted(before.items()):
        if s["active"]:
            print(f"  ACTIVE  {name}  <- will be checked again afterwards")

    # Templates name their credentials; n8n binds them by id. Resolving here
    # keeps the JSON in git readable and portable - it carries no ids that are
    # meaningless on any other instance.
    known = n8n_api.credential_ids()
    print(f"{len(known)} credential(s) available to bind by name.")

    print()
    all_missing = []
    unset_env = []
    imported = []
    for f in files:
        wf = json.loads(f.read_text(encoding="utf-8"))
        name = wf["name"]

        missing = n8n_api.wire_credentials(wf, known)
        for m in missing:
            if m not in all_missing:
                all_missing.append(m)

        # Secrets that a Code node reads cannot live in an n8n credential, so
        # the template carries __ENV:NAME__ and the value is injected here.
        for m in n8n_api.inject_env(wf):
            if m not in unset_env:
                unset_env.append(m)

        if not apply:
            note = f"   [unbound: {', '.join(missing)}]" if missing else ""
            print(f"  would import  {name}  ({len(wf['nodes'])} nodes){note}")
            continue
        try:
            wid, action = n8n_api.upsert(wf)
            imported.append((name, wid))
            print(f"  {action:<8} {name}  -> {wid}")
        except n8n_api.N8nError as e:
            print(f"  FAILED   {name}: {e}", file=sys.stderr)
            return 1

    if not apply:
        print("\nDry run. Re-run with --apply to import.")
        return 0

    after = n8n_api.snapshot_others()
    if after != before:
        print("\n!!! A workflow belonging to another project CHANGED during this import:",
              file=sys.stderr)
        for name in sorted(set(before) | set(after)):
            if before.get(name) != after.get(name):
                print(f"    {name}: {before.get(name)} -> {after.get(name)}", file=sys.stderr)
        return 1

    print("\nImported. Other projects' workflows are unchanged.")

    if want_activate:
        print("\nActivating the scheduled workflows (--activate was passed):")
        failures = activate(imported)
        if failures:
            print(f"\n{len(failures)} workflow(s) could not be activated: "
                  f"{', '.join(failures)}", file=sys.stderr)
            return 1
        print("\nThese are now LIVE and will run on their own schedules. CH-01 spends")
        print("Apify credit when it runs; its own brake refuses once the monthly cap")
        print("in app_state.apify_spend is reached.")
    else:
        print("Everything is INACTIVE. Re-run with --activate, or publish from the")
        print("n8n UI, when you are ready to spend.")

    if unset_env:
        print("\nThese environment values were not set, so those settings are empty:")
        for m in unset_env:
            print(f"  - {m}")
        print("The nodes that use them degrade rather than fail: an empty search")
        print("key means Stage C is skipped and earns no confidence, which is the")
        print("intended behaviour, not a fault.")

    if all_missing:
        # Not an error. A workflow with an unbound credential imports fine and
        # shows "credential not set" on that node - one click to fix. Failing
        # the whole import over it would mean the pipeline cannot be deployed
        # until every optional integration is configured.
        print("\nThese credentials do not exist yet, so those nodes are unbound:")
        for m in all_missing:
            print(f"  - {m}")
        print("Create them in n8n with EXACTLY these names, then re-run this")
        print("importer - the nodes will bind automatically.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
