"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, Sparkles, Lock } from "lucide-react";
import UpgradeModal from "@/components/UpgradeModal";
import { useAuth } from "@/lib/auth";
import { hasTeacherPlus } from "@/lib/plans";

const included = [
  "AI-generated tasksets",
  "Session analytics & summaries",
  "Student & team reports",
  "Printable Station Posters",
  "Session history & replay",
  "Saved tasksets",
  "Early access features",
];

export default function PricingPage() {
  const { user } = useAuth();
  const [billing, setBilling] = useState<"annual" | "monthly">("annual");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const isPlus = hasTeacherPlus(user);

  const ctaHref = useMemo(() => {
    // Marketing site: funnel to signup for now. Tomorrow: wire Stripe checkout.
    return "/signup";
  }, []);

  const primaryCta = () => {
    if (user && !isPlus) {
      setUpgradeOpen(true);
      return;
    }
    if (user && isPlus) {
      window.location.href = "/dashboard";
      return;
    }
    window.location.href = ctaHref;
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h1 className="text-5xl sm:text-6xl font-black text-gray-900">Pricing</h1>
          <p className="mt-4 text-xl text-gray-700 font-medium max-w-3xl mx-auto">
            Built for teachers. Start free. Upgrade when you feel the value.
          </p>
        </div>

        <div id="teacher-plus" className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Teacher Plus Card */}
          <div className="lg:col-span-2 bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-purple-50 border border-purple-200 px-4 py-2 text-purple-800 font-black">
                  <Lock className="w-4 h-4" />
                  Founding Teacher Price
                </div>
                <h2 className="mt-4 text-3xl font-black text-gray-900">Teacher Plus</h2>
                <p className="mt-2 text-gray-700 font-medium">
                  The premium classroom flow: station posters, rich reports, and the AI-powered task engine.
                </p>
              </div>

              {/* Billing Toggle (Annual default) */}
              <div className="flex items-center gap-2 bg-gray-100 rounded-2xl p-1 border border-gray-200">
                <button
                  className={`px-4 py-2 rounded-xl font-black ${
                    billing === "annual" ? "bg-white shadow" : "text-gray-600 hover:text-gray-900"
                  }`}
                  onClick={() => setBilling("annual")}
                >
                  Annual
                </button>
                <button
                  className={`px-4 py-2 rounded-xl font-black ${
                    billing === "monthly" ? "bg-white shadow" : "text-gray-600 hover:text-gray-900"
                  }`}
                  onClick={() => setBilling("monthly")}
                >
                  Monthly
                </button>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-end gap-x-4 gap-y-2">
              {billing === "monthly" ? (
                <>
                  <div className="text-6xl font-black text-gray-900">$7.99</div>
                  <div className="text-gray-700 font-black text-xl mb-2">/ month</div>
                </>
              ) : (
                <>
                  <div className="text-6xl font-black text-gray-900">$79</div>
                  <div className="text-gray-700 font-black text-xl mb-2">/ year</div>
                  <div className="text-emerald-700 font-black mb-3">(2 months free)</div>
                </>
              )}
            </div>

            <div className="mt-2 text-sm font-bold text-purple-700">
              Early access pricing is limited and will never increase for early subscribers.
            </div>
            <div className="mt-2 text-sm font-semibold text-gray-600">Regular pricing coming soon.</div>

            <button
              onClick={primaryCta}
              className="mt-8 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-purple-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-purple-700"
            >
              <Sparkles className="w-5 h-5 text-yellow-200" />
              {user ? (isPlus ? "Go to Dashboard" : "Unlock Teacher Plus") : "Get Teacher Plus"}
            </button>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {included.map((x) => (
                <div key={x} className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                  <div className="text-gray-900 font-bold">{x}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Comparison */}
          <div className="bg-white rounded-3xl shadow-xl border border-gray-200 p-6">
            <h3 className="text-xl font-black text-gray-900">Free vs Teacher Plus</h3>

            <div className="mt-4 space-y-3 text-gray-800 font-semibold">
              <Row label="Run sessions" freeText="Yes" plusText="Yes" />
              <Row label="AI tasksets" freeText="Limited" plusText="Unlimited" />
              <Row label="Reports" freeText="—" plusText="Included" />
              <Row label="Station Posters" freeText="—" plusText="Included" />
              <Row label="Session history" freeText="—" plusText="Included" />
            </div>

            <Link
              href="/signup"
              className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Start Free
            </Link>

            <div className="mt-3 text-sm text-gray-600 font-semibold">
              Already a user? Click “Unlock Teacher Plus” above and we’ll upgrade your account.
            </div>
          </div>
        </div>
      </div>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        feature="Teacher Plus"
        ctaHref="/signup"
        ctaLabel="Upgrade"
      />
    </main>
  );
}

function Row({ label, freeText, plusText }: { label: string; freeText: string; plusText: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 border border-gray-200 p-3">
      <div className="font-bold text-gray-900">{label}</div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-black text-gray-600">Free:</span>
        <span className="text-sm font-black text-gray-900">{freeText}</span>
        <span className="mx-2 text-gray-300">|</span>
        <span className="text-sm font-black text-purple-700">Plus:</span>
        <span className="text-sm font-black text-gray-900">{plusText}</span>
      </div>
    </div>
  );
}
