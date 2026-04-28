/**
 * native-bridge.js
 *
 * This script is injected into the WebView to bridge between the
 * Curriculate web app and native Capacitor APIs. It exposes a
 * global `CurriculateNative` object that the web app can call.
 *
 * Include this via Capacitor's server.injectedJavaScript or by
 * adding a <script> tag to your web app that checks for Capacitor.
 */

import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { PushNotifications } from "@capacitor/push-notifications";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";

// ── Camera ──────────────────────────────────────────────────────
// Use native camera instead of browser file picker for better UX
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
// Register for push notifications (grade alerts, weekly digests)
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
  PushNotifications.addListener(
    "pushNotificationReceived",
    (notification) => {
      console.log("Push received:", notification);
      // Could show an in-app banner here
    }
  );

  // User tapped on a notification
  PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action) => {
      const data = action.notification.data;
      // Navigate to the result if a code is provided
      if (data?.resultCode) {
        window.location.href = `/results/${data.resultCode}`;
      } else if (data?.url) {
        window.location.href = data.url;
      }
    }
  );
}

// ── Haptics ─────────────────────────────────────────────────────
// Subtle feedback on grade reveal, button taps, etc.
export async function hapticLight() {
  await Haptics.impact({ style: ImpactStyle.Light });
}

export async function hapticMedium() {
  await Haptics.impact({ style: ImpactStyle.Medium });
}

// ── App Lifecycle ───────────────────────────────────────────────
export function setupAppListeners() {
  // Handle deep links (e.g., curriculate.net/results/AB123)
  App.addListener("appUrlOpen", (event) => {
    const url = new URL(event.url);
    if (url.pathname) {
      window.location.href = url.pathname + url.search;
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

// ── Navigation Guard ────────────────────────────────────────────
// Keep the app locked to /grading. Any link to other parts of the
// site (or external URLs) opens in the phone's default browser.
import { Browser } from "@capacitor/browser";

function setupNavigationGuard() {
  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a[href]");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

    try {
      const url = new URL(href, window.location.origin);
      const isInternal = url.origin === window.location.origin;
      const isGrading = url.pathname.startsWith("/grading");

      if (!isInternal || !isGrading) {
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
  }, true); // capture phase to intercept before React handlers
}

// ── Initialize ──────────────────────────────────────────────────
export async function initNative() {
  // Hide splash screen once web app has loaded
  await SplashScreen.hide();

  // Set up listeners
  setupAppListeners();
  setupPushListeners();
  setupNavigationGuard();

  // Expose to global scope so web app can call these
  window.CurriculateNative = {
    takePhoto,
    registerPush,
    hapticLight,
    hapticMedium,
    isNative: true,
    platform: window.Capacitor?.getPlatform() || "web",
  };

  console.log("[Pulse] Native bridge initialized on", window.CurriculateNative.platform);
}

// Auto-initialize when loaded
if (window.Capacitor) {
  initNative();
}
