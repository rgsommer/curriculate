import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Lottie from "lottie-react";

/**
 * Motion Mission (MOTION_MISSION)
 * MULTI-PLAYER PASS-AROUND:
 * - Each player grabs the device, does the motion, tries to hit the target bar.
 * - Bonus points if a player beats the previous player's count.
 * - Per-player 10-second turn with countdown.
 * - Final scoreboard at the end.
 *
 * Lottie JSON is loaded at runtime from /public/animations/*.json
 */

const ACTIVITY_CONFIG = {
  "Jump 10 times": { type: "jump", target: 10, emoji: "🦘", file: "jump.json" },
  "Do 8 squats": { type: "squat", target: 8, emoji: "🏋️‍♂️", file: "squat.json" },
  "Run on the spot": { type: "run", target: 15, emoji: "🏃‍♂️", file: "run.json" },
  "Dance wildly!": { type: "dance", target: 12, emoji: "💃", file: "dance.json" },
  "Spin around 5 times": { type: "spin", target: 5, emoji: "🌀", file: "spin.json" },
};

const TURN_SECONDS = 10; // each player gets 10 seconds

/** Render activity text with line breaks for numbered steps */
function FormattedActivity({ text, className, style }) {
  const raw = String(text || "").trim();
  const hasNumbered = /\d+[\)\.]\s/.test(raw);
  if (hasNumbered) {
    const lines = raw
      .replace(/(\d+[\)\.]\s)/g, "\n$1")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      return (
        <div className={className} style={{ ...style, textAlign: "left" }}>
          {lines.map((line, i) => (
            <div key={i} style={{ marginBottom: i < lines.length - 1 ? 8 : 0 }}>{line}</div>
          ))}
        </div>
      );
    }
  }
  return <div className={className} style={style}>{raw}</div>;
}

/** Points for a single turn */
function calcTurnPoints(count, target, bestPrev) {
  if (count <= 0) return 0;
  const ratio = count / Math.max(target, 1);
  let pts;
  if (ratio >= 1.5) pts = 15;
  else if (ratio >= 1) pts = Math.round(10 + (ratio - 1) * 10); // 10–15
  else pts = Math.max(1, Math.round(ratio * 10)); // 1–9

  // Beat-the-previous bonus: +3 if they exceeded the best so far
  if (bestPrev > 0 && count > bestPrev) pts += 3;
  return Math.min(pts, 18); // hard cap
}

export default function MotionMissionTask({
  task,
  onSubmit,
  disabled,
  presenter,
  remainingMs,
  // 🦘 Jump Higher superpower — when true, lower the accelerometer
  // shake threshold and the debounce so smaller/faster movements
  // count. Applies for the whole task; consumed at mount.
  jumpHigherActive = false,
  onJumpHigherConsumed,
}) {
  const activityPrompt = task?.prompt || task?.activity || "Jump 10 times";
  const activityName = useMemo(() => String(activityPrompt || "").trim() || "Jump 10 times", [activityPrompt]);

  const config = ACTIVITY_CONFIG[activityName] || null;
  const hasConfiguredActivity = !!ACTIVITY_CONFIG[activityName];
  const emoji = config?.emoji || "🏃‍♂️";
  const target = config?.target || 10;
  const file = config?.file || null;

  const [animData, setAnimData] = useState(null);

  // Phases: demo → waiting → countdown → active → turnResult → done
  const [phase, setPhase] = useState("demo");
  const [countdown, setCountdown] = useState(3);

  // Multi-player state
  const [players, setPlayers] = useState([]); // [{ count, points, beatPrev }]
  const currentIdx = players.length; // next player index (0-based)
  const bestCount = useMemo(() => Math.max(0, ...players.map(p => p.count)), [players]);

  // Current turn motion
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  useEffect(() => { countRef.current = count; }, [count]);
  const [noMotionSupport, setNoMotionSupport] = useState(false);
  const lastShakeTime = useRef(0);
  // 🦘 Jump Higher — sensitivity boost. Threshold drops by ~25% and
  // debounce shortens so smaller/faster movements register as counts.
  const shakeThreshold = jumpHigherActive ? 1.4 : 1.9;
  const minInterval = jumpHigherActive ? 280 : 380;
  const jumpHigherConsumedRef = useRef(false);
  useEffect(() => {
    if (jumpHigherActive && !jumpHigherConsumedRef.current) {
      jumpHigherConsumedRef.current = true;
      if (typeof onJumpHigherConsumed === "function") onJumpHigherConsumed();
    }
  }, [jumpHigherActive, onJumpHigherConsumed]);

  // Per-turn timer
  const [turnTime, setTurnTime] = useState(TURN_SECONDS);
  const turnTimerRef = useRef(null);

  // Last turn result (for display)
  const [lastResult, setLastResult] = useState(null); // { count, points, beatPrev, playerNum }

  const [submitted, setSubmitted] = useState(false);

  // "SWITCH!" popup — fires at evenly spaced intervals if the prompt mentions switching
  const hasSwitch = /switch/i.test(activityName);
  const [showSwitch, setShowSwitch] = useState(false);
  const [switchNumber, setSwitchNumber] = useState(0);

  const totalSwitches = useMemo(() => {
    if (!hasSwitch) return 0;
    const text = activityName.toLowerCase();
    const twiceMatch = /repeat.*twice|twice.*repeat/i.test(text);
    if (twiceMatch) return 3;
    const timesMatch = text.match(/repeat.*?(\d+)\s*time/i);
    if (timesMatch) return 1 + parseInt(timesMatch[1], 10);
    const thriceMatch = /repeat.*thrice|three\s*times/i.test(text);
    if (thriceMatch) return 4;
    return 1;
  }, [activityName, hasSwitch]);

  const switchesFiredRef = useRef(0);
  const switchTimerRef = useRef(null);
  const initialRemainingRef = useRef(null);

  // Load Lottie
  useEffect(() => {
    let cancelled = false;
    setAnimData(null);
    if (!file) return;
    fetch(`/animations/${file}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setAnimData(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [file]);

  // Reset on task change
  useEffect(() => {
    setPhase("demo");
    setCountdown(3);
    setCount(0);
    setNoMotionSupport(false);
    setPlayers([]);
    setLastResult(null);
    setSubmitted(false);
    setShowSwitch(false);
    setSwitchNumber(0);
    setTurnTime(TURN_SECONDS);
    switchesFiredRef.current = 0;
    if (switchTimerRef.current) { clearTimeout(switchTimerRef.current); switchTimerRef.current = null; }
    if (turnTimerRef.current) { clearInterval(turnTimerRef.current); turnTimerRef.current = null; }
    initialRemainingRef.current = null;
  }, [task?.taskType, task?.title, task?.prompt]);

  // SWITCH popup logic (unchanged)
  useEffect(() => {
    if (phase !== "active" || !hasSwitch || totalSwitches === 0) return;
    if (initialRemainingRef.current === null && typeof remainingMs === "number" && remainingMs > 0) {
      initialRemainingRef.current = remainingMs;
    }
    const init = initialRemainingRef.current;
    if (!init) return;
    const fired = switchesFiredRef.current;
    if (fired >= totalSwitches) return;
    const segment = init / (totalSwitches + 1);
    const nextThreshold = init - ((fired + 1) * segment);
    if (typeof remainingMs === "number" && remainingMs <= nextThreshold) {
      switchesFiredRef.current = fired + 1;
      setSwitchNumber(fired + 1);
      setShowSwitch(true);
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
      switchTimerRef.current = setTimeout(() => {
        setShowSwitch(false);
        switchTimerRef.current = null;
      }, 10000);
    }
  }, [phase, remainingMs, hasSwitch, totalSwitches]);

  // Countdown flow (per-player)
  useEffect(() => {
    if (phase !== "countdown") return;
    if (disabled) return;
    setCountdown(3);
    const id = setInterval(() => {
      setCountdown((c) => {
        const next = c - 1;
        if (next <= 0) {
          clearInterval(id);
          setPhase("active");
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, disabled]);

  // Per-turn timer during ACTIVE
  useEffect(() => {
    if (phase !== "active") return;
    setTurnTime(TURN_SECONDS);
    const id = setInterval(() => {
      setTurnTime(prev => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    turnTimerRef.current = id;
    return () => { clearInterval(id); turnTimerRef.current = null; };
  }, [phase]);

  // Auto-end turn when per-turn timer hits 0
  useEffect(() => {
    if (phase === "active" && turnTime <= 0) {
      endTurn();
    }
  }, [phase, turnTime]);

  // Motion listener during ACTIVE
  useEffect(() => {
    if (phase !== "active") return;
    let cancelled = false;

    const handleMotion = (event) => {
      if (cancelled || disabled) return;
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;
      const ax = typeof acc.x === "number" ? acc.x : 0;
      const ay = typeof acc.y === "number" ? acc.y : 0;
      const az = typeof acc.z === "number" ? acc.z : 0;
      const total = Math.abs(ax) + Math.abs(ay) + Math.abs(az);
      const now = Date.now();
      if (total > shakeThreshold && now - lastShakeTime.current > minInterval) {
        lastShakeTime.current = now;
        setCount(prev => prev + 1); // no cap — let them exceed target
      }
    };

    const requestMotionPermission = async () => {
      try {
        if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
          const response = await DeviceMotionEvent.requestPermission();
          if (response === "granted") {
            window.addEventListener("devicemotion", handleMotion);
          } else {
            setNoMotionSupport(true);
          }
        } else if (typeof window !== "undefined" && window.DeviceMotionEvent) {
          window.addEventListener("devicemotion", handleMotion);
        } else {
          setNoMotionSupport(true);
        }
      } catch (err) {
        setNoMotionSupport(true);
      }
    };

    requestMotionPermission();
    return () => {
      cancelled = true;
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [phase, disabled]);

  // End the current player's turn — uses refs to avoid stale closures
  const endTurn = useCallback(() => {
    if (phase !== "active") return;

    const turnCount = countRef.current;
    const beatPrev = bestCount > 0 && turnCount > bestCount;
    const pts = noMotionSupport ? 10 : calcTurnPoints(turnCount, target, bestCount);
    const playerNum = currentIdx + 1;

    const result = { count: turnCount, points: pts, beatPrev, playerNum };
    setLastResult(result);
    setPlayers(prev => [...prev, result]);
    setPhase("turnResult");

    if (turnTimerRef.current) { clearInterval(turnTimerRef.current); turnTimerRef.current = null; }
  }, [phase, bestCount, target, currentIdx, noMotionSupport]);

  // Progress for current turn
  const progressPct = Math.min((count / Math.max(target, 1)) * 100, 150);
  const currentPoints = useMemo(() => {
    if (noMotionSupport) return 10;
    return calcTurnPoints(count, target, bestCount);
  }, [count, target, bestCount, noMotionSupport]);

  // Total points across all players
  const totalPoints = useMemo(() => players.reduce((s, p) => s + p.points, 0), [players]);

  // Submit final result
  const submitFinal = () => {
    if (disabled || submitted) return;
    setSubmitted(true);
    setPhase("done");
    try { new Audio("/sounds/victory.mp3").play(); } catch (e) {}
    onSubmit?.({
      completed: true,
      points: totalPoints,
      activity: activityName,
      players: players.map(p => ({ count: p.count, points: p.points, beatPrev: p.beatPrev })),
      target,
    });
  };

  // Start next player's turn
  const startNextTurn = () => {
    setCount(0);
    lastShakeTime.current = 0;
    if (presenter?.showCountdown) {
      presenter.showCountdown({
        title: `Player ${currentIdx + 1}, get ready!`,
        seconds: 3,
        subtext: "1-2-3 GO!",
        mode: "video",
        videoSrc: "/animations/categories/1-2-3-go.mp4",
      }).catch(() => {}).then(() => setPhase("active"));
      return;
    }
    setPhase("countdown");
  };

  // Check if overall timer expired
  const overallExpired = typeof remainingMs === "number" && remainingMs <= 0;

  return (
    <div className="relative flex flex-col items-center h-full p-6 md:p-8 bg-gradient-to-br from-orange-600 via-red-600 to-pink-700 text-white overflow-hidden">
      {jumpHigherActive && (
        <div
          data-testid="jump-higher-boost"
          style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 14px",
            borderRadius: 999,
            background: "linear-gradient(135deg, #fde68a, #f59e0b)",
            color: "#78350f",
            fontWeight: 900,
            fontSize: "0.8rem",
            letterSpacing: 0.3,
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            zIndex: 20,
          }}
        >
          🦘 Jump Higher active — smaller moves count!
        </div>
      )}
      <h1 className="text-4xl md:text-6xl font-black drop-shadow-2xl z-10 mt-2 mb-3 text-center">
        MOTION MISSION!
      </h1>

      {/* ═══════ DEMO PHASE ═══════ */}
      {phase === "demo" && (
        <div className="text-center w-full max-w-4xl flex-1 flex flex-col items-center justify-center">
          {hasConfiguredActivity && (
            <>
              <div className="text-2xl md:text-4xl font-black mb-3 drop-shadow-2xl">
                Watch and Copy
              </div>
              <div className="mx-auto w-[60vw] max-w-sm md:max-w-md flex items-center justify-center rounded-3xl bg-black/20 border border-white/20 shadow-2xl" style={{ maxHeight: "40vh" }}>
                {animData ? (
                  <Lottie animationData={animData} loop autoplay style={{ width: "100%", height: "100%", maxHeight: "40vh" }} />
                ) : (
                  <div className="text-7xl md:text-8xl animate-bounce drop-shadow-2xl">{emoji}</div>
                )}
              </div>
            </>
          )}

          <FormattedActivity text={activityName} className="mt-4 px-4 text-xl md:text-3xl font-black text-yellow-200 drop-shadow-2xl leading-tight" style={{ maxWidth: "90vw" }} />

          <div className="mt-5 text-base md:text-lg font-bold opacity-80 max-w-md px-4">
            Each player grabs the device and tries to hit the motion bar.
            Beat the last player for <span className="text-yellow-200">bonus points!</span>
          </div>

          <button
            type="button"
            disabled={disabled}
            onClick={() => startNextTurn()}
            className={[
              "mt-5 px-8 py-4 rounded-3xl text-2xl md:text-3xl font-black shadow-2xl border",
              disabled ? "bg-white/20 border-white/10 opacity-60" : "bg-yellow-400 text-black border-yellow-300 hover:scale-[1.02] transition",
            ].join(" ")}
          >
            Player 1 — Go!
          </button>
        </div>
      )}

      {/* ═══════ COUNTDOWN ═══════ */}
      {phase === "countdown" && !(presenter?.showCountdown) && (
        <div className="text-center flex-1 flex flex-col items-center justify-center">
          <div className="text-2xl md:text-3xl font-extrabold opacity-90">
            Player {currentIdx + 1}, get ready!
          </div>
          <div className="mt-4 text-7xl md:text-9xl font-black animate-bounce drop-shadow-2xl">
            {countdown}
          </div>
          <div className="mt-2 text-5xl md:text-7xl font-black text-yellow-200 drop-shadow-2xl">
            GO!
          </div>
        </div>
      )}

      {/* ═══════ WAITING (between turns) ═══════ */}
      {phase === "waiting" && (
        <div className="text-center flex-1 flex flex-col items-center justify-center">
          <div className="text-6xl md:text-8xl mb-4">{emoji}</div>
          <div className="text-2xl md:text-4xl font-black mb-3">
            Pass the device!
          </div>
          <div className="text-lg md:text-xl font-bold opacity-80 mb-6">
            Player {currentIdx + 1}, grab it and hit <span className="text-yellow-200">Go!</span>
          </div>

          {bestCount > 0 && (
            <div className="mb-4 px-5 py-3 rounded-2xl bg-white/10 border border-white/15 text-base md:text-lg font-bold">
              Score to beat: <span className="text-yellow-200">{bestCount}</span> motions
            </div>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={() => startNextTurn()}
            className="px-8 py-4 rounded-3xl text-2xl md:text-3xl font-black shadow-2xl border bg-yellow-400 text-black border-yellow-300 hover:scale-[1.02] transition"
          >
            I'm ready — Go!
          </button>
        </div>
      )}

      {/* ═══════ ACTIVE TURN ═══════ */}
      {phase === "active" && (
        <div className="w-full max-w-5xl flex flex-col items-center flex-1 justify-center relative">
          {/* SWITCH! overlay */}
          {showSwitch && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 rounded-3xl animate-pulse">
              <div className="text-center">
                <div className="text-7xl md:text-8xl font-black text-yellow-300 drop-shadow-2xl">SWITCH!</div>
                <div className="mt-3 text-xl md:text-2xl font-bold text-white drop-shadow-lg">Change activity now!</div>
                {totalSwitches > 1 && (
                  <div className="mt-2 text-lg font-bold text-white/70">Switch {switchNumber} of {totalSwitches}</div>
                )}
              </div>
            </div>
          )}

          {/* Player + turn timer */}
          <div className="flex items-center gap-4 mb-2">
            <div className="text-xl md:text-2xl font-black">Player {currentIdx + 1}</div>
            <div className={[
              "px-4 py-1 rounded-full text-xl md:text-2xl font-black border",
              turnTime <= 3 ? "bg-red-500/60 border-red-300 animate-pulse" : "bg-white/10 border-white/20",
            ].join(" ")}>
              {turnTime}s
            </div>
          </div>

          <FormattedActivity text={activityName} className="text-xl md:text-2xl font-black mb-2 px-4 text-center leading-tight" />

          {hasConfiguredActivity && (
            <div className="w-[50vw] max-w-xs md:max-w-sm flex items-center justify-center rounded-3xl bg-black/20 border border-white/20 shadow-2xl" style={{ maxHeight: "30vh" }}>
              {animData ? (
                <Lottie animationData={animData} loop autoplay style={{ width: "100%", height: "100%", maxHeight: "30vh" }} />
              ) : (
                <div className="text-6xl md:text-7xl animate-bounce drop-shadow-2xl">{emoji}</div>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-col items-center gap-3 w-full max-w-md px-4">
            {/* Motion progress bar */}
            {!noMotionSupport && (
              <div className="w-full">
                <div className="text-center mb-1 text-base md:text-lg font-extrabold">
                  <span className="text-yellow-200">{currentPoints}</span>
                  <span className="opacity-80"> pts</span>
                </div>
                {/* Bar container — represents 0% to 150% of target */}
                <div className="relative w-full h-8 rounded-full bg-black/30 border border-white/20 overflow-hidden">
                  {/* Filled bar */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                    style={{
                      width: `${(progressPct / 150) * 100}%`,
                      background: progressPct >= 100
                        ? "linear-gradient(90deg, #22c55e, #4ade80)"
                        : progressPct >= 60
                          ? "linear-gradient(90deg, #eab308, #facc15)"
                          : "linear-gradient(90deg, #ef4444, #f87171)",
                    }}
                  />
                  {/* Target line at 66.7% */}
                  <div
                    className="absolute top-0 bottom-0 w-[3px] bg-white shadow-lg z-10"
                    style={{ left: "66.7%" }}
                  >
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold whitespace-nowrap text-white drop-shadow">
                      Goal: {target}
                    </div>
                  </div>
                  {/* Best-so-far marker (if previous players exist) */}
                  {bestCount > 0 && (
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-yellow-300/70 z-10"
                      style={{ left: `${Math.min((bestCount / Math.max(target, 1) / 1.5) * 100, 100)}%` }}
                    >
                      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-bold whitespace-nowrap text-yellow-300 drop-shadow">
                        Best: {bestCount}
                      </div>
                    </div>
                  )}
                  {/* Bonus zone label */}
                  {progressPct <= 100 && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-white/40">
                      BONUS
                    </div>
                  )}
                </div>
                <div className="text-center mt-1 text-sm font-bold opacity-80">
                  {count} motions
                  {count >= target && count > 0 && <span className="text-green-300 ml-1">— Target reached!</span>}
                  {bestCount > 0 && count > bestCount && <span className="text-yellow-200 ml-1"> NEW BEST!</span>}
                </div>
              </div>
            )}

            {/* No motion support — explain the real-classroom flow,
                then offer a Done button so the player isn't stuck.
                Tester (laptop): "a laptop does not have motion sensing
                ... assure me that on a mobile device it would work,
                for each player". */}
            {noMotionSupport && (
              <>
                <div
                  className="w-full max-w-sm rounded-2xl border border-yellow-300/40 bg-yellow-300/10 px-4 py-3 text-sm leading-snug text-yellow-100 mb-1"
                  role="note"
                >
                  📱 <b>No motion sensor on this device.</b> On a phone or
                  tablet (which every player will be using in a real
                  classroom), each player's device counts jumps, shakes,
                  and movements live via the accelerometer — and scores
                  them individually. For this practice run, tap{" "}
                  <b>Done</b> to finish your turn.
                </div>
                <button
                  type="button"
                  onClick={endTurn}
                  className="px-8 py-3 rounded-3xl text-2xl font-black shadow-2xl border bg-green-400 text-black border-green-200 hover:scale-[1.02] transition"
                >
                  Done!
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TURN RESULT ═══════ */}
      {phase === "turnResult" && lastResult && (
        <div className="text-center flex-1 flex flex-col items-center justify-center w-full max-w-md">
          <div className="text-6xl md:text-7xl font-black text-yellow-200 drop-shadow-2xl mb-2">
            {lastResult.beatPrev ? "NEW BEST!" : lastResult.count >= target ? "NICE!" : "GOOD TRY!"}
          </div>

          <div className="text-2xl md:text-3xl font-extrabold mb-1">
            Player {lastResult.playerNum}
          </div>

          <div className="flex items-center gap-4 mb-3">
            <div className="px-4 py-2 rounded-2xl bg-white/10 border border-white/15 text-lg font-bold">
              {lastResult.count} motions
            </div>
            <div className="px-4 py-2 rounded-2xl bg-yellow-400/20 border border-yellow-300/30 text-lg font-bold">
              +{lastResult.points} pts
              {lastResult.beatPrev && <span className="text-yellow-200 text-sm ml-1">(+3 bonus!)</span>}
            </div>
          </div>

          {/* Mini scoreboard */}
          {players.length > 1 && (
            <div className="w-full mb-4 px-2">
              <div className="text-sm font-bold opacity-60 mb-1">Scoreboard</div>
              <div className="flex flex-col gap-1">
                {players.map((p, i) => (
                  <div
                    key={i}
                    className={[
                      "flex items-center justify-between px-3 py-1 rounded-xl text-sm font-bold",
                      i === players.length - 1 ? "bg-white/15 border border-white/20" : "bg-white/5",
                    ].join(" ")}
                  >
                    <span>Player {p.playerNum}</span>
                    <span className="flex items-center gap-3">
                      <span className="opacity-70">{p.count} motions</span>
                      <span className="text-yellow-200">{p.points} pts</span>
                      {p.beatPrev && <span className="text-xs">🔥</span>}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-right text-sm font-bold text-yellow-200">
                Total: {totalPoints} pts
              </div>
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-3 items-center">
            {/* Next player — only if overall timer hasn't expired */}
            {!overallExpired && (
              <button
                type="button"
                onClick={() => setPhase("waiting")}
                className="px-7 py-3 rounded-3xl text-xl md:text-2xl font-black shadow-2xl border bg-yellow-400 text-black border-yellow-300 hover:scale-[1.02] transition"
              >
                Next Player
              </button>
            )}
            {/* Finish — always available if at least one player went */}
            <button
              type="button"
              disabled={disabled || submitted}
              onClick={submitFinal}
              className={[
                "px-7 py-3 rounded-3xl text-xl md:text-2xl font-black shadow-2xl border transition",
                overallExpired
                  ? "bg-green-400 text-black border-green-200 hover:scale-[1.02] animate-pulse"
                  : "bg-white/15 border-white/20 hover:bg-white/25",
              ].join(" ")}
            >
              {overallExpired ? "We're done!" : "All done"}
            </button>
          </div>
        </div>
      )}

      {/* ═══════ FINAL DONE ═══════ */}
      {phase === "done" && (
        <div className="text-center flex-1 flex flex-col items-center justify-center w-full max-w-md">
          <div className="text-6xl md:text-8xl font-black text-yellow-200 drop-shadow-2xl mb-3">
            {totalPoints >= players.length * 12 ? "AMAZING!" : totalPoints >= players.length * 8 ? "GREAT JOB!" : "GOOD EFFORT!"}
          </div>
          <div className="text-3xl md:text-4xl font-extrabold mb-4">
            {totalPoints} total points!
          </div>

          {/* Final scoreboard */}
          <div className="w-full px-2">
            {players.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-2 rounded-xl text-base font-bold mb-1 bg-white/10"
              >
                <span>Player {p.playerNum}</span>
                <span className="flex items-center gap-3">
                  <span className="opacity-70">{p.count} motions</span>
                  <span className="text-yellow-200">{p.points} pts</span>
                  {p.beatPrev && <span>🔥</span>}
                </span>
              </div>
            ))}
          </div>

          {!noMotionSupport && players.length > 0 && (
            <div className="mt-3 text-lg font-bold opacity-70">
              Best: {Math.max(...players.map(p => p.count))} motions (Player {players.reduce((best, p) => p.count > best.count ? p : best, players[0]).playerNum})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
