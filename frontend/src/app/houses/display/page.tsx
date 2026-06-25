"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../behavior/_lib/api";

type House = { id: string; name: string; color: string; image?: string; points: number };
type Daily = { name: string; photoUrl?: string; house: string; color: string; points: number } | null;
type Reward = { points: number; reward: string };
type Board = {
  schoolName: string;
  houses: House[];
  dailyTopStudent: Daily;
  dailyTopHouse: { name: string; color: string; image?: string; points: number } | null;
  rewards: Reward[];
};

const KEY = "houses_portal_code";
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export default function HousesDisplay() {
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setCode(localStorage.getItem(KEY) || ""); }, []);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/behavior/public/houses?code=${encodeURIComponent(code)}`);
        const d = await r.json();
        if (!alive) return;
        if (!d.ok) { setErr(d.error || "Could not load"); return; }
        setErr("");
        setBoard({ schoolName: d.schoolName || "", houses: d.houses || [], dailyTopStudent: d.dailyTopStudent || null, dailyTopHouse: d.dailyTopHouse || null, rewards: d.rewards || [] });
        setUpdated(new Date());
      } catch { if (alive) setErr("Network error"); }
    };
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => { alive = false; if (timer.current) clearInterval(timer.current); };
  }, [code]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const c = input.trim();
    if (!/^\d{3,6}$/.test(c)) { setErr("Enter the school code"); return; }
    localStorage.setItem(KEY, c);
    setCode(c);
  }

  if (!code) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 p-6 text-white">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 text-slate-900">
          <h1 className="text-xl font-bold">House display board</h1>
          <p className="mt-1 text-sm text-slate-500">Enter the school House code to start the wall display.</p>
          <input value={input} onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoFocus
            placeholder="1234" className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.3em]" />
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <button className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white">Start</button>
        </form>
      </div>
    );
  }

  const max = Math.max(1, ...(board?.houses || []).map((h) => Math.abs(h.points)));
  const ts = board?.dailyTopStudent;
  const th = board?.dailyTopHouse;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 p-[2.2vw] text-white">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-[3vw] font-extrabold leading-none">House Standings</h1>
        <div className="text-right">
          <div className="text-[1.4vw] font-semibold text-slate-200">{board?.schoolName || ""}</div>
          <div className="text-[0.9vw] text-slate-400">{updated ? `updated ${updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · refreshes every 5 min` : ""}</div>
        </div>
      </div>
      {err && <p className="mt-1 text-[1vw] text-red-300">{err}</p>}

      <div className="mt-[2vh] grid min-h-0 flex-1 grid-cols-[38fr_62fr] gap-[2vw]">
        {/* Left: daily winners + rewards */}
        <div className="flex min-h-0 flex-col gap-[2vh]">
          <div className="rounded-[1.2vw] border-[0.25vw] border-transparent bg-white/10 p-[1.6vw]" style={ts ? { borderColor: ts.color, background: `${ts.color}26` } : undefined}>
            <div className="text-[1.1vw] uppercase tracking-wide text-slate-300">⭐ Top student today</div>
            {ts ? (
              <div className="mt-[1vh] flex items-center gap-[1.4vw]">
                {ts.photoUrl
                  ? <img src={ts.photoUrl} alt="" className="h-[10vw] w-[10vw] rounded-[1vw] border-[0.35vw] object-cover" style={{ borderColor: ts.color }} />
                  : <div className="flex h-[10vw] w-[10vw] items-center justify-center rounded-[1vw] border-[0.35vw] bg-white/15 text-[4vw]" style={{ borderColor: ts.color }}>🏅</div>}
                <div className="min-w-0">
                  <div className="truncate text-[2.4vw] font-extrabold leading-tight">{ts.name}</div>
                  <div className="mt-[0.5vh] flex items-center gap-[0.6vw] text-[1.4vw]">
                    <span className="inline-block h-[1.2vw] w-[1.2vw] rounded-full" style={{ background: ts.color }} />{ts.house}
                  </div>
                  <div className="mt-[0.5vh] text-[1.6vw] font-bold text-emerald-300">+{ts.points} today</div>
                </div>
              </div>
            ) : <div className="mt-[1vh] text-[1.4vw] text-slate-300">No points yet today.</div>}
          </div>

          <div className="rounded-[1.2vw] border-[0.25vw] border-transparent bg-white/10 p-[1.6vw]" style={th ? { borderColor: th.color, background: `${th.color}26` } : undefined}>
            <div className="text-[1.1vw] uppercase tracking-wide text-slate-300">🏆 Top house today</div>
            {th ? (
              <div className="mt-[1vh] flex items-center gap-[1.2vw]">
                {th.image ? <img src={th.image} alt="" className="h-[5vw] w-[5vw] rounded-[0.8vw] object-cover" /> : <span className="inline-block h-[3vw] w-[3vw] rounded-full" style={{ background: th.color }} />}
                <span className="text-[2.4vw] font-extrabold">{th.name}</span>
                <span className="ml-auto text-[2vw] font-bold text-emerald-300">+{th.points}</span>
              </div>
            ) : <div className="mt-[1vh] text-[1.4vw] text-slate-300">No points yet today.</div>}
          </div>

          {board && board.rewards.length > 0 && (
            <div className="min-h-0 flex-1 overflow-hidden rounded-[1.2vw] bg-white/10 p-[1.6vw]">
              <div className="text-[1.1vw] uppercase tracking-wide text-slate-300">🎁 Rewards</div>
              <ul className="mt-[1vh] space-y-[0.8vh]">
                {board.rewards.map((rw, i) => {
                  const reached = (board.houses || []).filter((h) => h.points >= rw.points);
                  return (
                    <li key={i} className="text-[1.2vw]">
                      <span className="font-bold">{rw.points} pts</span> → {rw.reward}
                      {reached.length > 0 && (
                        <span className="ml-[0.6vw]">
                          {reached.map((h) => (
                            <span key={h.id} className="ml-[0.4vw] inline-flex items-center gap-[0.3vw] rounded-full bg-emerald-500/20 px-[0.7vw] py-[0.2vh] text-[1vw] text-emerald-200">
                              <span className="inline-block h-[0.8vw] w-[0.8vw] rounded-full" style={{ background: h.color }} />{h.name} ✓
                            </span>
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Right: leaderboard */}
        <div className="flex min-h-0 flex-col justify-center rounded-[1.2vw] bg-white/10 p-[2vw]">
          <ul className="space-y-[2.4vh]">
            {(board?.houses || []).map((h, i) => (
              <li key={h.id} className="flex items-center gap-[1.2vw]">
                <span className="w-[3vw] text-center text-[2.2vw]">{["🥇", "🥈", "🥉"][i] || <span className="text-[1.4vw] text-slate-400">{i + 1}</span>}</span>
                {h.image ? <img src={h.image} alt="" className="h-[3.2vw] w-[3.2vw] rounded-[0.6vw] object-cover" /> : <span className="inline-block h-[2vw] w-[2vw] shrink-0 rounded-full" style={{ background: h.color }} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="truncate text-[2vw] font-bold">{h.name}</span>
                    <span className="text-[2.2vw] font-extrabold tabular-nums">{h.points.toLocaleString()}</span>
                  </div>
                  <div className="mt-[0.6vh] h-[1.6vh] w-full overflow-hidden rounded-full bg-white/15">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, (Math.abs(h.points) / max) * 100)}%`, background: h.color }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
