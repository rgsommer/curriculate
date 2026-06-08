# Behaviours — cross-teacher behaviour tracking (Phase 1)

App at **https://www.curriculate.net/behavior**. Built into the existing
Curriculate stack: Express + MongoDB backend (`api.curriculate.net`) + Next.js
frontend. The defining property: **behaviour incidents aggregate per student
across ALL teachers** — one shared strike count, append-only, concurrency-safe.

## What Phase 1 ships

- **Auth + invites** — reuses the existing email+password JWT (`routes/auth.js`).
  Originator creates the school; invites are restricted to the originator's
  email domain. Roles: `originator`, `admin`, `teacher`, `principal` (read-only).
- **Roster import** — tolerant CSV (`POST /api/behavior/roster/import`); handles
  DELETE/blank rows, reports skips, **drops the ethnicity field and bracketed
  tags**.
- **Incident logging** — `POST /api/behavior/incidents`, append-only, one doc per
  incident, behaviour wording snapshotted so edits don't rewrite history.
- **Cross-teacher trigger** — THRESHOLD count within the fade window (default
  3 / 30 days) + IMMEDIATE; resets the counter on a notice but keeps history.
- **AI note home** — configurable provider/model, **fail-safe** deterministic
  template fallback. Auto-send (this school's choice) with a cancellable window.
  Note is *from the contributing teachers*; CC-VP on the 2nd+ notice.
- **Email delivery** behind a `NotificationProvider` interface; `EdsbyProvider`
  is a Phase-3 stub that fails over to email.
- **Audit log** of every send + config/roster change.

Tests: `npm run test:behavior` (23 tests — trigger, fade, CC-VP, AI fallback,
Edsby→email failover, roster import).

## Environment variables (backend)

Already present: `MONGO_URI`, `JWT_SECRET`, `SMTP_HOST/PORT/USER/PASS`.

New / relevant:
- `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) — AI note composition. **Server-side
  only.** Absent → notices still send via the deterministic template.
- `BEHAVIOR_AI_PROVIDER` (`openai` | `anthropic`), `BEHAVIOR_AI_MODEL` — optional
  overrides; per-school `aiProvider`/`aiModel` in config take precedence.
- `BEHAVIOR_FROM_EMAIL` — From address for notices/invites (falls back to `SMTP_FROM`/`SMTP_USER`).
- `APP_BASE_URL` — used to build invite links (default `https://www.curriculate.net`).

Frontend: `NEXT_PUBLIC_API_BASE` (default `https://api.curriculate.net`).

## Deploy / DNS

No new DNS. `/behavior` is a path on the existing Next.js frontend and
`/api/behavior` a router on the existing Express backend.

1. **Backend** — deploy as normal (PM2 on the EC2 host). The router is mounted in
   `index.js`. Set `OPENAI_API_KEY` (+ optional `BEHAVIOR_*`) in the prod env.
2. **Frontend** — `next build` + deploy. Ensure `NEXT_PUBLIC_API_BASE` points at
   the backend. The `/behavior/*` routes ship automatically.
3. Smoke test: sign in → `/behavior/setup` (create school, import roster, invite)
   → `/behavior/log` (log 3 incidents across the threshold → notice fires).

## ⚠️ Privacy / residency — required before go-live (Ontario / MFIPPA)

This stores children's behavioural records and parent contacts. **Flagged for
your board sign-off (you handle approval; this lists the requirements):**

1. **Data residency** — confirmed earlier that the EC2 backend + Mongo are *not*
   certainly in Canada. **Recommendation:** host the Behaviours MongoDB in a
   Canadian region (Atlas `ca-central-1`) and confirm the EC2 region; if EC2
   stays in the US, document it as a cross-border processing flow in the PIA.
2. **Sub-processors to list in the PIA:** MongoDB (DB), the EC2/host provider,
   the SMTP/email provider, the AI provider (OpenAI/Anthropic — receives
   *de-identified* incident summaries: preferred name + pronoun + behaviour/date
   only, no surname, no parent contact, no ethnicity), and Edsby (Phase 3).
3. **Ethnicity is dropped** by the importer and never stored (verified by test).
4. **Retention** — incident counting fades at the configured window; keep the
   communication history for the academic year, then archive/purge (admin).
5. **Recommended before launch:** a MFIPPA Privacy Impact Assessment, a
   data-processing/sub-processor list, parental-notification language, and
   role-based access confirmation (already enforced: teachers log + view; only
   admin edits Setup; principal is read-only).

## Not in Phase 1 (planned)

- **Phase 2:** Setup UI depth, consequence follow-ups + 7:30am morning reminders
  (node-cron), missed-consequence escalation, custom-behaviour management,
  comms-history "Email History to…", school-calendar `.ics` import.
- **Phase 3:** real `EdsbyProvider` (encrypted creds, CSRF/cookie session).
- **Phase 4:** dashboards + the read-only principal dashboard.
