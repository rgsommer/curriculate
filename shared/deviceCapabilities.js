// shared/deviceCapabilities.js
//
// Device-mode support for Curriculate. Pure data + pure functions,
// no React, no fetch, no side effects. Consumed by:
//   - teacher-app  (DeviceModeSelector, LiveSession pre-launch)
//   - backend      (roomEngine at launch time — Phase 1b — for the
//                   silent substitution pass)
//   - student-app  (device detection payload — Phase 2)
//
// Design decisions locked in docs/device-mode-architecture.md §4:
//   - 3 device modes are user-facing, but for TASK FILTERING purposes
//     "mixed" and "laptop_only" behave identically (limiting factor is
//     the laptop). The distinction still matters for device detection,
//     print card selection, and analytics.
//   - Only device_motion GATES compatibility. Camera / mic / large
//     screen are "preferred" capabilities used for analytics + UX
//     hints, they don't filter tasks. Laptops fall back to file picker
//     for camera tasks, front webcam for selfie tasks — all treated
//     as compatible.
//   - Truly-blocked task list: motion-mission, hole-in-one,
//     treasure-runner (interstitial only, so it degrades gracefully),
//     body-break (motion is its intended pedagogy).
//
// Adding a new device capability: extend DEVICE_CAPABILITIES and, if
// the capability HARD-blocks on some mode, add it to the mode's
// blocking set below. Don't scatter checks through the UI.

export const DEVICE_MODES = {
  TABLET_ONLY: "tablet_only",
  LAPTOP_ONLY: "laptop_only",
  MIXED: "mixed",
};

export const ALL_DEVICE_MODES = Object.values(DEVICE_MODES);

export const DEFAULT_DEVICE_MODE = DEVICE_MODES.TABLET_ONLY;

/**
 * Capability catalogue. Kept small on purpose — see architecture doc.
 * Adding a capability: append here + tag the affected task types in
 * shared/taskTypes.js (TASK_TYPE_META[key].deviceCompat).
 */
export const DEVICE_CAPABILITIES = {
  DEVICE_MOTION: "device_motion",   // accelerometer + gyroscope
  REAR_CAMERA: "rear_camera",       // preferred, not gating (file picker fallback works)
  FRONT_CAMERA: "front_camera",     // preferred, not gating (laptop webcam is front-facing)
  MICROPHONE: "microphone",         // preferred, not gating (both platforms have mics)
  LARGE_SCREEN: "large_screen",     // preferred, not gating (mind-mapper, mapit — nicer on tablet)
};

/**
 * Capabilities that HARD-block a task from running on a given mode.
 * Anything not in these sets is a "preferred" capability and does not
 * cause substitution.
 *
 * Rationale: adding more capabilities to a mode's blocking set will
 * yank tasks out of that mode's playable pool. Only add here when a
 * task truly cannot function.
 */
const HARD_BLOCKERS_BY_MODE = {
  [DEVICE_MODES.TABLET_ONLY]: new Set([
    // Tablets handle everything current tasks require. If a task needs
    // a full physical keyboard (currently none), add "keyboard_input"
    // here and the task shifts to laptop-only.
  ]),
  [DEVICE_MODES.LAPTOP_ONLY]: new Set([
    DEVICE_CAPABILITIES.DEVICE_MOTION,
  ]),
  [DEVICE_MODES.MIXED]: new Set([
    // Same as laptop-only per user decision. When the room contains
    // any laptop team, motion-required tasks can't run for those
    // teams. Since the substitution pass is applied per-taskset (not
    // per-team) we conservatively treat mixed as laptop-only.
    DEVICE_CAPABILITIES.DEVICE_MOTION,
  ]),
};

/**
 * Default deviceCompat metadata used when a task type declares no
 * explicit compatibility block. "Universal by default" — a new task
 * type is assumed to work in every mode unless its meta says otherwise.
 */
export const DEFAULT_DEVICE_COMPAT = {
  requiredCapabilities: [],
  preferredCapabilities: [],
  supportedDeviceModes: ALL_DEVICE_MODES,
};

/**
 * Given a task's requiredCapabilities, resolve which modes it can run
 * in. Falls back to ALL_DEVICE_MODES when no requirements are set.
 */
export function supportedModesForRequired(requiredCapabilities = []) {
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return [...ALL_DEVICE_MODES];
  }
  return ALL_DEVICE_MODES.filter((mode) => {
    const blockers = HARD_BLOCKERS_BY_MODE[mode];
    return !requiredCapabilities.some((cap) => blockers.has(cap));
  });
}

/**
 * User-facing reason string. Kept in shared/ so backend + frontend
 * render the same copy. Written for teachers, not developers — no
 * "capability", "API", "media constraint" jargon.
 */
export function reasonForIncompatibility(taskType, deviceCompat, deviceMode) {
  const explicit = deviceCompat?.incompatibilityReason;
  if (explicit) return explicit;

  const req = deviceCompat?.requiredCapabilities || [];
  if (req.includes(DEVICE_CAPABILITIES.DEVICE_MOTION)) {
    if (deviceMode === DEVICE_MODES.LAPTOP_ONLY) {
      return "Needs a tablet that can detect motion. Laptops can't score these gestures.";
    }
    if (deviceMode === DEVICE_MODES.MIXED) {
      return "Needs a tablet that can detect motion — not every team in Mixed mode has one.";
    }
  }
  return "This activity isn't a fit for the selected devices.";
}

/**
 * Human-readable name + blurb for the selector cards. Kept here so
 * the copy stays consistent if referenced elsewhere.
 */
export const DEVICE_MODE_CARDS = [
  {
    id: DEVICE_MODES.TABLET_ONLY,
    icon: "📱",
    title: "Tablet Only",
    tagline: "Every team on a tablet or phone",
    blurb: "Full activity library, including photo, video, and motion-based challenges.",
    bestFor: "Classrooms where teams share a tablet or a phone.",
  },
  {
    id: DEVICE_MODES.LAPTOP_ONLY,
    icon: "💻",
    title: "Laptop Only",
    tagline: "Every team on a laptop with a webcam",
    blurb: "Curriculate quietly swaps in laptop-friendly activities where needed. Motion-based games are unavailable.",
    bestFor: "1:1 Chromebook or laptop classrooms.",
  },
  {
    id: DEVICE_MODES.MIXED,
    icon: "🎛",
    title: "Mixed Devices",
    tagline: "Some tablets, some laptops",
    blurb: "Same activity pool as Laptop Only so every team can play. Tablet teams get the full experience; laptop teams get the best equivalent.",
    bestFor: "Bring-your-own-device or shared-cart classrooms.",
  },
];

/**
 * Convenience: normalize any string into a valid DeviceMode or the
 * default. Used at read boundaries (socket payloads, URL params).
 */
export function normalizeDeviceMode(value) {
  if (typeof value === "string" && ALL_DEVICE_MODES.includes(value)) {
    return value;
  }
  return DEFAULT_DEVICE_MODE;
}
