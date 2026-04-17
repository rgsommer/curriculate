# Curriculate — Project Threads

## 1. Template-Based Task Generation (AI Quality)
**Status:** Shipped, needs live testing after deploy
**What:** Replaced freeform AI generation with pre-built JSON shell templates. AI fills content placeholders instead of inventing structure. Eliminates structural errors.
**Key files:**
- `shared/taskTypes.js` — TASK_SHELLS export (23 shell builders at bottom of file)
- `backend/controllers/sharedTasksetController.js` — `generateFromTemplate()`, template path in `regenerateSingleTask()`
- `backend/tests/test-all-shells.mjs` — 230-run test suite (23 types × 10 vocab sets)
**Coverage:** 23 task types have shells. Simple types (open-text, record-audio, collaboration, echo-chain, etc.) skipped — no complex structure to lock.
**Next:** Monitor live generation success rate. If good, consider wiring templates into the initial bulk generation path too (currently only used for single-task retries).

## 2. Diagnose & Fix Button
**Status:** Shipped
**What:** Fix button on every taskset card in teacher-app. Three-pass: deterministic sanitize → validate → AI repair (up to 5 tasks). Logs original broken JSON to MongoDB + JSONL.
**Key files:**
- `backend/routes/tasksets.js` — POST `/:id/sanitize` endpoint, GET/DELETE `/diagnostics/logs`
- `backend/models/TaskDiagnosticLog.js` — MongoDB schema for diagnostic entries
- `teacher-app/src/pages/TaskSets.jsx` — Fix dialog UI, `runFix()`, `copyDiagnosticReport()`
- `backend/routes/adminFeedback.js` — admin-facing diagnostic endpoints
**Note:** Diagnostic logs from the Fix button will mostly show errors from old freeform-generated tasks. Template approach prevents most of these going forward.

## 3. Admin Diagnostic Log Viewer
**Status:** Shipped
**What:** Diagnostic logs visible in admin panel with Load Logs, Copy All, Clear buttons. Copy includes full raw task JSON for pasting to Claude.
**Key files:**
- `frontend/src/app/admin/page.jsx` — diagnostic logs section, `formatDiagForClipboard()`
- `frontend/src/app/api/admin/diagnostics/route.js` — Next.js proxy to backend

## 4. Task Sanitizer (sanitizeTaskShape.js)
**Status:** Ongoing — add blocks as new task types show structural issues
**What:** Deterministic field promotion/normalization. Runs on every task before validation.
**Key files:**
- `backend/controllers/sanitizeTaskShape.js` — all sanitizer blocks
**Covered types:** Multiple Choice, Brain Spark Notes, VennSort, Script Play, Fake Out, Hangman Duel, Pet Feeding, Mad Dash Sequence, Mind Mapper, Body Break/Motion Mission, Speech Recognition/Pronunciation, Role Play Deck

## 5. Task Validators
**Status:** Ongoing
**What:** Two validation layers: `validateAiTask()` in sharedTasksetController (generation-time) and `validateTaskByType()` in taskValidators (normalizer-level).
**Key files:**
- `backend/controllers/sharedTasksetController.js` — `validateAiTask()`, `validateMindMapperTask()`, `validateBrainSparkNotesTask()`, `retryMustHave` constraints
- `backend/validators/taskValidators.js` — `normalizeTaskByType()`, `validateTaskByType()`

## 6. Student UX Fixes
**Status:** Shipped
**What:** Various student-facing fixes.
**Items completed:**
- BrainSparkNotes showing `[object Object]` — rewrote `BrainSparkNotesInline` in TaskRunner.jsx to handle object-shaped data (color-coded cards for key terms, main points, summary)
- Skip task not advancing — `shouldShowReview` logic was showing review overlay for skipped tasks
- Echo Chain unclear instructions — replaced vague subtitle with step-by-step how-to-play, contextual turn prompts, better input placeholders
**Key files:**
- `student-app/src/components/tasks/TaskRunner.jsx` — BrainSparkNotesInline component
- `student-app/src/StudentApp.jsx` — skip/review logic (~line 2398)
- `student-app/src/components/tasks/types/EchoChainTask.jsx` — Echo Chain instructions

## 7. Feedback Persistence
**Status:** Shipped
**What:** Post-taskset student feedback (rating, highlights, improvements, etc.) now persists to MongoDB via FeedbackMessage model. Previously only broadcast via socket, never saved.
**Key files:**
- `backend/index.js` — `feedback:submit` socket handler (made async, added FeedbackMessage.create)
- `backend/models/FeedbackMessage.js` — added `archived` field

## 8. AI Generation Prompts (retryMustHave)
**Status:** Shipped, but templates largely supersede this for covered types
**What:** Detailed per-type constraint strings that tell AI exactly what schema to produce. Used in retry prompts and the Fix button's AI repair.
**Key files:**
- `backend/controllers/sharedTasksetController.js` — `retryMustHave` object (~line 839)
**Note:** For the 23 types with shell templates, the retryMustHave is still used as a fallback if the template path fails, but shouldn't fire often.

## 9. Pending / Future Work
- **Bulk generation via templates:** Wire template path into `buildTasksetPrompt` so initial generation also uses shells (currently only retries do)
- **More student UX testing:** Watch for task types that confuse students in class (like Echo Chain did)
- **Scoring improvements:** AI scoring is on for many types but quality hasn't been audited
- **Usage analytics:** usageStats on tasksets exist but aren't surfaced well in teacher-app
