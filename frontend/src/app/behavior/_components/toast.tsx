"use client";

// One app-wide save confirmation. Call toast("Saved ✓") from anywhere; the
// <Toaster /> mounted in the Compass layout shows a brief pill. Used for every
// auto-saving control (toggles, inline fields) so feedback is consistent.
import { useEffect, useState } from "react";

type ToastKind = "success" | "error";
const EVENT = "compass:toast";

export function toast(message = "Saved ✓", kind: ToastKind = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, kind } }));
}

export function Toaster() {
  const [t, setT] = useState<{ message: string; kind: ToastKind; id: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onToast(e: Event) {
      const { message, kind } = (e as CustomEvent).detail || {};
      setT({ message, kind, id: Date.now() });
      if (timer) clearTimeout(timer);
      // Longer messages (e.g. what a delete undid) stay up long enough to read.
      const base = kind === "error" ? 4000 : 1800;
      timer = setTimeout(() => setT(null), Math.min(12000, Math.max(base, String(message || "").length * 70)));
    }
    window.addEventListener(EVENT, onToast);
    return () => { window.removeEventListener(EVENT, onToast); if (timer) clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return (
    <div
      key={t.id}
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${
        t.kind === "error" ? "bg-red-600 text-white" : "bg-slate-900 text-white"
      }`}
    >
      {t.message}
    </div>
  );
}
