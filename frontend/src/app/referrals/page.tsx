// frontend/src/app/referrals/page.tsx
import Link from "next/link";
import { ArrowRight, Gift, Link2, Users } from "lucide-react";

const steps = [
  { icon: <Link2 className="w-6 h-6 text-blue-600" />, title: "Share your link", desc: "Send your personal referral link to another teacher." },
  { icon: <Users className="w-6 h-6 text-purple-600" />, title: "They try Curriculate", desc: "They sign up and run a real session in their classroom." },
  { icon: <Gift className="w-6 h-6 text-emerald-600" />, title: "You both earn credit", desc: "Account credit is applied automatically — simple and fair." },
];

export default function ReferralsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Referral Program</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Built for teachers — not influencers. Share Curriculate with colleagues and earn account credit.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div key={s.title} className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mb-4">
                {s.icon}
              </div>
              <h2 className="text-2xl font-extrabold text-gray-900 mb-2">{s.title}</h2>
              <p className="text-gray-700 font-medium">{s.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-3">Fair & simple rules</h3>
          <ul className="space-y-2 text-gray-800 font-medium">
            {[
              "Real teachers only (credit triggers after real classroom use).",
              "No limits on referrals.",
              "Credit can apply toward Teacher Plus upgrades or School discounts.",
              "Designed to encourage genuine adoption, not spam.",
            ].map((x) => (
              <li key={x} className="flex items-start gap-3">
                <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                <span>{x}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Get your referral link <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              See Plans
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
