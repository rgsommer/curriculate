# Bdays Populator — Edsby → Google Sheets (Apps Script)

Pulls students + parents from Edsby into a spreadsheet's `Bdays` tab.

Lives here next to `../behaviours-edsby-cookie-sync/` because it shares the same
constraint: **Edsby has no public API**, so every call imitates a logged-in
browser request. The request shape is ported from
`backend/behavior/lib/edsbyRead.js`, the only DevTools-verified shape in this
repo.

## Why the import returns HTTP 403

The failing call answers with Edsby application error **1030, "no links to
node"**:

```
GET ZoomMyStudents/21471167 -> HTTP 403
  {"error":1030,"when":"2026-09-03 13:57:39","errorstr":"no links to node","ticket":""}
```

1030 means **the caller** has no relationship to that node. Two very different
causes produce it:

1. **The request is not authenticated as you.** An unauthenticated caller has no
   link to any node, so Edsby answers node reads with 1030 rather than 401.
2. **The node id is genuinely stale.** Zoom node ids are per-account and change
   across school years.

`/p/ZoomMyStudents/21471167` loads fine in the browser, which rules out (2) —
the id is correct. So this is (1): the session cookie is not authenticating.

### The trap: a bootstrap 200 proves nothing

`GET /core/node.json/?xds=bootstrap` returns HTTP 200 with only a
`session_id_edsby` cookie and no version headers. That is **not** evidence the
session works — `backend/behavior/lib/edsbyRead.js:352` calls it an
"unauthenticated-CSRF bootstrap GET", i.e. it answers without a valid session.
`EdsbyProvider.testConnection` accordingly never treats a bootstrap 200 as a
passing session check; it requires a `_formkey` in the body, and detects an
expired session by the login-form HTML.

So bootstrap succeeding while node reads 403 with 1030 is exactly the signature
of an unauthenticated session, not a healthy one.

### Ruled out so far

- **The node id.** `/p/ZoomMyStudents/21471167` opens in the browser.
- **jver/cver.** Not required; unset and other calls still succeed.
- **"Paste the whole Cookie header."** Plausible from the setup page, but the
  cookie-sync extension pushes only `session_id_edsby`
  (`extensions/behaviours-edsby-cookie-sync/background.js:14`) and the
  honour-roll feature works on it — so one cookie *can* authenticate.
- **HTML-shell auth detection.** Edsby's shell is a 4.5 KB JS bootstrap that
  looks identical signed in or out. `checkAuth()` cannot decide from it.
- **Nav-link scraping.** Neither the shell nor the 200 KB bootstrap contains any
  `/p/<View>/<nid>` link; the nav is built client-side. `discoverZoomNodes()`
  is a dead end on this deployment.

### The pairing rule (from this repo)

`/avgs` — the working Edsby path here — deliberately pairs **cookie ↔ userNid ↔
zoomNid per teacher**:

- `BehaviorTeacher.js:44` — "Edsby's broadcast create is `/core/create/<userNid>`
  and **must match the session**".
- `avgsRoutes.js:111` — node priority is "the signed-in user's own My-Students
  node (**matches whose session is being used**)", from
  `membership.edsbyZoomNid`.

Node `21471167` is linked to one specific Edsby user. Error 1030 "no links to
node" is what you get when the session's user is not that user — a cookie for a
different account, or a stale session that no longer maps to one.

### Compare against /avgs directly

`/avgs` runs the verified backend code against the same node with a cookie you
paste for one run, and dumps raw diagnostics. It is the cleanest A/B test:

1. Open `/avgs` in the app.
2. Put `21471167` in **My Students node** (its placeholder is already that id).
3. Paste a **fresh** cookie into "used for this run only, never saved".
4. Run, and read the diagnostics panel.

If `/avgs` returns students, the cookie and node are fine and the difference is
in this script's request. If it also fails with 1030, the cookie is not the
session that owns that node.

### Ruled out by probing (all 8 combinations)

`probeNode()` against `21471167`, every student-listing view, both methods:

```
  (formkey) — refreshed, POST attempts enabled
✗ ZoomMyStudents [GET]  · Edsby 1030 "no links to node"
✗ ZoomMyStudents [POST] · Edsby 1030
✗ SchoolStudents [GET/POST] · Edsby 1030
✗ Students       [GET/POST] · Edsby 1030
✗ ClassStudents  [GET/POST] · Edsby 1030
```

A formkey **was** obtained, so the CSRF path is available and the POST is not
being rejected for lack of one. And every view fails *identically* — if the
session were authenticated but simply lacked permission for a view, at least
one would fail differently. Identical "no links to node" across all views means
the failure is the node relationship, not view permission.

That leaves only: the session is not authenticated as the user who owns the
node, or it is not authenticated at all.

### The one test that settles it

While signed in to Edsby in a browser, open the API URL directly:

```
https://bcs.edsby.com/core/node.json/21471167?xds=ZoomMyStudents&stage=1
```

- **JSON with students** → node and account are fine; only this script's
  session differs, and the cookie is the thing to replace.
- **1030 again** → even a live browser session cannot use this endpoint, so the
  `/p/ZoomMyStudents/` page reaches its data some other way and the endpoint
  itself is wrong. DevTools → Network on that page shows what it really calls.

This removes Apps Script from the question entirely, which is why it beats
every indirect check attempted so far.

### Still open

Whether the session authenticates at all. Two tests can settle it:

- **`dumpSession()`** — checks `Set-Cookie` (if Edsby hands back a *different*
  `session_id_edsby`, it rejected ours and the cookie is dead), scans the
  bootstrap for person-shaped objects, and retries the node under five
  parameter sets including the original `noForm`/`facetSave` combination.
- **The browser's own request.** DevTools → Network → filter `xds` → open
  `/p/ZoomMyStudents/21471167` → right-click the `ZoomMyStudents` request →
  **Copy as cURL**. Diffing that against what the script sends is the one
  guaranteed answer.

### If the cookie does turn out to be the problem

1. Sign in to Edsby, open DevTools (F12) → **Network**.
2. Filter on `xds` and reload the page.
3. Click any `?xds=` request → **Headers → Request Headers**.
4. Copy **everything after `Cookie:`** — usually several hundred characters
   across several cookies — into `EDSBY_SESSION_COOKIE`.
5. Run **`checkAuth()`**. Once it reports signed in, run `populateBdays()`.

`checkAuth()` tests the one reliable signal: whether the app shell renders as the
signed-in user or as a login page. It also recovers your user nid, worth storing
as `EDSBY_USER_NID`.

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
sent when set. Neither is the cause of this 403, but both align the script with
the one request shape known to work. `EDSBY_JVER` / `EDSBY_CVER` stay
**optional**.

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

Run these from the Apps Script editor, then read the Execution log:

- **`checkAuth()`** — the first thing to run on any 403. Reports whether the
  cookie is actually signed in, and spells out the fix when it is not.
- **`diagnoseEdsby()`** — reports each credential, probes `bootstrap` and
  `ZoomMyStudents`, and reports **Edsby's own error code and string** rather
  than the HTTP status it rides on. When `bootstrap` succeeds but the node call
  fails it says so explicitly, so a valid session is never misread as an expired
  one.
- **`discoverZoomNodes()`** — lists every `/p/<View>/<nid>` nav link the session
  exposes (with per-source byte counts, so an empty source is visible), then
  probes each candidate against all four student-listing views. Run it whenever
  you see error 1030.
- **`probeNode(12345678)`** — tests one id you read out of the browser URL bar
  against every student view. The quickest way to confirm an id before storing
  it. With no argument it probes `EDSBY_ZOOM_NODE_ID`.

### When discovery finds nothing

Nav links are not always present in the app shell — Edsby may build them client
side. Read the id by hand; it takes 20 seconds:

1. Open Edsby in a browser and sign in.
2. Click the page that lists your students ("My Students").
3. The URL is `.../p/ZoomMyStudents/12345678` — take the number.
4. Put it in `EDSBY_ZOOM_NODE_ID`.
5. Run `probeNode()` to confirm, then `populateBdays()`.

If the URL shows a different view name, that is fine — `probeNode()` tries every
student-listing view against the id.

Error codes worth knowing:

| Code | Means | Do |
|---|---|---|
| `1030` `no links to node` | the **caller** has no link to that node: usually not authenticated, sometimes a stale id | `checkAuth()` first. If it says signed in, `discoverZoomNodes()` |
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

Developer-only — this has nothing to do with running the import, which happens
entirely inside the Apps Script editor.

```
node extensions/edsby-bdays-apps-script/test-parsing.mjs
```

109 assertions over the pure functions — response parsing against the recorded
`ZoomMyStudents` shape, group derivation, error-message construction (including
the real 1030 payload above), nav-link harvesting in every shape Edsby emits,
user-nid detection, redirect handling, and column mapping. Apps Script has no
test runner, so `Code.gs` is loaded as text with an export footer appended;
`UrlFetchApp` and `SpreadsheetApp` are never touched.

Several of these tests caught real bugs during development: the harvest regex
missed the `\/`-escaped JSON link form, the diagnostic reported the HTTP status
ahead of Edsby's own error code, one guards against the retracted
"bootstrap returned 200 so your session is valid" verdict reappearing, and the
nid plausibility tests pin a bug where a bare `\d{4,}` match pulled the
timestamp `054748` out of the bootstrap and used it as a user nid.

## Maintenance

Two things drift:

- **The zoom node id**, across school years — `discoverZoomNodes()`, or just let
  `populateBdays()` re-find it.
- **The session cookie**, every so often — re-copy it. The
  `../behaviours-edsby-cookie-sync/` extension automates this for the web app;
  this script still needs a manual paste.

`jver`/`cver` also change with each Edsby release, but these reads do not need
them.
