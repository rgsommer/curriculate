# Bdays Populator — Edsby → Google Sheets (Apps Script)

Pulls students + parents from Edsby into a spreadsheet's `Bdays` tab.

Lives here next to `../behaviours-edsby-cookie-sync/` because it shares the same
constraint: **Edsby has no public API**, so every call imitates a logged-in
browser request. The request shape is ported from
`backend/behavior/lib/edsbyRead.js`, the only DevTools-verified shape in this
repo.

## Why the import returns HTTP 403 — solved

**The session cookie is stale. Copy a current one.**

Opening the API URL directly in a signed-in browser returns the full student
list:

```
https://bcs.edsby.com/core/node.json/21471167?xds=ZoomMyStudents&stage=1
→ {"slices":[{"data":{"nid":21471167,...,"zoom":{"data":{"table":{"rec":{...}}}}}}],
   "unid":25582870, "perm":{"roles":["Staff","School Teacher","Teacher",...]}}
```

So the node id, the endpoint and the `xds=ZoomMyStudents&stage=1` parameters are
all correct. Three sessions, three different answers:

| Session | Result | Meaning |
|---|---|---|
| Browser, live | students | right account, right node |
| `/avgs`, pasted cookie | `denied nodetype(xds=ZoomMyStudents)` | authenticated, but not a School Teacher |
| Apps Script, months-old cookie | `no links to node` | not authenticated at all |

### The trap

**`1030 "no links to node"` is Edsby's expired-session signature for node
reads.** It is not a 401 and not a login page, so the usual expiry checks never
fire — and `?xds=bootstrap` keeps returning HTTP 200 alongside it because it
answers unauthenticated. Between them, an expired session looks like a
permissions or node problem. That is what sent three earlier diagnoses down the
wrong path here.

The three 1030 variants are now reported distinctly:

| errorstr | Means | Fix |
|---|---|---|
| `no links to node` | caller not authenticated — **stale cookie** | copy a current `session_id_edsby` |
| `denied nodetype(xds=…)` | authenticated, wrong role — `ZoomMyStudents` needs `School Teacher` | sign in as the teacher, not an admin |
| `denied(xds not found)` | that view does not exist here | wrong view name |

That last one also proves `SchoolStudents`, `Students` and `ClassStudents` do
**not** exist on this deployment, so the fallback list in
`backend/behavior/lib/edsbyRead.js:30` only ever costs six wasted requests here.

### Do this

1. Open Edsby in a browser and sign in **as the teacher** (an admin account
   gets `denied nodetype`).
2. DevTools (F12) → **Network** → filter `xds` → click any `?xds=` request →
   **Headers → Request Headers** → copy the `Cookie:` value.
3. Put it in `EDSBY_SESSION_COOKIE`, and set `EDSBY_USER_NID` to `25582870`
   (the `unid` from the response above).
4. Run `populateBdays()`.

### Then stop doing it by hand

The Cookie Sync extension pushes only to the Behaviours backend
(`api.curriculate.net/api/behavior/edsby/ingest`), which is why this
spreadsheet's cookie went stale while the web app's stayed fresh — they are
different stores and nothing linked them.

Extension v1.3.0 accepts **several ingest URLs, one per line**, so it can feed
this script too. Set it up once and the cookie never has to be pasted again:

1. Script Properties → add `EDSBY_INGEST_TOKEN` with a long random value.
2. **Deploy → New deployment → Web app**, Execute as **Me**, Access **Anyone**.
3. In the extension's options, add a second Ingest URL line:
   `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?token=<TOKEN>`
4. Reload the unpacked extension (its host permissions changed), then click its
   toolbar button.

`doPost` accepts the extension's payload and writes `EDSBY_SESSION_COOKIE`,
`EDSBY_BASE_URL`, `EDSBY_JVER`, `EDSBY_CVER` and `EDSBY_USER_NID`, plus
`EDSBY_COOKIE_UPDATED_AT` — which `diagnoseEdsby()` prints, so a stale sync is
visible at a glance. The token is in the query string because Apps Script cannot
read custom request headers; treat that URL as a password.

A `GET` on the same URL returns a liveness check (token configured? cookie
present? last updated when?) and never returns the cookie itself.

## Using it

An **Edsby** menu appears in the spreadsheet toolbar. That is the whole
interface — there is nothing to pick out of a function list:

| Menu item | When |
|---|---|
| **Update Roster** | the one you want, every time |
| Export roster CSV | to feed the roster into Behaviours |
| Check connection | it failed, and you want to know why |
| Find my students list | the connection is fine but no students come back |
| Full diagnostics (when stuck) | nothing else explained it |
| Sort by grade | as before |

Everything else in `Code.gs` is a private helper (trailing `_`), so only these
and the two web-app entry points appear in the editor's Run list — 8 public
functions out of 67. `populateBdays` keeps its name so any button already
assigned to it still works.

Menu items mirror their log into a dialog, because `Logger` output is invisible
when a function runs from a menu rather than the editor.

## How the Group (section) is worked out

The Group column wants `8A`, not `8`. Three sources are tried in order of
trust, and only then does it fall back to the bare grade:

1. **The student's own classes in the zoom row.** Works when a `PrefName`
   carries the section (`HR8A`, `GEO8B`, `MATH7B`) *and* its grade digits match
   the student's `Grade`.
2. **The student's Panorama.** The zoom lists only classes shared with the
   signed-in teacher, so a student whose one shared class is section-less —
   `Learning Skills` / `MLS68Sommer`, id `34944663`, last year's — resolves
   nothing at step 1. Panorama is their own page and carries their real
   homeroom. It is already fetched for DOB and parents, so this costs no extra
   requests.
3. **Their homeroom teacher.** Every zoom row has `hrTeacher`, and a homeroom
   teacher maps to one section, so the mapping is *learned* from the students
   who did resolve and applied to those who did not — the automatic version of
   `CONFIG.TEACHER_TO_CLASS`, which remains as a manual override and still
   wins. A teacher running homerooms in two grades cannot mislabel across them:
   an inferred section is only accepted when its grade matches the student's.

**Stale enrolments are discarded, not used.** `Classes` carries history, so a
grade-8 student can still list last year's `HR7B` (note the id ranges: `34944xxx`
is last year, `38275xxx` current). A token whose grade disagrees with the
student's now yields nothing, letting steps 2 and 3 answer instead — returning
`""` is better than returning last year's section.

The run log reports where each section came from, the teacher→section map it
learned, and names anyone still unresolved:

```
Sections resolved from: {"own classes":41,"panorama":12,"homeroom teacher":9}
Homeroom teacher → section (learned): {"Mr. Richard Sommer":"8A","Ms. Nakesha McKenzie":"8B"}
No section for 2 student(s) — Group falls back to their grade. …
  Asante, Davine (Mrs. Jil Ng)
```

## Roster CSV export

**Edsby → Export roster CSV** writes a file to Drive and shows a link. The
headers are the canonical ones from `backend/behavior/lib/rosterImport.js`, so
it uploads into Behaviours → Students → Import roster with no editing:

```
Student ID, Last Name, First Name, Common/Preferred Name, Gender,
Class/Group, Grade, House, DOB,
Parent 1 Name, Parent 1 Email, Parent 1 Edsby ID,
Parent 2 Name, Parent 2 Email, Parent 2 Edsby ID
```

- Only **Last Name** and **First Name** matter; a row with either is exported,
  a row with neither is skipped and reported (blank padding rows are not).
- **House** matches an existing house by name or creates one on import. The
  Bdays sheet has no House column and Edsby supplies none, so it exports blank
  unless you set `CONFIG.CSV.HOUSE_COL` to the column you keep houses in. The
  import never writes that column.
- **Grade** is derived from the Group cell (`8A` → `8`), since the sheet has no
  separate grade column.
- **Parent Edsby IDs** come from columns V and W, which `Update Roster` now
  fills from each student's Edsby parent nids. They feed `EdsbyProvider`, so
  notices post through Edsby instead of falling back to email.
- **Ethnicity is never exported.** There is no such column, and bracketed tags
  like `Smith [White]` are stripped from names on the way out — mirroring
  `stripTags()` in the importer — so a tag pasted into this sheet cannot
  travel.
- Dates become `yyyy-MM-dd`. An ambiguous `01/04/2011` is passed through as
  typed rather than guessed at, because picking d/m/y over m/d/y here would
  silently corrupt birthdays; the importer parses tolerantly.
- The export reads **the sheet**, not a fresh Edsby pull, so manual corrections
  are included. Run **Update Roster** first if you want current data.

## What happens to students who leave

`Update Roster` **merges** rather than wiping:

- Rows are matched on the student's Edsby nid, kept in **column U**.
- Matched rows are updated in place, so notes you keep in C, D, I–M, O or R
  survive, and the column-T formula is never touched.
- New students are appended.
- Students no longer in Edsby move to a **`Bdays Archive`** sheet with the date
  they were first missing, then their row is removed from `Bdays`. Nothing is
  deleted.
- The data rows are then sorted by last name, first name.

On the first merge run the sheet has no nids yet, so rows are adopted by
last+first name (case- and spacing-insensitive) instead of being archived
wholesale. After that the nid is authoritative, so a student who changes
surname keeps her row rather than appearing twice.

Edsby's zoom already excludes dropped students — "Show Dropped" defaults off
and the request does not pass `showdropped=1` — so anyone absent from the
response has genuinely left or moved on.

Set `CLEAR_OLD_ROWS: true` only to force a full rebuild; that path clears the
imported columns and writes every student, with no archive step.

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

136 assertions over the pure functions — response parsing against the recorded
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
