# Extracting student data from Edsby — handoff brief

Paste this into a new thread. Everything here was verified against live
responses from `bcs.edsby.com` (Sept 2026), not inferred. The traps section is
the important part: each one cost a wrong diagnosis before it was understood.

Working implementations in this repo:
`extensions/edsby-bdays-apps-script/Code.gs` (Apps Script) and
`backend/behavior/lib/edsbyRead.js` (Node).

---

## 1. There is no public API

Everything imitates a logged-in browser. One endpoint does the work:

```
GET https://<school>.edsby.com/core/node.json/<nid>?xds=<View>&stage=1
Cookie: session_id_edsby=<value>
Accept: application/json, text/plain, */*
```

- **`stage=1` is required** for the student rows. Without it you get the page
  shell and no data.
- **A session cookie is the only credential needed** for reads. `x-xds-jver` /
  `x-xds-cver` headers appear in the backend implementation and are harmless to
  send, but reads succeed without them.
- **Do not send `Origin` or `X-Requested-With` on GETs.** The verified path
  sends neither.
- Responses are JSON with the payload at `slices[0].data`.

### The CSRF POST fallback

Some views answer a POST when the GET is refused: same URL plus `_method=GET`,
a multipart body carrying `_formkey`, and headers `Origin` +
`x-edsby-client-request-queue: net::post`. Get a fresh formkey by regexing
`_formkey"?\s*[:=]\s*"([^"]+)"` out of `?xds=bootstrap` — they expire in
minutes, so fetch one immediately before use.

---

## 2. Traps that will waste your time

**`?xds=bootstrap` answers WITHOUT a valid session.** It returns HTTP 200 and
~200 KB of app config to an unauthenticated caller. It is *not* a login check.
`edsbyRead.js` calls it an "unauthenticated-CSRF bootstrap GET".

**An expired session returns `403 {"error":1030,"errorstr":"no links to node"}`
— not 401, not a login page.** Combined with the above, a dead cookie presents
as a permissions or wrong-node problem. This is the single biggest time sink.

**Error 1030 has three distinct meanings.** Always read `errorstr`, never just
the code or the HTTP status:

| `errorstr` | Means | Fix |
|---|---|---|
| `no links to node` | caller is not authenticated (or not the node's owner) | fresh cookie |
| `denied nodetype(xds=X)` | authenticated, wrong role — `ZoomMyStudents` needs `School Teacher` | sign in as the teacher, not an admin |
| `denied(xds not found)` | that view does not exist on this deployment | wrong view name |

**A zoom lists only students the signed-in teacher shares a class with.** Not
the whole school. A grade you do not teach is simply absent — nothing is
filtering it. Node ids are per-account and change across school years, so
support a comma-separated list and union by nid (both implementations do).

**`Classes[]` carries historical enrolments.** A grade-8 student can still list
last year's `HR7B`. Distinguish by id range (`34944xxx` was last year,
`38275xxx` current) or, more robustly, only trust a class whose grade digits
match the student's `Grade`.

**These views do NOT exist** on this deployment (`denied(xds not found)`):
`SchoolStudents`, `Students`, `ClassStudents`. Only `ZoomMyStudents` is real.

**Nav links are built client-side.** Neither the 4.5 KB app shell nor the
200 KB bootstrap contains a `/p/<View>/<nid>` link, so you cannot scrape node
ids. Read them from the browser URL bar.

---

## 3. Where each field lives

### Roster — `?xds=ZoomMyStudents&stage=1` on the zoom node

Rows at `slices[0].data.zoom.data.table.rec`, an object keyed `r<rowid>`. Find
the map by shape (keys mostly matching `^r\d+$`) rather than a fixed path — the
nesting moves between releases. Each row:

```json
{ "nid": 11326682, "FirstName": "Benjamin", "PrefName": "Benjamin",
  "LastName": "Whitaker", "MName": "Stuart", "Gender": "M", "Grade": "7",
  "SID": 328374723, "MinistryID": "927771790", "accountStatus": "0",
  "haveiep": 0, "BusRoute": "BR 4", "custom": { "psID": "843" },
  "hrTeacher": [ { "nid": 7571441, "name": "Mrs. Annette Cabral" } ],
  "Classes": [ { "id": 38275317, "PrefName": "HIST7A",
                 "LastName": "History - 07" } ] }
```

Top level also carries `"unid"` — **the signed-in user's own nid** — and
`perm.roles`. `accountStatus`: `0` active, `-2` not activated, `-4` suspended.
Dropped students are excluded unless you pass `showdropped=1`.

### Per student — `?xds=Panorama` on the student's nid

- `col3.info` → `lastname`, `prefname`, `grade`, `gender`, **`birthday`** (the
  only place DOB appears), `homeroom.data.teacher[]`
- `col1.parents.parents` → each `{ nid, profpicname.name.{name, role} }`;
  role matches `/Father|Mother|Stepfather|Stepmother/`

This is the student's **own** page, so it carries their real homeroom even when
the zoom row's classes do not.

### Per parent — `?xds=ParentDetails` on the parent's nid

Email at `col1.col1.account.email`, falling back to `col2.info.email`.

### Section / homeroom ("8A" rather than "8")

No single field holds it. Derive, in order of trust:
1. The zoom row's `Classes[].PrefName` — `HR8A`, `GEO8B`, `MATH7B`, `HIST7C` —
   but only when the grade digits match the student's `Grade`.
2. The student's Panorama homeroom.
3. Their `hrTeacher`: learn teacher→section from students who resolved, then
   apply it to those who did not. A homeroom teacher maps to one section.

Watch the regex: `MLS68Sommer` must yield nothing, and `HR8A` matches both an
HR pattern and a generic course-code pattern, so de-duplicate.

### Untested lead — CSV export

The zoom's own JSON describes an export button hitting
`cf.gbl.csvexport + <nid> + '?xds=ZoomMyStudentsExport&attachment=1'`. Might be
far simpler than walking Panorama per student. Nobody has tried it.

---

## 4. Getting the credentials

**Cookie:** sign in → DevTools (F12) → Network → filter `xds` → click any
`?xds=` request → Headers → Request Headers → copy everything after `Cookie:`.
On `bcs.edsby.com` that is a single ~53-character `session_id_edsby=…`; one
cookie is normal there, so cookie count says nothing about validity.

**Zoom node id:** open the page listing your students; the URL is
`/p/ZoomMyStudents/<NUMBER>`.

**Your user nid:** the `unid` field in any zoom response.

**To verify a session in one step**, paste this into a signed-in browser tab:

```
https://bcs.edsby.com/core/node.json/21471167?xds=ZoomMyStudents&stage=1
```

Students back → cookie, node and endpoint are all fine and any failure is in
your request. 1030 → the session is the problem. This beats every indirect
check; reach for it first.

Cookies expire every few days. `extensions/behaviours-edsby-cookie-sync/`
automates refreshing them.

---

## 5. Privacy

This is K-12 student data: names, DOBs, ministry IDs, parent emails, IEP flags.

- Do not commit real student data to a repo — build test fixtures with invented
  names.
- `backend/behavior/lib/rosterImport.js` deliberately drops ethnicity and
  strips bracketed tags (`Smith [White]`) from names, because the source data
  embeds them there. Preserve that anywhere data leaves the system.
