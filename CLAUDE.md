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
- **The Setup slot rules are evaluated, not read** (`lib/daily/formula.ts`): each slot's row 4 in `Setup!S1:AB8` is a NOW()-driven rule — the CE memory verse for the first ten minutes, the picture in S2 on the week's last teaching day — and reading the cell gave the answer for the instant of the read, so the scrubber could not move E1. A Sheets evaluator re-runs them with NOW() bound to the time on the board: IF/IFS/AND/OR, NOW/TODAY/TIMEVALUE/WEEKDAY/DATEVALUE/DAYS/TEXT, INDEX (a missing row or column meaning the whole of it), MATCH, HLOOKUP/VLOOKUP, FILTER, ROW/COLUMN, JOIN, INDIRECT, LET and LAMBDA, the text and maths functions, cell and range references, and arrays that spread across comparisons and arithmetic the way Sheets spreads them. RANDBETWEEN is fixed for the day, or a projector re-rendering every few seconds would make the line jump about. It reaches `Setup!A1:P40`, `Setup!M1:Q8`, `Setup!S1:AB8`, `Display!A1:F20`, `Poems!A1:B60` and `F1:J3`, `MemoryCards!H1:H40`, `Vocab!A1:B60`, `Master!A1:K2`, `Subjects!U1:U40`, `MathChallenge!A1:C60`, and the heads of `Vertical` and `VerticalAi`; a reference past those, or a function it does not know, falls back to the value the sheet computed. A slot whose row 4 is only a value keeps its rule in row 5 — the daily update is generated there and pasted into row 4 — so row 5 is run instead, which is the difference between today's text and whatever was pasted last term. Row 3 is the slot's own material and row 4 the rule that gates it; `?debug=1` prints both for every slot
- The status is a privilege code shown as a coloured bubble mirroring the sheet's conditional formatting on D9/D11/D13 (`statusStyle`). It says what the benefit is (`statusWords`, `BENEFIT_WORDS`) and only while that benefit is on the table: **Free seat** (B1) for the opening minutes of the class (Setup "Free seat for", 5 by default), **Free pass** (B2) and **Extra FD** (B3) from Setup's grace minutes (15) to the end, **All 3** for the whole class from its first minute. A trailing 4 adds "+2" for a perfect class. The colour is worked out from what is on offer — the code is rebuilt in the sheet's shorthand and put through the same rules — and the bubble is not drawn when nothing is available. The group letter sits small beside the words and the raw code stays in the tooltip. A code with no text label (`A-1000`) is read as its digits, in the legend's order — Benefit 1, 2, 3 — instead of reading as nothing. The Washroom chip shares the pass's opening window and counts down to it
- The legend's writing penalty is the one rule the sheet does not compute, so the board does (`writingOwed`): more than one day of five points or fewer inside the last five school days puts a brown **Writing** chip beside that class. `Points!A1:BV46` is now one read serving the names (row 3), the flags (row 46) and the days between; the score column inside each class's block is found by looking under the class's own name first, and `?debug=1` prints the rows and column it settled on. A day counts only once it has been scored: the rows waiting for the rest of the year read as a column of noughts, and counting those flagged every class in the school
- The between-classes screen ("Change of class") only says **Day complete** when the day actually is complete — past the day's last bell — and otherwise "Nothing scheduled", because it was claiming the day was over at ten in the morning. With no class after this one it shows the day itself — the classes on the board, else the day's plan, else the timetable rows — rather than a lone caption on an empty screen, so it is plain at a glance whether the gap is the timetable or the sheet
- The "Today" panel does not carry another class's lesson: when the day's text is the whole plan, one class after another, shortening it to its first lines always gave the *first* class of the day — so the History screen showed Math's blurb under a heading reading "Today". During a class that panel is left out altogether, since the class is the screen; between classes the plan still shows. A genuine daily note is unaffected
- Persistent next-class peek line (subject, room, time) under the period line
- Each subject carries its own colour (`subjectTheme` in `lib/daily/parse.ts`, keyed off the lesson code letter) — heading wash, chips, progress bar and panel edge follow it, so a class change is visible from the back of the room; the footer day chip uses the sheet's own weekday colours (`weekdayColour`)
- The clock is highlighted (red pill, slow pulse) for the last few minutes of a period — the window is Setup's "change time to red" (5 min if that row is missing) — and the peek line turns red and reads "Next in N min: …", naming the next row of the timetable (lunch and recess included), or Dismissal after the last class; it applies to breaks too, measured to the end of the break
- A class holds the screen to its very last minute: the dismissal screen waits for the current period to finish rather than taking over at the dismissal time, which can fall inside the final period
- End-of-day package: for the last few minutes of the day (Setup's "For Dismissal Messages" block, columns N to Q — the times and how many minutes ahead) E1's side of the screen becomes what's on tomorrow (the "Tomorrow:" header cell), the "Before you head out" list (C15) and the Kiss & Ride waiting list; the "Pray for …" line also comes forward, highlighted, before each of those times. At dismissal the screen carries the goodbye, the verse of the day, the head-out list, its blessing, tomorrow, the waiting list and whatever E1 holds, with the unscramble puzzle in the bottom bar
- The dismissal panel leads with "Get ready for dismissal" — tidy up, tuck the chair in, stand behind it ready for the homeroom teacher — for the last few minutes before the day's last bell (Setup's "Stand ready for dismissal" row, five minutes if it is absent, as it is in the sheet today). Setup is read as `A1:F20`, labels in column B and values in C/D
- The Kiss & Ride tab is found by name at read time (`listSheetTitles` in `lib/daily/sheets.ts`), and its "Waiting (Recent First)" column is located by its header cell, so renaming either does not silently empty the panel
- End of the day = the DisplayAI dismissal row, else the Dismissal entry in the message block, else Setup's "Show Dismissal List", and only then the last bell — Vertical's time column runs on past the school day, so taking the last bell ahead of the sheet's own "Dismissal" put the end of the day at 4:25 PM and ran the class screens an hour past home time; that branch is checked before the "No classes today" one, which the board used to fall through to once the last row had passed
- The verse (A5) is evaluated too: the board reads Verses!A and Vertical!B4, strips the cell's lead-in at `~` so what gets shortened is the scripture rather than the introduction, and cuts at a word boundary (`truncateWords`) instead of A5's LEFT(…, 85); it shows in full for the 20 minutes from A9 and again from A11, as the formula does. If the Verses tab cannot be read, the A5 value is tidied back to the last whole word (`tidyTruncated`)
- At the end of the day the bottom bar shows the unscramble if the sheet has one, otherwise a riddle — the sheet's own, or one of the built-in `HOUSE_RIDDLES` picked by the date — since the verse is already large on the dismissal screen
- Handouts for the class on screen show as clickable chips under the lesson bullets, so a print run that was forgotten can be started from the board. They come from URLs written into the lesson cell (`extractLinks`) and from rich-text links attached to phrases in it (`readCellLinkRuns` over `DisplayAI!C1:C40`); the name is taken from the words nearest that link — since the previous link, back to the last sentence break — falling back to the kind of file. Links are deduped by what they point at (`canonicalUrl`), so the same Google file written `/edit?tab=t.0`, `/edit?usp=sharing` and `/edit` is one chip. The addresses are stripped out of the bullets, which also stops a URL's own `?` being read as the lesson's question
- The teacher's own material comes from the **Lessons** tab, keyed by the lesson code in column C (`~H001` or `H001`): E the starting page reference (a chip beside the room), F the homework (its links become handout chips, its text fills "Write in your agenda"), and at the end of the row the picture and the video. Those two are read for **what they hold, not by position**: every URL in I to K is gathered, the one that looks like a video is the video, and the picture is what is left — so a mirror column inserted between them, or taken out again, cannot make the board show a video where a picture belongs. The read is `C1:K400`. The student-facing tabs leave all of this out on purpose (`parseLessons` in `lib/daily/parse.ts`). Any URL there is taken, including a Drive link written `open?id=…` (which passes no image test) and a link attached to the cell's own text — the grid read covers `Lessons!E1:K400` for that. The picture takes the large side of the screen for the first `picSeconds` (10 min) of the class; `?debug=1` prints what was found and whether it loaded
- **DisplayAI and the day's plan are merged, not either/or.** DisplayAI fills from the sheet's own clock, so at half past nine it carries one class and the rest of the day is not in it yet; using it alone made the board believe the day ended after that class ("Change of class", "Day complete", at ten in the morning). The plan supplies every class DisplayAI has no row for, and DisplayAI — the live, AI-written version — wins for the periods it does carry, with the plan filling in only the code, page, picture and handouts that row lacks. The day's plan is on **VerticalAi columns F to J** (Monday to Friday, the day's classes run together in one cell): `classesFromText` finds each class header and parses the chunk after it, `dayPlanByWeekday` does it per weekday. **Vertical** carries the same columns with the period times in column A, so a row with both a time and a class gives that class its time; timed rows win the dedupe over a run-together copy, and a codeless echo of a coded class is dropped. The AI-written column does not always keep the lesson code, so the codes for each subject are collected from Vertical's own column and handed, in order, to any class that arrives without one — which is what lets a class from VerticalAi reach its Lessons row. The lesson code is optional in a class header, because that text writes some classes without one, and the subject is one word so a duty word before it ("Playground CE 8A") is not swallowed
- **Vertical writes a lesson in a different shape from DisplayAI's** — the header line, then a line carrying the code after a bullet and the lesson's title after a colon, then the activities, then an `[Assign: …]` block — so `parseClassText` reads that shape whenever the text announces it — a bullet-marked code line or an `[Assign: …]` block — rather than waiting for the DisplayAI patterns to find nothing, which failed on a title that happens to end in a question mark. Bulleted points inside the Assign block become separate assignments, and emoji come out while the bullet characters stay (`verticalLesson`). Line breaks are preserved through `extractLinks` and `classesFromText` because the shape is what tells the title from the activities
- Vertical is the spine of the day's plan — it carries the times and the codes — but it is the teacher's shorthand; **VerticalAi is the same lessons written for the room**, so where both describe a class the AI wording is what shows (`asWritten` in `dayPlanByWeekday`), with Vertical's time, code and room kept
- **Vertical column A is the bell schedule** (`bellSchedule`): a time is taken only while it is a school-day time and later than the one before it, so the first value that breaks that run ends the schedule — the column carries other things further down, and a stray value became a bell that cut a class short. No period is clamped to less than `MIN_PERIOD_MIN`. A class shorter than that is dropped outright and the class before it takes the time: the column carries bells left over from years with a class in that minute, and each one became a one-minute period repeating the class before it — "10:00 Math 7A, 10:59 Math 7A" on the agenda. Every period runs to the next bell, whatever rows DisplayAI happens to carry — without that a recess row whose next DisplayAI row was an hour away stretched over the classes in between. It is also where a plan class with no time can be placed
- A plan class with no time is placed in the next free bell time after the class before it (one no timed class has taken and DisplayAI has not named), so an afternoon Vertical gives no times for still appears rather than vanishing
- "Before you head out" belongs to the dismissal window, not to the last class on the board — before lunch the board says a grace instead (`LUNCH_GRACE`), inside the same "For Dismissal Messages" window
- A day whose lessons come from the plan runs the board's ordinary class screens: `periodsFromPlan` in `page.jsx` turns the timed plan into periods, each running to the next boundary (the next planned class, or the next time row DisplayAI does carry, which keeps lunch and recess in place), so the scrubber moves between them — 11:00 AM shows the 11:00 AM class — instead of one static list
- The points strip and the bottom line are sized to be read from the back of the room, and the bottom line stays on one row: the week line and the "Pray for …" link keep their space and the verse gives way
- The points strip is built from the cells the sheet's own plans line is built out of (`pointsFromSetup`): rows 35 to 40 of Setup, F the class, **K its total and L its percentage**. The line alternates between the two by the minute only because one cell can hold one number at a time; reading the pair directly puts both on screen at once and neither has to be caught on the right minute. A class counts only where its column in Points row 2 has something — G, T, AG, AT, BG, BT, every thirteenth column — which is the same test the line makes, so a section not taught this year drops out. Both ranges are already read, so this costs nothing
- The plans line is still parsed as the fallback, and for its title, which past four o'clock reads "That's it for …" rather than "Plans for …" — the board did not recognise that and lost the title and the points-entered flag every afternoon. Each class's total is written `-value-` there and neighbours may share the dash between them, so the values are split on the dash (a run of three dashes is a negative value) rather than matched — matching swallowed the dash that started the next value and showed four classes as two. Points row 3 names the classes when the Setup rows do not
- The board's grid column track is pinned to `minmax(0, 1fr)` and so are the lesson area's, or a long word grows the track, the whole board is laid out for a screen wider than the screen, and the overflow is clipped — which is what made the type look small with half the screen empty. An empty panel column is skipped when measuring the fit (stretched to the row, it reported a full screen) and the lesson takes the whole width when there is nothing to put beside it
- A lesson written without a question leads with what it is about rather than repeating the class name; and when a lesson is a title and an assignment with no activities, the assignment goes in the lesson column instead of leaving that half of the screen empty
- The lesson area fills the screen: after each render the board measures how far its content actually reaches and scales a `--fit` multiplier (0.75 to 1.9) on the content type until it just fits, so a sparse screen is not a page of white space and a crowded one still needs no scrolling. A picture column is elastic and left out of the reckoning; `.main` still clips as a backstop
- Before the first class the board lists the day's materials — every class's handouts, named by class — as clickable chips under the agenda, so they can be printed on the way in
- The greeting (A1) is evaluated too (`evaluateGreeting`): "Good morning" / "Enjoy your lunch" past 11:55 / "Good afternoon" up to the dismissal time / "Goodbye", plus the weekday's name from Setup column M — so it moves with the scrubber like the rest
- A class opens on the verse: for the opening minutes (Setup's `openMin`, 5) the day's verse leads the panel in full, large and set in the serif — a brief focus while everyone settles — after which it gives the screen back to the lesson and carries on along the bottom bar, where it stays all day
- The verse in the bottom bar carries the whole quotation and slides across and back when it is longer than the bar, rather than ending in an ellipsis; the distance is measured, so a short verse sits still
- Panel blocks do not shrink (`.panel > .block { flex: 0 0 auto }`): as flex items they used to compress and clip their own text, and the fit measurement reads where the blocks reach, so it saw a screen that fitted while the room saw a sentence cut in half. `FIT_MIN` is 0.66 so a full opening screen can still be made to fit
- A picture that fails to load is dropped for the rest of the page's life, and a projector page runs all day — so a fresh read of the sheet clears that memory and gives a re-shared Drive image another chance
- A header cell starting with "Pray" (with its hyperlink) shows in the bottom bar as a link, or as a small enlarging player when it points at a video
- One refresh is three Sheets requests — a values batch, a formula batch and one grid read (`readGridLinks`, serving both the "Pray for …" link and the lesson-cell handouts) — with the tab list cached an hour. Google allows 60 reads a minute per user, so a refresh happens at most once every 20 s even when a sheet edit has pinged, and a 429 puts the board on a 90 s hold serving the last read. `readRangesSafe` drops any range whose tab is not in the cached tab list before the batch is sent, so an optional tab the sheet does not have — `BoardImages` before the script has ever run, `MemoryCards`, `Vocab` — never reaches Google. That matters: it used to answer a 400 by probing every range on its own, and with two dozen ranges that is two dozen requests against a quota of sixty a minute, so one missing tab spent the allowance and turned a 400 into a 429 and the board into "the sheet could not be read". If a 400 still comes back, Google's message names the range it could not parse (`rangeFromError`); that one is remembered and the batch retried, at most a few times
- `/daily?debug=1` shows exactly what the board received from the sheet — first stop when something in the sheet is not appearing
- **O Canada** holds the screen for the five minutes after the announcements (Setup's "O Canada for", 5 if the row is absent): the words on one side and the flag on the other, taken from the day's own column of `Poems!F1:J3` — F is Monday and J Friday, and the column carries whichever language that day sings in (`anthemOfDay`). The flag has to be a URL the API can read (`=IMAGE("…")`, a link, or the address itself) — see **Pictures the API cannot see** below. `?debug=1` prints the window, the flag it found and how many lines of words
- A picture in the feature cell E1 (`=IMAGE()`, hyperlink, or image URL — E1 is read as both value and formula) takes the large side of the screen while the sheet shows it; Drive links are rewritten for `<img>`, and an image that fails to load falls back to the normal panel. It reaches the screens either side of the teaching day too: during announcements it has the screen to itself, scaled up to fill it (the flag for the anthem) with "Please listen" underneath — that branch used to render a blank screen before E1 was ever consulted — and the before-school screen shows it beside the agenda whether or not the day's classes are known yet
- **Pictures the API cannot see.** The Sheets REST API has no image field at all: `CellData` carries formats, formulas, notes, hyperlinks and chips, `ExtendedValue` has no image type, and the discovery document has no image schema anywhere. A picture put *into* a cell with Insert > Image — either kind — therefore reaches the board as nothing, which is why the flag, the feature cartoon and the lesson pictures all read empty. The fix is in the sheet, and it leaves the cells alone: `frontend/src/app/daily/apps-script/mirror-cell-images.gs` finds the cells holding a picture, takes Google's temporary address, fetches the bytes while it is good, writes them to a Drive folder shared with anyone who has the link, and records the durable address on a hidden **BoardImages** tab — cell in column A, address in column B. The board reads `BoardImages!A2:B200` (`buildCellImages`, `cellImageKey`) and uses it wherever the picture itself cannot be seen: the anthem flag, the feature cell, a lesson's picture, and any Setup rule whose reference lands on a picture cell (`cellAt` in `formula.ts` falls back to it). A picture inserted from a URL keeps that URL; one pasted or uploaded is copied, because the projector is not signed in as the teacher and Google's own image URLs are tagged to the requester and expire within the hour. The bytes are fingerprinted, so an unchanged picture is not uploaded again and its address does not churn. A mirror column of the teacher's own is fine — the picture and video columns are told apart by content — but it only covers the Lessons tab, and a mirror written from `getContentUrl()` expires within the hour, so the recorded address is the durable route. Triggers cannot be bound to a column, so the handlers filter on the edited range; a picture insertion often arrives as a change rather than an edit, with no range to filter on, so the hourly time trigger is the dependable one
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
