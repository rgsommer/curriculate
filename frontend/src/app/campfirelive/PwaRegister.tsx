"use client";

import { useEffect } from "react";

// Registers the Campfire service worker so the app is installable
// (add-to-home-screen) and has an offline fallback.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/campfirelive/sw.js", { scope: "/campfirelive/" })
      .catch(() => {
        /* registration is best-effort */
      });
  }, []);
  return null;
}
