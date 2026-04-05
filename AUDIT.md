# Curriculate — Full Cross-File Audit
_Generated April 2026_

---

## Summary

The codebase is a working, feature-rich product with solid architecture choices (Express + Socket.io + Mongoose + Vite + Next.js). The core problems are not design flaws — they're the natural result of fast AI-assisted development without a periodic cleanup pass. The issues cluster into five categories: **route conflicts**, **dead/duplicate files**, **auth token inconsistency**, **model duplication**, and **god files**.

Total source lines: ~102,000 across 200+ files (excluding node_modules, .next, dist).

---

## 🔴 Critical Issues (fix these first)

### 1. Route Double-Registration — Active Conflicts in Production

Several API endpoints are defined in **both** a dedicated route file AND inline in `index.js`. Since `index.js` mounts the route file first and then re-declares the same paths later, the route file version handles the request — but the inline version is dead code that creates confusion and maintenance risk.

| Endpoint | Route file | Also in index.js (lines) |
|---|---|---|
| `GET/POST/PUT/DELETE /api/tasksets` | `routes/tasksets.js` | 6762, 8979, 9064, 9292, 9307 |
| `GET/POST /api/shared/:token` | `routes/shared.js` | 9131, 9163, 9205 |
| `GET /api/reports` + `/:id` | `routes/reports.js` | 9369, 9387 |

**Additionally**, these route registrations appear **twice** in `index.js` itself:
- `/api/subscription` — lines 378 AND 625
- `/api/auth` — line 372 AND line 627
- `/auth` — line 626 (duplicate of `/api/auth`)
- `/api/stripe` — line 376 AND 628

### 2. Ten Route Files Not Imported Into index.js

~~These files exist in `backend/routes/` but are never mounted — meaning their endpoints are silently unreachable.~~

**✅ Fixed (April 2026):** All actionable route files have been mounted.

| File | Action taken |
|---|---|
| `admin.js` | Mounted at `/api/admin` |
| `analytics.js` | Mounted at `/api` (replaces inline routes that lacked plan guard) |
| `billingHandoff.js` | Mounted at `/api` |
| `sessions.js` | Mounted at `/api/sessions` |
| `speech.js` | Mounted at `/api/speech` |
| `voice.js` | Mounted at `/api/voice` |
| `teacherProfileRoutes.js` | Mounted at `/api/teacher-profile` ⚠️ auth is commented out — enable before prod |
| `reports.js` | **NOT mounted** — imports `listReports`/`getReport` from controller but those exports don't exist. Working inline implementations kept. |
| `tasks.js` | **NOT mounted** — stub with no real routes |
| `voiceOLD.js` | Deleted in prior cleanup pass |

### 3. Auth Token Key Inconsistency — Auth Can Silently Break

Three different localStorage key names are used across the teacher-app to store and retrieve the JWT:

| Key | Used in |
|---|---|
| `"token"` | `utils/apiFetch.js`, `api/client.js`, several pages |
| `"curriculateToken"` | `api/apiFetch.js` (getStoredAuthToken tries 6 keys) |
| `"curriculate_token"` | `api/client.js` interceptor, some pages |

If a user logs in via one path (which writes `"token"`) and a subsequent API call reads `"curriculate_token"`, it finds nothing and the request goes out unauthenticated. The `api/apiFetch.js` `getStoredAuthToken` function tries 6 different key names as a workaround — that function exists _because_ this inconsistency exists.

**One canonical key needs to be chosen and used everywhere.**

---

## 🟠 Important Issues

### 4. Models Defined Inline in index.js Despite Having Model Files

~~`SessionReport`, `SharedTasksetLink`, and `GradingCapture`/`GradingUsage` are all defined inline in `index.js`.~~

**✅ Fixed (April 2026):**
- `SessionReport` — model file updated with merged schema (added `headline`, `sharedToken`, `transcript`, `noiseSamples`, etc. that existed only in the inline); imported from `./models/SessionReport.js`; inline removed
- `SharedTasksetLink` — import changed from named-only `{ hashShareToken }` to default+named `SharedTasksetLink, { hashShareToken }`; inline removed
- `GradingUsage` — was defined inside a socket handler (re-registered on every call); moved to module top-level
- `GradingCapture` — was already at top-level, no model file exists; kept inline (small schema, no divergence risk)

### 5. Duplicate "Backup" Files Scattered Through the Project

These are copy-on-save artifacts that should be cleaned up:

```
backend/package-lock 2.json
deploy 2.sh
package 2.json  /  package-lock 2.json
student-app/.gitignore 2
student-app/src/utils/stationColors 2.ts
teacher-app/package-lock 2.json
teacher-app/src/api/client 2.js
teacher-app/src/components/BackButton 2.3iv
teacher-app/src/components/Layout 2.jsx
teacher-app/src/components/LoadingSpinner 2.3iv
teacher-app/src/components/RoomPicker 2.jsx
teacher-app/src/components/Sidebar 2.jsx
teacher-app/src/components/TaskRenderer 2.jsx
teacher-app/src/components/TeacherLayout 2.jsx
teacher-app/src/components/TeamBubble 2.jsx
teacher-app/src/socket 2.js
dev/e2e/tests/full_flow.spec 2.js
test-results/.last-run 2.json
```

The `.3iv` files (`BackButton 2.3iv`, `LoadingSpinner 2.3iv`) appear to be editor-specific backup formats and should not be in the repo at all.

### 6. DEL-Named Files Still in the Repo

```
backend/middleware/requirePlanDEL.js       — not imported anywhere
backend/reports/sessionReportPdfDEL150.js  — not imported anywhere
backend/reports/sessionReportPdfDEL170.js  — not imported anywhere
dev/taskTypesDEL.js                        — not imported anywhere
teacher-app/src/components/RoomPickerDEL.jsx
teacher-app/src/components/SidebarDEL.jsx
teacher-app/src/components/TeacherLayoutDEL.jsx
```

None are imported. They are dead code and should be removed.

### 7. Three API Client Files in teacher-app — No Single Source of Truth

The teacher-app has three separate HTTP client implementations:

| File | Tech | Auth key |
|---|---|---|
| `src/api/client.js` | axios | `curriculate_token` or `token` |
| `src/api/apiFetch.js` | fetch | Tries 6 different key names |
| `src/utils/apiFetch.js` | fetch | `token` only |

These are not consistent. Different pages likely use different clients, which means different auth behavior and different error handling depending on which endpoint you're calling.

### 8. Double Body Parser Stack

In `index.js` lines 364–369:
```js
app.use(bodyParser.json({ limit: "25mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.json({ limit: "25mb" }));         // same thing, second time
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
```
Then at line 397:
```js
app.use(express.json({ limit: "2mb" }));  // does nothing — 25mb parser already ran
```
Every request is parsed twice. `bodyParser` is just `express`, so these are duplicates.

---

## 🟡 Code Quality Issues

### 9. `taskTypes.js` Contains Junk/Internal Values Mixed With Real Task Types

The `shared/taskTypes.js` file is supposed to be the single source of truth for task type IDs. But `grep` of its string values reveals entries like: `"chlorophyll"`, `"glucose"`, `"evaporation"`, `"harbor"`, `"island"`, `"genesis"`, `"anchor"`, `"compass"`, `"jp"`, `"gavel"`, `"jeopardy"`. These appear to be internal category codes, rubric labels, or test content — not task type IDs — mixed into the same file.

### 10. Task Type Aliases in TaskRunner Instead of at the Source

`TaskRunner.jsx` has a 100+ line `normalizeTaskType()` switch statement with aliases like:
```
"venn-sort" / "venn_sort" / "venn" / "venn-diagram" / "venndiagram" → VENNSORT
"brain-spark-notes" / "brain_spark_notes" / "brainsparknotes" → BRAIN_SPARK_NOTES
```
These aliases exist because the AI generator and the backend sometimes emit different strings for the same task type. The fix is to normalize at the point of generation/storage, not at the point of rendering — then the client never needs to guess.

### 11. God Files — The Five Biggest Files

| File | Lines | Problem |
|---|---|---|
| `backend/index.js` | 9,596 | Server setup + socket handlers + all routes + models + business logic |
| `student-app/StudentApp.jsx` | 5,370 | 69 useState, 36 useRef, 19 useEffect, all in one component |
| `teacher-app/pages/LiveSession.jsx` | 5,316 | Same pattern as StudentApp |
| `frontend/app/grading/page.jsx` | 3,182 | Single page component managing the entire grading flow |
| `shared/taskTypes.js` | 3,082 | Mix of constants, metadata, and non-task content |

### 12. `process.env.NEXT_PUBLIC_BUILD_ID` in a Vite App

In `student-app/src/StudentApp.jsx` line 17:
```js
const BUILD_MARKER = process.env.NEXT_PUBLIC_BUILD_ID;
```
This is a Next.js env pattern. The student-app uses Vite. This is always `undefined`. The build marker you're trying to log is never shown.

### 13. Disabled/Draft Pages Left in frontend/src/app

```
frontend/src/app/demo/_page.tsx           (prefixed, disabled)
frontend/src/app/grading/_pageNoLearningSummary.jsx
frontend/src/app/grading/_pageWorking.jsx
frontend/src/app/grading/_pageWorkingFeb11_419.jsx
frontend/src/app/results/_page.jsx
```

These are Next.js route-convention disabled pages (underscore prefix = not a route). They're draft/working copies. Three versions of the grading page exist simultaneously.

### 14. `App copy.jsx` in student-app

`student-app/src/App copy.jsx` — a copy of the main app component, sitting in the source directory. Not imported anywhere. Should be deleted.

---

## ✅ What's Working Well

- **`.env` is properly gitignored** — no secrets found hardcoded in source files
- **`TaskErrorBoundary`** in StudentApp prevents blank-screen crashes from task component errors
- **`shared/taskTypes.js`** is the right idea — a single canonical file shared across all apps
- **`backend/models/`** directory structure is correct — the problem is just that `index.js` doesn't use it fully
- **Auto-resume logic** in StudentApp handles reconnects gracefully
- **`normalizeStationId`** handles all QR code format variants cleanly
- **The test files** (`scoring.test.js`, `scoring.tie.test.js`) exist and cover real scoring logic
- **`SessionReport` model file** (`backend/models/SessionReport.js`) is more complete than the inline version — it has `TeamSchema` and `AttachmentSchema` that the inline version is missing

---

## Recommended Fix Order

### Immediate (low risk, high value)
1. Delete all `* 2.*` duplicate files and `*DEL*` files
2. Delete `App copy.jsx` and `voiceOLD.js`
3. Fix `NEXT_PUBLIC_BUILD_ID` → `import.meta.env.VITE_BUILD_ID`
4. Remove the duplicate body parser lines in `index.js`

### Short-term (moderate effort)
5. ✅ **Done** — Auth token standardized to single `"token"` key across all teacher-app files (`useAuth.jsx`, `apiFetch.js`, `client.js`, `tasksets.js`, `TeacherApp.jsx`, `SharedLaunch.jsx`)
6. ✅ **Done** — Duplicate route block at lines 625–628 removed
7. ✅ **Done** — `SessionReport` imported from model file; inline removed; schema merged to cover both versions' fields
8. ✅ **Done** — `SharedTasksetLink` imported as default export from model file; inline removed
9. ✅ **Done** — All actionable route files mounted; `reports.js` deferred (missing controller exports); `tasks.js` deferred (stub)

### Longer-term (architectural)
10. Extract socket handlers out of `index.js` into `socket/taskHandlers.js` (which already exists and is the right direction)
11. Move inline route handlers from `index.js` into their corresponding route files
12. Decompose `StudentApp.jsx` and `LiveSession.jsx` into subcomponents
13. Normalize task type strings at generation time so `TaskRunner` doesn't need a 100-line alias switch
