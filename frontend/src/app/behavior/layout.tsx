// src/app/behavior/layout.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import LogNavLink from "./_components/LogNavLink";
import TourButton from "./_components/TourButton";
import FeedbackButton from "./_components/FeedbackButton";

export const metadata = {
  title: "Behaviours — Curriculate",
  description: "Cross-teacher student behaviour tracking and parent notices.",
};

export default function BehaviorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/behavior" className="shrink-0 text-lg font-semibold tracking-tight">
            Behaviours
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto whitespace-nowrap text-sm [&>*]:shrink-0">
            <Link href="/behavior" className="text-slate-600 hover:text-slate-900">
              Dashboard
            </Link>
            <LogNavLink className="text-slate-600 hover:text-slate-900" />
            <Link href="/behavior/homework" className="text-slate-600 hover:text-slate-900">
              Homework
            </Link>
            <Link href="/behavior/students" className="text-slate-600 hover:text-slate-900">
              Students
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
            <TourButton className="text-slate-600 hover:text-slate-900" />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
      <FeedbackButton />
    </div>
  );
}
