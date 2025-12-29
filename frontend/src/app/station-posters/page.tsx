"use client";

import Link from "next/link";
import { useState } from "react";
import { Printer, CheckCircle2 } from "lucide-react";
import UpgradeModal from "@/components/UpgradeModal";
import { useAuth } from "@/lib/auth";
import { hasTeacherPlus } from "@/lib/plans";

export default function StationPostersPage() {
  const { user } = useAuth();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const isPlus = hasTeacherPlus(user);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center">
            <Printer className="w-7 h-7 text-purple-700" />
          </div>
          <div>
            <h1 className="text-5xl font-black text-gray-900">Station Posters</h1>
            <p className="mt-3 text-xl text-gray-700 font-medium max-w-3xl">
              Printable, QR-ready posters that make rotations obvious and smooth — even with energetic classes.
            </p>
          </div>
        </div>

        <div className="mt-10 bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
          <h2 className="text-2xl font-black text-gray-900">What you get</h2>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              "QR codes for each station",
              "Clear color/number labels",
              "Room-ready layout (print and tape)",
              "Consistency across task types",
            ].map((x) => (
              <div key={x} className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div className="text-gray-900 font-bold">{x}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            {user ? (
              isPlus ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
                >
                  Go to Dashboard
                </Link>
              ) : (
                <button
                  onClick={() => setUpgradeOpen(true)}
                  className="inline-flex items-center justify-center rounded-2xl bg-purple-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-purple-700"
                >
                  Unlock with Teacher Plus
                </button>
              )
            ) : (
              <Link
                href="/pricing#teacher-plus"
                className="inline-flex items-center justify-center rounded-2xl bg-purple-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-purple-700"
              >
                See Teacher Plus
              </Link>
            )}

            <Link
              href="/reports"
              className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              View Sample Reports
            </Link>
          </div>
        </div>
      </div>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        feature="Station Posters"
        ctaHref="/signup"
        ctaLabel="Upgrade"
      />
    </main>
  );
}
