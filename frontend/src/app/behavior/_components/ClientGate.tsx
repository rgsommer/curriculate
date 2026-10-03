"use client";

// Compass pages decide what to show from the sign-in token in localStorage,
// which the server can't see. Rendering them server-side produced "Please sign
// in", then the browser rendered the real page — a hydration mismatch on every
// page load (a visible "Please sign in" flash + React re-rendering the tree).
// These pages fetch all their data client-side anyway, so render a neutral
// placeholder until mounted, then the page.
//
// Because content appears only after mount (and often after a data fetch), the
// browser's native jump to a URL #anchor (e.g. /behavior/setup#roster) fires
// before the target exists. So once mounted, wait for the anchor to appear and
// scroll to it.
import { useEffect, useState, type ReactNode } from "react";

export default function ClientGate({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!id) return;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) { el.scrollIntoView({ block: "start" }); return true; }
      return false;
    };
    if (tryScroll()) return;
    const obs = new MutationObserver(() => { if (tryScroll()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    const stop = setTimeout(() => obs.disconnect(), 10000);
    return () => { obs.disconnect(); clearTimeout(stop); };
  }, [mounted]);

  if (!mounted) return <p className="text-slate-500">Loading…</p>;
  return <>{children}</>;
}
