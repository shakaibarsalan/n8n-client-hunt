#!/usr/bin/env python3
"""
Minimal n8n public-API client, and the guard rails this instance needs.

The n8n instance this was built against is SHARED: it carries workflows from
other projects, and at least one of them is active and sending email. So this
module does two things beyond wrapping HTTP:

  1. It refuses to touch any workflow whose name does not start with CH-.
     Nothing in this project has any business writing to another project's
     workflow, and "I was sure I had the right id" is not a control.

  2. It re-reads `active` after every write and FORCES it back to inactive
     if the write left it (or found it) active - never "restores whatever it
     was before this call". From the job-hunt gotchas:

         "PUT /api/v1/workflows/{id} on a deactivated workflow turns it back
          on. The sender was deliberately stopped after it emailed the same
          company three times. The fix was pushed. The push restarted it, and
          it sent again while it was believed to be off."

     An earlier version of this file only defended against the PUT itself
     flipping the state - it re-read `active`, but compared it against
     `was_active` and "corrected" back to THAT, which does nothing if the
     workflow was already active before the write for any reason. CH-01
     through CH-04 ran that way, active, on their live schedules, for an
     unknown stretch of this project's own testing - invisible, because
     import-workflows.py's "Everything is INACTIVE" was a printed claim, not
     a verified one. Do not assume the state you set (or intend) survives
     the next write; check it, and always land on inactive.

Env:  N8N_URL, N8N_API_KEY
"""

import json
import re
import os
import sys
import urllib.error
import urllib.request

# Cloudflare rejects urllib's default user-agent with "403, error code 1010",
# and the message says nothing about the user-agent, so it reads as an auth
# problem and sends you looking at your API key for an hour.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

PREFIX = "CH-"


class N8nError(RuntimeError):
    pass


def _base():
    url = os.environ.get("N8N_URL", "").rstrip("/")
    if not url:
        raise N8nError("N8N_URL is not set")
    return url


def call(method, path, body=None):
    key = os.environ.get("N8N_API_KEY")
    if not key:
        raise N8nError("N8N_API_KEY is not set")

    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        _base() + path, data=data, method=method,
        headers={
            "X-N8N-API-KEY": key,
            "Accept": "application/json",
            "User-Agent": UA,
            **({"Content-Type": "application/json"} if data else {}),
        })
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        raise N8nError(f"{method} {path} -> HTTP {e.code}: {detail}") from None


def list_workflows():
    out, cursor = [], None
    while True:
        q = "/api/v1/workflows?limit=100" + (f"&cursor={cursor}" if cursor else "")
        page = call("GET", q)
        out.extend(page.get("data", []))
        cursor = page.get("nextCursor")
        if not cursor:
            break
    return out


ENV_PLACEHOLDER = re.compile(r"__ENV:([A-Z0-9_]+)__")


def inject_env(workflow, env=None):
    """Replace __ENV:NAME__ placeholders in the workflow with real values.

    Some settings are secrets but do not belong in an n8n *credential*: the
    Serper key is read by a Code node, and a Code node cannot use credentials.
    Putting it in the Config node would put it in the committed workflow JSON.

    So the template carries a placeholder and the value is injected here, at
    import time, from the environment. Git holds __ENV:SERPER_API_KEY__; n8n
    holds the key; neither holds both.

    Returns the list of names that had no value, so the caller can say which
    features will run degraded rather than leaving a literal "__ENV:X__" in a
    field and letting it fail as a bad API key later.
    """
    env = env or os.environ
    missing = []

    def walk(node):
        if isinstance(node, list):
            return [walk(v) for v in node]
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, str):
            def sub(m):
                name = m.group(1)
                val = env.get(name)
                if val:
                    return val
                if name not in missing:
                    missing.append(name)
                # Emptied, not left as the placeholder. Every consumer treats
                # an empty value as "not configured" and degrades cleanly; a
                # literal __ENV:X__ would be sent to the API as a key.
                return ""
            return ENV_PLACEHOLDER.sub(sub, node)
        return node

    workflow["nodes"] = walk(workflow.get("nodes", []))
    return missing


def credential_ids():
    """name -> id for every credential on the instance.

    Workflow templates name their credentials; n8n binds them by id. Resolving
    at import time means the JSON in git stays readable and portable, and does
    not carry ids that are meaningless on any other instance.
    """
    try:
        data = call("GET", "/api/v1/credentials?limit=250").get("data", [])
        return {c["name"]: c["id"] for c in data}
    except N8nError:
        # Some n8n versions drop GET /credentials from the public API. Without
        # it, nodes import with the credential NAME but no id, which n8n shows
        # as "credential not set" - one click to fix in the UI, and far better
        # than failing the whole import.
        return {}


def wire_credentials(workflow, known):
    """Fill in credential ids from names. Returns a list of unresolved names."""
    missing = []
    for node in workflow.get("nodes", []):
        for cred_type, spec in (node.get("credentials") or {}).items():
            name = spec.get("name")
            if not name:
                continue
            if name in known:
                spec["id"] = known[name]
            elif name not in missing:
                missing.append(name)
    return missing


def guard(name):
    """Refuse to write to anything that is not ours."""
    if not str(name or "").startswith(PREFIX):
        raise N8nError(
            f"refusing to modify {name!r}: this tool only writes workflows "
            f"named {PREFIX}*. The other workflows on this instance belong to "
            f"other projects and one of them is actively sending email.")


def upsert(workflow):
    """Create or update by name. Returns (id, action)."""
    name = workflow.get("name")
    guard(name)

    existing = next((w for w in list_workflows() if w.get("name") == name), None)

    # The API rejects fields it considers read-only, and the error names the
    # field rather than explaining the rule, so it reads as a schema mismatch.
    payload = {
        "name": name,
        "nodes": workflow["nodes"],
        "connections": workflow["connections"],
        "settings": workflow.get("settings", {"executionOrder": "v1"}),
    }

    if existing:
        res = call("PUT", f"/api/v1/workflows/{existing['id']}", payload)

        # Re-read and FORCE inactive - not "preserve whatever it was before
        # this write", which is what this used to do. That version only
        # protected against the PUT itself silently flipping the state; it
        # never stopped a workflow that was ALREADY active (for any reason -
        # a prior manual activation, a bug, a test that forgot to turn
        # something back off) from staying active through every subsequent
        # deploy forever, all while import-workflows.py printed "Everything
        # is INACTIVE" underneath it. Found for real: CH-01 through CH-04
        # were active and running on their live schedules for an unknown
        # stretch of this project's testing, invisibly, because nothing ever
        # actually checked the claim the deploy output was making.
        after = call("GET", f"/api/v1/workflows/{existing['id']}")
        if bool(after.get("active")):
            call("POST", f"/api/v1/workflows/{existing['id']}/deactivate")
            print(f"    (deactivated: was active going into this import)")
        return existing["id"], "updated"

    res = call("POST", "/api/v1/workflows", payload)
    # New workflows are created inactive by n8n's own default, but this is
    # the same claim as above - verified, not assumed, for the same reason.
    wid = res.get("id")
    after = call("GET", f"/api/v1/workflows/{wid}")
    if bool(after.get("active")):
        call("POST", f"/api/v1/workflows/{wid}/deactivate")
        print(f"    (deactivated: was created active)")
    return wid, "created"


def snapshot_others():
    """Record the state of every workflow that is NOT ours.

    Run before and after any import. If anything in this list changes, the
    import touched something it should not have, and you want to know that
    immediately rather than the next time somebody wonders why a mailer
    stopped.
    """
    return {
        w["name"]: {"id": w["id"], "active": bool(w.get("active"))}
        for w in list_workflows()
        if not str(w.get("name", "")).startswith(PREFIX)
    }


if __name__ == "__main__":
    # `python tools/n8n_api.py` lists what is on the instance, read-only.
    try:
        for w in sorted(list_workflows(), key=lambda x: x.get("name", "")):
            mark = "*" if str(w.get("name", "")).startswith(PREFIX) else " "
            state = "ACTIVE " if w.get("active") else "off    "
            print(f"{mark} {state} {w['id']:<20} {w.get('name')}")
    except N8nError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
