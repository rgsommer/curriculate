"use client";

// ⭐ Star count: count each house's bottle of stars, enter the numbers, award all
// houses at once (stars × points per star, default 5). Recent counts are listed;
// the latest can be undone if it was a miscount.
import { useEffect, useState } from "react";
import { api } from "../_lib/api";
import { Button } from "./ui";
import { toast } from "./toast";

type House = { _id: string; name: string; color?: string };
type Count = { at: string; by: string; houses: { house: string; color: string; stars: number; points: number }[]; totalStars: number; totalPoints: number };

export default function StarCount({ houses, onAwarded, onClose }: { houses: House[]; onAwarded: () => void; onClose: () => void }) {
  const [per, setPer] = useState(5);
  const [counts, setCounts] = useState<Count[]>([]);
  const [stars, setStars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function loadHistory() {
    api<{ starPoints: number; counts: Count[] }>("/house/stars").then((d) => { setPer(d.starPoints ?? 5); setCounts(d.counts || []); }).catch(() => {});
  }
  useEffect(loadHistory, []);

  const n = (id: string) => Math.max(0, Math.round(Number(stars[id]) || 0));
  const totalStars = houses.reduce((a, h) => a + n(h._id), 0);

  async function award() {
    if (!totalStars) { setErr("Enter at least one house's star count."); return; }
    const summary = houses.filter((h) => n(h._id) > 0).map((h) => `${h.name} ${n(h._id)} (+${n(h._id) * per})`).join(", ");
    if (!window.confirm(`Award star points?\n\n${summary}`)) return;
    setBusy(true); setErr("");
    try {
      await api("/house/stars", { body: { counts: houses.map((h) => ({ houseId: h._id, stars: n(h._id) })) } });
      toast(`⭐ ${totalStars} stars awarded`);
      setStars({});
      loadHistory();
      onAwarded();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function undo(at: string) {
    if (!window.confirm("Undo this star count? Its points come off every house.")) return;
    try { await api(`/house/stars?at=${encodeURIComponent(at)}`, { method: "DELETE" }); toast("Star count undone"); loadHistory(); onAwarded(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">⭐ Star count <span className="font-normal text-slate-500">— {per} points per star</span></p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 underline">close</button>
      </div>
      <p className="text-xs text-slate-600">Count each house&apos;s bottle and enter the number of stars. Every house is awarded at once.</p>
      <ul className="space-y-1.5">
        {houses.map((h) => (
          <li key={h._id} className="flex items-center gap-2 text-sm">
            <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: h.color || "#0f172a" }} />
            <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
            <input type="number" min={0} inputMode="numeric" value={stars[h._id] ?? ""} placeholder="0" aria-label={`Stars for ${h.name}`}
              onChange={(e) => setStars((p) => ({ ...p, [h._id]: e.target.value }))}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
            <span className="w-16 text-right text-xs tabular-nums text-slate-500">{n(h._id) ? `+${n(h._id) * per}` : ""}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={award} disabled={busy || !totalStars}>{busy ? "Awarding…" : `Award ${totalStars ? `${totalStars} stars (+${totalStars * per})` : "stars"}`}</Button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
      {counts.length > 0 && (
        <div className="border-t border-amber-200 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent counts</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-700">
            {counts.slice(0, 5).map((c, i) => (
              <li key={c.at} className="flex flex-wrap items-baseline gap-x-2">
                <span className="tabular-nums text-slate-500">{new Date(c.at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>
                <span>{c.houses.map((h) => `${h.house} ${h.stars}`).join(" · ")}</span>
                <span className="text-slate-500">= {c.totalStars} stars, +{c.totalPoints}{c.by ? ` · ${c.by}` : ""}</span>
                {i === 0 && <button type="button" onClick={() => undo(c.at)} className="text-red-700 underline">undo</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
