// frontend/src/app/signup/page.tsx
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck, Sparkles, CreditCard } from "lucide-react";

const bullets = [
  "Free to start (no credit card required)",
  "Run a real session in minutes",
  "Upgrade only when you’re ready",
  "Teacher-controlled AI is optional",
];

const steps = [
  { n: "1", title: "Create your teacher account", desc: "Quick setup so you can launch your first session." },
  { n: "2", title: "Run your first stations", desc: "Students join fast with a room code + team name." },
  { n: "3", title: "Upgrade when you want", desc: "When you’re using it weekly, unlock reports + full catalog." },
];

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-12">
          <h1 className="text-5xl font-black mb-4">Sign up</h1>
          <p className="text-xl text-gray-700 mb-8 max-w-3xl">
            Start free. Run your first station-based session. Upgrade only if you love it.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            {bullets.map(b => (
              <div key={b} className="flex items-center gap-3">
                <Check className="w-5 h-5 text-green-600" />
                <span className="font-medium text-gray-800">{b}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-4 mb-12">
            <Link href="/dashboard" className="px-6 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl">
              Create Free Account <ArrowRight className="inline w-5 h-5 ml-1" />
            </Link>
            <Link href="/pricing" className="px-6 py-4 border rounded-2xl font-black">
              View Plans
            </Link>
          </div>

          <h2 className="text-3xl font-black mb-6">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map(s => (
              <div key={s.n} className="border rounded-2xl p-6 bg-gray-50">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center font-black mb-3">
                  {s.n}
                </div>
                <h3 className="font-extrabold text-lg mb-1">{s.title}</h3>
                <p className="text-gray-700">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex items-center gap-3 text-gray-600">
            <ShieldCheck className="w-5 h-5" />
            <span>No student accounts required. Stripe checkout will plug in here.</span>
          </div>
        </div>
      </div>
    </main>
  );
}
