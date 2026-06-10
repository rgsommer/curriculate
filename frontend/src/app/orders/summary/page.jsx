"use client";

/** /orders/summary — finance view: combined school-wide order + per-teacher list. */

import { useEffect, useMemo, useState } from "react";
import AdminGate from "../_AdminGate";

const money = (n) => "$" + (Math.round((n || 0) * 100) / 100).toFixed(2);

function Summary({ session }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showTeachers, setShowTeachers] = useState(true);

  useEffect(() => {
    fetch("/api/orders/summary", { headers: { Authorization: "Bearer " + session } })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed to load."); return j; })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [session]);

  // Group combined lines by supplier -> category, preserving server order.
  const grouped = useMemo(() => {
    if (!data) return [];
    const sup = [];
    const supMap = new Map();
    for (const l of data.combined) {
      if (!supMap.has(l.supplier)) { supMap.set(l.supplier, { supplier: l.supplier, po: l.po, cats: new Map() }); sup.push(l.supplier); }
      const s = supMap.get(l.supplier);
      if (!s.cats.has(l.category)) s.cats.set(l.category, []);
      s.cats.get(l.category).push(l);
    }
    return sup.map((name) => {
      const s = supMap.get(name);
      return { supplier: s.supplier, po: s.po, categories: Array.from(s.cats, ([category, lines]) => ({ category, lines })) };
    });
  }, [data]);

  function exportCsv() {
    if (!data) return;
    const rows = [["Supplier", "PO", "Category", "SKU", "Description", "Unit", "Price", "TotalQty", "LineTotal"]];
    for (const l of data.combined) {
      rows.push([l.supplier, l.po, l.category, l.sku, l.description, l.uom, l.price, l.qty, l.lineTotal]);
    }
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "school-order-summary.csv";
    a.click();
  }

  if (err) return <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{err}</div>;
  if (!data) return <p className="text-sm text-slate-400">Loading orders…</p>;

  if (data.totals.orderCount === 0) {
    return <p className="text-sm text-slate-500 bg-white rounded-lg border border-slate-200 p-4">No orders have been submitted yet.</p>;
  }

  return (
    <div>
      {/* totals */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">Grand total (all teachers)</div>
          <div className="text-2xl font-bold">{money(data.totals.grand)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">Orders submitted</div>
          <div className="text-2xl font-bold">{data.totals.orderCount}</div>
        </div>
        {data.totals.bySupplier.map((s) => (
          <div key={s.supplier} className="bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">{s.supplier} · PO {s.po}</div>
            <div className="text-xl font-semibold">{money(s.subtotal)}</div>
          </div>
        ))}
        <div className="ml-auto flex gap-2 print:hidden">
          <button onClick={exportCsv} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Export CSV</button>
          <button onClick={() => window.print()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Print</button>
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Combined quantities below are the total to order against each blanket PO — every teacher's quantities summed per item.
      </p>

      {/* combined order, grouped */}
      {grouped.map((g) => (
        <div key={g.supplier} className="mb-6">
          <h2 className="text-base font-bold text-slate-800 mb-2">{g.supplier} <span className="text-slate-400 font-normal text-sm">· Blanket PO {g.po}</span></h2>
          {g.categories.map((c) => (
            <div key={c.category} className="bg-white rounded-lg border border-slate-200 mb-2 overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 text-xs font-semibold text-slate-600">{c.category}</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {c.lines.map((l) => (
                    <tr key={l.id || l.sku}>
                      <td className="px-3 py-1.5 text-center font-semibold w-14">{l.qty}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-500 w-28">{l.sku}</td>
                      <td className="px-3 py-1.5">{l.description}</td>
                      <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap w-20">{l.uom}</td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap w-20">{money(l.price)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold whitespace-nowrap w-24">{money(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}

      {/* per-teacher breakdown */}
      <div className="mt-8">
        <button onClick={() => setShowTeachers((v) => !v)} className="text-sm font-semibold text-indigo-600 hover:underline print:hidden">
          {showTeachers ? "Hide" : "Show"} per-teacher breakdown ({data.orders.length})
        </button>
        {showTeachers && (
          <div className="mt-3 bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2">Teacher</th><th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Submitted</th><th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2 font-medium">{o.teacherName}</td>
                    <td className="px-3 py-2 text-slate-500">{o.teacherEmail}</td>
                    <td className="px-3 py-2 text-slate-500">{o.createdAt ? new Date(o.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                    <td className="px-3 py-2 text-right">{o.lineCount}</td>
                    <td className="px-3 py-2 text-right font-semibold">{money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SummaryPage() {
  return <AdminGate title="Ordering · School Summary">{(ctx) => <Summary {...ctx} />}</AdminGate>;
}
