// MadDashTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_COLORS = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Teal", "Pink"];

// Bold Kahoot-style swatches (matches PhysicalMultipleChoiceTask) so the
// route reveal actually shows the colour the player is looking for.
function getColorCss(color) {
  const map = {
    Red: "#ee3333",
    Orange: "#ff6633",
    Yellow: "#ffdd33",
    Green: "#33dd33",
    Blue: "#3366ff",
    Teal: "#00cccc",
    Purple: "#dd33ff",
    Pink: "#ff3399",
  };
  return map[color] || "#6b7280";
}

// Light readable text on a coloured swatch — yellow needs dark ink, the
// rest read fine in white.
function getColorInk(color) {
  return color === "Yellow" ? "#1f2937" : "#ffffff";
}

// Render a single coloured swatch with step number + colour name.  Used
// in the reveal grid, hint pills, and the big "scan next" target.
function ColorBlock({ index, color, size = "lg", muted = false }) {
  const dims =
    size === "xl"
      ? { side: 96, font: 18, num: 26 }
      : size === "lg"
      ? { side: 72, font: 14, num: 20 }
      : { side: 52, font: 11, num: 14 };
  return (
    <div
      style={{
        width: dims.side,
        height: dims.side,
        background: getColorCss(color),
        color: getColorInk(color),
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: muted
          ? "inset 0 0 0 2px rgba(255,255,255,0.4)"
          : "0 4px 14px rgba(0,0,0,0.18), inset 0 0 0 3px rgba(255,255,255,0.85)",
        fontWeight: 900,
        textShadow:
          color === "Yellow" ? "none" : "0 2px 6px rgba(0,0,0,0.4)",
        opacity: muted ? 0.55 : 1,
        transition: "opacity 0.2s, box-shadow 0.2s",
      }}
      aria-label={`Step ${index + 1}: ${color}`}
    >
      <div style={{ fontSize: dims.num, lineHeight: 1 }}>{index + 1}</div>
      <div style={{ fontSize: dims.font, marginTop: 4, letterSpacing: 0.5 }}>
        {String(color || "").toUpperCase()}
      </div>
    </div>
  );
}

function normalizeColorName(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Accept "station-3" or a direct color string (or color embedded in URL / JSON)
function stationIdToColor(value, palette) {
  if (!value) return null;
  let raw = value;

  // Allow event detail object
  if (raw && typeof raw === "object") {
    raw = raw.color || raw.stationColor || raw.stationId || raw.id || raw.value || "";
  }
  raw = String(raw).trim();
  if (!raw) return null;

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  const jsonish = raw.startsWith("{") && raw.endsWith("}");
  if (jsonish) {
    try {
      const obj = JSON.parse(raw);
      const candidate = obj?.station || obj?.code || obj?.value || obj?.id || obj?.color;
      if (candidate) raw = String(candidate);
    } catch {}
  }

  const colorsNorm = (palette?.length ? palette : DEFAULT_COLORS)
    .map(normalizeColorName)
    .filter(Boolean);

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

function pickGivenRoute(task, palette) {
  const seq =
    (Array.isArray(task?.sequence) && task.sequence) ||
    (Array.isArray(task?.config?.sequence) && task.config.sequence) ||
    [];

  const cleaned = seq.map(normalizeColorName).filter(Boolean);
  if (cleaned.length >= 3) return cleaned.slice(0, 5);

  const len = Math.max(3, Math.min(5, Number(task?.config?.length) || 3));
  const colors = (palette?.length ? palette : DEFAULT_COLORS).map(normalizeColorName).filter(Boolean);
  const uniq = Array.from(new Set(colors));
  const pool = uniq.length ? uniq : DEFAULT_COLORS.map(normalizeColorName);

  const out = [];
  for (let i = 0; i < len; i += 1) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}

function fmtMs(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  return s.toFixed(s >= 10 ? 1 : 2) + "s";
}

function pickRunnerLabel(memberNames, idx) {
  const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
  if (names.length > 0) return names[idx % names.length];
  return `Runner ${idx + 1}`;
}

export default function MadDashTask({
  task,
  onSubmit,
  disabled,
  memberNames = [],
  roomCode = null,
  teamId = null,
  teamName = null,
  presenter = null,
  // Practice / demo surface (DemoMode).  No physical stations or
  // camera, so we render tappable colour buttons that fire the same
  // scan handler.
  practiceMode = false,
}) {
  const palette = useMemo(() => {
    const p =
      (Array.isArray(task?.availableColors) && task.availableColors) ||
      (Array.isArray(task?.stationColors) && task.stationColors) ||
      DEFAULT_COLORS;
    return p.map(normalizeColorName).filter(Boolean);
  }, [task]);

  // routeKey bumps every time we want a fresh sequence (e.g. after a
  // wrong scan).  The route memo is keyed off it so a new sequence is
  // generated on demand.
  const [routeKey, setRouteKey] = useState(0);
  const route = useMemo(
    () => pickGivenRoute(task, palette),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [task, palette, routeKey]
  );

  // Practice-mode tappable buttons used to render in palette order,
  // which incidentally matched the route order — testers noted the
  // task became trivial.  Shuffle a copy of the palette per routeKey
  // (so it changes every time we generate a new route) but keep it
  // stable within the same route so a player isn't whip-lashed mid-run.
  const practiceButtonOrder = useMemo(() => {
    const arr = [...palette].slice(0, 8);
    // Fisher-Yates with a routeKey-derived seed for determinism in tests.
    let seed = (routeKey + 1) * 9301 + 49297;
    for (let i = arr.length - 1; i > 0; i -= 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [palette, routeKey]);

  const revealMs = Number(task?.config?.revealMs || 6000);
  const goVideoSrc = String(task?.config?.goVideoSrc || "/1-2-3-go.mp4");

  const intraTeamEnabled = Boolean(
    task?.config?.intraTeamTurns ||
      task?.config?.turnMode === "intra-team" ||
      (Array.isArray(memberNames) && memberNames.filter(Boolean).length >= 2)
  );

  const [phase, setPhase] = useState(intraTeamEnabled ? "lobby" : "instructions");
  const [scanIdx, setScanIdx] = useState(0);
  const [errorFlash, setErrorFlash] = useState(false);
  // Progressive hints: how many route colors have been revealed as hints
  const [hintsUsed, setHintsUsed] = useState(0);

  const [runnerIdx, setRunnerIdx] = useState(0);
  const [runs, setRuns] = useState([]);
  const bestRun = useMemo(() => {
    if (!runs.length) return null;
    return runs.reduce((best, r) => (!best || r.timeMs < best.timeMs ? r : best), null);
  }, [runs]);

  const startAtRef = useRef(null);
  const tickRef = useRef(null);
  const [timerMs, setTimerMs] = useState(0);

  // Claim scans only while scanning
  const wantsScan = !disabled && phase === "scan";

  useEffect(() => {
    window.__curriculateTaskWantsScan = wantsScan;
    return () => {
      if (window.__curriculateTaskWantsScan === wantsScan) window.__curriculateTaskWantsScan = false;
    };
  }, [wantsScan]);

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

  const handleScanValue = (value) => {
    if (phase !== "scan" || disabled) return false;

    const colorName = stationIdToColor(value, palette);
    if (!colorName) return false;

    const expected = route[scanIdx];
    const ok = normalizeColorName(colorName) === normalizeColorName(expected);

    if (!ok) {
      setErrorFlash(true);
      window.setTimeout(() => setErrorFlash(false), 220);
      // Tester request: a wrong scan should hand the player a NEW
      // sequence to start over (not just reset progress on the same
      // route).  Bump routeKey to regenerate route + reset progress.
      // Timer keeps running — that's the penalty.
      setScanIdx(0);
      setRouteKey((k) => k + 1);
      return false;
    }

    // Start the clock on the very first correct scan
    if (!startAtRef.current) {
      startAtRef.current = performance.now();
    }

    const nextIdx = scanIdx + 1;
    setScanIdx(nextIdx);

    if (nextIdx >= route.length) {
      // Freeze timer at the exact moment of last scan
      const finalMs = performance.now() - startAtRef.current;
      setTimerMs(finalMs);

      const entry = {
        runnerIdx,
        runnerName: pickRunnerLabel(memberNames, runnerIdx),
        timeMs: finalMs,
        scans: route.length,
        hintsUsed,
        atIso: new Date().toISOString(),
      };
      setRuns((prev) => [...(Array.isArray(prev) ? prev : []), entry]);

      if (!intraTeamEnabled) {
        setPhase("done");
        onSubmit?.({
          ok: true,
          type: "mad-dash",
          completed: true,
          route,
          timeMs: finalMs,
          scans: route.length,
          hintsUsed,
          hintPenaltyPct: route.length > 0 ? Math.round((hintsUsed / route.length) * 50) : 0,
        });
        return true;
      }

      setPhase("summary");
      return true;
    }

    return true; // consumed a correct step
  };

  // Install short-circuit scan handler for StudentApp
  const installedHookRef = useRef(null);
  useEffect(() => {
    const hook = (raw) => handleScanValue(raw);
    installedHookRef.current = hook;
    window.__curriculateTaskScanHandler = hook;
    return () => {
      if (window.__curriculateTaskScanHandler === installedHookRef.current) {
        window.__curriculateTaskScanHandler = null;
      }
      installedHookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, disabled, scanIdx, route, palette]);

  // Listen to StudentApp's normalized mad dash event
  useEffect(() => {
    const onMadDashScan = (ev) => {
      const d = ev?.detail || {};
      handleScanValue(d?.color || d?.stationColor || d?.stationId || d);
    };
    window.addEventListener("curriculate:madDashScan", onMadDashScan);
    return () => window.removeEventListener("curriculate:madDashScan", onMadDashScan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, disabled, scanIdx, route, palette]);

  // Reveal timer
  const revealTimerRef = useRef(null);
  useEffect(() => {
    if (phase !== "reveal" || disabled) return;
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = window.setTimeout(() => setPhase("go"), Math.max(0, revealMs));
    return () => {
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    };
  }, [phase, revealMs, disabled]);

  const startRun = async () => {
    if (disabled) return;
    if (presenter?.showCountdown) {
      try {
        await presenter.showCountdown({
          title: "Mad Dash",
          seconds: 3,
          subtext: "1–2–3… GO!",
        });
      } catch {}
    }
    setPhase("reveal");
  };

  const beginScanNow = () => {
    setScanIdx(0);
    setTimerMs(0);
    // Don't start the clock yet — it starts on the FIRST successful scan
    startAtRef.current = null;
    setPhase("scan");
  };

  const nextRunner = () => {
    const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
    const n = names.length > 0 ? names.length : 4;
    setRunnerIdx((i) => (i + 1) % n);
    setScanIdx(0);
    setTimerMs(0);
    setHintsUsed(0);
    startAtRef.current = null;
    setPhase("lobby");
  };

  const finishAndSubmit = () => {
    if (disabled) return;
    const best = bestRun;
    const payload = {
      ok: true,
      type: "mad-dash",
      completed: true,
      route,
      scans: route.length,

      intraTeam: true,
      runs,
      bestTimeMs: best?.timeMs ?? null,
      bestRunner: best?.runnerName ?? null,
      hintsUsed,
      hintPenaltyPct: route.length > 0 ? Math.round((hintsUsed / route.length) * 50) : 0,

      roomCode: roomCode || task?.roomCode || null,
      teamId: teamId || task?.teamId || null,
      teamName: teamName || task?.teamName || null,
    };

    onSubmit?.(payload);
    setPhase("done");
  };

  const titleBadge = (text) => (
    <span className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 font-extrabold text-slate-800 text-sm">
      {text}
    </span>
  );

  return (
    <div className="w-full min-h-[560px] rounded-2xl overflow-hidden border border-slate-200 bg-white">
      <div className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-4xl font-black">Mad Dash</div>
            <div className="text-slate-600 mt-1">
              Memorize a route of {route.length} coloured stations, then run
              and scan them <em>in the same order</em>. Wrong scan ⇒ a
              fresh route is generated and you start over (timer keeps
              running). Fastest run wins.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {titleBadge(`${route.length} scans`)}
            {intraTeamEnabled ? titleBadge("Intra-team turns") : titleBadge("Single run")}
          </div>
        </div>

        {phase === "lobby" && (
          <div className="mt-6 grid gap-4" style={{ maxWidth: 760 }}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="font-extrabold text-xl">Runner up next</div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="text-slate-700 font-bold">Runner:</div>
                <select
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white font-extrabold"
                  value={runnerIdx}
                  onChange={(e) => setRunnerIdx(Number(e.target.value) || 0)}
                  disabled={disabled}
                >
                  {(() => {
                    const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
                    const n = names.length > 0 ? names.length : 4;
                    return new Array(n).fill(0).map((_, i) => (
                      <option key={i} value={i}>
                        {pickRunnerLabel(memberNames, i)}
                      </option>
                    ));
                  })()}
                </select>

                {bestRun ? (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {titleBadge(`Best: ${bestRun.runnerName} • ${fmtMs(bestRun.timeMs)}`)}
                  </div>
                ) : null}
              </div>

              {runs.length > 0 && (
                <div className="mt-4 text-slate-700">
                  <div className="font-extrabold mb-2">Runs so far</div>
                  <div className="grid gap-2">
                    {runs.slice(-6).map((r, idx) => (
                      <div
                        key={`${r.atIso}:${idx}`}
                        className="flex items-center justify-between gap-3 px-4 py-2 rounded-xl border border-slate-200 bg-white"
                      >
                        <div className="font-extrabold text-slate-800">{r.runnerName}</div>
                        <div className="font-black text-amber-700">{fmtMs(r.timeMs)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  className="px-5 py-3 rounded-full bg-emerald-600 text-white font-black disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => setPhase("instructions")}
                >
                  Start this run
                </button>

                {runs.length > 0 && (
                  <button
                    className="px-5 py-3 rounded-full bg-slate-900 text-white font-black disabled:opacity-50"
                    disabled={disabled}
                    onClick={finishAndSubmit}
                    title="Submit best time + runs"
                  >
                    Finish & submit
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {phase === "instructions" && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-2">
              {intraTeamEnabled && (
                <span className="px-3 py-2 rounded-full bg-indigo-50 border border-indigo-200 font-extrabold text-indigo-800">
                  Runner: {pickRunnerLabel(memberNames, runnerIdx)}
                </span>
              )}
              <span className="px-3 py-2 rounded-full bg-slate-50 border border-slate-200 font-bold text-slate-700">
                Route is {route.length} stations long
              </span>
            </div>

            {/* Step-by-step explainer so first-time players actually
                understand what's about to happen. */}
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="font-extrabold text-slate-800 mb-2">How this works</div>
              <ol className="list-decimal pl-5 space-y-1 text-slate-700">
                <li>Tap <strong>Show route</strong>.</li>
                <li>You'll see a row of {route.length} coloured blocks — that's your route, in order. Memorize it. (Hidden after a few seconds.)</li>
                <li>A 1–2–3 GO video plays.</li>
                <li>
                  {practiceMode
                    ? "Tap the colour buttons in the same order you saw."
                    : "Run to each coloured station and scan its QR code in the same order you saw."}
                </li>
                <li>Wrong scan ⇒ a <strong>brand-new route</strong> is dealt and you start over (clock keeps ticking). Fastest run wins.</li>
              </ol>
              {practiceMode && (
                <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <strong>Practice mode:</strong> no real stations, so we'll show big colour buttons you can tap to simulate the scan.
                </div>
              )}
            </div>

            <div className="mt-5">
              <button
                className="px-5 py-3 rounded-full bg-emerald-600 text-white font-black disabled:opacity-50"
                disabled={disabled}
                onClick={startRun}
              >
                Show route
              </button>
            </div>
          </div>
        )}

        {phase === "reveal" && (
          <div className="mt-6">
            <div className="font-extrabold text-2xl">Memorize the route, in order:</div>
            <div
              className="mt-4 flex flex-wrap gap-3 p-4 rounded-2xl"
              style={{
                background:
                  "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(236,72,153,0.08))",
                border: "1px solid #e2e8f0",
              }}
            >
              {route.map((c, i) => (
                <ColorBlock key={i} index={i} color={c} size="xl" />
              ))}
            </div>
            <div className="mt-4 text-slate-600">
              Hides in {Math.round(revealMs / 1000)}s… Need a refresher mid-run? Tap <strong>Hint</strong> (small points cost).
            </div>
          </div>
        )}

        {phase === "go" && (
          <div className="mt-6">
            <video
              src={goVideoSrc}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", maxWidth: 520, borderRadius: 14, background: "#000" }}
              onEnded={beginScanNow}
              onError={beginScanNow}
            />
            <div className="mt-2 text-slate-600">Get ready — timer starts on your first scan!</div>
          </div>
        )}

        {phase === "scan" && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-2xl font-black">
                Time: <span className="text-amber-600">{fmtMs(timerMs)}</span>
              </div>
              <div className="px-3 py-2 rounded-full bg-slate-50 border border-slate-200 font-extrabold text-slate-700">
                Progress: {scanIdx}/{route.length}
              </div>
            </div>

            {/* Big colour target so the player sees what to scan next.
                Done blocks show muted to confirm progress; remaining blocks
                show a question mark to remind the player they need to recall
                the route from memory unless they've used a hint. */}
            <div className="mt-4">
              <div className="font-extrabold text-slate-700 mb-2">
                {scanIdx >= route.length ? "All done!" : `Scan #${scanIdx + 1}`}:
              </div>
              <div
                className="flex items-center gap-3 p-4 rounded-2xl"
                style={{
                  background: errorFlash ? "rgba(239,68,68,0.1)" : "#f8fafc",
                  border: errorFlash
                    ? "2px solid #ef4444"
                    : "1px solid #e2e8f0",
                  transition: "background 0.15s, border-color 0.15s",
                  minHeight: 120,
                }}
              >
                {/* Done so far (muted) */}
                {route.slice(0, scanIdx).map((c, i) => (
                  <ColorBlock key={`done-${i}`} index={i} color={c} size="md" muted />
                ))}
                {/* Current target — full size + glow */}
                {scanIdx < route.length && (
                  <div style={{ animation: "mdPulse 1.4s ease-in-out infinite" }}>
                    <ColorBlock
                      index={scanIdx}
                      color={route[scanIdx]}
                      size="xl"
                    />
                  </div>
                )}
                {/* Remaining (locked, ?-only) */}
                {route.slice(scanIdx + 1).map((_, i) => (
                  <div
                    key={`rest-${i}`}
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      background: "#e2e8f0",
                      color: "#94a3b8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 900,
                      fontSize: 22,
                    }}
                    aria-label={`Step ${scanIdx + 2 + i}: locked`}
                  >
                    ?
                  </div>
                ))}
              </div>
              <style>{`
                @keyframes mdPulse {
                  0%   { transform: scale(1);    filter: drop-shadow(0 0 0 rgba(34,197,94,0)); }
                  50%  { transform: scale(1.05); filter: drop-shadow(0 0 18px rgba(34,197,94,0.6)); }
                  100% { transform: scale(1);    filter: drop-shadow(0 0 0 rgba(34,197,94,0)); }
                }
              `}</style>
            </div>

            {/* Progressive hints: show revealed colours as colour blocks */}
            {hintsUsed > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <span className="text-slate-500 font-bold text-sm">Hints:</span>
                {route.slice(0, hintsUsed).map((c, i) => (
                  <ColorBlock key={i} index={i} color={c} size="md" />
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {hintsUsed < route.length && (
                <button
                  className="px-4 py-2 rounded-full bg-amber-500 text-white font-bold text-sm"
                  onClick={() => setHintsUsed((h) => h + 1)}
                >
                  Hint ({hintsUsed + 1}/{route.length}) — costs points
                </button>
              )}
              {hintsUsed > 0 && (
                <span className="text-amber-700 font-bold text-sm">
                  −{Math.round((hintsUsed / route.length) * 50)}% points
                </span>
              )}
            </div>

            {/* Practice-mode tappable colour buttons (no real camera).
                Tapping fires the same handleScanValue() used by the
                physical scanner.  Tester can complete the task without
                hardware and we still validate the order. */}
            {practiceMode && (
              <div className="mt-4 p-4 rounded-2xl bg-slate-900">
                <div className="text-white text-sm font-extrabold uppercase tracking-wide mb-3 opacity-80">
                  Practice mode — tap a colour to scan
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 10,
                  }}
                >
                  {practiceButtonOrder.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleScanValue(c)}
                      aria-label={`Tap to simulate scanning ${c}`}
                      style={{
                        background: getColorCss(c),
                        color: getColorInk(c),
                        border: "3px solid rgba(255,255,255,0.85)",
                        borderRadius: 14,
                        height: 56,
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: "0.95rem",
                        textShadow:
                          c === "Yellow" ? "none" : "0 2px 6px rgba(0,0,0,0.45)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                        letterSpacing: 0.5,
                      }}
                    >
                      {c.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div
              className={`mt-3 p-4 rounded-2xl border ${
                errorFlash ? "border-red-400 bg-red-50" : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="text-slate-700 font-bold">
                {practiceMode
                  ? "Tap the colour buttons above in the right order."
                  : "Use the on-screen scanner."}
              </div>
              <div className="text-slate-600 text-sm mt-1">
                {!startAtRef.current && scanIdx === 0
                  ? "Timer starts on your first scan."
                  : "Wrong scan ⇒ a NEW route is dealt — start over (clock keeps running)."}
              </div>
            </div>
          </div>
        )}

        {phase === "summary" && intraTeamEnabled && (
          <div className="mt-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="font-extrabold text-xl">Run complete</div>
              {bestRun && (
                <div className="mt-2 text-slate-700 font-bold">
                  Best so far: <span className="text-amber-700">{bestRun.runnerName}</span> —{" "}
                  <span className="text-amber-700">{fmtMs(bestRun.timeMs)}</span>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  className="px-5 py-3 rounded-full bg-emerald-600 text-white font-black disabled:opacity-50"
                  disabled={disabled}
                  onClick={nextRunner}
                >
                  Next runner
                </button>

                <button
                  className="px-5 py-3 rounded-full bg-slate-900 text-white font-black disabled:opacity-50"
                  disabled={disabled}
                  onClick={finishAndSubmit}
                >
                  Finish & submit
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="mt-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="font-extrabold text-xl">Submitted!</div>
              <div className="text-slate-600 mt-1">Waiting for next task…</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
