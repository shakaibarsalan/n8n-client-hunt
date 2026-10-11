# Things about n8n that cost somebody a day

Carried forward from `job-hunt-automation/docs/N8N-GOTCHAS.md`, plus the ones
this project found. Every entry produced a real fault, not a theoretical one.

New faults go here as they happen, one heading each.

---

## Inherited — each of these produced a production fault elsewhere

### Updating a workflow re-activates it

`PUT /api/v1/workflows/{id}` on a deactivated workflow turns it back on.

In the job-hunt repo the email sender was deliberately stopped after it mailed
the same company three times. The fix was pushed. **The push restarted it**,
and it sent again while it was believed to be off.

`tools/n8n_api.py` re-reads `active` after every PUT and puts it back. Do not
assume the state you set survives the next write.

### A Code node is validated as raw text, comments included

In *Run Once for Each Item* mode, n8n rejects `$input.all/first/last/
itemMatching`. It finds them by matching the **source text**, so a comment
mentioning one is rejected exactly like a call to one.

A comment explaining an old bug produced `Can't use .first() here [line 49,
for item 0]` from a line that called nothing.

`tests/n8n-node-preflight.js` checks for this. `n8n/snippets/prove-domain.js`
carries a note at the top explaining why it never names those accessors.

### `$env` is blocked below Enterprise, and so are Variables

The error says *"access to env vars denied"*, which names the mechanism rather
than the setting, so it reads as a permissions problem.

This instance returns **403 `feat:variables`** as well. Hence the `Config` Set
node at the top of every workflow: it is not a style choice, it is the only
place a shared value can live here.

### `appendOrUpdate` overwrites the columns you map, and only those

Unmapped columns survive. Mapped columns are overwritten unconditionally.

A flow that mapped `Status: 'queued'` reset rows already marked `sent` every
eight hours, and six companies received two or three emails.

The same shape applies to an SQL upsert. `db/upsert-business.sql` deliberately
does **not** update `website_status` or `first_seen_at`.

### A webhook returns only the first item

With `responseMode: lastNode`, the response contains one item unless
`responseData: 'allEntries'` is set.

A test harness without it reported "1 item" from a node that had correctly
returned six — the harness reproduced the very bug it was built to detect.

### The schedule trigger strips default values when it saves

Set `minutesInterval: 5` and read it back as `{ "field": "minutes" }`. The
value is still 5, but nothing in the stored workflow says so. Verify by
behaviour — the gaps between executions — not by the field.

### `Intl.DateTimeFormat` is expensive inside a loop

A formatter built per row, per tick, is quadratic in the size of the table.
Build formatters once, at module scope.

### Cloudflare blocks the default Python user-agent

`urllib` gets `403, error code 1010`. A browser user-agent gets through. The
API key is not the problem, so the error sends you looking in the wrong place.
`tools/n8n_api.py` sets `UA` for this reason.

### `[\s\S]` does not survive being written inside a single-quoted string

JS drops the backslash on an unknown escape, so it compiles as `[sS]` and
matches only the letters s and S. Use `[^]`, which means the same thing and
contains no backslash. See the `titleOf()` helper in `prove-domain.js`.

---

## Found in this project

### A literal high character in a regex class does not survive the round trip

The accent-folding regex was written as `/[<combining marks>]/`. That source
goes snippet → `JSON.stringify` → workflow JSON → n8n's editor → n8n's code
validator, and the literal characters were mangled at more than one of those
steps, in more than one direction. Three separate attempts to write the
escape sequence `̀` produced the literal character instead.

The failure is silent: the class stops matching, accented names stop folding,
and Stage B quietly stops matching Norwegian and Spanish businesses.

**Fixed structurally rather than per-file.** `tools/build-workflows.js`
escapes every non-ASCII code point to `\uXXXX` when it writes the workflow
JSON, so the built artefact is pure ASCII whatever the snippet contains.

### Normalisation written twice is the worst seam in the project

`name_norm` is computed in JavaScript (inside n8n) for the Google side and in
Python (at load time) for the Overture/Foursquare side. Stage B matches the
two against each other.

The first version implemented it a second time as a nest of DuckDB
`regexp_replace()` calls. Two copies of this logic fail **silently**: nothing
errors, every business simply looks like "not present in the open datasets",
and every lead quietly downgrades from `NO_WEBSITE_CONFIRMED` to
`NO_WEBSITE_LIKELY`. That is indistinguishable from a city with thin open
data, which is a real thing — so it would have been believed.

One implementation per language, and `tests/normalisation-parity.test.js`
runs both over the same list and demands identical output.

### Node writes UTF-8 to stdin; Python on Windows reads cp1252

The first run of the parity test above reported six mismatches that did not
exist. The normalisers agreed; the harness corrupted every accented name on
the way into Python.

Pass ASCII-escaped JSON **and** run Python with `-X utf8`. Either alone is not
enough.

### `Number('')` is `0`, and `0,0` is a real place

`pick()` returns `''` for a missing field, so a business with no coordinates
became lat 0, lon 0 — which geohashes to `7zzzzzz`, the same cell as **every
other** business with no coordinates.

Combined with `name_norm` that is a dedup key which starts merging unrelated
businesses, and a Stage B cross-check that matches them against each other.
Reject the absent value before the conversion, not after it.

### Dots must be closed up, not turned into spaces

`S.L.` → `s l` → two single letters that survive the legal-form filter,
because `s` and `l` are not `sl`. `"Peluquería Sol S.L."` normalised to
`peluqueria sol s l`, Overture holds `peluqueria sol`, and Stage B stopped
working for one entire country without any sign that it had.

### A greedy `^\{\{(.*)\}\}$` mis-reads a multi-expression template

`={{ $json.base }}/runs/{{ $json.id }}` is a template with literal text in the
middle. A greedy match spans the `}}...{{` and treats the whole thing as one
expression, producing a syntax error that is not in the workflow at all.

The preflight now requires exactly one `{{` before treating a value as a
single expression, and `tests/fixtures/broken-workflows/f-*.json` is a
regression guard. A checker that invents failures gets ignored exactly as fast
as one that hides them.

### Evidence has to scale with the guess, even for one-word names

The ported domain-prover keyed its strictest rule off `proof.length > 1`,
which silently switched itself off whenever a business name reduced to a
single distinctive word.

`"Salong <Word>"` → `salong` is generic in this niche → the only token is
the one word → `<word>.no` passed on one title match. That domain belonged to
an energy company.
Marking a real prospect `HAS_WEBSITE` drops them from the list permanently,
which is the more expensive of the two possible mistakes.

The rule is now about **coverage**: if the domain leaves part of the name out,
the page must mention the missing part.

### A Code node dies at 300s, and "Run Once for Each Item" shares ONE budget

n8n's task runner kills a Code node after **300 seconds**, and this is the
trap: a node set to *Run Once for Each Item* does **not** get 300s per item.
Every item in the batch runs inside a **single** task sharing one 300s budget.
The log gives one task id and one timeout line for the whole node.

So a per-item node's real limit is `batch_size × worst-case-time-per-item`,
and CH-02 was configured far past it:

| stage | worst case at batch_size 25 | vs 300s |
|---|---|---|
| C search   | 25 × 15s          = 375s  | over |
| D probe    | 25 × 8 × 9s       = 1800s | over |
| E PageSpeed| 25 × 60s          = 1500s | over |
| F email    | 25 × 3 × 9s       = 675s  | over |

It fired on schedule, hung, and was killed at exactly 300s — and because the
verdict is written in the LAST node, **the entire batch was lost**, every
time, with nothing in the database to show it had tried. Five businesses that
all had websites was enough: `5 × 60s` of PageSpeed is 300s on the nose.
`PAGESPEED_API_KEY` being unset makes it worse, since unauthenticated PSI
calls are rate-limited and burn the whole timeout instead of answering.

The fix is arithmetic, not cleverness. Every per-item network stage must
satisfy `batch_size × per-item-worst-case < 300s` with room to spare:

    batch_size 25 -> 5      probe_timeout_ms 9000 -> 5000
    max_probes  8 -> 6      search_timeout_ms 15000 -> 10000
                            psi_timeout_ms 60000 -> 8000

which lands at C 50s, D 150s, E 40s, F 75s. Fewer probes and shorter timeouts
cost a little thoroughness, but "could not check" already lowers confidence
honestly by design — whereas a timed-out batch produces nothing at all, which
is strictly worse. When adding a stage that makes network calls, do this
multiplication first.

**Later correction (3 Oct 2026): 8s was too short for PageSpeed.** The
timeouts were not what was killing these runs - the 163x fan-out further
down this file was - and PageSpeed never actually ran in production until
then anyway (see the URLSearchParams entry). Once it did, with a key, every
call timed out at 8000ms: PSI runs a full Lighthouse audit and routinely
takes 15-30s. The budget is per Code node, so Stage E alone has 300s:

    psi_timeout_ms 8000 -> 45000      E: 5 x 45s = 225s
