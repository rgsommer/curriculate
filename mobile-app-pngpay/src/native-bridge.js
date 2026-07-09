/**
 * native-bridge.js — PNGPay
 *
 * Injected into the WebView to bridge the hosted TeeBee payroll app to native
 * Capacitor APIs. Exposes a global `PngpayNative` object.
 *
 * PNGPay is a role-specific tool for supervisors: submit team hours and leave,
 * then hand off to the bookkeeper for approval. It deliberately has NO camera
 * (fewer permissions, faster review). Its native value-add is push (hours-due
 * reminders), haptics, back-button handling, and keeping the WebView locked to
 * the TeeBee app.
 */

import { PushNotifications } from "@capacitor/push-notifications";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { Browser } from "@capacitor/browser";

// ── Push Notifications ──────────────────────────────────────────
// Hours-due reminders and approval notices, delivered as native push.
export async function registerPush() {
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    console.log("Push permission denied");
    return null;
  }
  await PushNotifications.register();
  return new Promise((resolve) => {
    PushNotifications.addListener("registration", (token) => resolve(token.value));
    PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration failed:", err);
      resolve(null);
    });
  });
}

function setupPushListeners() {
  PushNotifications.addListener("pushNotificationReceived", (n) => {
    console.log("Push received:", n);
  });
  // Tapping a reminder jumps to the relevant screen (default: team hours).
  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action.notification?.data || {};
    if (data.url) window.location.href = data.url;
    else window.location.href = "/teebeepay/app?view=team";
  });
}

// ── Haptics ─────────────────────────────────────────────────────
export async function hapticLight() { await Haptics.impact({ style: ImpactStyle.Light }); }
export async function hapticMedium() { await Haptics.impact({ style: ImpactStyle.Medium }); }

// ── App Lifecycle ───────────────────────────────────────────────
function setupAppListeners() {
  // Deep links (e.g. curriculate.net/teebeepay/...) open in the app.
  App.addListener("appUrlOpen", (event) => {
    try {
      const url = new URL(event.url);
      if (url.pathname) window.location.href = url.pathname + url.search;
    } catch (_) { /* ignore malformed */ }
  });
  // Android hardware back button.
  App.addListener("backButton", () => {
    if (window.history.length > 1) window.history.back();
    else App.exitApp();
  });
}

// ── Navigation Guard ────────────────────────────────────────────
// Keep the app locked to the TeeBee app (/teebeepay). Any link elsewhere —
// or to an external site — opens in the phone's default browser.
function setupNavigationGuard() {
  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    try {
      const url = new URL(href, window.location.origin);
      const isInternal = url.origin === window.location.origin;
      const isTeebee = url.pathname.startsWith("/teebeepay");
      if (!isInternal || !isTeebee) {
        e.preventDefault();
        e.stopPropagation();
        Browser.open({ url: url.href });
      }
    } catch (err) {
      e.preventDefault();
      Browser.open({ url: href });
    }
  }, true); // capture phase to intercept before React handlers
}

// ── Initialize ──────────────────────────────────────────────────
export async function initNative() {
  await SplashScreen.hide();
  setupAppListeners();
  setupPushListeners();
  setupNavigationGuard();

  window.PngpayNative = {
    registerPush,
    hapticLight,
    hapticMedium,
    isNative: true,
    platform: window.Capacitor?.getPlatform() || "web",
  };

  console.log("[PNGPay] Native bridge initialized on", window.PngpayNative.platform);
}

if (window.Capacitor) {
  initNative();
}
