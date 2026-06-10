"use client";

/**
 * /orders/guide — how-to guide. Teacher steps are shown to everyone; adding
 * ?role=finance also reveals the finance/admin steps (linked from Setup).
 */

import { useEffect, useState } from "react";

const TEACHER_STEPS = [
  { t: "Open the ordering page", d: "Go to curriculate.net/orders. If you're already signed in to Behaviours you'll go straight in. Otherwise type your school email and we'll send a 6-digit code — enter it to sign in." },
  { t: "Find what you need", d: "Browse by supplier and category, or use the search box to jump to an item by name, SKU, or category. Each row shows the unit (e.g. 12/BOX) and price." },
  { t: "Type quantities", d: "Put a number in the box beside any item. It's added to “Your order” on the right, and the running total updates. Set it back to 0 (or hit ×) to remove it." },
  { t: "Add your name and send", d: "Enter your name so finance knows who ordered, then click Send order. Only items with a quantity are included." },
  { t: "Check your confirmation", d: "You'll get an email listing exactly what you ordered and the total. You can come back and order again anytime." },
];

const FINANCE_STEPS = [
  { t: "Set who receives orders", d: "In Setup, the finance name + email are where every teacher's order and the school summary go. Only this email can open Setup and the summary." },
  { t: "Invite teachers", d: "In Setup → Invite teachers, click “Copy invite email” and paste it into Outlook/Gmail to send staff a ready-made explanation of what it is and how to use it." },
  { t: "Watch orders come in", d: "Each submission emails you that teacher's order (non-zero lines only). The teacher gets their own confirmation copy." },
  { t: "Place the combined order", d: "Open the School summary for one combined list — every teacher's quantities summed per item, split by supplier/PO with totals. Export CSV or print it to order against each blanket PO." },
  { t: "Refresh prices each year", d: "In Setup → Items & prices, download the current catalog, edit prices/items in Excel, save as CSV (or .xlsx), and upload it. Teachers immediately see the new catalog." },
];

function Steps({ steps }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.t} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex gap-4">
          <span className="shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center text-sm">{i + 1}</span>
          <div>
            <h3 className="font-semibold text-slate-800 mb-1">{s.t}</h3>
            <p className="text-sm text-slate-600 leading-relaxed">{s.d}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function GuidePage() {
  const [showFinance, setShowFinance] = useState(false);
  useEffect(() => {
    try { setShowFinance(new URLSearchParams(window.location.search).get("role") === "finance"); } catch {}
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Supply Ordering · Guide</h1>
          <nav className="flex gap-3 text-sm">
            <a href="/orders/features" className="text-indigo-600 hover:underline">Features</a>
            <a href="/orders" className="text-indigo-600 hover:underline">Start ordering →</a>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h2 className="text-lg font-bold text-slate-800 mb-4">For teachers</h2>
        <Steps steps={TEACHER_STEPS} />

        <div className="mt-8">
          {!showFinance ? (
            <button onClick={() => setShowFinance(true)} className="text-sm text-indigo-600 hover:underline">
              Show finance / admin steps
            </button>
          ) : (
            <>
              <h2 className="text-lg font-bold text-slate-800 mb-4">For finance</h2>
              <Steps steps={FINANCE_STEPS} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
