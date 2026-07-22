# Device Mode Support — Architecture

**Status:** Decisions locked (see §4). Phase 1a in progress.
**Owner:** Richard
**Author of this doc:** Claude
**Date:** 2026-07-21

---

## 1. Executive summary

Add a Device Mode setting (Tablet Only / Laptop Only / Mixed Devices) that filters incompatible activities out of a session before launch and enables laptop-webcam QR scanning so laptop teams can still physically travel to stations.

**Why phased, not one-shot:** the full spec spans 20 sections across shared/, backend, teacher-app, student-app, print pipeline, analytics, accessibility, and testing. Realistically 3–4 weeks. This doc is the "propose the architecture before broad changes" step the spec itself calls for in Section 18.

**What Phase 1 delivers by itself:** a teacher can pick a device mode when creating a session, see incompatible activities flagged with plain-language reasons, and launch. Laptop QR scanning + hidden-card print + device detection ship in later phases.

---

## 2. What we found in the codebase

### 2.1 Session state lives in two disconnected places

- **Live source of truth:** in-memory `rooms[code]` map in `backend/socket/roomEngine.js`. Built by `createRoom(roomCode, teacherSocketId, locationCode)` at `roomEngine.js:130`. Broadcast to clients via `room:state` events. Every field the teacher-app and student-app read comes from here.
- **Mongo `Session.js`** model has `code`, `hostId`, `taskSet`, `state`, `teams[]`, `stations[]` (with `qrToken`), but is **largely legacy** — the live socket path doesn't persist through it.
- **`TeamSession.js`** persists team-level state for reconnect (24h TTL).

**Consequence for this feature:** `deviceMode` belongs on the in-memory room object first (added alongside `locationCode`, `treatsConfig`, `noiseControl`). Persisting it to Mongo can be a Phase 4 hardening step, or immediately if we resurrect the legacy `Session` model — decision below in §4.

### 2.2 Task registry — one existing capability field, no hardware flags

- **Registry:** `shared/taskTypes.js` — exports `TASK_TYPES`, `TASK_TYPE_META`, `TASK_SHELLS`, `TASK_TYPE_META_DEFAULTS`, `TASK_BLOOMS_MAP`. ~79 canonical task keys registered.
- **Only existing flag:** `TASK_TYPE_META[type].isOffTablet` (boolean) — coarse content-mix flag used by the pool builder for off-tablet diversity. Not a hardware compatibility flag; misleading if repurposed.
- **Where the truth actually lives:** each task's component under `student-app/src/components/tasks/types/*.jsx`. That's where `getUserMedia`, `capture="environment"`, `DeviceMotionEvent`, `SpeechRecognition`, and QR scanning are wired.

### 2.3 The audit — how many task types actually break on laptop?

Full 79-row audit is in the research transcript. Consolidated buckets:

| Bucket                                                                    | Count | Examples                                                                                                    |
| ------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| **Universal** — works on laptop AND tablet, no degradation                | ~55   | multiple-choice, sort, sequence, matching, cloze, all trivia/riddle, chat-based (careers, case-study), etc. |
| **Laptop-blocked: needs rear cam for station QR at submit**               | 4     | physical-multiple-choice, mad-dash, mad-dash-sequence, musical-chairs                                       |
| **Laptop-blocked: needs rear cam of physical object/world**               | 4     | photo, make-and-snap, photo-journal, hidenseek                                                              |
| **Laptop-blocked: needs device motion (accel/tilt)**                      | 3     | motion-mission, hole-in-one, treasure-runner (interstitial only)                                            |
| **Front-camera required (laptop is BETTER than tablet)**                  | 1     | team-selfie                                                                                                 |
| **Degraded on laptop but usable** (mouse-drawing is worse than finger)    | ~5    | speed-draw, draw, mind-mapper (screen mode), draw-mime, word-weaver-duel                                    |
| **Has paper-photo alt submit** (works on either — rear cam optional)      | 5     | peer-editing, interview, speed-draw, mind-mapper, draw                                                      |

**Only ~11 task types are truly incompatible with laptop mode**, not ~half like the spec's wording implies. This changes the shape of the feature — Mixed mode isn't as devastating as feared (§4.2), and the capability enum can stay lean.

### 2.4 QR scanning today

- **jsQR is already a dep** in `student-app/package.json`. No new library needed.
- `student-app/src/components/QrScanner.jsx` — hardcoded to `facingMode: "environment"` at line 52. Fallback path is a manual text input with placeholder `"e.g. RED-01"` (line 45).
- **QR payload is a URL with the plain color name:** `https://play.curriculate.net/{location}/{color}` — no token. Students can bypass by typing "red" in the fallback textbox. **The spec's Section 6 principle ("station codes must not be visible") is already violated by the current system.** See §4.6.
- QR image comes from `quickchart.io` external service — an offline classroom currently can't even print QR posters. Separate but related tech debt.

### 2.5 Camera capture patterns already in use

Two coexisting patterns across ~11 task components:

- **`<input type="file" accept="image/*" capture="environment">`** — native camera picker on mobile, file picker on desktop. Used by PhotoTask, HideNSeekTask, PeerEditingTask, InterviewTask, SpeedDrawTask, MindMapperTask, PaperPhotoSubmit, PaperModeCamera, HandwritingCapture. `MakeAndSnapTask` deliberately dropped `capture` for compatibility (line 457 comment).
- **`getUserMedia`** live video/audio — used by QrScanner, DiffDetectiveTask, LiveDebateTask, PronunciationTask, NoiseSensor, TeachBackTask, TeamSelfieTask.

**Consequence:** on laptop, all `<input capture>` tasks already work via file picker. They're not truly blocked — the UX just shifts (upload a photo from files instead of snap now). Whether we count those as "compatible" is a UX-quality call.

### 2.6 Print pipeline

- Only station-card generator is `teacher-app/src/pages/StationPosters.jsx` — pure HTML + `@media print` + `window.print()`. One letter-portrait page per station.
- QR image is an `<img src>` pointing to `quickchart.io`.
- **No duplex, no jsPDF, no server-side PDF, no double-sided layout anywhere in the repo.**

**Consequence for hidden QR cards:** we're building the print pipeline from scratch. Section 7 is not a small feature — it's a new print system.

### 2.7 Analytics + tests

- **Analytics is batch rollup** at session end (`buildAnalyticsForSession` → `SessionAnalytics` + `StudentSessionAnalytics` collections). No event-stream, no PostHog/Mixpanel. Adding per-event tracking is a new pattern.
- **Test harness thin.** Backend has Jest (`backend/tests/*.test.js`), Playwright e2e at `dev/e2e/`. Teacher-app and student-app have **no test runner wired up** — adding Vitest+RTL is prerequisite work for meeting Section 16.

---

## 3. Proposed architecture

### 3.1 Capability enum — start lean

Ship these 5 capabilities first, matching what the audit actually revealed:

```ts
type DeviceCapability =
  | "rear_camera"       // photo of paper/object/world OR station-QR submit
  | "front_camera"      // team selfie, video performances that face the team
  | "microphone"        // audio recording, speech recognition
  | "device_motion"     // accelerometer/gyro (motion-mission, hole-in-one)
  | "large_screen";     // best experienced on a big canvas (mind-mapper, mapit)
```

The spec's 12-value enum is honest premature abstraction — 7 of the values (`qr_scan`, `photo_capture`, `video_capture`, `audio_recording`, `touch_input`, `keyboard_input`, `drag_and_drop`, `file_upload`) don't gate any real task in the current codebase. Add them individually **when** a new task type needs a capability we don't have.

### 3.2 Per-type compatibility metadata

Extend `TASK_TYPE_META` in `shared/taskTypes.js` (the existing single source of truth for per-type metadata) with a new `deviceCompat` object:

```js
// In TASK_TYPE_META[TASK_TYPES.MULTIPLE_CHOICE]:
deviceCompat: {
  requiredCapabilities: [],
  preferredCapabilities: [],
  supportedDeviceModes: ["tablet_only", "laptop_only", "mixed"],
}

// In TASK_TYPE_META[TASK_TYPES.PHOTO]:
deviceCompat: {
  requiredCapabilities: ["rear_camera"],
  preferredCapabilities: [],
  supportedDeviceModes: ["tablet_only"],
  incompatibilityReason: "Needs a tablet with a rear-facing camera to photograph physical work.",
}

// In TASK_TYPE_META[TASK_TYPES.MOTION_MISSION]:
deviceCompat: {
  requiredCapabilities: ["device_motion"],
  preferredCapabilities: [],
  supportedDeviceModes: ["tablet_only"],
  incompatibilityReason: "Needs a mobile device that can detect motion. Laptops can't score these gestures.",
}
```

Extend `TASK_TYPE_META_DEFAULTS` so any type without an explicit `deviceCompat` inherits `{ requiredCapabilities: [], supportedDeviceModes: ["tablet_only","laptop_only","mixed"] }` — universal by default, opt-out via explicit flags.

### 3.3 Pure filter function in `shared/`

New file: `shared/deviceModeFilter.js`.

```js
// Pure. No React, no fetch, no side effects. Used by teacher-app pre-launch,
// backend launch validator, and (later) student-app runtime skip logic.
export function filterTasksForDeviceMode(tasks, deviceMode) {
  const compatible = [];
  const incompatible = [];
  for (const t of tasks) {
    const meta = TASK_TYPE_META[t.type]?.deviceCompat || DEFAULT_COMPAT;
    if (meta.supportedDeviceModes.includes(deviceMode)) {
      compatible.push(t);
    } else {
      incompatible.push({
        task: t,
        reason: meta.incompatibilityReason || DEFAULT_REASON_FOR(deviceMode, meta),
        requiredCapabilities: meta.requiredCapabilities,
      });
    }
  }
  return { compatible, incompatible };
}
```

### 3.4 Where `deviceMode` lives on the wire

Add to the in-memory room object built in `backend/socket/roomEngine.js:createRoom()`:

```js
rooms[code] = {
  code,
  // …existing fields
  deviceMode: "tablet_only",  // new — default preserves current behavior
  qrCardFormat: "standard",   // new — used by print system (Phase 3)
  allowTeacherFallbackCodes: false, // new — accessibility fallback (Phase 4)
  // …
};
```

Included in every `room:state` broadcast so teacher-app + student-app can read it. `teacher:setDeviceMode` socket handler for the pre-launch selector.

### 3.5 Phase-by-phase file changes

**Phase 1 — Data model + selector + filter + launch validation (this turn's scope after sign-off).**

Files to create:
- `shared/deviceModeFilter.js` — pure filter + reason strings
- `teacher-app/src/components/DeviceModeSelector.jsx` — three-card selector for pre-launch
- `teacher-app/src/components/IncompatibleTaskPanel.jsx` — warning panel with per-task reason + Replace/Remove buttons
- `docs/device-mode-architecture.md` — this file

Files to modify:
- `shared/taskTypes.js` — add `deviceCompat` metadata to every task type entry, add `DEFAULT_COMPAT` to `TASK_TYPE_META_DEFAULTS`
- `backend/socket/roomEngine.js` — add `deviceMode` to room state, socket handler, broadcast
- `backend/index.js` — wire `teacher:setDeviceMode` socket event
- `teacher-app/src/pages/LiveSession.jsx` — inject `<DeviceModeSelector>` in pre-launch flow, filter tasks in launch-readiness check
- `backend/tests/deviceModeFilter.test.js` — unit tests for filter + intersection rules

**Phase 2 — Laptop webcam QR scanning + device detection + dashboard indicators.**

- Modify `student-app/src/components/QrScanner.jsx` — accept `preferredFacingMode` prop; when `deviceMode === "laptop_only"` or camera enumeration returns no environment-facing camera, drop `facingMode` constraint and fall through to whichever camera the laptop has
- New `student-app/src/utils/deviceDetection.js` — lightweight UA + `mediaDevices.enumerateDevices` sniffing; returns `{ deviceType, hasCamera, cameraFacingModes, supportsTouch }`
- Student join payload carries a `clientDeviceInfo` object; backend attaches to team record
- Teacher-app dashboard shows per-team device chip with soft warning icon on mismatch

**Phase 3 — Hidden QR cards + print system.**

- Build the double-sided print pipeline. This is real work: new print component, duplex-flip layout math, QR generation via a local library (`qrcode` npm package) — not the current external `quickchart.io` dependency
- Print preview screen with visual "how to attach" illustration
- Support letter + A4, long-edge and short-edge flip
- **This phase depends on §4.1 decision.** If we pilot first and the hidden-card workflow doesn't survive contact with real Chromebooks, this phase changes shape entirely

**Phase 4 — Analytics events + accessibility fallback + polish + e2e.**

- Add Vitest + RTL to teacher-app and student-app (prerequisite)
- Analytics event pattern: extend `SessionAnalytics` schema or add lightweight `SessionEvent` collection
- Teacher-generated one-shot fallback codes for accessibility (per team, not visible to class)
- Playwright e2e flows A/B/C/D from spec Section 16
- Persist `deviceMode` to Mongo (either resurrect `Session.js` or add to a fresh `SessionConfig` collection)

---

## 4. Decisions — user calls (locked 2026-07-21)

**Summary of what user decided vs the pre-decision proposals below:**

- **§4.1 Pilot hidden-QR cards first** — approved. Phase 3 print pipeline blocked on pilot outcome.
- **§4.2 Mixed = Laptop-only for task filtering** — user override. No device-aware routing planned. All three mode names retained for device detection + print + analytics, but the task-filter treats Mixed and Laptop-only identically.
- **§4.3 Capability enum trimmed further** — only `device_motion` gates task compatibility. `rear_camera`, `front_camera`, `microphone` become **preferred** capabilities (used for analytics + UX hints, do not filter tasks). All laptop-workarounds (file picker fallback for photo, front webcam for selfie) are treated as compatible even if UX is degraded.
- **§4.4 Silent substitution** — user override. Not "warn but allow" — no teacher-facing warning UI at all. Incompatible tasks are silently swapped at launch time with a same-topic, same-vocab task of a compatible type using the existing `regenerateSingleTask` machinery. Teachers and students see no compatibility drama; the design goal is "students will come to prefer/demand tablets" without teacher friction.
- **§4.5 QR payload hardening** — in scope for Phase 2 (opaque tokens). Approved.

**Truly-blocked task list (locked):** motion-mission, hole-in-one, treasure-runner (interstitial only), body-break.
**Note on body-break:** currently implemented as view-only, but user's intent is that it uses motion. Adding motion capability to its `deviceCompat` metadata aligns with intended future behavior. On tablets it plays as-is; on laptops it substitutes.

### Original five decision points (kept below for context)

Each of these changes what code I write.

### 4.1 Do we pilot hidden-QR cards before building the print pipeline?

**The concern:** Chromebook webcams are notoriously bad at close-focus. Lifting a paper card and putting a laptop under it may not focus well enough to read the QR at classroom lighting.

**Options:**
- **A.** Print 5 test cards, put them on your classroom wall, hold 5 real Chromebooks under them. Report back before Phase 3 starts. If they focus + read, build the pipeline as-spec. If not, redesign laptop mode around a different scan mechanism.
- **B.** Assume it works, build the print pipeline anyway. Reversible if the pilot fails, but we'll have burned Phase 3.

**Recommended: A.** Phase 1 + Phase 2 don't depend on this, so the pilot doesn't block any code. It just determines whether Phase 3 exists in its current form.

### 4.2 What does Mixed mode actually mean?

**Spec's default:** `mixed = intersection(tablet_compat, laptop_compat)`. Everything a laptop can't do gets dropped. Teacher picking the "flexible" option gets the smallest activity pool.

Given the audit (only ~11 types are truly laptop-blocked out of ~79), intersection isn't actually that punishing — the teacher still gets ~55+ universal types. So the trap I flagged earlier is less severe than I initially thought.

**Options:**
- **A.** Phase 1 = intersection as spec says. Phase 2 or 3 = optional device-aware routing (incompatible tasks auto-route to compatible teams only; other teams get a variant or observer role).
- **B.** Phase 1 = intersection only. Never build device-aware routing — accept the tradeoff.
- **C.** Phase 1 = "warn but include" — every task appears in Mixed, with a note next to incompatible ones saying which team types will skip them. Runtime skip logic on student-app.

**Recommended: A.** Ship intersection now, plan the routing extension as a Phase 2/3 add. Option C is tempting but adds Mixed-mode-specific student-app runtime logic that's premature.

### 4.3 Capability enum — start with 5, or spec's 12?

**Options:**
- **A.** Ship the 5 real ones now (`rear_camera`, `front_camera`, `microphone`, `device_motion`, `large_screen`). Extend when needed.
- **B.** Ship all 12 the spec listed. Some (`keyboard_input`, `touch_input`) are trivially satisfied by any device but future-proof future task types.

**Recommended: A.** The 5 real ones map 1:1 to actual task requirements from the audit. Adding capabilities that don't gate any current task muddies the model. If we discover we need `photo_capture` distinct from `rear_camera` later, we add it in an afternoon.

### 4.4 Block launch on incompatible tasks, or warn + allow?

**Spec says block:** "prevent launch if the session contains activities that cannot run in the selected mode."

**Options:**
- **A.** Warn but allow. Skip incompatible tasks at run-time for affected teams (Mixed mode) or all teams (single-mode with legacy tasks still in the set).
- **B.** Block as spec. Force explicit resolution before launch.

**Recommended: A.** Real classrooms are messier than the spec's Platonic ideal. A teacher who wants to launch with 8 tasks knowing 2 will be skipped shouldn't be blocked. But: make the warning **loud** (a modal, not a toast) and require explicit "Launch anyway" confirmation. That's the honest middle path.

### 4.5 QR payload hardening — in scope or separate work?

Right now `normalizeStationId("red")` accepts a raw color name because the QR encodes `.../red` as a URL. That's already the "visible code" anti-pattern the spec warns about. Hardening it means switching the QR payload to opaque per-station tokens (like the unused `Session.stations[].qrToken` field in Mongo).

**Options:**
- **A.** In scope for this feature — do it as part of Phase 2 alongside laptop scanning. Same subsystem, same test surface, and it's a real security hardening.
- **B.** Out of scope — file as separate tech debt; ship device-mode without touching QR payload format.

**Recommended: A.** But it means Phase 2 grows by ~1 day for token generation + rotation + `normalizeStationId` update + student-app scan-URL parser update. Worth it — otherwise the "no visible codes" principle is a fig leaf.

---

## 5. What I need from you

Sign off on the five decision points above (or override any). I'll take the answers, revise this doc if anything changed, and start Phase 1 code on the next turn.

If all five recommendations land as recommended, Phase 1 concretely delivers:

- `shared/deviceModeFilter.js` — pure filter function + tests
- `shared/taskTypes.js` — `deviceCompat` metadata on every task type (large diff, mechanical)
- `backend/socket/roomEngine.js` — `deviceMode` on room state + broadcast
- `backend/index.js` — `teacher:setDeviceMode` socket handler
- `teacher-app/src/components/DeviceModeSelector.jsx` — pre-launch 3-card picker
- `teacher-app/src/components/IncompatibleTaskPanel.jsx` — warning modal
- `teacher-app/src/pages/LiveSession.jsx` — integrate the above
- `backend/tests/deviceModeFilter.test.js` — unit tests
- Update `CLAUDE.md` — new "M. Device Mode Support" section pointing to this doc

Phase 1 is **not**: laptop webcam scanning, device detection, dashboard indicators, hidden QR cards, print preview, analytics events, accessibility fallback, e2e tests. Those are Phases 2-4.

---

## 6. Open questions I don't need answered yet

Parking these — they matter but not for Phase 1 sign-off:

- **Persistence:** do we resurrect the legacy `Session.js` Mongo model, or add a fresh `SessionConfig` collection? Phase 4 decision.
- **QR library replacement:** switch from `quickchart.io` to the `qrcode` npm package now (offline-safe, no external dep) or defer? Phase 3 decision.
- **Test framework choice for teacher-app + student-app:** Vitest + React Testing Library is the sensible default (matches the Vite build). Confirm in Phase 4.
- **Mobile app impact:** the `mobile-app-curriculate/` Capacitor shell we scaffolded earlier will need to advertise its capabilities to `deviceDetection.js`. That's Phase 2 work, but flag now.
