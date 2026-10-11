#!/usr/bin/env python3
"""
Create the n8n credentials this project needs, idempotently.

RUN THIS ON THE SERVER. It reads the database password out of the stack's
.env (the directory deploy/deploy.sh deploys to; CH_ENV overrides the path)
and posts it straight to n8n over loopback, so the password never travels
anywhere - not through a laptop, not through a shell history, not through a
chat window.

    cd <stack directory> && N8N_API_KEY=... python3 ensure-credentials.py

n8n's API has no "get credential by name" and no upsert, so this lists what
exists and skips anything already present. Re-running is safe; it will not
create a second credential with the same name, and it will never print a
secret.

Credentials are deliberately NOT deleted or updated if they already exist. A
credential you created by hand with a working token is worth more than this
script's idea of what it should contain.
"""

import json
import os
import sys
import urllib.error
import urllib.request

N8N = os.environ.get("N8N_URL", "http://127.0.0.1:5678")
KEY = os.environ.get("N8N_API_KEY", "")
ENV_FILE = os.environ.get("CH_ENV", ".env")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        N8N.rstrip("/") + path, data=data, method=method,
        headers={"X-N8N-API-KEY": KEY, "Accept": "application/json",
                 "User-Agent": UA,
                 **({"Content-Type": "application/json"} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def env_value(key):
    try:
        with open(ENV_FILE) as fh:
            for line in fh:
                line = line.strip()
                if line.startswith(key + "="):
                    return line.split("=", 1)[1]
    except FileNotFoundError:
        pass
    return None


def main():
    if not KEY:
        print("N8N_API_KEY is not set", file=sys.stderr)
        return 2

    pw = env_value("POSTGRES_PASSWORD")
    if not pw:
        print(f"POSTGRES_PASSWORD not found in {ENV_FILE}", file=sys.stderr)
        return 2

    existing = {c["name"]: c["id"] for c in call("GET", "/api/v1/credentials?limit=250").get("data", [])} \
        if _supports_listing() else {}

    apify = env_value("APIFY_TOKEN")
    tg = env_value("TELEGRAM_BOT_TOKEN")
    smtp_host = env_value("SMTP_HOST")
    smtp_port = env_value("SMTP_PORT")
    imap_host = env_value("IMAP_HOST")
    imap_port = env_value("IMAP_PORT")
    mail_user = env_value("OUTREACH_USER")
    mail_pw = env_value("OUTREACH_PASSWORD")

    wanted = [
        {
            "name": "Client Hunt DB",
            "type": "postgres",
            "data": {
                # The HOSTNAME matters and is the single most common mistake
                # here. n8n runs in a container; "localhost" inside it means
                # the n8n container itself, not the host. The database is
                # reached by its container name over the network it shares
                # with n8n, on the internal port 5432 - never on the host's
                # published 15434.
                "host": "clienthunt-postgres",
                "port": 5432,
                "database": "clienthunt",
                "user": "clienthunt",
                "password": pw,
                "ssl": "disable",
                "allowUnauthorizedCerts": False,
                "maxConnections": 5,
            },
        },
    ]

    if apify:
        wanted.append({
            "name": "Apify token",
            # Header Auth rather than the Apify community node: that node may
            # not be installed on the instance, and a generic header credential
            # on a plain HTTP Request node has no community package to break
            # on the next n8n upgrade.
            "type": "httpHeaderAuth",
            "data": {"name": "Authorization", "value": "Bearer " + apify},
        })

    if tg:
        wanted.append({
            # NOT a generic "Telegram account" - on a shared instance that
            # name is likely taken by another project's bot. Sharing one bot
            # between two projects means a token change in either silently
            # breaks the other, and alerts arrive from a bot whose name says
            # the wrong thing.
            "name": "Client Hunt Telegram",
            "type": "telegramApi",
            "data": {"baseUrl": "https://api.telegram.org", "accessToken": tg},
        })

    if smtp_host and mail_user and mail_pw:
        wanted.append({
            "name": "Client Hunt SMTP",
            "type": "smtp",
            "data": {
                "host": smtp_host,
                "port": int(smtp_port or 465),
                "user": mail_user,
                "password": mail_pw,
                # Port 465 is implicit TLS from the first byte ("secure").
                # STARTTLS (587) is a different handshake and setting this
                # wrong on either port fails silently as a connection error
                # that has nothing to do with the actual mismatch.
                "secure": int(smtp_port or 465) == 465,
            },
        })

    if imap_host and mail_user and mail_pw:
        wanted.append({
            "name": "Client Hunt IMAP",
            "type": "imap",
            "data": {
                "host": imap_host,
                "port": int(imap_port or 993),
                "user": mail_user,
                "password": mail_pw,
                "secure": True,
            },
        })

    for spec in wanted:
        if spec["name"] in existing:
            print(f"  exists   {spec['name']}  (id {existing[spec['name']]})")
            continue
        res = call("POST", "/api/v1/credentials", spec)
        print(f"  created  {spec['name']}  (id {res.get('id')})")

    absent = [k for k, v in (("APIFY_TOKEN", apify),
                             ("TELEGRAM_BOT_TOKEN", tg),
                             ("SMTP_HOST/OUTREACH_USER/OUTREACH_PASSWORD",
                              smtp_host and mail_user and mail_pw),
                             ("IMAP_HOST/OUTREACH_USER/OUTREACH_PASSWORD",
                              imap_host and mail_user and mail_pw)) if not v]
    if absent:
        print(f"\nNot present in {ENV_FILE}, so not created: {', '.join(absent)}")
        print("Add the line, then re-run this script.")
    return 0


def _supports_listing():
    """n8n's public API dropped GET /credentials in some versions.

    Without it there is no way to tell "already exists" from "does not exist",
    and blindly POSTing would create a duplicate on every run. So: probe once,
    and if listing is unavailable, say so rather than making a mess.
    """
    try:
        call("GET", "/api/v1/credentials?limit=1")
        return True
    except RuntimeError as e:
        print(f"  note: cannot list credentials ({str(e)[:80]}...)")
        print("  Will attempt to create; if a credential already exists you may "
              "get a duplicate - check the n8n UI.")
        return False


if __name__ == "__main__":
    sys.exit(main())
