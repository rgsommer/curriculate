# Curriculate — Project Guide

## A. Pulse Grading — Core

**What:** AI grading tool for teachers. Photo/paste/batch/video/audio input → rubric-matched feedback → score + report.

**Key files:**
- `frontend/src/app/grading/page.jsx` — main grading UI (photo, paste, strictness, student/class pickers, rubric override, session email, response display)
- `frontend/src/app/grading/BatchGrading.jsx` — batch PDF grading (upload PDF → classify pages → grade each student → results grid)
- `frontend/src/app/grading/VideoGrading.jsx` — video performance grading
- `frontend/src/app/grading/AudioGrading.jsx` — audio performance grading (music, speeches, drama)
- `frontend/src/app/grading/pdfReports.js` — PDF report generation (half-page, strips, session summaries)
- `backend/index.js` — main backend; grading endpoints (`POST /grading`, `/grading/batch`, `/grading/check-rotation`), classification prompt, AI scoring logic
- `backend/models/GradingUsage.js` — usage tracking per teacher

**Features:**
- 5 input modes: photo, paste, batch PDF, video, audio
- 13 feedback voices + per-question audit toggle + rigorous review modifier
- Rubric override: paste, upload PDF/DOCX, or use auto-detected rubric from photos
- Saved rubrics (localStorage)
- Per-student strictness adjustment (chevron UI on results)
- Batch grading: PDF upload → AI classifies answer key / rubric / student pages → grades each student → results grid with re-grade
- PDF rotation handling: dedicated `/grading/check-rotation` endpoint with majority vote, retry logic, gpt-4.1
- Freeform/handwritten assignment classification support
- CurricQR-coded PDF reports for students
- Session email with PDF attachments + Edsby CSV export

## B. Pulse Grading — Mobile App

**What:** Capacitor 6 native wrapper for Android (iOS ready). Loads the live grading page in a WebView — one codebase, instant updates, no store resubmission for content changes.

**Key files:**
- `mobile-app/capacitor.config.ts` — app config; live URL `curriculate.net/grading?app=1`, splash screen, status bar, push notifications
- `mobile-app/src/native-bridge.js` — bridges web app to native APIs: camera, push notifications, haptics, deep links, navigation guard (non-grading URLs open in external browser)
- `mobile-app/store-metadata.md` — Play Store / App Store listing copy, keywords, screenshots spec
- `frontend/src/app/globals.css` — `.capacitor-native` rules hide site header/footer, safe-area padding
- `frontend/src/app/layout.tsx` — Capacitor detection script (`?app=1` param + `sessionStorage` persistence)
- `frontend/src/components/SiteHeader.tsx` — has `site-header` class for native hiding
- `frontend/src/components/SiteFooter.tsx` — has `site-footer` class for native hiding

**Status:** App builds and runs on Android via ADB. Signed AAB generated. Play Store submission in progress.

## C. Pulse Grading — Class Rosters & Progress

**What:** Teachers upload a class roster (CSV). AI auto-matches student names from graded work. Enables per-student tracking, Edsby CSV export, and the student/parent progress portal.

**Key files:**
- `backend/routes/classRoster.js` — CRUD routes for roster upload/management
- `backend/models/ClassRoster.js` — MongoDB model (className, students array with firstName, lastName, studentId/edsbyId)
- `frontend/src/app/grading/page.jsx` — roster UI (student dropdown, class dropdown, 50/50 layout)
- `frontend/src/app/progress/` — student/parent progress portal
- `backend/routes/studentProgress.js` — progress data endpoints

## D. Pulse Grading — Results & Reports

**What:** Every graded assignment gets a short result code. Students/parents visit `/results/{code}` to see feedback, rubric, and photos.

**Key files:**
- `frontend/src/app/results/` — public results viewer
- `backend/routes/resultsRoutes.js` — result lookup endpoints
- `backend/models/PublishedResult.js` — stored results with code
- `frontend/src/app/grading/pdfReports.js` — `buildResultsPdf()`, `buildStripsPdf()`, `buildSessionEdsbyCsv()`

## E. Scavenger Hunts — Task Generation & AI Quality

**What:** AI-powered classroom scavenger hunts. Teachers describe a lesson → AI generates interactive task stations. Template-based generation replaced freeform to eliminate structural errors.

**Key files:**
- `shared/taskTypes.js` — TASK_SHELLS export (23 shell builders); task type definitions used across apps
- `backend/controllers/sharedTasksetController.js` — `generateFromTemplate()`, `regenerateSingleTask()`, `validateAiTask()`, `retryMustHave` constraints
- `backend/tests/test-all-shells.mjs` — 230-run test suite (23 types × 10 vocab sets)
- `backend/controllers/sanitizeTaskShape.js` — deterministic field promotion/normalization per task type
- `backend/validators/taskValidators.js` — `normalizeTaskByType()`, `validateTaskByType()`

**Coverage:** 23 task types have shell templates. Simple types (open-text, record-audio, collaboration, echo-chain) skipped — no complex structure to lock.

**Sanitizer covers:** Multiple Choice, Brain Spark Notes, VennSort, Script Play, Fake Out, Hangman Duel, Pet Feeding, Mad Dash Sequence, Mind Mapper, Body Break/Motion Mission, Speech Recognition/Pronunciation, Role Play Deck

## F. Scavenger Hunts — Teacher App

**What:** Teacher-facing dashboard for creating, managing, and running scavenger hunt sessions.

**Key files:**
- `teacher-app/src/pages/TaskSets.jsx` — taskset cards, Diagnose & Fix button, `runFix()`, `copyDiagnosticReport()`
- `backend/routes/tasksets.js` — POST `/:id/sanitize` (fix endpoint), GET/DELETE `/diagnostics/logs`
- `backend/models/TaskDiagnosticLog.js` — MongoDB schema for diagnostic log entries
- `backend/models/TaskSet.js` — taskset model
- `backend/routes/sessions.js` — live session management

**Diagnose & Fix:** Three-pass repair on any taskset card: deterministic sanitize → validate → AI repair (up to 5 tasks). Logs broken JSON to MongoDB + JSONL.

## G. Scavenger Hunts — Student App

**What:** Student-facing app for playing scavenger hunts. Renders task types, handles submissions, shows reviews.

**Key files:**
- `student-app/src/StudentApp.jsx` — main app; skip/review logic
- `student-app/src/components/tasks/TaskRunner.jsx` — renders all task types; `BrainSparkNotesInline` component
- `student-app/src/components/tasks/types/EchoChainTask.jsx` — Echo Chain with step-by-step instructions

**UX fixes shipped:** BrainSparkNotes `[object Object]` display, skip-task not advancing, Echo Chain unclear instructions

## H. Admin & Analytics

**Key files:**
- `frontend/src/app/admin/page.jsx` — admin panel; diagnostic logs section, `formatDiagForClipboard()`
- `frontend/src/app/api/admin/diagnostics/route.js` — Next.js proxy to backend diagnostic endpoints
- `backend/routes/admin.js`, `adminCrud.js`, `adminFeedback.js`, `adminUsageSummary.js`, `adminTeacherOutreach.js` — admin API routes
- `backend/routes/analytics.js` — usage analytics endpoints
- `backend/models/SessionAnalytics.js`, `StudentSessionAnalytics.js` — analytics models

## I. Feedback & Student Data

**Key files:**
- `backend/index.js` — `feedback:submit` socket handler (persists to MongoDB)
- `backend/models/FeedbackMessage.js` — feedback model with `archived` field
- `backend/models/Student.js`, `StudentAccount.js`, `StudentProfile.js` — student data models
- `backend/routes/feedback.js` — feedback API routes

## J. Billing & Subscriptions

**Key files:**
- `backend/routes/stripe.js`, `subscriptionRoutes.js`, `billingHandoff.js` — Stripe integration
- `backend/models/SubscriptionPlan.js`, `UserSubscription.js`, `ProcessedStripeEvent.js` — billing models
- `frontend/src/app/billing/`, `frontend/src/app/pricing/` — billing/pricing pages

## K. Frontend (Marketing & SEO)

**Key files:**
- `frontend/src/app/layout.tsx` — root layout, metadata, Google Analytics, Capacitor detection
- `frontend/src/app/page.tsx` — homepage
- `frontend/src/app/pulse/` — Pulse Grading landing page
- `frontend/src/app/prism/` — legacy Prism landing redirect
- `frontend/src/app/grading/` — grading tool (see section A)
- `frontend/src/app/sitemap.ts`, `robots.ts` — SEO
- `frontend/src/app/privacy/`, `terms/`, `contact/`, `faq/`, `about/` — informational pages

**Branding:** Grading tool is branded "Pulse Grading" (formerly "Prism", formerly "AI Grading"). Scavenger hunts are branded "Curriculate".

## L. Pending / Future Work

- **Bulk generation via templates:** Wire template path into `buildTasksetPrompt` so initial generation also uses shells (currently only retries do)
- **Play Store submission:** Signed AAB ready; needs app listing creation, screenshots, and review submission
- **More student UX testing:** Watch for task types that confuse students in class
- **Scoring improvements:** AI scoring is on for many task types but quality hasn't been audited
- **Usage analytics:** usageStats on tasksets exist but aren't surfaced well in teacher-app
- **Rotation fix verification:** Dedicated `/grading/check-rotation` endpoint deployed but not yet confirmed working in production
- **Chapel Journals classification:** Freeform assignment guidance deployed but not confirmed
