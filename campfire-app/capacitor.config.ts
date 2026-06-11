import type { CapacitorConfig } from "@capacitor/cli";

// Campfire native shell. The webview loads the LIVE Campfire (served by Vercel),
// so the app is always up to date and reuses all 129 server routes. A custom URL
// scheme (campfire://) carries the OAuth deep-link back into the app.
const config: CapacitorConfig = {
  appId: "net.curriculate.campfire",
  appName: "Campfire",
  webDir: "www",
  server: {
    // Remote-first: the app IS the hosted Campfire.
    url: "https://www.curriculate.net/campfirelive",
    // Keep the user inside the app for our own domains + Supabase; everything else
    // (e.g. a Google OAuth page) is pushed to the system browser by NativeBridge.
    allowNavigation: [
      "www.curriculate.net",
      "curriculate.net",
      "*.supabase.co",
    ],
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    contentInset: "always",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#fff7ed",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
