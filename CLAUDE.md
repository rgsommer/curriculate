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

## M. Daily Board (classroom projector)

**What:** `www.curriculate.net/daily` — a full-screen, one-class-per-screen board driven by the DisplayAI tab of the teacher's Google Sheet planner. Polls the sheet once a minute; every element (lesson text, status chips, class points, video tile, lesson picture, poem/riddle cell) comes from the sheet, and the timing rules come from its Setup tab. No site header/footer on this page.

**Key files:**
- `frontend/src/app/daily/page.jsx` — the board (clock phases, video tile, picture window, points strip)
- `frontend/src/app/daily/layout.tsx` — kiosk layout (fonts, noindex, hides chrome via `body.daily-kiosk`)
- `frontend/src/app/daily/daily.css` — projector-sized styles
- `frontend/src/app/api/daily/route.ts` — reads + parses the sheet; in-memory copy (`lib/daily/cache.ts`) re-read after 2 min or after a ping; optional `DAILY_ACCESS_KEY`
- `frontend/src/app/api/daily/ping/route.ts` — `?key=DAILY_PING_KEY`; the sheet's Apps Script on-edit trigger calls it so edits show within ~10 s
- Page polls every 10 s; bottom-edge time scrubber previews any time of day and snaps back to live after 45 s
- The board evaluates the sheet's three NOW()-driven display rules itself (`evaluateFeature`, `evaluateDailyText`, `evaluateStatus` in `lib/daily/parse.ts`) instead of reading their results, so the scrubber moves them and an `=IMAGE()` slot is seen — the sheet's own `<>""` test skips picture slots, which is why E1 showed nothing
- The status is a privilege code shown as a coloured badge mirroring the sheet's conditional formatting on D9/D11/D13 (`statusStyle`), so codes with no text label (e.g. `A-1000`) still read correctly
- Persistent next-class peek line (subject, room, time) under the period line
- Each subject carries its own colour (`subjectTheme` in `lib/daily/parse.ts`, keyed off the lesson code letter) — heading wash, chips, progress bar and panel edge follow it, so a class change is visible from the back of the room; the footer day chip uses the sheet's own weekday colours (`weekdayColour`)
- The clock is highlighted (red pill, slow pulse) for the last few minutes of a period — the window is Setup's "change time to red" (5 min if that row is missing) — and the peek line turns red and reads "Next in N min: …", naming the next row of the timetable (lunch and recess included), or Dismissal after the last class; it applies to breaks too, measured to the end of the break
- A class holds the screen to its very last minute: the dismissal screen waits for the current period to finish rather than taking over at the dismissal time, which can fall inside the final period
- End-of-day package: for the last few minutes of the day (Setup's "For Dismissal Messages" block, columns N to Q — the times and how many minutes ahead) E1's side of the screen becomes what's on tomorrow (the "Tomorrow:" header cell), the "Before you head out" list (C15) and the Kiss & Ride waiting list; the "Pray for …" line also comes forward, highlighted, before each of those times. At dismissal the screen carries the goodbye, the verse of the day, the head-out list, its blessing, tomorrow, the waiting list and whatever E1 holds, with the unscramble puzzle in the bottom bar
- The Kiss & Ride tab is found by name at read time (`listSheetTitles` in `lib/daily/sheets.ts`), and its "Waiting (Recent First)" column is located by its header cell, so renaming either does not silently empty the panel
- End of the day = the DisplayAI dismissal row, else Setup's "Show Dismissal List", else the Dismissal entry in the message block; that branch is checked before the "No classes today" one, which the board used to fall through to once the last row had passed
- The verse (A5) is evaluated too: the board reads Verses!A and Vertical!B4, strips the cell's lead-in at `~` so what gets shortened is the scripture rather than the introduction, and cuts at a word boundary (`truncateWords`) instead of A5's LEFT(…, 85); it shows in full for the 20 minutes from A9 and again from A11, as the formula does. If the Verses tab cannot be read, the A5 value is tidied back to the last whole word (`tidyTruncated`)
- At the end of the day the bottom bar shows the unscramble if the sheet has one, otherwise a riddle — the sheet's own, or one of the built-in `HOUSE_RIDDLES` picked by the date — since the verse is already large on the dismissal screen
- Handouts for the class on screen show as clickable chips under the lesson bullets, so a print run that was forgotten can be started from the board. They come from URLs written into the lesson cell (`extractLinks`) and from rich-text links attached to phrases in it (`readCellLinkRuns` over `DisplayAI!C1:C40`); the name is taken from the words nearest that link — since the previous link, back to the last sentence break — falling back to the kind of file. Links are deduped by what they point at (`canonicalUrl`), so the same Google file written `/edit?tab=t.0`, `/edit?usp=sharing` and `/edit` is one chip. The addresses are stripped out of the bullets, which also stops a URL's own `?` being read as the lesson's question
- The teacher's own material comes from the **Lessons** tab, keyed by the lesson code in column C (`~H001` or `H001`): E the starting page reference (a chip beside the room), F the homework (its links become handout chips, its text fills "Write in your agenda"), I the lesson picture, J the video when the DisplayAI row has none. The student-facing tabs leave all of this out on purpose (`parseLessons` in `lib/daily/parse.ts`)
- When DisplayAI's lesson column is empty — it fills from the sheet's own clock, so before the day starts it can be blank — the board falls back to the day's plan on **VerticalAi columns F to J** (Monday to Friday, the day's classes run together in one cell): `classesFromText` finds each class header and parses the chunk after it, `dayPlanByWeekday` does it per weekday. **Vertical** carries the same columns with the period times in column A, so a row with both a time and a class gives that class its time; timed rows win the dedupe over a run-together copy, and a codeless echo of a coded class is dropped. The AI-written column does not always keep the lesson code, so the codes for each subject are collected from Vertical's own column and handed, in order, to any class that arrives without one — which is what lets a class from VerticalAi reach its Lessons row. The lesson code is optional in a class header, because that text writes some classes without one, and the subject is one word so a duty word before it ("Playground CE 8A") is not swallowed
- The lesson area fills the screen: after each render the board measures how far its content actually reaches and scales a `--fit` multiplier (0.75 to 1.9) on the content type until it just fits, so a sparse screen is not a page of white space and a crowded one still needs no scrolling. A picture column is elastic and left out of the reckoning; `.main` still clips as a backstop
- Before the first class the board lists the day's materials — every class's handouts, named by class — as clickable chips under the agenda, so they can be printed on the way in
- A header cell starting with "Pray" (with its hyperlink) shows in the bottom bar as a link, or as a small enlarging player when it points at a video
- One refresh is three Sheets requests — a values batch, a formula batch and one grid read (`readGridLinks`, serving both the "Pray for …" link and the lesson-cell handouts) — with the tab list cached an hour. Google allows 60 reads a minute per user, so a refresh happens at most once every 20 s even when a sheet edit has pinged, and a 429 puts the board on a 90 s hold serving the last read. `readRangesSafe` learns which ranges name a missing tab so one bad range cannot fail the batch forever
- `/daily?debug=1` shows exactly what the board received from the sheet — first stop when something in the sheet is not appearing
- A picture in the feature cell E1 (`=IMAGE()`, hyperlink, or image URL — E1 is read as both value and formula) takes the large side of the screen while the sheet shows it; Drive links are rewritten for `<img>`, and an image that fails to load falls back to the normal panel
- `frontend/src/lib/daily/sheets.ts` — Sheets API via service account JSON (`DAILY_SHEETS_SERVICE_ACCOUNT`) or `DAILY_SHEETS_API_KEY`
- `frontend/src/lib/daily/parse.ts` — pure parser (DisplayAI rows, status text, points line, Setup labels)
- `frontend/src/app/daily/README.md` — env vars, ranges read, timing rules, test URLs

**Workflow for this feature:** changes to the daily board go all the way through without asking — commit, push, open the PR and merge it — so the board deploys. Stop and check first only for work outside `frontend/src/app/daily`, `frontend/src/app/api/daily` and `frontend/src/lib/daily`, or anything that could affect the grading pages.

## L. Pending / Future Work

- **Bulk generation via templates:** Wire template path into `buildTasksetPrompt` so initial generation also uses shells (currently only retries do)
- **Play Store submission:** Signed AAB ready; needs app listing creation, screenshots, and review submission
- **More student UX testing:** Watch for task types that confuse students in class
- **Scoring improvements:** AI scoring is on for many task types but quality hasn't been audited
- **Usage analytics:** usageStats on tasksets exist but aren't surfaced well in teacher-app
- **Rotation fix verification:** Dedicated `/grading/check-rotation` endpoint deployed but not yet confirmed working in production
- **Chapel Journals classification:** Freeform assignment guidance deployed but not confirmed
