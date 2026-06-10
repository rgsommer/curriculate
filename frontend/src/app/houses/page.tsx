"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../behavior/_lib/api";

type House = { id: string; name: string; color: string; points: number; members: number };
type Comp = { name: string; monthLabel: string; scored: boolean; results: { place: number; houseName: string; houseColor: string }[] };
type School = { id: string; name: string };

const KEY = "houses_portal_school";
const MEDAL = ["🥇", "🥈", "🥉"];

export default function HousesPortal() {
  const [school, setSchool] = useState<School | null>(null);
  const [schools, setSchools] = useState<School[] | null>(null);
  const [houses, setHouses] = useState<House[] | null>(null);
  const [comps, setComps] = useState<Comp[]>([]);
  const [err, setErr] = useState("");

  // Restore the chosen school (picked once, remembered).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s?.id) setSchool(s);
    } catch {
      /* ignore */
    }
  }, []);

  // No school yet → load the picker list.
  useEffect(() => {
    if (school) return;
    fetch(`${API_BASE}/api/behavior/public/schools`)
      .then((r) => r.json())
      .then((d) => setSchools(d.schools || []))
      .catch(() => setSchools([]));
  }, [school]);

  // Load standings for the chosen school (and refresh every 30s).
  useEffect(() => {
    if (!school) return;
    let alive = true;
    const load = () =>
      fetch(`${API_BASE}/api/behavior/public/houses?schoolId=${encodeURIComponent(school.id)}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (!d.ok) { setErr(d.error || "Could not load standings"); return; }
          setHouses(d.houses || []);
          setComps(d.competitions || []);
        })
        .catch(() => alive && setErr("Could not load standings"));
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [school]);

  function pick(s: School) {
    localStorage.setItem(KEY, JSON.stringify(s));
    setSchool(s);
    setHouses(null);
    setErr("");
  }
  function changeSchool() {
    localStorage.removeItem(KEY);
    setSchool(null);
    setHouses(null);
    setComps([]);
    setErr("");
  }

  // ── School picker ──────────────────────────────────────────────────────────
  if (!school) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Choose your school</h2>
          <p className="mt-1 text-sm text-slate-500">Pick once — we&apos;ll remember it on this device.</p>
          {schools === null ? (
            <p className="mt-3 text-sm text-slate-400">Loading…</p>
          ) : schools.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No schools have published their house standings yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {schools.map((s) => (
                <li key={s.id}>
                  <button onClick={() => pick(s)} className="w-full px-1 py-3 text-left font-medium hover:text-slate-600">
                    {s.name} →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const max = Math.max(1, ...(houses || []).map((h) => Math.abs(h.points)));

  // ── Leaderboard ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Header />
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{school.name}</p>
        <button onClick={changeSchool} className="text-xs text-slate-400 underline">change school</button>
      </div>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Leaderboard</h2>
        {houses === null ? (
          <p className="mt-2 text-sm text-slate-400">Loading…</p>
        ) : houses.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No houses yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {houses.map((h, i) => (
              <li key={h.id} className="flex items-center gap-3">
                <span className="w-6 text-center text-lg">{MEDAL[i] || <span className="text-sm text-slate-400">{i + 1}</span>}</span>
                <span className="inline-block h-4 w-4 shrink-0 rounded-full" style={{ background: h.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="truncate font-semibold">{h.name}</span>
                    <span className="ml-2 shrink-0 tabular-nums font-bold">{h.points.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, (Math.abs(h.points) / max) * 100)}%`, background: h.color }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {comps.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Competitions</h2>
          <ul className="mt-3 space-y-2">
            {comps.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-slate-400">{c.monthLabel}</div>
                </div>
                {c.scored ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {c.results.map((r) => (
                      <span key={r.place} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {MEDAL[r.place - 1] || `${r.place}.`}
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.houseColor }} />
                        {r.houseName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-slate-300">upcoming</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pb-6 text-center text-xs text-slate-400">Updates automatically · go {houses && houses[0] ? houses[0].name : "team"}!</p>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-lg">👀</span>
      <div>
        <h1 className="text-xl font-bold tracking-tight">House Standings</h1>
        <p className="text-xs text-slate-400">Live points &amp; leaderboard</p>
      </div>
    </div>
  );
}
