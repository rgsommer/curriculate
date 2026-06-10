"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The "Log" nav link. When you're already on the log page, clicking it doesn't
// remount the component (same route), so it would keep your mid-flow state.
// Fire an event the log page listens for to jump back to the student picker.
export default function LogNavLink({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <Link
      href="/behavior/log"
      className={className}
      onClick={() => {
        if (pathname === "/behavior/log") window.dispatchEvent(new Event("behavior:log-reset"));
      }}
    >
      Log
    </Link>
  );
}
