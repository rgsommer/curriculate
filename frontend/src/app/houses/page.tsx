"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "../behavior/_lib/api";

type House = { id: string; name: string; color: string; points: number; members: number; captains?: string[] };
type Comp = { name: string; monthLabel: string; scored: boolean; results: { place: number; houseName: string; houseColor: string }[] };
type Activity = { house: string; color: string; points: number; reason: string; at: string };
type Board = { schoolName: string; houses: House[]; competitions: Comp[]; activity: Activity[] };

const KEY = "houses_portal_code";
const MEDAL = ["🥇", "🥈", "🥉"];

async function fetchBoard(code: string): Promise<{ ok: boolean; error?: string; board?: Board }> {
  try {
    const r = await fetch(`${API_BASE}/api/behavior/public/houses?code=${encodeURIComponent(code)}`);
    const d = await r.json();
    if (!d.ok) return { ok: false, error: d.error || "Could not load standings" };
    return { ok: true, board: { schoolName: d.schoolName || "", houses: d.houses || [], competitions: d.competitions || [], activity: d.activity || [] } };
  } catch {
    return { ok: false, error: "Network error — try again" };
  }
}

type Match = { firstName: string; grade: string; house: string; color: string; group: number | null; room: string };

export default function HousesPortal() {
  const [code, setCode] = useState<string>("");
  const [input, setInput] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // "Find your house" by last name
  const [lookupName, setLookupName] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState("");

  async function doLookup(e?: React.FormEvent) {
    e?.preventDefault();
    const ln = lookupName.trim();
    if (ln.length < 2) { setLookupErr("Type at least two letters of your last name."); return; }
    setLookupBusy(true); setLookupErr(""); setMatches(null);
    try {
      const r = await fetch(`${API_BASE}/api/behavior/public/houses/lookup?code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(ln)}`);
      const d = await r.json();
      if (!d.ok) { setLookupErr(d.error || "Could not look that up."); return; }
      setMatches(d.matches || []);
    } catch {
      setLookupErr("Network error — try again.");
    } finally {
      setLookupBusy(false);
    }
  }

  // Restore the saved code (entered once, remembered on this device).
  useEffect(() => {
    const saved = localStorage.getItem(KEY) || "";
    if (saved) setCode(saved);
  }, []);

  // Load + auto-refresh standings while a code is active.
  useEffect(() => {
    if (!code) return;
    let alive = true;
    const load = async () => {
      const r = await fetchBoard(code);
      if (!alive) return;
      if (!r.ok) { setErr(r.error || "error"); setBoard(null); return; }
      setErr("");
      setBoard(r.board!);
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [code]);

  async function submitCode(e?: React.FormEvent) {
    e?.preventDefault();
    const c = input.trim();
    if (!/^\d{3,6}$/.test(c)) { setErr("Enter your school code (digits)."); return; }
    setBusy(true);
    setErr("");
    const r = await fetchBoard(c);
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Invalid code"); return; }
    localStorage.setItem(KEY, c);
    setCode(c);
    setBoard(r.board!);
  }
  function changeCode() {
    localStorage.removeItem(KEY);
    setCode("");
    setBoard(null);
    setInput("");
    setErr("");
  }

  // ── Code entry ─────────────────────────────────────────────────────────────
  if (!code) {
    return (
      <div className="space-y-4">
        <Header />
        <form onSubmit={submitCode} className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Enter your school code</h2>
          <p className="mt-1 text-sm text-slate-500">Ask your teacher for the 4-digit House code. You only enter it once.</p>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoFocus
            placeholder="1234"
            className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.3em]"
          />
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <button type="submit" disabled={busy} className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-40">
            {busy ? "Checking…" : "See standings"}
          </button>
        </form>
      </div>
    );
  }

  const max = Math.max(1, ...(board?.houses || []).map((h) => Math.abs(h.points)));

  // ── Leaderboard ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Header />
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{board?.schoolName || ""}</p>
        <button onClick={changeCode} className="text-xs text-slate-400 underline">change code</button>
      </div>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Find your house</h2>
        <p className="mt-1 text-sm text-slate-500">Type your last name to see your house and group.</p>
        <form onSubmit={doLookup} className="mt-2 flex gap-2">
          <input
            value={lookupName}
            onChange={(e) => setLookupName(e.target.value)}
            placeholder="Last name"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5"
          />
          <button type="submit" disabled={lookupBusy} className="rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-40">
            {lookupBusy ? "…" : "Find"}
          </button>
        </form>
        {lookupErr && <p className="mt-2 text-sm text-red-600">{lookupErr}</p>}
        {matches && matches.length === 0 && <p className="mt-2 text-sm text-slate-400">No match — check the spelling, or ask your teacher.</p>}
        {matches && matches.length > 0 && (
          <ul className="mt-3 space-y-2">
            {matches.map((m, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <span className="inline-block h-8 w-8 shrink-0 rounded-full" style={{ background: m.color }} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{m.firstName}{m.grade ? <span className="ml-1 text-xs font-normal text-slate-400">Gr {m.grade}</span> : null}</div>
                  <div className="text-sm text-slate-600">
                    {m.house || "—"}
                    {m.group ? <span className="font-medium"> · Group #{m.group}</span> : null}
                    {m.room ? <span className="text-slate-500"> → Room {m.room}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Leaderboard</h2>
        {board === null ? (
          <p className="mt-2 text-sm text-slate-400">Loading…</p>
        ) : board.houses.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No houses yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {board.houses.map((h, i) => (
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
                  {h.captains && h.captains.length > 0 && (
                    <div className="mt-1 text-xs text-slate-400">© {h.captains.join(", ")}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {board && board.competitions.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Competitions</h2>
          <ul className="mt-3 space-y-2">
            {board.competitions.map((c) => (
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

      {board && board.activity.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <style>{`@keyframes hpFlash { 0% { background:#fef9c3; } 100% { background:transparent; } }`}</style>
          <h2 className="font-semibold">Latest points</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {board.activity.map((a) => (
              <li
                key={`${a.house}-${a.at}-${a.points}-${a.reason}`}
                className="flex items-center gap-2 rounded-md py-2 text-sm"
                style={{ animation: "hpFlash 1.6s ease-out" }}
              >
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className="font-medium">{a.house}</span>
                <span className={`shrink-0 font-bold tabular-nums ${a.points < 0 ? "text-red-600" : "text-green-600"}`}>
                  {a.points > 0 ? `+${a.points}` : a.points}
                </span>
                {a.reason && <span className="truncate text-slate-400">· {a.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pb-6 text-center text-xs text-slate-400">Updates automatically · go {board && board.houses[0] ? board.houses[0].name : "team"}!</p>
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
