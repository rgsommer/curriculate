// src/app/houses/layout.tsx
// Public, student-facing house standings portal at /houses. No teacher chrome.
import type { ReactNode } from "react";

export const metadata = {
  title: "House Standings",
  description: "Live house points and leaderboard.",
};

export default function HousesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
