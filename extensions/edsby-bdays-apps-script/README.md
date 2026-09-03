# Bdays Populator — Edsby → Google Sheets (Apps Script)

Pulls students + parents from Edsby into a spreadsheet's `Bdays` tab.

Lives here next to `../behaviours-edsby-cookie-sync/` because it shares the same
constraint: **Edsby has no public API**, so every call imitates a logged-in
browser request. The request shape is ported from
`backend/behavior/lib/edsbyRead.js`, the only DevTools-verified shape in this
repo.

## Why the old script returned HTTP 403

The previous version sent only a session cookie:

```js
headers: {
  "Cookie": cookie,
  "Origin": "https://bcs.edsby.com",
  "X-Requested-With": "XMLHttpRequest",
}
```

Two problems, either of which produces a 403:

1. **Missing `x-xds-jver` / `x-xds-cver`.** Edsby requires these client-version
   headers on `/core/node.json/` calls. Every working request in this repo sends
   them (`backend/behavior/lib/edsbyRead.js:44-45`,
   `backend/behavior/lib/providers/EdsbyProvider.js:61`). They change with each
   Edsby release, so a script that never sent them breaks permanently, and one
   that hardcodes them breaks at the next release.
2. **`Origin` + `X-Requested-With` on a plain GET.** The verified GET path sends
   neither; adding `Origin` makes the request look cross-origin and trips
   Edsby's CSRF rejection. They belong only on the formkey `POST` fallback.

A third, likelier-than-it-looks cause: the old setup notes said to store just
`session_id_edsby=<value>`. Edsby generally needs the **whole** `Cookie:` header.

## Setup

Project Settings → Script Properties:

| Property | Required | What |
|---|---|---|
| `EDSBY_SESSION_COOKIE` | yes | the **entire** `Cookie:` header line from a logged-in Edsby request |
| `EDSBY_JVER` | yes | value of the `x-xds-jver` request header |
| `EDSBY_CVER` | yes | value of the `x-xds-cver` request header |
| `EDSBY_USER_NID` | no | your Edsby user/teacher nid — enables the formkey POST retry |
| `EDSBY_BASE_URL` | no | defaults to `https://bcs.edsby.com` |

To capture all of them at once: sign in to Edsby → DevTools (F12) → **Network**
→ filter `xds` → reload → click any `?xds=Panorama` request → **Headers →
Request Headers**. Copy everything after `Cookie:`, plus `x-xds-jver` and
`x-xds-cver`. (`jver` is also the `_i=` hash on `engine.min.js`.)

Then add a button on the Bdays sheet → Assign script → `populateBdays`.

## Run `diagnoseEdsby()` first

When something fails, run `diagnoseEdsby()` from the Apps Script editor and read
the Execution log. It reports which credential is missing or stale, probes both
`bootstrap` and `ZoomMyStudents`, and explains the status instead of logging a
bare `HTTP 403`. Sample output:

```
Cookie:   612 chars, 7 cookie(s), session_id_edsby present
jver:     ⚠ MISSING — set EDSBY_JVER (403s without it)
Probe GET ZoomMyStudents/21471167 -> HTTP 403
  Forbidden. Almost always stale/missing x-xds-jver or x-xds-cver …
```

## What else changed

- **Retries the listing.** Tries `ZoomMyStudents`, then `SchoolStudents`,
  `Students`, `ClassStudents` — an admin account is often denied
  `ZoomMyStudents` (Edsby error `1030`), which the old script reported as
  "returned no students".
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

## Maintenance

`jver`/`cver` change with every Edsby release and the cookie expires
periodically. When the import starts failing, re-copy all three from a live
request. The `../behaviours-edsby-cookie-sync/` extension automates the cookie
half of this for the web app; this script still needs it pasted by hand.
