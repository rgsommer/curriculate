// src/app/behavior/layout.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import NavLink from "./_components/NavLink";
import LogNavLink from "./_components/LogNavLink";
import TourButton from "./_components/TourButton";
import FeedbackButton from "./_components/FeedbackButton";

export const metadata = {
  title: "Compass — Curriculate",
  description: "Cross-teacher student behaviour tracking and parent notices.",
};

export default function BehaviorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/behavior" className="shrink-0 text-lg font-semibold tracking-tight">
            Compass
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto whitespace-nowrap text-sm [&>*]:shrink-0">
            <NavLink href="/behavior">Dashboard</NavLink>
            <LogNavLink className="text-slate-600 hover:text-slate-900" />
            <NavLink href="/behavior/homework">Homework</NavLink>
            <NavLink href="/behavior/students">Students</NavLink>
            <NavLink href="/behavior/reports">Reports</NavLink>
            <NavLink href="/behavior/team">Team</NavLink>
            <NavLink href="/behavior/setup">Setup</NavLink>
            <NavLink href="/behavior/features">Guide</NavLink>
            <TourButton className="text-slate-600 hover:text-slate-900" />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
      <FeedbackButton />
    </div>
  );
}
