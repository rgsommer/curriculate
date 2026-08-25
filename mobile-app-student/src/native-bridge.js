/**
 * native-bridge.js — Curriculate Student
 *
 * The student web app (play.curriculate.net) drives the camera (QR scan),
 * microphone (audio/speech tasks) and accelerometer (Motion Mission)
 * directly through standard web APIs, which work inside the WebView once
 * the native permissions are declared (Info.plist / AndroidManifest). So
 * this bridge is intentionally thin: hide the splash, wire lifecycle,
 * expose haptics + a motion-permission helper, and keep navigation inside
 * play.curriculate.net.
 *
 * Include via Capacitor's server.injectedJavaScript, or ship bundled and
 * load before handing off to the live site.
 */

import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Network } from "@capacitor/network";

const APP_HOST = "play.qrewzi.com";

// ── Haptics ─────────────────────────────────────────────────────
export async function hapticLight() {
  await Haptics.impact({ style: ImpactStyle.Light });
}
export async function hapticSuccess() {
  await Haptics.notification({ type: NotificationType.Success });
}

// ── Device motion permission (Motion Mission task, iOS 13+) ──────
// iOS requires a user-gesture-triggered permission prompt before
// DeviceMotion events fire. The web app can call this from a tap.
export async function requestMotion() {
  try {
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === "function") {
      const res = await DME.requestPermission();
      return res === "granted";
    }
    return true; // Android / older iOS: no explicit prompt needed
  } catch {
    return false;
  }
}

// ── App lifecycle ───────────────────────────────────────────────
export function setupAppListeners() {
  App.addListener("appUrlOpen", (event) => {
    try {
      const url = new URL(event.url);
      if (url.pathname) window.location.href = url.pathname + url.search;
    } catch {
      /* ignore malformed deep links */
    }
  });

  App.addListener("backButton", () => {
    if (window.history.length > 1) window.history.back();
    else App.exitApp();
  });
}

// ── Network status ──────────────────────────────────────────────
// A live game needs a connection — surface offline state so the web app
// can show a reconnect banner instead of a silently dead socket.
export function setupNetworkListeners() {
  Network.addListener("networkStatusChange", (status) => {
    window.dispatchEvent(
      new CustomEvent("curriculate:network", { detail: status })
    );
  });
}

// ── Navigation guard ────────────────────────────────────────────
// Keep the app inside play.curriculate.net; open other links externally.
function setupNavigationGuard() {
  document.addEventListener(
    "click",
    (e) => {
      const anchor = e.target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      try {
        const url = new URL(href, window.location.origin);
        if (url.host !== APP_HOST) {
          e.preventDefault();
          e.stopPropagation();
          Browser.open({ url: url.href });
        }
      } catch {
        e.preventDefault();
        Browser.open({ url: href });
      }
    },
    true
  );
}

// ── Initialize ──────────────────────────────────────────────────
export async function initNative() {
  await SplashScreen.hide();
  setupAppListeners();
  setupNetworkListeners();
  setupNavigationGuard();

  window.CurriculateStudent = {
    hapticLight,
    hapticSuccess,
    requestMotion,
    isNative: true,
    platform: window.Capacitor?.getPlatform() || "web",
  };

  console.log(
    "[Curriculate Student] Native bridge initialized on",
    window.CurriculateStudent.platform
  );
}

if (window.Capacitor) {
  initNative();
}
