# Field Day backend

Self-contained Express + Mongoose module powering the Field Day app at
`/fieldday`. Drops into your existing Curriculate backend with one line.

## Install

```bash
cd backend
npm install bcryptjs cookie-parser
```

`mongoose` is already a dependency of the rest of Curriculate; we reuse it.

## Mount

In `backend/index.js` (or wherever your Express app lives):

```js
const fielddayRouter = require("./fieldday");
app.use("/fieldday/api", fielddayRouter);
```

That's it. All routes documented in `frontend/public/fieldday/BACKEND.md`
become available under `/fieldday/api/*` and match the client's `api.js`.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `FIELDDAY_PASSKEY_TTL_MIN` | 15 | How long a passkey is valid after we email it. |
| `FIELDDAY_SESSION_TTL_DAYS` | 14 | Session-token lifetime. |
| `FIELDDAY_CODE_CHANGE_TTL_MIN` | 30 | School-code-change confirmation code lifetime. |
| `FIELDDAY_FROM_ADDR` | `fieldday@curriculate.net` | From-address for outgoing email. |
| `FIELDDAY_DEV_ECHO_PASSKEY` | (unset) | Set to `1` in dev to echo passkeys / confirmation codes back to the client. **Never set in production.** |

## Email transport

`backend/fieldday/email.js` tries to `require('../email')` at boot and uses
its `send()` function if present. Adjust to match your existing email
helper, or call `setTransport(fn)` once at startup:

```js
const { setTransport } = require("./fieldday/email");
const mailer = require("./email/sendEmail");
setTransport(({ from, fromName, to, subject, text, html }) =>
  mailer.send({ from: `${fromName} <${from}>`, to, subject, text, html })
);
```

## Collections

All collections are prefixed `fieldday_*` so they don't collide with
Curriculate's grading collections.

| Collection | What |
|---|---|
| `fieldday_schools` | School + embedded subdocs (records, standards, PBs, archives, etc.) |
| `fieldday_events` | Events with embedded competitors & heats |
| `fieldday_passkeys` | TTL: short-lived 6-digit codes for admin sign-in |
| `fieldday_sessions` | TTL: bearer tokens for authenticated admins/leaders |
| `fieldday_code_changes` | TTL: pending school-code-change confirmations |

TTL indexes auto-expire docs based on `expiresAt`. No cleanup cron needed.

## Auth model

- **Admin**: email + 6-digit passkey emailed via your existing email
  pipeline. `POST /admin/request-passkey` → `POST /admin/verify-passkey`
  returns a `sessionToken`. Multi-school: an admin can join more schools
  by code (`POST /admin/join-school`) and switch active school
  (`POST /admin/select-school`).
- **Leader**: school code + name only. `POST /leader/join` returns a
  session token tied to that school. Leaders can only mutate events
  whose `leaderName` matches theirs (admins can mutate anything).

The client sends `Authorization: Bearer <sessionToken>` on every
authenticated request. Same-origin cookie `fielddaySession` is also
accepted.

## Sample request flow

```bash
# Admin sign-up
curl -X POST localhost:3000/fieldday/api/admin/request-passkey \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@school.org"}'
# (server emails the passkey)

curl -X POST localhost:3000/fieldday/api/admin/verify-passkey \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@school.org","passkey":"123456"}'
# → { sessionToken: "...", schools: [] }

curl -X POST localhost:3000/fieldday/api/schools \
  -H "Authorization: Bearer ..." \
  -H "Content-Type: application/json" \
  -d '{"name":"Maple Elementary","code":"MAPLE26"}'
# → { school: {...} }

# State snapshot
curl localhost:3000/fieldday/api/state \
  -H "Authorization: Bearer ..."
```

## Migrating from localStorage

If you have admins running the localStorage demo and want to bring their
data into MongoDB, the script at `scripts/importLocalStorageBlob.js`
takes a JSON file (the "Backup" download from the Admin tab) and
inserts schools/events/records/etc. into your collections.

Usage:

```bash
node backend/fieldday/scripts/importLocalStorageBlob.js \
  --file ./MAPLE26-2026-05-08.json \
  --admin-email admin@school.org
```

## What this module does NOT do

- **Roster/registration with Curriculate user accounts** — admins are
  tracked by email + per-email passkey rather than reusing the grading
  app's auth. If you want them to share auth, swap `requireSession`
  for your existing middleware that loads `req.user`, then rewrite the
  passkey endpoints to defer to your existing OTP flow.
- **Real-time over WebSockets** — the client polls `/state` every 6s.
  Plenty for a school field day; if you want to move to SSE or WS later,
  it's a small lift. The data shape doesn't change.
- **Audit log** — every mutation overwrites in place. Easy to add: a
  middleware that writes an event log to a `fieldday_audit` collection
  on every non-GET request.
