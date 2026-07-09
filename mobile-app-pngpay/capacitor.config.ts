import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "net.curriculate.pngpay",
  appName: "PNGPay",
  webDir: "www",

  // ── Live URL mode ──────────────────────────────────────────────
  // Loads the hosted TeeBee payroll app instead of a bundled static export, so
  // supervisors always run the latest build with no store resubmission for
  // content changes. `?app=1` hides the website chrome (safe-area native
  // layout); `view=team` deep-links straight to the supervisor's team
  // hours screen after email-PIN sign-in.
  server: {
    url: "https://www.curriculate.net/teebeepay/app?app=1&view=team",
    cleartext: false, // HTTPS only
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: "#0f2c52", // navy
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "LIGHT", // white text on navy background
      backgroundColor: "#0f2c52",
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
    allowsLinkPreview: false,
    scrollEnabled: true,
    scheme: "PNGPay",
  },

  // Android-specific
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
