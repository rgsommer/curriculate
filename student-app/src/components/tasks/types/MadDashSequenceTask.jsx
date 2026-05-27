// student-app/src/components/tasks/types/MadDashSequenceTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * MadDashSequenceTask
 *
 * IMPORTANT: This task does NOT mount a camera scanner.
 * It listens for scan values dispatched by the app-wide scanner via:
 *   window.dispatchEvent(new CustomEvent("curriculate:qr-scan", { detail: value }))
 * OR
 *   window.__curriculateTaskScanHandler?.(value)
 */

const DEFAULT_COLORS = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Teal", "Pink"];

// Render the station tags in their ACTUAL color so they match the physical
// station signs, instead of a generic dark pill with a color word.
const COLOR_SWATCH = {
  Red:    { bg: "#ef4444", fg: "#ffffff" },
  Blue:   { bg: "#3b82f6", fg: "#ffffff" },
  Green:  { bg: "#22c55e", fg: "#ffffff" },
  Yellow: { bg: "#eab308", fg: "#1a1a1a" },
  Purple: { bg: "#a855f7", fg: "#ffffff" },
  Orange: { bg: "#f97316", fg: "#ffffff" },
  Teal:   { bg: "#14b8a6", fg: "#ffffff" },
  Pink:   { bg: "#ec4899", fg: "#ffffff" },
};
function colorPillStyle(name) {
  const sw = COLOR_SWATCH[name] || { bg: "#0f172a", fg: "#ffffff" };
  return {
    background: sw.bg,
    color: sw.fg,
    border: `1px solid rgba(0,0,0,0.15)`,
  };
}

function normalizeColorName(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function stationIdToColor(value, palette) {
  if (!value) return null;
  let raw = String(value).trim();
  if (!raw) return null;

  try { raw = decodeURIComponent(raw); } catch {}

  const jsonish = raw.startsWith("{") && raw.endsWith("}");
  if (jsonish) {
    try {
      const obj = JSON.parse(raw);
      const candidate = obj?.station || obj?.code || obj?.value || obj?.id || obj?.color;
      if (candidate) raw = String(candidate);
    } catch {}
  }

  const colorsNorm = (palette?.length ? palette : DEFAULT_COLORS).map(normalizeColorName).filter(Boolean);

  const m1 = /station-(\d+)/i.exec(raw) || /station[\s_:-]*(\d+)/i.exec(raw);
  if (m1) {
    const idx = Number(m1[1]) - 1;
    return colorsNorm[idx % colorsNorm.length] || null;
  }

  const asColor = normalizeColorName(raw);
  if (asColor && colorsNorm.includes(asColor)) return asColor;

  const lower = raw.toLowerCase();
  for (const c of colorsNorm) {
    if (c && lower.includes(c.toLowerCase())) return c;
  }
  return asColor || null;
}

function shuffle(arr, seed = Math.random()) {
  const a = [...arr];
  let m = a.length;
  let s = Math.floor(seed * 1e9) || 123456789;
  const rand = () => {
    s = (1664525 * s + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  while (m) {
    const i = Math.floor(rand() * m--);
    [a[m], a[i]] = [a[i], a[m]];
  }
  return a;
}

export default function MadDashSequenceTask({ task, onSubmit, disabled, presenter, practiceMode = false, requireRealScans = false }) {
  // Practice/preview path: no real station QRs, so show tappable colour buttons
  // that fire the same scan handler. Hidden at the conference booth (real scans).
  const showScanSimulator = practiceMode && !requireRealScans;
  const palette = useMemo(() => {
    const p =
      (Array.isArray(task?.availableColors) && task.availableColors) ||
      (Array.isArray(task?.stationColors) && task.stationColors) ||
      DEFAULT_COLORS;
    return p.map(normalizeColorName).filter(Boolean);
  }, [task]);

  const items = useMemo(() => {
    const raw =
      (Array.isArray(task?.config?.items) && task.config.items) ||
      (Array.isArray(task?.items) && task.items) ||
      [];
    return raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
  }, [task]);

  const correctOrder = useMemo(() => {
    const raw = task?.config?.correctOrder ?? task?.correctOrder ?? task?.answerKey ?? null;
    if (Array.isArray(raw)) return raw.map((n) => Number(n)).filter((n) => Number.isInteger(n));
    return null;
  }, [task]);

  const players = useMemo(() => {
    const n = Math.max(1, Math.min(6, Number(task?.players) || 1));
    return Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
  }, [task]);

  const revealMs = Number(task?.config?.revealMs || 10000);

  const [phase, setPhase] = useState("instructions"); // instructions -> puzzle -> reveal -> go -> scan -> result -> complete
  const [turnIdx, setTurnIdx] = useState(0);

  const [mapping, setMapping] = useState([]);       // shuffled display items
  const [correctMapping, setCorrectMapping] = useState([]); // items in correct order with colors
  const [scanSeq, setScanSeq] = useState([]);

  const [scanIdx, setScanIdx] = useState(0);
  const [errorFlash, setErrorFlash] = useState(false);

  const startAtRef = useRef(null);
  const tickRef = useRef(null);
  const revealTimerRef = useRef(null);
  const [timerMs, setTimerMs] = useState(0);

  const [playerRuns, setPlayerRuns] = useState([]);


  const fmt = (ms) => {
    const s = Math.max(0, Number(ms) || 0) / 1000;
    return s.toFixed(s >= 10 ? 1 : 2) + "s";
  };

  useEffect(() => {
    const n = items.length;
    if (!n) return;

    const colors = (palette?.length ? palette : DEFAULT_COLORS).slice(0, Math.max(3, n));
    const assigned = shuffle(colors, 0.1337 + turnIdx * 0.17).slice(0, n);

    const map = items.map((text, i) => ({ text, idx: i, color: assigned[i] }));
    const display = shuffle(map, 0.4242 + turnIdx * 0.31);

    setMapping(display);

    const order =
      Array.isArray(correctOrder) && correctOrder.length === n
        ? correctOrder
        : Array.from({ length: n }, (_, i) => i);

    const expectedColors = order.map((i) => map[i]?.color).filter(Boolean);
    setScanSeq(expectedColors);

    // Build the correct-order display: items in the right sequence with their assigned colors
    const correctItems = order.map((i) => map[i]).filter(Boolean);
    setCorrectMapping(correctItems);

    setScanIdx(0);
    setErrorFlash(false);
    setTimerMs(0);
    startAtRef.current = null;
  }, [items, palette, correctOrder, turnIdx]);

  useEffect(() => {
    setPhase("instructions");
    setTurnIdx(0);
    setPlayerRuns([]);
  }, [task?.id]);

  useEffect(() => {
    if (phase !== "scan" || disabled) return;
    tickRef.current = window.setInterval(() => {
      if (!startAtRef.current) return;
      setTimerMs(performance.now() - startAtRef.current);
    }, 50);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [phase, disabled]);

  // Start scanning straight from the puzzle. We deliberately do NOT reveal the
  // correct order first — students must reason out the sequence from the
  // statements themselves (a reveal just gets copied without reading).
  const startScan = async () => {
    if (disabled) return;
    if (presenter?.showCountdown) {
      try {
        await presenter.showCountdown({
          title: "Mad Dash Sequence",
          seconds: 3,
          subtext: "1–2–3… GO!",
        });
      } catch {}
    }
    setScanIdx(0);
    setTimerMs(0);
    startAtRef.current = performance.now();
    setPhase("scan");
  };

  const handleScanValue = (value) => {
    if (phase !== "scan" || disabled) return false;

    const colorName = stationIdToColor(value, palette);
    if (!colorName) return false;

    const expected = scanSeq[scanIdx];
    const ok = normalizeColorName(colorName) === normalizeColorName(expected);

    if (!ok) {
      setErrorFlash(true);
      window.setTimeout(() => setErrorFlash(false), 220);
      setScanIdx(0);
      return false;
    }

    const nextIdx = scanIdx + 1;
    setScanIdx(nextIdx);

    if (nextIdx >= scanSeq.length) {
      const finalMs = performance.now() - (startAtRef.current || performance.now());
      setPhase("result");
      setPlayerRuns((prev) => {
        const next = [...prev];
        next[turnIdx] = { timeMs: finalMs, correct: true };
        return next;
      });
      return true;
    }

    return false;
  };

  // -------------------------------------------------------------------
  // Listen for scans from the SINGLE app-wide scanner
  // -------------------------------------------------------------------
  const scanHandlerRef = useRef(null);
  const installedHookRef = useRef(null);

  useEffect(() => {
    scanHandlerRef.current = handleScanValue;
  }, [handleScanValue]);

  useEffect(() => {
    if (disabled) return;

    const onScanEvent = (e) => {
      const v = e?.detail ?? e;
      scanHandlerRef.current?.(v);
    };

    window.addEventListener("curriculate:qr-scan", onScanEvent);

    const hookFn = (v) => scanHandlerRef.current?.(v);
    installedHookRef.current = hookFn;
    window.__curriculateTaskScanHandler = hookFn;

    return () => {
      window.removeEventListener("curriculate:qr-scan", onScanEvent);
      if (window.__curriculateTaskScanHandler === installedHookRef.current) {
        window.__curriculateTaskScanHandler = null;
      }
      installedHookRef.current = null;
    };
  }, [disabled]);

  useEffect(() => {
    if (phase !== "result" || disabled) return;
    const t = window.setTimeout(() => {
      const isLast = turnIdx >= players.length - 1;
      if (isLast) setPhase("complete");
      else {
        setTurnIdx((x) => x + 1);
        setPhase("instructions");
      }
    }, 1400);
    return () => window.clearTimeout(t);
  }, [phase, disabled, turnIdx, players.length]);

  const submittedRef = useRef(false);
  useEffect(() => {
    if (phase !== "complete") return;
    if (submittedRef.current) return;
    submittedRef.current = true;

    const totalMs = playerRuns.reduce((a, r) => a + (Number(r?.timeMs) || 0), 0);

    onSubmit?.({
      ok: true,
      type: "mad-dash-sequence",
      completed: true,
      players,
      items,
      correctOrder: correctOrder || Array.from({ length: items.length }, (_, i) => i),
      playerRuns,
      totalTimeMs: totalMs,
      n: items.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="w-full min-h-[520px] rounded-2xl overflow-hidden border border-slate-200 bg-white">

      <div className="p-6">
        <div className="text-4xl font-black">Mad Dash Sequence</div>
        <div className="text-slate-600 mt-1">
          {task?.prompt || task?.config?.prompt || "Determine the correct order, then scan the colours in that order. Wrong scan resets."}
        </div>
        {(task?.config?.orderingCriterion || task?.orderingCriterion) && (
          <div className="mt-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 font-bold text-sm">
            Ordering: {task?.config?.orderingCriterion || task?.orderingCriterion}
          </div>
        )}

        {phase === "instructions" && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="text-xl font-extrabold">Player {turnIdx + 1}</div>
            <button
              className="px-5 py-3 rounded-full bg-emerald-600 text-white font-black disabled:opacity-50"
              disabled={disabled}
              onClick={() => setPhase("puzzle")}
            >
              Show items
            </button>
          </div>
        )}

        {phase === "puzzle" && (
          <div className="mt-6">
            <div className="font-extrabold text-xl">Items (shuffled):</div>
            <div className="mt-1 text-slate-500 font-semibold">
              Work out the correct order, then scan the stations in that order.
            </div>
            <div className="mt-3 grid gap-2">
              {mapping.map((m) => (
                <div
                  key={`${m.idx}-${m.color}`}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between"
                >
                  <div className="font-bold">{m.text}</div>
                  <div className="px-3 py-1 rounded-full font-black" style={colorPillStyle(m.color)}>
                    {m.color}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-3">
              <button
                className="px-5 py-3 rounded-full bg-indigo-600 text-white font-black disabled:opacity-50"
                disabled={disabled}
                onClick={startScan}
              >
                Ready to scan
              </button>
              <div className="text-slate-500 self-center">Scan the station colors in the order you think is correct.</div>
            </div>
          </div>
        )}

        {/* No "reveal" phase — students must reason the order themselves.
            "go" countdown is handled by the presenter overlay in startScan(). */}

        {phase === "scan" && (
          <div className="mt-6">
            <div className="text-2xl font-black">
              Time: <span className="text-amber-600">{fmt(timerMs)}</span>
            </div>
            {/* Intentionally NOT revealing the next colour — that would let
                students match colours without reading/ordering the statements.
                They scan the stations in the order they worked out. */}
            <div className="mt-3 font-extrabold text-slate-700">
              Scan the stations in the order you worked out.
            </div>

            <div className={`mt-4 p-4 rounded-xl border ${errorFlash ? "border-red-400 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
              <div className="text-slate-600">Progress: {scanIdx}/{scanSeq.length}</div>
              <div className="mt-2 text-xs text-slate-500">
                {showScanSimulator
                  ? "Practice mode — tap a colour below to simulate scanning that station."
                  : "Use the on-screen scanner — this task listens to it."}
              </div>
            </div>

            {/* Practice/preview scan simulator — tappable colour buttons that
                fire the same scan handler as a real station QR. */}
            {showScanSimulator && (
              <div className="mt-4">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
                    gap: 10,
                  }}
                >
                  {(palette && palette.length ? palette : DEFAULT_COLORS).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleScanValue(c)}
                      aria-label={`Tap to simulate scanning ${c}`}
                      className="font-black"
                      style={{
                        ...colorPillStyle(c),
                        borderRadius: 14,
                        height: 52,
                        cursor: "pointer",
                        border: "3px solid rgba(255,255,255,0.85)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                        letterSpacing: 0.5,
                      }}
                    >
                      {String(c).toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {phase === "result" && (
          <div className="mt-10 text-3xl font-black text-emerald-700">Done!</div>
        )}

        {phase === "complete" && (
          <div className="mt-10">
            <div className="text-3xl font-black text-emerald-700">Team Complete</div>
            <div className="mt-3 space-y-2">
              {players.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="font-bold">{p}</div>
                  <div className="font-black text-amber-700">{fmt(playerRuns?.[i]?.timeMs || 0)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
