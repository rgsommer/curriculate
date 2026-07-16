/**
 * native-bridge.js — PNGPay
 *
 * Injected into the WebView to bridge the hosted TeeBee payroll app to native
 * Capacitor APIs. Exposes a global `PngpayNative` object.
 *
 * PNGPay is a role-specific tool for supervisors: submit team hours and leave,
 * then hand off to the bookkeeper for approval. It deliberately has NO camera
 * (fewer permissions, faster review). Its native value-add is haptics,
 * back-button handling, and keeping the WebView locked to the TeeBee app.
 *
 * Push notifications are intentionally NOT included in v1 — no Firebase/APNs
 * dependency, no notification permission — to keep the first store review
 * minimal. Reintroduce via @capacitor/push-notifications in a later release.
 */

import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { Browser } from "@capacitor/browser";

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
  setupNavigationGuard();

  window.PngpayNative = {
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
