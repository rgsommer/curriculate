// src/app/behavior/layout.tsx
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Behaviours — Curriculate",
  description: "Cross-teacher student behaviour tracking and parent notices.",
};

export default function BehaviorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/behavior" className="text-lg font-semibold tracking-tight">
            Behaviours
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/behavior" className="text-slate-600 hover:text-slate-900">
              Dashboard
            </Link>
            <Link href="/behavior/log" className="text-slate-600 hover:text-slate-900">
              Log
            </Link>
            <Link href="/behavior/reports" className="text-slate-600 hover:text-slate-900">
              Reports
            </Link>
            <Link href="/behavior/team" className="text-slate-600 hover:text-slate-900">
              Team
            </Link>
            <Link href="/behavior/setup" className="text-slate-600 hover:text-slate-900">
              Setup
            </Link>
            <Link href="/behavior/features" className="text-slate-600 hover:text-slate-900">
              Guide
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  );
}
