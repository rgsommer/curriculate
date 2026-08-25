# Qrewzi Rebrand — Change List (Phase 3 discovery)

**Scope:** Games-only rebrand. Pulse Grading stays on curriculate.net.
Change list below covers the four unambiguous game surfaces plus shared/ +
backend/ items that touch the game side.

**In-scope roots:**
- `teacher-app/` — 28 files with brand mentions
- `student-app/` — 35 files with brand mentions
- `mobile-app-student/` — 7 files (native shell → Qrewzi Student)
- `mobile-app-curriculate/` — 6 files (native shell → Qrewzi teacher/GameMaster)
- `shared/` — 9 files (mixed — see §5)
- `backend/` — mixed, requires per-file judgment (see §4)

**Out of scope (do NOT touch):**
- `frontend/src/app/grading/*`, `frontend/src/app/pulse/*`, `frontend/src/app/ai-grading/*`, `frontend/src/app/prism/*` — Pulse Grading pages
- `mobile-app/` (Pulse Grading), `mobile-app-pngpay/` (separate product)
- `backend/routes/stocks*`, `backend/jobs/stocks*`, `backend/routes/travel.js`, `backend/routes/subsNotify.js`, `backend/fieldday/*` — other products in the monorepo
- Any `backend/routes/adminCrud.js`, `adminTeacherOutreach.js` unless flagged

---

## §1. Config Identity (immediate one-liner replacements)

Small file, big visibility.

### teacher-app
| File | Line | Current | Change to |
|---|---|---|---|
| `teacher-app/package.json` | 2 | `"name": "curriculate-teacher"` | `"name": "qrewzi-teacher"` |
| `teacher-app/index.html` | 6 | `Curriculate Teacher Dashboard — …` | `Qrewzi Teacher — …` |
| `teacher-app/index.html` | 7 | `<title>Curriculate</title>` | `<title>Qrewzi</title>` |

### student-app
| File | Line | Current | Change to |
|---|---|---|---|
| `student-app/package.json` | 2 | `"name": "curriculate-student"` | `"name": "qrewzi-student"` |
| `student-app/index.html` | 6 | `Curriculate Student App — …` | `Qrewzi — join classroom games…` |
| `student-app/index.html` | 7 | `<title>Curriculate Student</title>` | `<title>Qrewzi</title>` |

### mobile-app-student (Qrewzi Student native shell)
| File | Line | Current | Change to |
|---|---|---|---|
| `mobile-app-student/capacitor.config.ts` | 19 | `appId: "net.curriculate.student"` | **DO NOT CHANGE** — see §6 |
| `mobile-app-student/capacitor.config.ts` | 20 | `appName: "Curriculate Student"` | `appName: "Qrewzi"` |
| `mobile-app-student/capacitor.config.ts` | 27 | `url: "https://play.curriculate.net"` | `url: "https://play.qrewzi.com"` |
| `mobile-app-student/package.json` | 2, 4, 8 | brand + `cap:init` string | rename all 3 |
| `mobile-app-student/APP-STORE-LISTING.md` | 20, 21, 22, 124 | URLs + description | update per §2 |
| `mobile-app-student/store-metadata.md` | 59-62 | URLs | update per §2 |
| `mobile-app-student/src/index.html` | 33, 34 | offline fallback text + URL | update |
| `mobile-app-student/src/native-bridge.js` | 22 | `APP_HOST = "play.curriculate.net"` | `"play.qrewzi.com"` |
| `mobile-app-student/SUBMISSION.md` | 3 | reference URL | update |

### mobile-app-curriculate (Qrewzi teacher/GameMaster shell)
| File | Line | Current | Change to |
|---|---|---|---|
| `mobile-app-curriculate/capacitor.config.ts` | 16 | `appId: "net.curriculate.sessions"` | **DO NOT CHANGE** — see §6 |
| `mobile-app-curriculate/capacitor.config.ts` | 17 | `appName: "Curriculate"` | `appName: "Qrewzi Teacher"` |
| `mobile-app-curriculate/capacitor.config.ts` | 30 | `url: "https://set.curriculate.net?app=1"` | `url: "https://set.qrewzi.com?app=1"` |
| `mobile-app-curriculate/package.json` | 2, 4, 8 | brand + `cap:init` string | rename all 3 |
| `mobile-app-curriculate/src/index.html` | 33, 34 | offline fallback | update |
| `mobile-app-curriculate/src/native-bridge.js` | 27 | `APP_HOST = "set.curriculate.net"` | `"set.qrewzi.com"` |
| `mobile-app-curriculate/SUBMISSION.md` | 3, 78, 79 | reference URLs | update per §2 |
| `mobile-app-curriculate/store-metadata.md` | 61, 65-68 | URLs + tagline | update |

---

## §2. URL Migration Table

| Old (curriculate.net) | New (qrewzi.com) | Notes |
|---|---|---|
| `play.curriculate.net` | `play.qrewzi.com` | student-app deploy target |
| `set.curriculate.net` | `set.qrewzi.com` | teacher-app deploy target — parallel to the Curriculate side |
| `api.curriculate.net` | **KEEP** (or `api.qrewzi.com`) | Backend is shared. Recommendation: keep on curriculate.net domain to avoid a CORS/cert dance, unless you want per-brand API for cleanliness. |
| `www.curriculate.net` | `qrewzi.com` (for game routes) | Marketing site split. Curriculate.net keeps Pulse pages. |
| `curriculate.net/pricing` | `qrewzi.com/pricing` (game context) | If Qrewzi has its own pricing; otherwise route back to a unified pricing page |
| `curriculate.net/privacy` | `qrewzi.com/privacy` | Legally required per brand |
| `curriculate.net/contact` | `qrewzi.com/contact` | |
| `curriculate.net/images/mascot/*` | `qrewzi.com/images/mascot/*` | Move assets or leave and cross-origin them |

**All in-scope URL hits (49 total in game surfaces + shared/) — sweep-and-replace list:**

- `student-app/src/DemoMode.jsx:73` — `MASCOT_BASE` (mascot image host)
- `student-app/src/DemoMode.jsx:2274, 2806, 2895, 3566` — pricing / practice / share links
- `student-app/src/StudentApp.jsx:5398, 6145, 6259` — mascot images
- `student-app/src/StudentApp.jsx:6401` — Get-app link
- `student-app/src/StudentApp.jsx:6427-6435` — social share text + URLs (rewrite the copy too — "played awesome team games on Curriculate" → "on Qrewzi")
- `student-app/src/StudentApp.jsx:6460-6468` — Events share text + URLs
- `student-app/src/components/tasks/types/CurrentEventsTask.jsx:113` — api fallback
- `student-app/src/components/tasks/types/PhysicalMultipleChoiceTask.jsx:299` — QR host match
- `student-app/src/components/tasks/types/ReadingCompTask.jsx:334` — api fallback
- `student-app/src/components/tasks/types/RecordAudioTask.jsx:355` — api fallback
- `student-app/src/components/tasks/types/ShortAnswerTask.jsx:276` — api fallback
- `student-app/src/config.js:10` — api fallback
- `student-app/src/pages/DemoPage.jsx:7` — api fallback
- `student-app/src/utils/stationHelpers.js:37` — comment mentioning QR host
- `student-app/vite.config.js:8`, `student-app/src/main.jsx:12` — build-stamp comment
- `teacher-app/src/TeacherApp.jsx:1063, 1066, 1073, 1075, 2347` — api fallbacks + freetrial link
- `teacher-app/src/api/apiFetch.js:4`, `teacher-app/src/api/client.js:8` — api fallbacks
- `teacher-app/src/auth/useAuth.jsx:20, 24` — host detection (needs both old + new for migration window)
- `teacher-app/src/config.js:6, 9, 13` — api + student play host
- `teacher-app/src/pages/HostView.jsx:562, 585` — displayed play URL banner
- `teacher-app/src/pages/LifeTasks.jsx:2-3` — comment
- `teacher-app/src/pages/MyPlan.jsx:148` — pricing link
- `teacher-app/src/pages/Signup.jsx:29` — host detection (add qrewzi variant)
- `teacher-app/src/utils/billingRedirect.js:17` — hardcoded curriculate.net redirect
- `shared/config/copy.js:5` — `DOMAIN: "play.curriculate.net"`
- `shared/curriculate/components/Footer.tsx:6`, `shared/curriculate/components/index.tsx:6` — footer text "Curriculate.net" — see §5 (dead code, can just delete)

**API base URL fallbacks** (`api.curriculate.net`) — if you keep the backend on curriculate.net, LEAVE all `process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net"` fallbacks alone. If you move backend to `api.qrewzi.com`, sweep all of these.

**Migration window:** teacher-app/src/auth/useAuth.jsx already has host-based logic to detect `set.curriculate.net` and redirect API calls. Extend the check to *also* recognize `set.qrewzi.com` before you flip DNS, so both hosts work during the cutover.

---

## §3. User-Visible Copy Hotspots

Sweep these files for the string "Curriculate" in JSX text nodes, alt text,
aria-labels, share text, and email-preview strings.

### student-app top hotspots
- `student-app/src/StudentApp.jsx` (149 hits total — biggest file)
- `student-app/src/DemoMode.jsx` (~30 hits)
- `student-app/src/demoTasks.js`
- `student-app/index.html`

**Notable copy strings to hand-review** (not mechanical):
- `StudentApp.jsx:6427` — "The best teachers make learning feel like this — I just played awesome team games on Curriculate…"
- `StudentApp.jsx:6460` — "Just used Curriculate for an interactive team event — it was a hit…"

Rewrite these voice-first, not with a mechanical s/Curriculate/Qrewzi/. Qrewzi is
kid-facing — the tone shifts.

### teacher-app top hotspots
- `teacher-app/src/TeacherApp.jsx` (95 hits, most are localStorage keys — see §7)
- `teacher-app/src/pages/HostView.jsx` (displayed room banner)
- `teacher-app/src/pages/LiveSession.jsx`
- `teacher-app/src/pages/MyPlan.jsx`
- `teacher-app/src/pages/AiTasksetGenerator.jsx`

---

## §4. Backend — Requires Per-File Judgment

The backend serves both grading and games. Do NOT do a global rename.

**High-priority (games-side, user-visible or brand-facing):**

- `backend/index.js:213` — **CRITICAL** — schema enum `appName: "pulse-grading" | "curriculate" | "fieldday"`. This is a persisted DB column that identifies which product a submission came from. Renaming `"curriculate"` → `"qrewzi"` requires a data migration (backfill existing records). Options:
  - (a) Add `"qrewzi"` to the enum, keep `"curriculate"` for backward compat, dual-write from now on. Cheapest.
  - (b) Backfill all existing `"curriculate"` rows to `"qrewzi"` in a migration script. Cleaner but riskier.
- `backend/index.js:225-242` — `resolveProduct()` function that inspects referrer URL to classify submissions. Update to also recognize `qrewzi.com` referrers.
- `backend/index.js:266-303` — **email template** for "someone shared a task set with you." Rewrite subject/body from "Curriculate" → "Qrewzi." Multiple hits.
- `backend/routes/demo.js:20, 850, 894, 905, 955` — demo email template + PDF filename + mascot image URL + footer link. Rewrite for Qrewzi voice.
- `backend/email/transcriptEmailer.js` (15 hits) — session transcript email; games-side. Rewrite.
- `backend/email/gradeNotification.js` (9 hits) — likely games-side "you got graded on your session" email. Verify context, rewrite.
- `backend/routes/studentProgress.js` (6 hits) — shared between products. Read hits before touching.
- `backend/scripts/simulate-report.mjs` (5 hits) — dev script; low-priority.
- `backend/data/currentEventsEvergreen.json` (10 hits) — content library for Current Events task type; games-side.
- `backend/simulate_tasksets_rigorous.py` (6 hits) — test harness; comments/docstrings.
- `backend/routes/adminCrud.js` (29 hits) — mixed. Only touch strings that show up in the game admin UI.

**Skip / leave alone:**
- `backend/jobs/blastSender.js` (58 hits) — blast/marketing tool; not games-specific
- `backend/routes/adminTeacherOutreach.js` (22 hits) — outreach automation; not games UI
- `backend/routes/stocksAuth.js`, `backend/jobs/stocksDailyBriefing.js` — separate product
- `backend/routes/travel.js`, `backend/routes/subsNotify.js`, `backend/fieldday/*` — separate products
- `backend/scripts/export-curriculate-feedback.sh` — utility script; name is fine as-is

---

## §5. Structural Change — `shared/curriculate/` folder

**Finding:** `shared/curriculate/components/Footer.tsx` and `index.tsx` exist but
have **zero importers** anywhere in the repo. Dead code.

**Recommendation:** delete the folder outright, or move to
`shared/_archive/curriculate/` if you want a paper trail.

`shared/taskTypes.js` has 73 hits — all in AI prompt strings like
`"Generate ONE Curriculate task object with taskType 'multiple-choice'"`. These
are LLM instructions, not user-visible. **Whether to rename these depends on whether
you want the LLM's "voice" to match the brand.** Recommend: sweep and rename to
"Qrewzi task object" for consistency; low risk.

Other shared/ files with mentions (1-2 hits each): `deviceCapabilities.js`,
`config/copy.js`, `superpowers.js`, `skins.js`, `freemiumConfig.js`,
`billingCopy.js` — quick per-file eyeball.

---

## §6. Do NOT Change

Preserving these avoids losing user installs, breaking active sessions,
and re-triggering store review.

| Item | Why keep |
|---|---|
| `mobile-app-student/capacitor.config.ts:19` — `appId: "net.curriculate.student"` | Changing appId = new Play Store listing = lose all installs, reviews, and the pulse-grading-keystore.jks signing key registration. Rename display name only. |
| `mobile-app-curriculate/capacitor.config.ts:16` — `appId: "net.curriculate.sessions"` | Same reason. |
| `localStorage` keys `curriculate.activeRoomCode`, `curriculate.debug`, `curriculate.testMode`, `curriculateRoomCodeOverride` | Renaming = users lose their active room state on upgrade day. Silent breakage. **Keep the internal namespace; users never see these keys.** |
| CustomEvent names `curriculate:pmcAnswerResult`, `curriculate:resetScanDedupe` | Same reason — internal wire protocol between components. |
| Database `appName` enum value `"curriculate"` | See §4 — data migration required if you change. |
| `backend/scripts/export-curriculate-feedback.sh` filename | Utility script; not user-facing. |
| `api.curriculate.net` (backend URL) | Recommend keep — backend is shared with Pulse Grading. Optional to move to `api.qrewzi.com`. |

---

## §7. Product Decisions Needed

Before you can PR anything, decide these:

1. **"CurricQR" — the branded feature name for QR-scanning stations.** 9 files
   reference it (`teacher-app/src/pages/StationPosters.jsx`,
   `teacher-app/src/pages/LiveSession.jsx`, `teacher-app/src/pages/AiTasksetGenerator.jsx`,
   `teacher-app/src/pages/MyPlan.jsx`, `student-app/index.html`,
   `student-app/src/StudentApp.jsx`, `student-app/src/demoTasks.js`,
   `student-app/src/components/QrScanner.jsx`, `shared/taskTypes.js`). Options:
   - **"QrewziQR"** — parallel construction. Ugly stacked-Q sound.
   - **"Qrewzi Code"** — drops the QR pun, cleaner read.
   - **Just "QR code"** — retires the brand-on-tech idea, most neutral.
   Recommend "Qrewzi Code" — the Q in Qrewzi already carries the QR association.

2. **Pricing surface.** Does Qrewzi have its own pricing page at `qrewzi.com/pricing`
   or does it link back to a unified `curriculate.net/pricing`? Affects
   `teacher-app/src/utils/billingRedirect.js:17` and `MyPlan.jsx:148`.

3. **API host.** Keep `api.curriculate.net` (recommended) or move to
   `api.qrewzi.com` for per-brand cleanliness? Affects ~10 fallback URLs.

4. **Mascot assets.** Move `curriculate.net/images/mascot/*` to `qrewzi.com/images/mascot/*`,
   or leave in place and cross-origin them? Recommend move — brand consistency.

---

## §8. Frontend Pages — Needs Product Classification

`frontend/` has 1286 hits across 240 files, but the app hosts MANY products.
Per-page classification is needed before touching any of them.

**Please classify each of the following into: `games` (becomes Qrewzi), `grading`
(stays Curriculate), `shared` (both), or `other` (subs/stocks/campfire/etc):**

`about`, `aboutcampfire`, `ai-grading`, `app`, `audit`, `avgs`, `behavior`,
`beta`, `billing`, `blast`, `businesses`, `demo`, `email`, `events`, `faq`,
`features`, `forgot-password`, `freetrial`, `give`, `grading`, `groupcards`,
`houses`, `how-it-works`, `investors`, `login`, `opportunities`, `orders`,
`parties`, `pedagogy`, `play`, `pledge`, `practice-dashboard`, `preptime`,
`preview`, `pricing`, `prism`, `privacy`, `progress`, `pulse`, `raffle`,
`referrals`, `reports`, `results`, `sample-sessions`, `selah`, `signup`,
`stocks`, `subs`, `tasks`, `teebee`, `teebee-console`, `teebee-loans`,
`teebee-tax`, `teebeepay`, `terms`, `termsofservice`, `thanks`, `travel`,
`unsubscribe`

Once classified, we can either:
- **A.** Move `games` pages to the new `qrewzi-web/` Next.js repo (per rebrand plan)
- **B.** Leave them in `frontend/` and use host-based routing to serve them at qrewzi.com

Rebrand plan recommends **A** — cleanest split.

---

## Sizing Summary

- **Immediate config edits (§1):** ~20 lines across 12 files. 30 minutes.
- **URL sweep (§2):** ~49 hits across 25 files. Mostly mechanical. 1-2 hours.
- **Copy hotspots (§3):** ~5 files that need voice-aware rewrites. Half day.
- **Backend (§4):** ~10 files, per-file judgment. Half day + a DB migration decision.
- **Structural (§5):** 15 minutes (delete dead code, sweep taskTypes.js prompts).
- **Frontend (§8):** blocked on product-page classification.

Total, minus §8: **1-2 focused days of code edits.**
