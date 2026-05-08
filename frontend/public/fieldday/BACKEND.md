# Field Day — Backend Contract

The Field Day client (`api.js`) talks to a REST API at `FIELDDAY_API_BASE`
(default `/fieldday/api`). When the backend is unreachable the client
silently falls back to localStorage, so the app stays usable for solo demos
while the server side is being built — but **multi-device operation
requires the endpoints below to be implemented**.

This document is the source of truth for what the backend must provide.

---

## Auth & sessions

The client sends `Authorization: Bearer <sessionToken>` on all requests
after sign-in. Tokens are opaque to the client. Same-origin cookies work
too — `credentials: "same-origin"` is set on every fetch.

Two roles:

- **`admin`** — owns a school, sees all events for that school, can
  edit settings, archive seasons, etc.
- **`leader`** — joined a school via its school code, sees / edits only
  events whose `leaderName` matches their own.

The server should authorize every request on (a) a valid session and
(b) the authenticated session's `schoolId` matching the data being
touched. Leader sessions should be denied for any admin-only endpoint
(see "Auth requirement" notes below).

---

## Endpoints

All paths are relative to `/fieldday/api`.

### `POST /admin/request-passkey`

Initiates admin sign-in. Generates a passkey, stores it (with TTL — 15
minutes is reasonable), and emails it from `Curriculate Field Day
<fieldday@curriculate.net>` using the existing curriculate.net/grading
email pipeline.

**Request:** `{ "email": "user@school.org" }`

**Response 200:**
```json
{
  "emailed": true,
  "hasSchools": true
}
```
- `emailed` — `true` if the email was sent. If `false` and `devPasskey` is
  present, the client will display the code on screen (dev / staging only).
- `hasSchools` — `true` if any school is registered to this email.

Auth requirement: none.

---

### `POST /admin/verify-passkey`

Verifies the passkey emailed in the previous step. On success, returns a
session token and the list of schools the email is admin of. If the email
has never been registered, returns an empty `schools` array — the client
will then call `POST /schools` to create one.

**Request:** `{ "email": "user@school.org", "passkey": "123456" }`

**Response 200:**
```json
{
  "sessionToken": "opaque-token-string",
  "schools": [
    { "id": "abc123", "name": "Maple Elementary", "code": "MAPLE26", "createdAt": 1715000000000 }
  ]
}
```

**Response 401:** `{ "error": "bad_passkey" }`

Auth requirement: none.

---

### `POST /admin/select-school`

Sets the active `schoolId` on the current admin session (when an email is
admin of more than one school).

**Request:** `{ "schoolId": "abc123" }`

**Response 200:** `{ "ok": true }`

Auth: admin session, must own the requested school.

---

### `POST /schools`

Creates a new school. Bound to the currently-authenticated admin email.

**Request:** `{ "name": "Maple Elementary", "code": "MAPLE26" }`

**Response 200:**
```json
{
  "school": {
    "id": "abc123",
    "name": "Maple Elementary",
    "code": "MAPLE26",
    "ageCategories": ["5","6","7","8","9","10","11","12","13","14"],
    "eventLibrary": ["50m Sprint", "100m Sprint", "..."],
    "tieMethod": "average",
    "archives": [],
    "createdAt": 1715000000000
  }
}
```

**Response 409:** `{ "error": "code_taken" }` if the code is already in use.

Auth: admin session.

---

### `POST /leader/join`

Looks up a school by code and creates a leader session bound to it.

**Request:** `{ "schoolCode": "MAPLE26", "leaderName": "Coach Smith" }`

**Response 200:**
```json
{
  "sessionToken": "opaque-token-string",
  "school": { "id": "abc123", "name": "Maple Elementary", "code": "MAPLE26" }
}
```

**Response 404:** `{ "error": "school_not_found" }`

Auth: none.

---

### `POST /sign-out`

Invalidates the current session.

**Response:** 200 or 204.

---

### `GET /state`

Returns the full snapshot for the session's active school. Called on boot
and polled while the user is on Admin / Announce / Event Detail (every
6 seconds).

**Response 200:**
```json
{
  "school": {
    "id": "abc123", "name": "Maple Elementary", "code": "MAPLE26",
    "ageCategories": ["5","6","7","8","9","10","11","12","13","14"],
    "eventLibrary": ["50m Sprint", "..."],
    "tieMethod": "average",
    "archives": [
      { "id": "arc1", "label": "2024-25", "archivedAt": 1715000000000,
        "events": [...], "announceQueue": [...] }
    ]
  },
  "events": [
    {
      "id": "e1", "schoolId": "abc123", "leaderName": "Coach Smith",
      "title": "50m Sprint", "age": "8", "gender": "Girls",
      "type": "timed", "attempts": 1, "unit": "seconds", "notes": "",
      "competitors": [
        { "id": "c1", "name": "Maya Patel", "attempts": [8.42] }
      ],
      "status": "completed",
      "completedAt": 1715000000000,
      "announcedAt": null,
      "createdAt": 1714900000000
    }
  ],
  "announceQueue": ["e1"]
}
```

For **leader sessions**, return only events whose `leaderName` matches
the session's leader name (or all of them and let the client filter — the
client already does this).

Auth: any session.

---

### `POST /events`

Creates an event. The client sends `leaderName`; the server should also
trust the session and may overwrite it.

**Request:**
```json
{
  "title": "50m Sprint", "age": "8", "gender": "Girls",
  "type": "timed", "attempts": 1, "unit": "seconds", "notes": "",
  "leaderName": "Coach Smith",
  "competitors": [{ "id": "c1", "name": "Maya Patel", "attempts": [null] }]
}
```

**Response 200:** `{ "event": { ...full event... } }`

Auth: any session.

---

### `PATCH /events/:id`

Partial update of an event's metadata. Used for the Edit Event form.
The client may send a `competitors` array when the `attempts` count
changes (it pre-resizes attempts arrays).

**Request:** `{ "title": "...", "attempts": 3, "competitors": [...] }`

**Response 200:** `{ "event": { ...updated event... } }`

Auth: admin, OR leader who owns this event.

---

### `DELETE /events/:id`

Deletes an event and removes it from any announce queue.

**Response:** 204 (or `{ "ok": true }`).

Auth: admin, OR leader who owns this event.

---

### `POST /events/:id/submit`

Marks the event `completed`, sets `completedAt`, and adds it to
`announceQueue` if not already present.

**Response 200:** `{ "event": { ...updated event... } }`

Auth: admin, OR leader who owns this event.

---

### `POST /events/:id/reopen`

Returns the event to `in_progress`, clears `completedAt` and `announcedAt`,
and removes it from `announceQueue`.

**Response 200:** `{ "event": { ...updated event... } }`

Auth: admin, OR leader who owns this event.

---

### `POST /events/:id/competitors`

Adds a competitor to an event with an empty attempts array sized to the
event's `attempts` count.

**Request:** `{ "name": "Jordan Smith" }`

**Response 200:** `{ "competitor": { "id": "c2", "name": "Jordan Smith", "attempts": [null, null, null] } }`

Auth: admin, OR leader who owns this event.

---

### `PATCH /events/:id/competitors/:cid`

Updates the competitor's `name` (and possibly `attempts` array, though
attempt updates should prefer the dedicated endpoint below).

**Request:** `{ "name": "Jordan A. Smith" }`

**Response 200:** `{ "competitor": { ...updated... } }`

---

### `DELETE /events/:id/competitors/:cid`

Removes a competitor from an event.

**Response:** 204 or `{ "ok": true }`.

---

### `PUT /events/:id/competitors/:cid/attempts/:idx`

Sets a single attempt result. `value` is a number (seconds rounded to
hundredths for timed events; a positive number with the event's unit
otherwise) or `null` to clear.

**Request:** `{ "value": 8.42 }` *(or `{ "value": null }`)*

**Response 200:** `{ "competitor": { ...updated competitor... } }`

This endpoint fires often (every blur on a result cell, plus every
stopwatch press), so it should be cheap and idempotent.

Auth: admin, OR leader who owns this event.

---

### `PATCH /schools/me`

Updates the current school's settings. All fields optional.

**Request:** `{ "tieMethod": "higher", "ageCategories": ["6","7","8"], "eventLibrary": ["50m","100m","..."] }`

**Response 200:** `{ "school": { ...updated school... } }`

Auth: admin only.

---

### `POST /schools/me/archives`

Snapshots all current events + announce queue into a new archive entry,
then removes those events from the live state. Used to start a new
school year.

**Request:** `{ "label": "2024-25" }`

**Response 200:** `{ "archive": { "id": "arc1", "label": "2024-25", "archivedAt": ..., "events": [...], "announceQueue": [...] } }`

Auth: admin only.

---

### `POST /schools/me/archives/:id/restore`

Moves an archive's events + queue back into live state and removes the
archive entry. If any restored event id collides with a live event id,
the server should mint a new id for the restored event.

**Response 200:** `{ "archive": {...}, "eventsRestored": 12 }`

Auth: admin only.

---

### `DELETE /schools/me/archives/:id`

Permanently deletes an archive.

**Response:** 204.

Auth: admin only.

---

### `POST /announce/:id/announced`

Marks an event as announced — sets `announcedAt` and removes it from
`announceQueue`.

**Response 200:** `{ "ok": true }`

Auth: admin only.

---

### Multi-admin endpoints

#### `POST /admin/join-school`

Adds the currently-authenticated admin email to an existing school's admin
list. Lets a colleague who already has email+passkey join an existing
school by knowing its school code.

**Request:** `{ "schoolCode": "MAPLE26" }`

**Response 200:** `{ "school": {...full school object...} }`

**Response 404:** `{ "error": "school_not_found" }`

Auth: admin session.

---

#### `POST /schools/me/code-change-request`

Generates a 6-digit confirmation code, stores it server-side with TTL,
and emails it to the school's `masterAdminEmail`. Used to authorize a
school-code change.

**Response 200:** `{ "confirmationSent": true }`

In dev / staging where no email is sent, the response may include
`devConfirmationCode` so the client can display it on screen.

Auth: admin session for the school.

---

#### `POST /schools/me/code-change`

Applies the code change after the master admin confirms.

**Request:** `{ "newCode": "MAPLE27", "confirmationCode": "123456" }`

**Response 200:** `{ "school": {...full school object with new code...} }`

**Response 401:** `{ "error": "bad_confirmation" }`
**Response 409:** `{ "error": "code_taken" }` if newCode is already in use.

Auth: admin session for the school.

---

#### `POST /schools/me/invite-admin`

Sends an email to a fellow admin's address, inviting them to join the
school. The email should contain the school name, school code, and a
direct link to the app's admin sign-in.

**Request:** `{ "email": "colleague@school.org" }`

**Response 200:** `{ "sent": true }`

Sender display name: `Curriculate Field Day`. Subject template:
`You've been invited to admin {schoolName} on Field Day`.

Auth: admin session for the school.

---

### School Records

`school.records[]` items have shape:
```json
{ "id":"r1", "title":"50m Sprint", "age":"8", "gender":"Girls",
  "type":"timed", "unit":"seconds", "value":7.92,
  "holderName":"Maya Patel", "dateSet":"2026-05-08",
  "eventId":"e1", "competitorId":"c1", "createdAt":1715000000000 }
```

#### `POST /schools/me/records`

Adds a new record (or overwrites an existing one for the same
title/age/gender — though the client also calls PATCH for that).

**Request:** record object (without id; server mints).

**Response 200:** `{ "record": {...} }`

#### `PATCH /schools/me/records/:id`

Partial update. Used when the app detects a result that beats the
existing record and wants to overwrite the value/holder/date in place.

**Request:** any subset of record fields.

**Response 200:** `{ "record": {...} }`

#### `DELETE /schools/me/records/:id`

**Response:** 204.

Auth: admin only for all of the above.

---

### Performance Standards

`school.standards[]` items have shape:
```json
{ "id":"s1", "title":"50m Sprint", "ageBand":"7-8", "gender":"Girls",
  "type":"timed", "unit":"seconds",
  "gold":9.8, "silver":10.8, "bronze":11.8 }
```

#### `POST /schools/me/standards`

**Request:** standard object without id.

**Response 200:** `{ "standard": {...} }`

#### `PATCH /schools/me/standards/:id`

**Request:** subset of `gold` / `silver` / `bronze` (or any field).

**Response 200:** `{ "standard": {...} }`

#### `DELETE /schools/me/standards/:id`

**Response:** 204.

Auth: admin only.

---

### Updated school object

`PATCH /schools/me` now also accepts:
- `scoringMode` — `"placement"` | `"standard"`
- `ageBands` — array of strings (e.g. `["5-6","7-8","9-10","11-12","13-14"]`)
- `eventRules` — object keyed by event title → rules text string

The full school object returned by `GET /state` should include:
```json
{
  "id": "abc", "name": "...", "code": "...",
  "masterAdminEmail": "creator@school.org",
  "adminEmails": ["creator@school.org", "colleague@school.org"],
  "ageCategories": [...], "ageBands": [...],
  "eventLibrary": [...], "eventRules": { "50m Sprint": "...", ... },
  "tieMethod": "average", "scoringMode": "placement",
  "records": [...], "standards": [...], "archives": [...]
}
```

---

### `POST /announce/:id/skip`

Moves an event from the front of `announceQueue` to the back. (No state
change on the event itself.)

**Response 200:** `{ "ok": true }`

Auth: admin only.

---

## Minimum schema

Reasonable starting point — adjust to your existing conventions:

```sql
schools (
  id                  text primary key,
  name                text not null,
  code                text not null unique,
  master_admin_email  text not null,    -- the original creator
  age_categories      jsonb not null,
  age_bands           jsonb not null,
  event_library       jsonb not null,
  event_rules         jsonb not null default '{}'::jsonb,
  tie_method          text not null default 'average',  -- 'average' | 'higher'
  scoring_mode        text not null default 'placement',-- 'placement' | 'standard'
  created_at          timestamptz not null default now()
)

admin_passkeys (
  email           text not null,
  passkey_hash    text not null,        -- bcrypt or scrypt
  expires_at      timestamptz not null,
  primary key (email)
)

-- Many-to-many for admins-of-schools. An email may admin multiple schools,
-- and a school may have multiple admins.
school_admins (
  email           text not null,
  school_id       text not null references schools(id) on delete cascade,
  primary key (email, school_id)
)

-- Pending school-code-change confirmations
code_change_requests (
  school_id          text primary key references schools(id) on delete cascade,
  confirmation_code  text not null,
  expires_at         timestamptz not null
)

records (
  id              text primary key,
  school_id       text not null references schools(id) on delete cascade,
  title           text not null,
  age             text not null,
  gender          text not null,
  type            text not null,        -- 'timed' | 'distance' | 'weight'
  unit            text,
  value           numeric not null,
  holder_name     text,
  date_set        date,
  event_id        text references events(id) on delete set null,
  competitor_id   text references competitors(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (school_id, title, age, gender)
)

standards (
  id              text primary key,
  school_id       text not null references schools(id) on delete cascade,
  title           text not null,
  age_band        text not null,
  gender          text not null,
  type            text not null,
  unit            text,
  gold            numeric,
  silver          numeric,
  bronze          numeric,
  unique (school_id, title, age_band, gender)
)

events (
  id              text primary key,
  school_id       text not null references schools(id) on delete cascade,
  leader_name     text not null,
  title           text not null,
  age             text not null,
  gender          text not null,
  type            text not null,        -- 'timed' | 'distance' | 'weight'
  attempts        int  not null,
  unit            text,
  notes           text,
  status          text not null,        -- 'in_progress' | 'completed'
  completed_at    timestamptz,
  announced_at    timestamptz,
  created_at      timestamptz not null default now()
)

competitors (
  id              text primary key,
  event_id        text not null references events(id) on delete cascade,
  name            text not null,
  attempts        jsonb not null default '[]'::jsonb,
  position        int                              -- ordering within event
)

announce_queue (
  school_id       text not null references schools(id) on delete cascade,
  event_id        text not null references events(id) on delete cascade,
  position        int  not null,
  primary key (school_id, event_id)
)

archives (
  id              text primary key,
  school_id       text not null references schools(id) on delete cascade,
  label           text not null,
  archived_at     timestamptz not null default now(),
  payload         jsonb not null     -- snapshot of {events, announceQueue}
)

sessions (
  token           text primary key,
  email           text,                -- for admin sessions
  school_id       text references schools(id) on delete cascade,
  role            text not null,       -- 'admin' | 'leader'
  leader_name     text,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
)
```

---

## Email integration

The admin passkey email is sent through the existing
`/grading/api/send-email` mechanism (or whatever the curriculate.net email
service exposes). The `From` should be:

- **Display name:** `Curriculate Field Day`
- **Address:** `fieldday@curriculate.net` (or similar — anything
  `@curriculate.net` is fine)

Subject and body templates are at the top of the request-passkey handler
in `api.js` (`sendPasskeyEmail`-style payload). The backend should mirror
the same wording so the email looks identical regardless of which path
generated it.

---

## Frontend dev notes

- The client has a built-in offline fallback to localStorage. To **force
  remote mode** during testing, run in the browser console:
  ```js
  localStorage.removeItem("fielddayMode"); location.reload();
  ```
  To **force local mode**:
  ```js
  FieldDayAPI.forceLocalMode(); location.reload();
  ```

- To point the client at a different API base (e.g. a staging server),
  set before `app.js` loads:
  ```html
  <script>window.FIELDDAY_API_BASE = "https://staging.curriculate.net/fieldday/api";</script>
  ```

- Live polling cadence is 6 seconds, only on Admin / Announce / Event
  Detail views. Tune via `POLL_MS` in `app.js`.

- The client always keeps a write-through cache in `localStorage` under
  the key `fielddayData`. This is used by Export / Import in the Admin
  tab. It does **not** survive `Reset all data` in Settings.
