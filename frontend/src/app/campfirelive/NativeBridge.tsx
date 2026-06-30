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
  Browser?: { close?: () => Promise<void> };
  PushNotifications?: {
    checkPermissions: () => Promise<{ receive: string }>;
    requestPermissions: () => Promise<{ receive: string }>;
    register: () => Promise<void>;
    addListener: (ev: string, cb: (data: unknown) => void) => void;
  };
};

function cap(): {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: CapPlugins;
} | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: ReturnType<typeof cap> }).Capacitor ?? null;
}

async function applySessionFromUrl(url: string) {
  // Only handle our OAuth callback, not other deep links (e.g. invite links).
  if (!url.includes("auth-callback")) return;
  try {
    // PKCE flow (supabase-js default): the redirect carries ?code=… and we trade
    // it for a session using the verifier stashed in this webview's localStorage
    // when signInWithOAuth ran. This is the path that actually fires today.
    const query = url.includes("?") ? url.split("?")[1].split("#")[0] : "";
    const code = new URLSearchParams(query).get("code");
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
      window.location.replace("/campfirelive");
      return;
    }
    // Implicit flow fallback: tokens in the fragment (#access_token=…&refresh_token=…).
    const hash = url.includes("#") ? url.split("#")[1] : "";
    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
      window.location.replace("/campfirelive");
    }
  } catch {
    // Sign-in failed to complete — drop the user on the auth screen to retry.
    window.location.replace("/campfirelive/auth");
  }
}

export default function NativeBridge() {
  useEffect(() => {
    const c = cap();
    if (!c?.isNativePlatform?.()) return; // plain browser → nothing to do

    document.body.classList.add("capacitor-native");
    // iOS shell only: flags `data-hide-on-ios` payment surfaces off (App Store 3.1.1).
    if (c.getPlatform?.() === "ios") document.body.classList.add("capacitor-ios");

    const plugins = c.Plugins ?? {};

    // 1 + 2: handle the OAuth deep-link return, then dismiss the system browser.
    plugins.App?.addListener("appUrlOpen", (data) => {
      if (!data?.url) return;
      applySessionFromUrl(data.url).finally(() => {
        plugins.Browser?.close?.().catch(() => {});
      });
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
