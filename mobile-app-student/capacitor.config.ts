import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Curriculate Student — native shell for the student play app.
 *
 * Wraps the production student app (play.curriculate.net) in a WebView.
 * Students join a live session by room code (no login), then play the
 * task stations. The web app drives the camera (QR scanning), microphone
 * (audio/speech tasks) and accelerometer (Motion Mission) directly via
 * standard web APIs (getUserMedia / DeviceMotion) — so the job of this
 * shell is to grant those permissions to the WebView, not to reimplement
 * them. See the iOS Info.plist usage strings and the Android manifest
 * CAMERA / RECORD_AUDIO permissions.
 *
 * Sibling apps: mobile-app/ (Pulse Grading) and mobile-app-curriculate/
 * (teacher Game Master console). Separate store listings, shared domain.
 */
const config: CapacitorConfig = {
  appId: "net.curriculate.student", // DO NOT CHANGE — Play Store install lineage + pulse-grading-keystore.jks signing key are pinned to this appId
  appName: "Qrewzi",
  webDir: "www",

  // ── Live URL mode ──────────────────────────────────────────────
  // The WebView loads the production student app directly. One codebase,
  // instant updates, no resubmission for content changes.
  server: {
    url: "https://play.qrewzi.com",
    cleartext: false,
    androidScheme: "https",
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK", // dark icons for the light splash / join screens
      backgroundColor: "#ffffff",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },

  // ── Android specifics ──────────────────────────────────────────
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: "#ffffff",
  },

  // ── iOS specifics ──────────────────────────────────────────────
  ios: {
    contentInset: "automatic",
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: "#ffffff",
    // Let the WebView present the camera/mic without an extra tap gate,
    // so getUserMedia (QR scanner, audio tasks) starts smoothly.
    preferredContentMode: "mobile",
  },
};

export default config;
