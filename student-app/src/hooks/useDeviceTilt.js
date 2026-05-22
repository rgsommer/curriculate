// student-app/src/hooks/useDeviceTilt.js
//
// Cross-platform device-tilt hook for the Hole in One task.
// Returns:
//   {
//     tilt: { x, y },      // smoothed tilt vector, range roughly -1..1
//     sourceLabel,         // "orientation" | "keyboard" | "joystick" | "idle"
//     permissionState,     // "unknown" | "needs-prompt" | "granted" | "denied" | "unsupported"
//     requestPermission,   // call from a user-gesture handler on iOS 13+
//     virtualJoystick: { onTouchStart, onTouchMove, onTouchEnd }   // bind to a joystick element if used
//   }
//
// iOS Safari requires DeviceOrientationEvent.requestPermission() to be called
// from a user-gesture handler. Other browsers expose orientation events freely.
// Chromebooks / desktops without orientation hardware fall back to arrow keys
// or a virtual on-screen joystick.
import { useEffect, useRef, useState, useCallback } from "react";

function _hasOrientationApi() {
  return typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined";
}

function _needsiOSPermission() {
  return _hasOrientationApi() && typeof window.DeviceOrientationEvent.requestPermission === "function";
}

export default function useDeviceTilt({ sensitivity = 1, smoothing = 0.85 } = {}) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [sourceLabel, setSourceLabel] = useState("idle");
  const [permissionState, setPermissionState] = useState(() => {
    if (!_hasOrientationApi()) return "unsupported";
    if (_needsiOSPermission()) return "needs-prompt";
    return "granted";
  });

  // Smoothing accumulators — refs so we don't re-render on every frame
  const smoothRef = useRef({ x: 0, y: 0 });
  const keyVelRef = useRef({ x: 0, y: 0 });
  const joyRef = useRef({ x: 0, y: 0 });

  // Apply the smoothing function with whichever source is currently active
  const applySmoothed = useCallback((nextX, nextY, source) => {
    const s = smoothRef.current;
    s.x = s.x * smoothing + nextX * (1 - smoothing);
    s.y = s.y * smoothing + nextY * (1 - smoothing);
    setTilt({ x: s.x, y: s.y });
    setSourceLabel(source);
  }, [smoothing]);

  // Orientation event handler (sensor source)
  useEffect(() => {
    if (permissionState !== "granted") return;
    const handler = (e) => {
      // event.gamma = left/right (-90..90), event.beta = front/back (-180..180)
      const gx = Number(e.gamma) / 30;     // normalize ~range to -1..1 (30° tilt ≈ full)
      const gy = Number(e.beta - 30) / 30; // baseline at 30° forward (typical hold-in-hand)
      if (Number.isFinite(gx) && Number.isFinite(gy)) {
        applySmoothed(gx * sensitivity, gy * sensitivity, "orientation");
      }
    };
    window.addEventListener("deviceorientation", handler);
    return () => window.removeEventListener("deviceorientation", handler);
  }, [permissionState, applySmoothed, sensitivity]);

  // Keyboard fallback (desktop)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const keys = new Set();
    const updateFromKeys = () => {
      let kx = 0, ky = 0;
      if (keys.has("ArrowLeft")  || keys.has("a") || keys.has("A")) kx -= 1;
      if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) kx += 1;
      if (keys.has("ArrowUp")    || keys.has("w") || keys.has("W")) ky -= 1;
      if (keys.has("ArrowDown")  || keys.has("s") || keys.has("S")) ky += 1;
      keyVelRef.current = { x: kx, y: ky };
    };
    const onKeyDown = (e) => { keys.add(e.key); updateFromKeys(); };
    const onKeyUp   = (e) => { keys.delete(e.key); updateFromKeys(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Tick keyboard / joystick sources at 60Hz when orientation isn't active
  useEffect(() => {
    let rafId = null;
    const tick = () => {
      const kv = keyVelRef.current;
      const jv = joyRef.current;
      const usingKeys = kv.x !== 0 || kv.y !== 0;
      const usingJoy  = jv.x !== 0 || jv.y !== 0;
      if (permissionState !== "granted" || sourceLabel !== "orientation") {
        if (usingKeys) applySmoothed(kv.x * sensitivity, kv.y * sensitivity, "keyboard");
        else if (usingJoy) applySmoothed(jv.x * sensitivity, jv.y * sensitivity, "joystick");
        else applySmoothed(0, 0, sourceLabel === "idle" ? "idle" : sourceLabel);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [permissionState, sourceLabel, applySmoothed, sensitivity]);

  // iOS permission request — caller must invoke this from a user-gesture handler.
  const requestPermission = useCallback(async () => {
    if (!_needsiOSPermission()) {
      setPermissionState(_hasOrientationApi() ? "granted" : "unsupported");
      return;
    }
    try {
      const result = await window.DeviceOrientationEvent.requestPermission();
      setPermissionState(result === "granted" ? "granted" : "denied");
    } catch (e) {
      setPermissionState("denied");
    }
  }, []);

  // Virtual joystick handlers (bind to a touchable element)
  const virtualJoystick = useCallback(() => {
    let origin = null;
    const onTouchStart = (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      origin = { x: t.clientX, y: t.clientY };
    };
    const onTouchMove = (e) => {
      const t = e.touches?.[0];
      if (!t || !origin) return;
      const dx = (t.clientX - origin.x) / 60; // 60px = full deflection
      const dy = (t.clientY - origin.y) / 60;
      joyRef.current = { x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) };
    };
    const onTouchEnd = () => { joyRef.current = { x: 0, y: 0 }; origin = null; };
    return { onTouchStart, onTouchMove, onTouchEnd };
  }, []);

  return { tilt, sourceLabel, permissionState, requestPermission, virtualJoystick: virtualJoystick() };
}
