"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/campfire/supabase";

// Bridges the web app to the Capacitor native shell WITHOUT bundling any Capacitor
// packages — everything is reached through the runtime-injected `window.Capacitor`.
// Safe no-op in a normal browser.
//
// What it does inside the native app:
//  1. Tags <html class="capacitor-native"> so CSS can add safe-area insets and hide
//     browser-only bits (the PWA install banner, etc.).
//  2. Catches the OAuth deep link (campfire://auth-callback#access_token=…) and sets
//     the Supabase session in the webview, so Google sign-in (which must happen in the
//     system browser) lands the user logged-in inside the app.
//  3. Registers for native push notifications and posts the device token to the API
//     so the digest/notify features can reach the device. (Backend send = phase 2.)

type CapPlugins = {
  App?: {
    addListener: (
      ev: string,
      cb: (data: { url?: string }) => void
    ) => Promise<{ remove: () => void }> | { remove: () => void };
  };
  PushNotifications?: {
    checkPermissions: () => Promise<{ receive: string }>;
    requestPermissions: () => Promise<{ receive: string }>;
    register: () => Promise<void>;
    addListener: (ev: string, cb: (data: unknown) => void) => void;
  };
};

function cap(): { isNativePlatform?: () => boolean; Plugins?: CapPlugins } | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: ReturnType<typeof cap> }).Capacitor ?? null;
}

async function applySessionFromUrl(url: string) {
  // Tokens arrive in the URL fragment (#access_token=…&refresh_token=…).
  const hash = url.includes("#") ? url.split("#")[1] : "";
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
    window.location.replace("/campfirelive");
  }
}

export default function NativeBridge() {
  useEffect(() => {
    const c = cap();
    if (!c?.isNativePlatform?.()) return; // plain browser → nothing to do

    document.body.classList.add("capacitor-native");

    const plugins = c.Plugins ?? {};

    // 1 + 2: handle the OAuth deep-link return.
    plugins.App?.addListener("appUrlOpen", (data) => {
      if (data?.url) applySessionFromUrl(data.url);
    });

    // 3: native push registration (best-effort; backend send wired in phase 2).
    (async () => {
      try {
        const push = plugins.PushNotifications;
        if (!push) return;
        let perm = await push.checkPermissions();
        if (perm.receive === "prompt") perm = await push.requestPermissions();
        if (perm.receive !== "granted") return;
        push.addListener("registration", async (token: unknown) => {
          const value = (token as { value?: string })?.value;
          if (!value) return;
          try {
            const { data } = await supabase.auth.getSession();
            const jwt = data.session?.access_token;
            if (!jwt) return;
            await fetch("/api/campfire/push/register", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${jwt}`,
              },
              body: JSON.stringify({ token: value, platform: "native" }),
            });
          } catch {
            /* best-effort */
          }
        });
        await push.register();
      } catch {
        /* push is optional; never block the app */
      }
    })();
  }, []);

  return null;
}
