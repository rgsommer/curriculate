'use client';
import { useState } from 'react';

export default function Unlock({ scanId, price, currency, count, city }:
  { scanId: string; price: string; currency: string; count: number; city: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/opportunities/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <section className="mt-16 rounded-2xl border-2 border-slate-900 bg-slate-50 p-8">
      <h2 className="text-2xl font-bold text-slate-900">Unlock all {count} opportunities for {city}</h2>
      <p className="mt-3 max-w-2xl text-slate-600">
        The full report names every opportunity, classifies it by type, scores it on a transparent
        100-point model, shows the peer evidence and the leakage test behind it, projects net income for
        three years — and lists what we investigated and rejected, so you do not spend a year finding out.
      </p>
      <ul className="mt-6 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        {['Top 25 opportunities, ranked and scored','Net income projection for every one',
          '20 expansions for existing businesses','10 low-capital ideas testable cheaply',
          '10 opportunities that scale beyond your city','10 municipal and youth-enterprise programmes',
          '15+ false positives, with reasons','Three launch packages with 90-day validation plans'].map(x => (
          <li key={x} className="flex gap-2"><span className="text-amber-700">✓</span>{x}</li>
        ))}
      </ul>
      <div className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com — where we send the report"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-blue-600"
        />
        <button onClick={go} disabled={busy}
          className="whitespace-nowrap rounded-lg bg-slate-900 px-7 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {busy ? 'Redirecting…' : `Get the full report — $${price} ${currency}`}
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <p className="mt-4 text-xs text-slate-500">
        One-time payment for this city. Secure checkout by Stripe. The report is generated after payment
        and takes a few minutes — we email you the link, so you can close the tab.
      </p>
    </section>
  );
}
