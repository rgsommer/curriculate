"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/campfire/supabase";
import {
  cap,
  isNative,
  isSafeInAppPath,
  nativePushCapable,
  takeOAuthNext,
} from "@/lib/campfire/native";
import { pushStatus, registerPush } from "@/lib/campfire/nativePush";

// Bridges the web app to the Capacitor native shell WITHOUT bundling any Capacitor
// packages — everything is reached through the runtime-injected `window.Capacitor`.
// Safe no-op in a normal browser.
//
// What it does inside the native app:
//  1. Tags <body> with capacitor-native / -ios / -android so CSS can add safe-area
//     insets and hide surfaces that mustn't show in a store build.
//  2. Catches the OAuth deep link (campfire://auth-callback?code=…), finishes the
//     Supabase sign-in (or guest → Google link) in the webview, and returns the user to
//     where they were going (e.g. the invite they were joining).
//  3. Opens Universal Links / App Links (https://curriculate.net/c/… and
//     /campfirelive/join/…) inside the app instead of a second browser session.
//  4. Push: never prompts on launch. If permission was already granted, re-registers
//     the device whenever someone is signed in. Asking happens in PushPrompt.

async function applySessionFromUrl(url: string) {
  try {
    // PKCE flow (supabase-js default): the redirect carries ?code=… and we trade
    // it for a session using the verifier stashed in this webview's localStorage
    // when signInWithOAuth / linkIdentity ran.
    const query = url.includes("?") ? url.split("?")[1].split("#")[0] : "";
    const code = new URLSearchParams(query).get("code");
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
      window.location.replace(takeOAuthNext());
      return;
    }
    // Implicit flow fallback: tokens in the fragment (#access_token=…&refresh_token=…).
    const hash = url.includes("#") ? url.split("#")[1] : "";
    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
      window.location.replace(takeOAuthNext());
    }
  } catch {
    // Sign-in failed to complete — drop the user on the auth screen to retry.
    window.location.replace("/campfirelive/auth");
  }
}

// An https link to our own site opened the app (Universal Link / App Link): show that
// page in the webview. Only Campfire paths — anything else stays out.
function openSiteLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!/^(www\.)?curriculate\.net$/i.test(u.hostname)) return false;
    const path = u.pathname + u.search;
    if (!isSafeInAppPath(path)) return false;
    window.location.assign(path + u.hash);
    return true;
  } catch {
    return false;
  }
}

export default function NativeBridge() {
  useEffect(() => {
    const c = cap();
    if (!isNative() || !c) return; // plain browser → nothing to do

    document.body.classList.add("capacitor-native");
    // iOS shell only: flags `data-hide-on-ios` payment surfaces off (App Store 3.1.1).
    if (c.getPlatform?.() === "ios") document.body.classList.add("capacitor-ios");
    // Android shell only: flags `data-hide-on-android` money-collection surfaces off
    // (Google Play "no financial features" build).
    if (c.getPlatform?.() === "android") document.body.classList.add("capacitor-android");

    const plugins = c.Plugins ?? {};

    // 2 + 3: deep links into the app.
    plugins.App?.addListener("appUrlOpen", (data) => {
      const url = data?.url;
      if (!url) return;
      if (url.includes("auth-callback")) {
        applySessionFromUrl(url).finally(() => {
          plugins.Browser?.close?.().catch(() => {});
        });
        return;
      }
      openSiteLink(url);
    });
    // Cold start from a link: the URL arrives via getLaunchUrl, not the event. Handle
    // it once per launch — openSiteLink reloads the page, which remounts this bridge.
    plugins.App?.getLaunchUrl?.()
      .then((r) => {
        const url = r?.url;
        if (!url || url.includes("auth-callback")) return;
        try {
          if (sessionStorage.getItem("campfire_launch_url") === url) return;
          sessionStorage.setItem("campfire_launch_url", url);
        } catch {
          return; // can't guard against a loop → don't risk it
        }
        openSiteLink(url);
      })
      .catch(() => {});

    // Tapping a notification opens the engagement it's about. Attached on every launch
    // (no permission needed to listen) so a tap that cold-starts the app is delivered.
    if (nativePushCapable()) {
      plugins.PushNotifications?.addListener("pushNotificationActionPerformed", (a: unknown) => {
        const link = (a as { notification?: { data?: { link?: string } } })?.notification?.data
          ?.link;
        if (link) openSiteLink(link);
      });
    }

    // 4: silent re-registration — only when permission is ALREADY granted and someone
    // is signed in (a token without a user is useless).
    const syncPush = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      if ((await pushStatus()) === "granted") await registerPush();
    };
    syncPush().catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") syncPush().catch(() => {});
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}
