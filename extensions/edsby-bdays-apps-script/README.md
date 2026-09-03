# Bdays Populator — Edsby → Google Sheets (Apps Script)

Pulls students + parents from Edsby into a spreadsheet's `Bdays` tab.

Lives here next to `../behaviours-edsby-cookie-sync/` because it shares the same
constraint: **Edsby has no public API**, so every call imitates a logged-in
browser request. The request shape is ported from
`backend/behavior/lib/edsbyRead.js`, the only DevTools-verified shape in this
repo.

## Why the import returned HTTP 403

Confirmed against a live session. `diagnoseEdsby()` reported:

```
Probe GET /core/node.json/?xds=bootstrap  -> HTTP 200  OK.
Probe GET ZoomMyStudents/21471167         -> HTTP 403
  {"error":1030,"when":"2026-09-03 13:57:39","errorstr":"no links to node","ticket":""}
```

`bootstrap` succeeding with **only** `session_id_edsby` and no `x-xds-jver` /
`x-xds-cver` proves the session is valid and those headers are not required for
these reads. The 403 is Edsby application error **1030, "no links to node"**:
the account has no relationship to node `21471167`.

In other words the hardcoded `ZOOM_NODE_ID` is stale. Zoom node ids are
per-account and change across school years, so last year's "My Students" id
stops resolving — which is exactly when you go looking for a *new* students
list.

Note for anyone reading `backend/behavior/lib/edsbyRead.js`: its comment glosses
1030 as "denied nodetype". Edsby's own `errorstr` here is "no links to node",
which is about the *node*, not the view — a wrong id, not a permissions
problem.

### Fixing it

Run `discoverZoomNodes()`. It harvests every `ZoomMyStudents` id the live
session exposes (authenticated landing-page HTML, `bootstrap`, and your `Home`
view), probes each one, and reports which return students:

```
Candidate ZoomMyStudents node ids:
  ✗ 21471167  (seen in CONFIG/script property) — HTTP 403: Edsby error 1030 "no links to node". …
  ✓ 24880031  (seen in landing page HTML) — 31 students

Set script property EDSBY_ZOOM_NODE_ID = 24880031 (31 students), then run populateBdays().
Currently configured: 21471167 ← stale
```

Store that id in `EDSBY_ZOOM_NODE_ID` and the import runs. `populateBdays()`
also self-heals: if the configured id returns nothing it runs the same search
automatically and uses the best candidate, so next September it keeps working
without an edit.

### The header change, kept anyway

The original headers were:

```js
headers: {
  "Cookie": cookie,
  "Origin": "https://bcs.edsby.com",
  "X-Requested-With": "XMLHttpRequest",
}
```

`Origin` and `X-Requested-With` on a plain GET are not what the verified path
sends (`backend/behavior/lib/edsbyRead.js:41-49`), so they were dropped from
GETs and kept on the formkey POST only, and `x-xds-jver` / `x-xds-cver` are now
sent when set. Neither turned out to be the cause of *this* 403 — the node id
was — but both align the script with the one request shape known to work.
`EDSBY_JVER` / `EDSBY_CVER` are therefore **optional**.

## Setup

Project Settings → Script Properties:

| Property | Required | What |
|---|---|---|
| `EDSBY_SESSION_COOKIE` | yes | the **entire** `Cookie:` header line from a logged-in Edsby request |
| `EDSBY_ZOOM_NODE_ID` | recommended | the `/p/ZoomMyStudents/NUMBER` id — overrides `CONFIG.ZOOM_NODE_ID` with no code edit. Get it from `discoverZoomNodes()` |
| `EDSBY_JVER` | no | `x-xds-jver` request header. Not needed for these reads; set it if a call ever 403s with no Edsby error code |
| `EDSBY_CVER` | no | `x-xds-cver` request header. Same |
| `EDSBY_USER_NID` | no | your Edsby user/teacher nid — enables the formkey POST retry |
| `EDSBY_BASE_URL` | no | defaults to `https://bcs.edsby.com` |

To capture all of them at once: sign in to Edsby → DevTools (F12) → **Network**
→ filter `xds` → reload → click any `?xds=Panorama` request → **Headers →
Request Headers**. Copy everything after `Cookie:`, plus `x-xds-jver` and
`x-xds-cver`. (`jver` is also the `_i=` hash on `engine.min.js`.)

Then add a button on the Bdays sheet → Assign script → `populateBdays`.

## Troubleshooting

Two functions to run from the Apps Script editor, then read the Execution log:

- **`diagnoseEdsby()`** — reports each credential, probes `bootstrap` and
  `ZoomMyStudents`, and reports **Edsby's own error code and string** rather
  than the HTTP status it rides on. When `bootstrap` succeeds but the node call
  fails it says so explicitly, so a valid session is never misread as an expired
  one.
- **`discoverZoomNodes()`** — lists and verifies the node ids this account can
  reach. Run it whenever you see error 1030.

Error codes worth knowing:

| Code | Means | Do |
|---|---|---|
| `1030` `no links to node` | this account has no link to that node id | `discoverZoomNodes()` — the id is stale |
| HTTP 401, or a login page at HTTP 200 | session expired | re-copy `EDSBY_SESSION_COOKIE` |
| HTTP 403, no Edsby code | CSRF or version headers | check the node id, then try `EDSBY_JVER` / `EDSBY_CVER` |

## What else changed

- **Resolves the node id.** `discoverZoomNodes()` finds it; `populateBdays()`
  falls back to that search when the configured id returns nothing.
- **Retries the listing.** Tries `ZoomMyStudents`, then `SchoolStudents`,
  `Students`, `ClassStudents` — an admin account may have no "My Students" view
  at all, which the old script reported as "returned no students".
- **Formkey POST fallback.** If the plain GET yields nothing, retries as a
  multipart POST with a freshly fetched `_formkey` and `_method=GET`, matching
  `fetchZoomStudents()` in the backend. Formkeys expire fast, so one is fetched
  immediately before use.
- **Detects expired sessions.** Edsby answers an expired session with its HTML
  login page, often at HTTP 200 — the old code parsed that as "no students".
- **Finds the `rec` map wherever it sits** rather than at a fixed
  `zoom.data.table.rec` path, so minor nesting changes between releases don't
  break the import.
- **Writes ~10× fewer spreadsheet calls.** The old per-cell `setValue()` loop
  made ~10 round-trips per student; now it's one `setValues()` per column.
- **`SortByGrade()` rewritten** — the recorded-macro version drove the UI
  through `activate()` calls and sorted whatever range the cursor happened to
  land on. It now sorts the `Bdays` data range directly.

## Tests

```
node extensions/edsby-bdays-apps-script/test-parsing.mjs
```

55 assertions over the pure functions — response parsing against the recorded
`ZoomMyStudents` shape, group derivation, error-message construction (including
the real 1030 payload above), node-id harvesting, and column mapping. Apps
Script has no test runner, so `Code.gs` is loaded as text with an export footer
appended; `UrlFetchApp` and `SpreadsheetApp` are never touched.

## Maintenance

Two things drift:

- **The zoom node id**, across school years — `discoverZoomNodes()`, or just let
  `populateBdays()` re-find it.
- **The session cookie**, every so often — re-copy it. The
  `../behaviours-edsby-cookie-sync/` extension automates this for the web app;
  this script still needs a manual paste.

`jver`/`cver` also change with each Edsby release, but these reads do not need
them.
