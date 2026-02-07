// MadDashTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_COLORS = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Teal", "Pink"];

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
}) {
  const palette = useMemo(() => {
    const p =
      (Array.isArray(task?.availableColors) && task.availableColors) ||
      (Array.isArray(task?.stationColors) && task.stationColors) ||
      DEFAULT_COLORS;
    return p.map(normalizeColorName).filter(Boolean);
  }, [task]);

  const route = useMemo(() => pickGivenRoute(task, palette), [task, palette]);

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
      setScanIdx(0);
      return false;
    }

    const nextIdx = scanIdx + 1;
    setScanIdx(nextIdx);

    if (nextIdx >= route.length) {
      const finalMs = performance.now() - (startAtRef.current || performance.now());

      const entry = {
        runnerIdx,
        runnerName: pickRunnerLabel(memberNames, runnerIdx),
        timeMs: finalMs,
        scans: route.length,
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

  // Listen to StudentApp’s normalized mad dash event
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
    startAtRef.current = performance.now();
    setPhase("scan");
  };

  const nextRunner = () => {
    const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
    const n = names.length > 0 ? names.length : 4;
    setRunnerIdx((i) => (i + 1) % n);
    setScanIdx(0);
    setTimerMs(0);
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
              Scan the colour route in order using the on-screen scanner. Wrong scan resets.
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
            <div className="font-extrabold text-xl">Memorize the route:</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {route.map((c, i) => (
                <span key={i} className="px-3 py-2 rounded-full bg-slate-100 border border-slate-200 font-black">
                  {i + 1}. {c}
                </span>
              ))}
            </div>
            <div className="mt-4 text-slate-600">Starting in {Math.round(revealMs / 1000)}s…</div>
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
            <div className="mt-2 text-slate-600">Timer starts when the video finishes.</div>
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

            <div className="mt-4 font-extrabold text-lg">
              Scan next: <span className="text-emerald-700">{route[scanIdx] || "—"}</span>
            </div>

            <div
              className={`mt-4 p-4 rounded-2xl border ${
                errorFlash ? "border-red-400 bg-red-50" : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="text-slate-700 font-bold">Use the on-screen scanner.</div>
              <div className="text-slate-600 text-sm mt-1">Wrong scan resets the route.</div>
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
