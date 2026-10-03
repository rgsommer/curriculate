"use client";

// Compass pages decide what to show from the sign-in token in localStorage,
// which the server can't see. Rendering them server-side produced "Please sign
// in", then the browser rendered the real page — a hydration mismatch on every
// page load (a visible "Please sign in" flash + React re-rendering the tree).
// These pages fetch all their data client-side anyway, so render a neutral
// placeholder until mounted, then the page.
import { useEffect, useState, type ReactNode } from "react";

export default function ClientGate({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p className="text-slate-500">Loading…</p>;
  return <>{children}</>;
}
