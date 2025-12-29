// frontend/src/app/pricing/page.tsx
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

const tiers = [
  {
    name: "Free",
    price: "$0",
    tagline: "Try Curriculate and run your first sessions.",
    cta: { label: "Get Started Free", href: "/dashboard" },
    highlight: false,
    features: ["Run live sessions", "Core task types", "Basic scoring + leaderboards", "Great for trying stations"],
  },
  {
    name: "Teacher Plus",
    price: "$…",
    tagline: "For teachers using Curriculate weekly.",
    cta: { label: "Upgrade to Teacher Plus", href: "/dashboard" },
    highlight: true,
    features: [
      "Unlimited sessions",
      "Full task catalog",
      "AI task generation (optional)",
      "Student + teacher reports",
      "Priority feature access",
    ],
  },
  {
    name: "School",
    price: "Let’s talk",
    tagline: "Scale across classrooms with admin visibility.",
    cta: { label: "Contact for School Plan", href: "/contact" },
    highlight: false,
    features: [
      "Multiple teachers",
      "Shared task libraries",
      "Admin visibility & reporting",
      "Onboarding support",
      "School-wide rollout options",
    ],
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Pricing</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Simple, transparent plans. Match your tier to how often you run stations.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`rounded-3xl border shadow-2xl p-8 ${
                t.highlight ? "bg-white border-blue-300 ring-2 ring-blue-200" : "bg-white border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-extrabold text-gray-900">{t.name}</h2>
                  <p className="text-gray-700 font-medium mt-2">{t.tagline}</p>
                </div>
                {t.highlight && (
                  <span className="rounded-full bg-blue-600 text-white text-xs font-black px-3 py-1">
                    Most Popular
                  </span>
                )}
              </div>

              <div className="mt-6">
                <div className="text-4xl font-black text-gray-900">{t.price}</div>
                <div className="text-sm text-gray-600 font-medium mt-1">per teacher / plan</div>
              </div>

              <ul className="mt-6 space-y-3 text-gray-800 font-medium">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span className="mt-1.5 inline-flex w-5 h-5 rounded-full bg-green-100 items-center justify-center">
                      <Check className="w-4 h-4 text-green-700" />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={t.cta.href}
                className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-black shadow-xl ${
                  t.highlight
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-white text-gray-900 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {t.cta.label} <ArrowRight className="w-5 h-5" />
              </Link>

              <p className="mt-4 text-sm text-gray-500 font-medium">
                Exact limits mirror what you see inside your MyPlan page — no surprises.
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-3">Who each plan is for</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Free</div>
              <div className="text-gray-700 font-medium">Teachers exploring stations and running occasional sessions.</div>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Teacher Plus</div>
              <div className="text-gray-700 font-medium">Teachers using Curriculate weekly and relying on reports + full catalog.</div>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">School</div>
              <div className="text-gray-700 font-medium">Departments and schools scaling active learning across classrooms.</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
