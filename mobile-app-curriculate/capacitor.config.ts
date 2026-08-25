import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Curriculate — Live Session (Game Master) native shell.
 *
 * Wraps the production teacher-app in a WebView. One codebase, instant
 * updates, no store resubmission for UI changes. The native shell
 * provides camera (for QR + photo entry), haptics for celebration
 * moments, push notifications, splash, and the back-button + deep-link
 * hooks Capacitor exposes.
 *
 * Sibling app: mobile-app/ packages Pulse Grading. The two share the
 * same domain but ship as distinct store listings.
 */
const config: CapacitorConfig = {
  appId: "net.curriculate.sessions", // DO NOT CHANGE — install lineage + signing key pinned to this appId
  appName: "Qrewzi Teacher",
  webDir: "www",

  // ── Live URL mode ──────────────────────────────────────────────
  // The WebView loads the production teacher-app. The `?app=1` flag
  // tells the web app to hide marketing chrome (header / footer /
  // ad-bars) and switch on native CSS (safe areas, taller tap
  // targets). See frontend/src/app/layout.tsx for the detection.
  //
  // If you ever need to point at a staging build, change this URL.
  // For an offline-first variant, drop `server` and run
  // `npm run build:web` to ship the www/ fallback inside the binary.
  server: {
    url: "https://set.qrewzi.com?app=1",
    cleartext: false,
    androidScheme: "https",
  },

  // ── Plugins ────────────────────────────────────────────────────
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: "#0b1024", // Game Master neon-night base
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK", // dark icons hidden against the neon-night gradient
      backgroundColor: "#0b1024",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },

  // ── Android specifics ──────────────────────────────────────────
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // flip to true only for local dev builds
    backgroundColor: "#0b1024",
  },

  // ── iOS specifics ──────────────────────────────────────────────
  ios: {
    contentInset: "automatic",
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: "#0b1024",
    preferredContentMode: "mobile",
  },
};

export default config;
