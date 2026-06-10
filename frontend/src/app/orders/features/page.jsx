"use client";

/** /orders/features — public overview of the supply ordering tool (teacher-facing). */

const FEATURES = [
  { t: "The whole catalogue, searchable", d: "Every approved item from Staples Professional and Office Central in one place. Search by name, SKU, or category — no scrolling paper forms." },
  { t: "Just type a quantity", d: "Put a number beside anything you want. Your running total and item list update instantly as you go." },
  { t: "Sign in in seconds", d: "Already using Behaviours? You're in automatically. Otherwise we email you a 6-digit code — no password to remember." },
  { t: "Instant confirmation", d: "You get an email copy of exactly what you ordered the moment you submit. Order as many times as you need." },
  { t: "Finance gets it automatically", d: "Your order goes straight to the finance office — non-zero lines only — so there's nothing to print, scan, or hand in." },
  { t: "Accurate pricing", d: "Prices come from the current supplier sheets and every total is calculated for you, so there are no math mistakes on the order." },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Supply Ordering · Features</h1>
          <nav className="flex gap-3 text-sm">
            <a href="/orders/guide" className="text-indigo-600 hover:underline">Guide</a>
            <a href="/orders" className="text-indigo-600 hover:underline">Start ordering →</a>
          </nav>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8">
        <p className="text-lg text-slate-600 mb-8 max-w-2xl">
          Order classroom and office supplies online in a couple of minutes — no paper forms, no totalling by hand.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map((f) => (
            <div key={f.t} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h3 className="font-semibold text-slate-800 mb-1">{f.t}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <a href="/orders" className="inline-block rounded-lg bg-indigo-600 text-white px-5 py-2.5 font-medium hover:bg-indigo-700">Start ordering</a>
        </div>
      </main>
    </div>
  );
}
