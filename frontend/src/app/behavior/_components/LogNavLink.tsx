"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The "Log" nav link. When you're already on the log page, clicking it doesn't
// remount the component (same route), so it would keep your mid-flow state.
// Fire an event the log page listens for to jump back to the student picker.
export default function LogNavLink({ className }: { className?: string }) {
  const pathname = usePathname();
  // Match the other nav links' active state (bold + underline + aria-current).
  const active = !!pathname?.startsWith("/behavior/log");
  return (
    <Link
      href="/behavior/log"
      aria-current={active ? "page" : undefined}
      className={active ? "font-semibold text-slate-900 underline decoration-2 underline-offset-4" : className}
      onClick={() => {
        if (pathname === "/behavior/log") window.dispatchEvent(new Event("behavior:log-reset"));
      }}
    >
      Log
    </Link>
  );
}
