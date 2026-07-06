/**
 * native-bridge.js
 *
 * Bridges the Curriculate web app (teacher Live Sessions / Game Master,
 * served from set.curriculate.net) to native Capacitor APIs. Exposes a
 * global `CurriculateNative` object the web app can feature-detect and
 * call.
 *
 * In live-URL mode the native shell loads the production site directly,
 * so this file is a reference for the capabilities the shell provides
 * and the initialization it performs. Include it via Capacitor's
 * `server.injectedJavaScript`, or ship it as a bundled entry that the
 * WebView loads before handing off to the live site.
 */

import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { PushNotifications } from "@capacitor/push-notifications";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { Browser } from "@capacitor/browser";
import { Network } from "@capacitor/network";
import { ScreenOrientation } from "@capacitor/screen-orientation";

// The origin the app is allowed to stay inside. Any navigation outside
// this host opens in the phone's default browser instead of the WebView.
const APP_HOST = "set.curriculate.net";

// ── Camera ──────────────────────────────────────────────────────
// Native camera for QR/join-code scanning and photo entry — better UX
// than the browser file picker on a phone in a classroom.
export async function takePhoto() {
  try {
    const image = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt, // let user choose camera or gallery
      correctOrientation: true,
      width: 2048, // cap resolution to save bandwidth
    });
    return image.dataUrl;
  } catch (err) {
    console.log("Camera cancelled or failed:", err);
    return null;
  }
}

// ── Push Notifications ──────────────────────────────────────────
// Register for push (session-start pings, student-joined alerts).
export async function registerPush() {
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    console.log("Push permission denied");
    return null;
  }

  await PushNotifications.register();

  return new Promise((resolve) => {
    PushNotifications.addListener("registration", (token) => {
      console.log("Push token:", token.value);
      resolve(token.value);
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration failed:", err);
      resolve(null);
    });
  });
}

// Handle incoming push notifications
export function setupPushListeners() {
  // Notification received while app is in foreground
  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    console.log("Push received:", notification);
    // Could show an in-app banner here
  });

  // User tapped on a notification — deep-link into the session/route
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action.notification.data;
    if (data?.sessionCode) {
      window.location.href = `/session/${data.sessionCode}`;
    } else if (data?.url) {
      window.location.href = data.url;
    }
  });
}

// ── Haptics ─────────────────────────────────────────────────────
// Feedback on button taps and celebration moments (correct answer,
// leaderboard change, session complete).
export async function hapticLight() {
  await Haptics.impact({ style: ImpactStyle.Light });
}

export async function hapticMedium() {
  await Haptics.impact({ style: ImpactStyle.Medium });
}

export async function hapticSuccess() {
  await Haptics.notification({ type: NotificationType.Success });
}

// ── App Lifecycle ───────────────────────────────────────────────
export function setupAppListeners() {
  // Handle deep links (e.g., set.curriculate.net/session/ABC12)
  App.addListener("appUrlOpen", (event) => {
    try {
      const url = new URL(event.url);
      if (url.pathname) {
        window.location.href = url.pathname + url.search;
      }
    } catch {
      /* ignore malformed deep links */
    }
  });

  // Handle back button on Android
  App.addListener("backButton", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });
}

// ── Network status ──────────────────────────────────────────────
// A live session dies without a connection — surface offline state so
// the web app can show a reconnect banner rather than a broken socket.
export function setupNetworkListeners() {
  Network.addListener("networkStatusChange", (status) => {
    window.dispatchEvent(
      new CustomEvent("curriculate:network", { detail: status })
    );
    console.log("[Curriculate] network:", status.connected ? "online" : "offline");
  });
}

// ── Navigation Guard ────────────────────────────────────────────
// Keep the app inside set.curriculate.net. Links elsewhere (marketing
// site, external URLs) open in the phone's default browser.
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
        const isInternal = url.host === APP_HOST;

        if (!isInternal) {
          // Open in external browser instead of navigating in WebView
          e.preventDefault();
          e.stopPropagation();
          Browser.open({ url: url.href });
        }
      } catch (err) {
        // Malformed URL — open externally to be safe
        e.preventDefault();
        Browser.open({ url: href });
      }
    },
    true // capture phase to intercept before framework handlers
  );
}

// ── Initialize ──────────────────────────────────────────────────
export async function initNative() {
  // Hide splash once the web app has painted
  await SplashScreen.hide();

  setupAppListeners();
  setupPushListeners();
  setupNetworkListeners();
  setupNavigationGuard();

  // Expose to global scope so the web app can feature-detect + call in
  window.CurriculateNative = {
    takePhoto,
    registerPush,
    hapticLight,
    hapticMedium,
    hapticSuccess,
    lockPortrait: () => ScreenOrientation.lock({ orientation: "portrait" }),
    unlockOrientation: () => ScreenOrientation.unlock(),
    isNative: true,
    platform: window.Capacitor?.getPlatform() || "web",
  };

  console.log(
    "[Curriculate] Native bridge initialized on",
    window.CurriculateNative.platform
  );
}

// Auto-initialize when running inside the Capacitor shell
if (window.Capacitor) {
  initNative();
}
