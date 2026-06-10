"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../_lib/api";

type Result = { place: number; houseId: string; houseName: string; houseColor: string; points: number };
type Comp = {
  _id: string;
  name: string;
  description: string;
  monthOrder: number;
  monthLabel: string;
  placementPoints: number[];
  scoredAt: string | null;
  results: Result[];
};
type House = { _id: string; name: string; color: string };

export default function CompetitionsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [comps, setComps] = useState<Comp[] | null>(null);
  const [houses, setHouses] = useState<House[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api<{ competitions: Comp[] }>("/competitions").then((d) => setComps(d.competitions || [])).catch((e) => setErr(e.message));
    api<{ houses: House[] }>("/houses").then((d) => setHouses(d.houses || [])).catch(() => {});
  }
  useEffect(() => {
    if (!getToken()) return;
    api<Me>("/me").then(setMe).catch((e) => setErr(e.message));
    load();
  }, []);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior/competitions")}>sign in</Link>.</p>;
  if (err) return <p className="text-red-600">{err}</p>;
  if (!me?.membership || comps === null) return <p className="text-slate-500">Loading…</p>;

  const isAdmin = me.membership.role === "originator" || me.membership.role === "admin";

  async function seed() {
    setBusy(true);
    try {
      await api("/competitions/seed", { body: {} });
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/behavior" className="text-sm text-slate-500 underline">← dashboard</Link>
        <h1 className="mt-1 text-xl font-semibold">House competitions</h1>
        <p className="text-sm text-slate-400">
          A Sept–June calendar. Scoring an event awards capped placement points
          ({(comps[0]?.placementPoints || [500, 300, 200, 100]).join(" / ")}) on top of everyday behaviour points — so one
          event can&apos;t run away with the year.
        </p>
      </div>

      {comps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
          <p className="text-sm text-slate-500">No competitions yet.</p>
          {isAdmin && (
            <button onClick={seed} disabled={busy} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
              {busy ? "Adding…" : "Seed the Sept–June calendar"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {comps.map((c) => (
            <CompRow key={c._id} c={c} houses={houses} editable={isAdmin} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompRow({ c, houses, editable, onChanged }: { c: Comp; houses: House[]; editable: boolean; onChanged: () => void }) {
  const places = Math.min(c.placementPoints.length, Math.max(houses.length, 1));
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<string[]>(
    Array.from({ length: places }, (_, i) => c.results.find((r) => r.place === i + 1)?.houseId || "")
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const results = picks.map((houseId, i) => ({ houseId, place: i + 1 })).filter((r) => r.houseId);
      await api(`/competitions/${c._id}/score`, { body: { results } });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">
            <span className="text-xs text-slate-400">{c.monthLabel}</span> · {c.name}
          </div>
          {c.results.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {c.results.map((r) => (
                <span key={r.place} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.houseColor }} />
                  {ord(r.place)} {r.houseName} <span className="text-slate-400">+{r.points}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-slate-400">Not scored yet</div>
          )}
        </div>
        {editable && (
          <button onClick={() => setOpen((o) => !o)} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs">
            {open ? "Cancel" : c.results.length ? "Edit result" : "Score"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {err && <p className="text-xs text-red-600">{err}</p>}
          {houses.length === 0 && <p className="text-xs text-amber-600">Define houses in Setup first.</p>}
          {Array.from({ length: places }, (_, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-20 text-slate-500">{ord(i + 1)} (+{c.placementPoints[i] || 0})</span>
              <select
                value={picks[i] || ""}
                onChange={(e) => setPicks((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5"
              >
                <option value="">—</option>
                {houses.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
              </select>
            </div>
          ))}
          <button onClick={save} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "Saving…" : "Award points"}
          </button>
        </div>
      )}
    </div>
  );
}

function ord(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
