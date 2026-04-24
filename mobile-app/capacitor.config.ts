import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "net.curriculate.prism",
  appName: "Curriculate Prism",
  webDir: "www",

  // ── Live URL mode ──────────────────────────────────────────────
  // The app loads your hosted site instead of a bundled static export.
  // This means: one codebase, instant updates, no store resubmission
  // for content changes. The native shell provides camera, push
  // notifications, and subscription hooks.
  server: {
    url: "https://www.curriculate.net",
    cleartext: false, // HTTPS only
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#2563eb",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "LIGHT", // white text on colored background
      backgroundColor: "#2563eb",
    },
    Keyboard: {
      resize: "body",
      style: "LIGHT",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },

  // iOS-specific
  ios: {
    contentInset: "always",
    allowsLinkPreview: true,
    scrollEnabled: true,
    scheme: "Curriculate Prism",
  },

  // Android-specific
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
