// student-app/src/utils/deviceDetection.js
//
// Device Mode Support — Phase 2a. Lightweight sniffer that reports
// what class of device the student joined from so the teacher can
// see per-team device chips and (later) route device-aware activities.
//
// Design: this is a HELPER, not a gatekeeper. UA sniffing + camera
// enumeration are both fuzzy; treat every result as advisory. The
// spec (Section 10) is explicit: "do not block users automatically
// unless there is a genuine compatibility failure."
//
// Returns:
//   {
//     deviceType: "tablet" | "laptop" | "phone" | "unknown",
//     hasCamera: boolean,
//     cameraFacingModes: Array<"environment"|"user"|"unknown">,
//     supportsTouch: boolean,
//     userAgent: string,
//   }
//
// enumerateDevices() works before camera permission is granted but
// returns limited label data. We call getUserMedia() FIRST only when
// the caller explicitly requests it via {probeCamera:true} — most
// callers should leave that off so we don't trigger a permission
// prompt just to sniff.

const UA_MATCHERS = [
  // Order matters: tablet UA strings often contain "Mobile" too, so
  // check tablet-y hints first.
  { type: "tablet", re: /iPad|Android(?!.*Mobile)|Tablet|Kindle|Silk|PlayBook/i },
  { type: "phone",  re: /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i },
  { type: "laptop", re: /Macintosh|Windows NT|Linux(?!.*Android)|CrOS/i },
];

function classifyByUA(userAgent, supportsTouch, largestDim) {
  const ua = String(userAgent || "");
  for (const m of UA_MATCHERS) {
    if (m.re.test(ua)) {
      // Chromebooks (CrOS) claim laptop but sometimes have touch. Don't
      // flip on touch alone — Chromebook IS a laptop.
      return m.type;
    }
  }
  // UA didn't match a known pattern (private browsers strip UA, etc.).
  // Fall back to screen size + touch heuristic:
  //   - large screen + no touch = laptop
  //   - large screen + touch    = tablet
  //   - small screen            = phone
  if (largestDim >= 1200 && !supportsTouch) return "laptop";
  if (largestDim >= 800 && supportsTouch) return "tablet";
  if (largestDim < 800) return "phone";
  return "unknown";
}

async function readCamerasFacingModes({ probeCamera = false } = {}) {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return { hasCamera: false, facingModes: [] };
  }
  try {
    // enumerateDevices returns camera COUNT even without permission,
    // but the labels/facingMode may be blank pre-permission.
    let devices = [];
    if (typeof navigator.mediaDevices.enumerateDevices === "function") {
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const cams = devices.filter((d) => d.kind === "videoinput");
    if (cams.length === 0) return { hasCamera: false, facingModes: [] };

    // Best-effort: map labels to facing modes. Real facingMode comes
    // from a MediaStreamTrack's getSettings() and is only reliable
    // AFTER getUserMedia — hence the probeCamera flag.
    const modes = new Set();
    for (const cam of cams) {
      const label = String(cam.label || "").toLowerCase();
      if (/back|rear|environment|world/.test(label)) modes.add("environment");
      else if (/front|user|face|selfie/.test(label)) modes.add("user");
      else modes.add("unknown");
    }

    if (probeCamera && cams.length > 0) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true, audio: false,
        });
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings ? track.getSettings() : {};
        if (settings.facingMode) modes.add(String(settings.facingMode));
        track?.stop();
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied is fine — we still return what we know.
      }
    }
    return { hasCamera: true, facingModes: Array.from(modes) };
  } catch {
    return { hasCamera: false, facingModes: [] };
  }
}

/**
 * Detect the student's device profile. Non-blocking, non-throwing.
 * Safe to call in module scope on mount.
 */
export async function detectClientDeviceInfo(opts = {}) {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      deviceType: "unknown",
      hasCamera: false,
      cameraFacingModes: [],
      supportsTouch: false,
      userAgent: "",
    };
  }
  const ua = navigator.userAgent || "";
  const supportsTouch =
    "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
  const largestDim = Math.max(
    Number(window.innerWidth) || 0,
    Number(window.innerHeight) || 0,
    Number(window.screen?.width) || 0,
    Number(window.screen?.height) || 0
  );
  const deviceType = classifyByUA(ua, supportsTouch, largestDim);
  const { hasCamera, facingModes } = await readCamerasFacingModes(opts);
  return {
    deviceType,
    hasCamera,
    cameraFacingModes: facingModes,
    supportsTouch,
    userAgent: ua,
  };
}

/**
 * Given a device-mode and the client's known cameras, return the
 * preferred facingMode for QR scanning:
 *   - Tablets w/ rear camera → "environment"
 *   - Laptops (usually no rear cam) → "user" (webcam)
 *   - Mixed / unknown → prefer "environment" if we see one, else "user"
 *
 * The scanner should ALSO fall back to no-facingMode-constraint on
 * getUserMedia failure so weird devices still get some camera.
 */
export function preferredFacingModeFor(deviceMode, clientDeviceInfo) {
  const modes = clientDeviceInfo?.cameraFacingModes || [];
  const hasRear = modes.includes("environment");
  const hasFront = modes.includes("user");
  const type = clientDeviceInfo?.deviceType || "unknown";

  if (deviceMode === "laptop_only") return hasRear ? "environment" : "user";
  if (type === "laptop") return hasRear ? "environment" : "user";
  if (hasRear) return "environment";
  if (hasFront) return "user";
  return null;
}
