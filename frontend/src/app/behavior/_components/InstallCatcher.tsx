"use client";

// Chrome/Edge/Android fire `beforeinstallprompt` once, early in the page load —
// often before the dashboard (behind ClientGate) has mounted. Catch it here in
// the layout, hold it on window, and announce it so the "Add to home screen"
// button can show the browser's one-tap install prompt later.
import { useEffect } from "react";

export const INSTALLABLE_EVENT = "compass:installable";

export default function InstallCatcher() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // we show our own button instead of the mini-infobar
      (window as any).__compassInstall = e;
      window.dispatchEvent(new Event(INSTALLABLE_EVENT));
    };
    const onInstalled = () => {
      (window as any).__compassInstall = null;
      window.dispatchEvent(new Event(INSTALLABLE_EVENT));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
