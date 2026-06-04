# Curriculate Subs — Substitute Teacher Staffing (`/subs`)

A web app for managing substitute-teacher staffing, designed around the real
problem administrators describe: when a teacher calls in sick at 6 a.m.,
finding a sub is the most stressful part of the morning. Schools rank their
preferred substitutes per grade level and post requests; a sequential
escalation engine contacts qualified subs in preference order until one
accepts — and falls back to internal coverage when none is found. Built for
schools like Brampton Christian School where mission fit, instructional
quality, and classroom culture matter.

Lives in the existing Curriculate stack (no new infrastructure):

- **Frontend** — Next.js 14 App Router, `frontend/src/app/subs/`
- **Backend** — Express + MongoDB/Mongoose + a background sweep job, in
  `backend/` (deployed at `api.curriculate.net`)

---

## Roles

- **School admin (principal/VP)** — creates a school, defines grade levels,
  ranks preferred subs per grade, posts requests, **approves teacher-reported
  absences**, sets the VP/Finance notification routing, and watches each
  request escalate live.
- **Substitute teacher** — sets contact preferences (email / SMS / both) and
  qualifications, and accepts or declines offers.
- **Staff teacher** — any signed-in teacher can report their own absence
  ("I need a sub"); it goes to their principal for approval. They're
  auto-added to the school's staff roster on approval (no list to maintain
  up front), and emailed when the class is covered.

The same signed-in email can be any combination of these. Sign-in is passwordless email-PIN
(mirrors `/stocks`): a 6-digit code → an HMAC-signed session in an HttpOnly
`subs_session` cookie.

---

## Request flow & escalation

A `SubRequest` has an **urgency** that sets the escalation interval — the
*only* behavioural difference between the two modes:

| Mode       | Meaning              | Default interval |
| ---------- | -------------------- | ---------------- |
| `urgent`   | same-day             | 5 minutes        |
| `advance`  | planned absence      | 4 hours          |

1. On posting, the engine sends an offer to preferred sub **#1**.
2. If they don't respond within the interval, the offer **expires** and the
   engine offers it to **#2**, then **#3**, and so on.
3. A **decline** escalates immediately (no waiting out the interval).
4. The **first** sub to accept wins; the request is marked `filled` and all
   further contact stops. Sibling pending offers are expired.
5. If the ranking is exhausted with no acceptance, the request is marked
   `exhausted` and the school admins are notified.

The interval is frozen onto each request at creation
(`escalationIntervalMs`), so tuning the defaults later never alters
in-flight requests. An explicit `escalationIntervalMs` override is accepted
on create for testing/tuning.

### Two ways a request starts

- **Admin-posted** (`source: "admin"`) — goes live (`open`) immediately and
  the engine fires at once.
- **Teacher-reported** (`source: "teacher"`) — a staff teacher submits "I
  need a sub"; it sits in `pending_approval` and the engine does **not**
  contact anyone. On submit, the principal/admins **and the appropriate VP**
  are notified. An approver (principal, or a VP within their authority)
  approves (setting role/qualifications/urgency) → status `open` + engine
  fires, or denies (`denied`) with a reason. The requesting teacher is
  emailed the decision and auto-added to the staff roster on approval.

#### Staff onboarding & VP approval authority

- **Broadcast staff link** — the principal generates one reusable link
  (`POST /schools/:id/staff-link` → `?staff=<token>`) and sends it to all
  staff. Opening it (while signed in) connects the teacher to the school's
  staff roster — no per-teacher invites, no list to maintain.
- **VP approval policy** (`SubsSchool.vpApproval`, principal-controlled):
  `none` (only the principal approves), `sick_only` (VP may approve absences
  whose reason is "Sick"), or `all`. A VP is recognised by email
  (`SubsSchool.vpEmail` for the whole school, or a grade's `vpEmail` for that
  division). The `/approvals` queue annotates each item with `canApprove`;
  approve/deny enforce it server-side.
- **Absence records** — every non-denied/cancelled request is an absence.
  Principals get an on-screen + emailable per-staff breakdown
  (`/schools/:id/absence-report[/email]`); teachers see their own
  (`/my-absences`).
- **Sick-day voice note** — principals can require a short recorded voice
  clip on sick-day requests (`SubsSchool.requireSickVoiceNote`); some like to
  "hear" that a teacher is genuinely unwell. The teacher records it in-app
  (MediaRecorder); it's stored in `SubsVoiceNote` and plays from the
  approval (`GET /requests/:rid/voice-note`).
- **Coverage window** — every request specifies whole day / half day (AM or
  PM) / specific times (`dayPart` + `startTime`/`endTime`), shown on the
  dashboard, board, offers, and in notifications.
- **Admin can request a day off for a teacher** — when posting, the admin
  picks a staff member (or types a name/email); it's recorded as that
  teacher's absence and triggers the same fill + reply-all-lesson-plan flow.

### Who's notified on a fill (principal is then done)

When a sub accepts, the system notifies — automatically:
1. the **substitute** (confirmation),
2. the **VP** who handles lesson plans — the *grade level's* VP if set,
   else the school-default VP,
3. **Finance** (budget/payroll),
4. the **absent teacher** (if known): "X is covering for you — reply-all
   with your lesson plans," with the sub + VP **cc'd** so reply-all reaches
   both,
5. the **admins** (confirmation, no action needed).

---

## Principal-centered features (challenge → where it lives)

Built around the real problem administrators describe: finding a sub is the
most stressful part of the morning. `/subs/features` is the explainer page
for new principals (linked from the sign-in screen).

| # | Challenge | Status | Where |
| - | --------- | ------ | ----- |
| 1 | **Qualification matching** — only eligible subs offered; flag 0 candidates | ✅ done | `subsMatching.isEligible` (engine hard-filter), `GET /requests/:rid/candidates`, dashboard `eligibleCount` |
| 2 | **Early-morning triage** — mobile dashboard, urgency + time-to-bell, live countdown | ✅ done | `GET /subs-admin/dashboard`, `MorningDashboard` |
| 3 | **Proximity / distribution** — sub & school location, max travel, fair distribution | 🟡 scaffold | `SubsTeacher.location/maxTravelKm`, `subsMatching.matchScore` (soft, not yet enforced) |
| 4 | **Challenging classes** — private difficulty/support notes | ✅ done | `SubsRequest.difficultyNote/supportLevel` |
| 5 | **Specialized roles** — teacher/EA/specialist/tech as distinct | ✅ done | `requiredRole` hard-filter |
| 6 | **Lesson plans** — plan, materials, **encrypted credentials**, completeness, templates | ✅ done (templates 🟡) | `SubsLessonPlan`, `subsCrypto`, plan views (admin + assigned sub) |
| 7 | **Budget** — day rates, school budget, running spend | 🟡 scaffold | `SubsSchool.subBudget`, `SubsTeacher.dayRate`, `SubsRequest.estimatedCost` |
| 8 | **Internal-coverage fallback & burnout** — record internal coverage; track load | ✅ done | `SubsInternalCoverage`, `engine.assignInternalCoverage`, dashboard burnout tally |
| 9 | **Reliability scoring** — acceptance/on-time/ratings/tags inform ranking | ✅ feedback + aggregates; 🟡 ranking blend | `SubsReliabilityFeedback`, `SubsTeacher.reliability`, `matchScore` |
| 10 | **Instructional quality** — teach-capable vs supervise-only | ✅ done | feedback `canTeach`, qualifications |
| 11 | **Mission / faith fit** — configurable, required/preferred, self-declared | ✅ done | `SubsSchool.faithFit.enabled`, `requiredFaithFit`, `SubsTeacher.faithFit` |

Plus: **optional SMS** (Twilio, challenge above) and the **multi-school invite
flow** — an admin invites a sub by email; the sub gets a sign-in link and,
once in, sees every school they're registered with and gets cross-school
offers (`BCS: teach Gr5 on …` / Accept / Skip).

---

## Data models (`backend/models/`)

| Model            | Purpose |
| ---------------- | ------- |
| `SubsSchool`     | School + `adminEmails`, `abbrev`, `bellTime`, `faithFit.enabled`, `subBudget`, **`vpEmail`, `financeEmail`** |
| `SubsGradeLevel` | A grade level within a school, with optional **`vpEmail`** (the grade's "appropriate VP") |
| `SubsTeacher`    | A substitute: contact prefs, **qualifications, roleTypes, gradeComfort, faithFit, location/maxTravelKm, reliability, dayRate, schoolIds** |
| `SubsStaff`      | A school's staff-teacher roster (the absent teachers); auto-built on approval, or via the staff link (name + grade → VP) |
| `SubsVoiceNote`  | A short recorded sick-day voice clip (base64), played by the approver |
| `SubsRanking`    | Ordered preferred subs for one `(school, gradeLevel)` |
| `SubsRequest`    | A request: grade, date, urgency, frozen interval, **`source`, `status` incl. `pending_approval`/`denied`, `absentTeacher`, `reason`,** requiredRole/Qualifications/FaithFit, startTime, difficultyNote, lessonPlanId, coverageType, exhaustedReason, eligibleCountAtPost |
| `SubsOffer`      | One offer to one teacher (pending/accepted/declined/expired) + token |
| `SubsAuthPin`    | Server-side email-PIN state with attempt lockout (TTL) |
| `SubsLessonPlan` | Lesson plan / template; classroom-system credentials **encrypted at rest** |
| `SubsInternalCoverage` | Internal coverage record (split-class/admin/EA/prep) — feeds burnout load |
| `SubsReliabilityFeedback` | Private admin rating + tags; aggregates into `SubsTeacher.reliability` |
| `SubsInvite`     | Multi-school sub registration invite (token) |

---

## Backend architecture

- **`services/subsEngine.js`** — the escalation engine. Pure logic, decoupled
  from MongoDB and from any notification provider via two injected
  collaborators (`store`, `notifier`) and an injectable `now` clock. This is
  what makes it unit-testable without a database.
- **`services/subsMongoStore.js`** — the MongoDB implementation of the store
  contract.
- **`services/subsNotify.js`** — the notification layer behind an interface.
  Email via **Resend** (falls back to a console mock with no API key); SMS is
  a **console mock** today. `// TODO(twilio)` marks where a real SMS provider
  plugs in.
- **`services/subsAuthToken.js`** — session sign/verify + `requireSubsAuth`.
- **`jobs/subsEscalation.js`** — starts a periodic sweep (`SUBS_SWEEP_MS`,
  default 20s) that fires due escalations even if nobody responds; survives
  restarts because all state is in Mongo. Also exposes `tickNow()` for the
  dev tick endpoint and a singleton engine the routes share.
- **Routes**: `routes/subsAuth.js`, `routes/subsAdmin.js`,
  `routes/subsTeacher.js` (mounted in `backend/index.js`).

### API surface

```
POST /api/subs-auth/request-pin        { email }
POST /api/subs-auth/verify-pin         { email, pin }   → sets cookie
POST /api/subs-auth/logout
GET  /api/subs-auth/me                                  → roles

GET  /api/subs-admin/schools
POST /api/subs-admin/schools           { name, location? }
POST /api/subs-admin/schools/:id/admins { email }
GET/POST /api/subs-admin/schools/:id/grades
GET  /api/subs-admin/teachers
POST /api/subs-admin/teachers          { email, name?, phone? }
GET/PUT  /api/subs-admin/schools/:id/grades/:gid/ranking  { teacherIds[] }
PATCH /api/subs-admin/schools/:id      { abbrev?, bellTime?, faithFitEnabled?, subBudgetTotal?, vpEmail?, financeEmail? }
PATCH /api/subs-admin/schools/:id/grades/:gid { vpEmail?, name? }   (per-grade "appropriate VP")
GET  /api/subs-admin/approvals                       → pending absences I can see (admin/VP), each w/ canApprove
POST /api/subs-admin/requests/:rid/approve { requiredRole?, requiredQualifications?, urgency? }  → opens + fires engine + auto-rosters
POST /api/subs-admin/requests/:rid/deny    { denyReason? }
GET/POST /api/subs-admin/schools/:id/staff           → staff roster (the auto-built teacher list)
POST /api/subs-admin/schools/:id/staff-link          → broadcast staff sign-up link (?staff=token)
GET  /api/subs-admin/schools/:id/absence-report[?from&to]    → per-staff breakdown
POST /api/subs-admin/schools/:id/absence-report/email { to?, from?, to? }  → email the report
POST /api/subs-admin/requests          { schoolId, gradeLevelId, date, urgency, startTime?, requiredRole?, requiredQualifications?, requiredFaithFit?, difficultyNote?, supportLevel?, estimatedCost?, lessonPlan?, notes? }  → { eligibleCount }
GET  /api/subs-admin/dashboard                       → morning triage (open sorted by urgency+time-to-bell, coveredToday, burnout)
GET  /api/subs-admin/schools/:id/requests           → requests + offers (live)
POST /api/subs-admin/requests/:rid/cancel
POST /api/subs-admin/schools/:id/invite { email, name?, phone? }  → invite link (multi-school)
POST /api/subs-admin/requests/:rid/internal-coverage { type, staffName, staffEmail?, note? }
POST /api/subs-admin/feedback          { teacherId, schoolId, requestId?, rating, onTime?, canTeach?, tags?, note? }
GET  /api/subs-admin/requests/:rid/candidates        → eligibility + reasons per ranked sub
GET  /api/subs-admin/requests/:rid/lesson-plan       → plan (decrypted for the owner admin)
POST /api/subs-admin/dev/tick                        → force one sweep (dev)

GET  /api/subs-teacher/me                            → { teacher, schools }
GET  /api/subs-teacher/my-schools
GET  /api/subs-teacher/all-schools                   → schools to pick when reporting an absence
GET  /api/subs-teacher/schools/:id/grades            → that school's classes
POST /api/subs-teacher/request-sub     { schoolId, gradeLevelId, date, reason, urgency?, notes?, name? }  → pending_approval
GET  /api/subs-teacher/my-requests                   → my reported absences + status
POST /api/subs-teacher/join-staff      { token }     → connect to a school via the staff link
GET  /api/subs-teacher/my-staff-schools              → schools I'm on staff at
GET  /api/subs-teacher/my-absences                   → my own absence breakdown
PUT  /api/subs-teacher/profile         { name?, phone?, active?, contactPrefs, qualifications?, roleTypes?, gradeComfort?, faithFit?, location?, maxTravelKm?, dayRate?, availabilityNote? }
POST /api/subs-teacher/accept-invite   { token }     → { schools }
GET  /api/subs-teacher/offers
POST /api/subs-teacher/offers/:id/accept | /decline
GET  /api/subs-teacher/offers/:id/lesson-plan        → plan; password revealed only once accepted
GET  /api/subs-teacher/offer-by-token/:token
POST /api/subs-teacher/respond         { token, action }   (public, token = credential)
```

---

## Environment variables

| Var | Required | Notes |
| --- | -------- | ----- |
| `SUBS_SECRET` | prod | Session signing secret. Falls back to `STOCKS_SECRET` / `MEDICENTRE_SECRET` in dev. |
| `SUBS_ENCRYPTION_KEY` | to store lesson-plan passwords | 32-byte key (hex/base64) for AES-256-GCM credential encryption. Without it, posting a plan **with** a password is rejected (we never store plaintext); plans without passwords work fine. |
| `RESEND_API_KEY` | for real email | Without it, emails/PINs are logged to the server console (dev). |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | for real SMS | All three enable Twilio SMS. Missing any → SMS falls back to a console mock (dev). |
| `SUBS_FROM` | optional | Email From header. Default `Curriculate Subs <noreply@curriculate.net>`. |
| `SUBS_BASE_URL` | optional | Base URL for accept/decline + invite links. Default `https://curriculate.net/subs`. |
| `SUBS_SWEEP_MS` | optional | Escalation sweep cadence (ms). Default `20000`. |
| `NEXT_PUBLIC_BACKEND_URL` | optional | Frontend → backend base. Default `https://api.curriculate.net`. |

---

## Running locally (no external accounts)

Everything runs with mock notifications — no Resend/Twilio needed.

```bash
# backend (needs MongoDB via MONGODB_URI; PIN + offer emails log to console)
cd backend && npm run dev

# frontend
cd frontend && NEXT_PUBLIC_BACKEND_URL=http://localhost:<backend-port> npm run dev
# open http://localhost:3000/subs
```

Happy-path walkthrough:

1. Sign in (the 6-digit PIN is printed to the backend console, and shown
   on-screen in dev). 
2. Create a school → add a grade level → add 2–3 substitutes → rank them.
3. Post an **urgent** request, then a **non-urgent** one.
4. Watch the **Requests** board. Use **Tick now (dev)** to force the sweep
   instead of waiting, or watch real escalation on the 20s sweep.
5. Sign in as one of the substitute emails (separate browser/incognito),
   open the **Substitute** view, and **Accept** — the request flips to
   `filled` and contacting stops. Offer emails (with accept/decline links to
   `/subs/respond`) are printed to the backend console.

### Engine tests (no DB, no network)

```bash
node backend/tests/test-subs-engine.mjs
```

Drives the real engine against an in-memory store and a virtual clock,
proving: urgent escalation #1→#2→#3, the non-urgent long-interval wait,
first-accept-wins/contacting-stops, immediate decline escalation, and
exhaustion.

---

## TODOs / next steps

Scaffolded (models + fields + soft logic exist; needs finishing):

- **Proximity ranking (#3)** — `matchScore` blends distance but ranking is
  still the admin's explicit order. Geocode addresses and surface
  chronically low-fill schools; optionally auto-suggest ranking by score.
- **Budget (#7)** — fields exist; build the running-spend view, remaining-
  budget meter, and "this request would exceed budget" flag.
- **Reliability → ranking (#9)** — feedback aggregates onto
  `SubsTeacher.reliability`; wire those into a suggested ranking order.
- **Lesson-plan templates (#6)** — `SubsLessonPlan.isTemplate` is modelled;
  add the pre-stage/apply-template UI.

Operational:

- **Real SMS/email** — set `TWILIO_*` and verify the `SUBS_FROM` domain in Resend.
- **Multi-instance escalation** — the sweep assumes a single backend process.
  If horizontally scaled, add a Mongo `findOneAndUpdate` lease per request so
  two workers don't double-send.
- **Notifications dedupe / retries** — best-effort today; add retry + delivery logging.
- **SMS opt-in compliance** — capture consent before enabling SMS per sub.
