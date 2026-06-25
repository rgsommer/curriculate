// teacher-app/src/components/GameMasterDashboard.jsx
//
// "Now Showing" dashboard for the Live Session page. Pure-visual layer
// injected at the top — reads roomState / taskset / roomCode / endsAt
// and answers the glance question "What's happening RIGHT NOW?" in
// under a second.
//
// Existing controls below remain untouched. No socket events emitted,
// no state mutated outside this component, no APIs changed.

import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Live ticking timer hook — fires every 1s while endsAt is in the future.
 * Returns { msLeft, hh, mm, ss, urgent } where urgent is true under 2 minutes.
 */
function useCountdown(endsAt) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return useMemo(() => {
    if (!endsAt) return null;
    const msLeft = Math.max(0, endsAt - Date.now());
    const totalSec = Math.floor(msLeft / 1000);
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return {
      msLeft,
      hh,
      mm,
      ss,
      urgent: msLeft > 0 && msLeft < 2 * 60_000,
      finished: msLeft <= 0,
      label:
        hh > 0
          ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
          : `${mm}:${String(ss).padStart(2, "0")}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, tick]);
}

/** Smooth-counting number — animates from prev → current. */
function AnimatedNumber({ value, fontSize = "2.5rem", color = "#fff" }) {
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (value === displayed) return;
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    const dur = 420;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span style={{ fontSize, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
      {displayed}
    </span>
  );
}

/** Glance pill — emoji + label + value. */
function GlancePill({ icon, label, value, tone = "neutral" }) {
  const TONES = {
    neutral: { bg: "rgba(255,255,255,0.14)", color: "#fff", border: "rgba(255,255,255,0.22)" },
    success: { bg: "rgba(34,197,94,0.20)", color: "#dcfce7", border: "rgba(34,197,94,0.45)" },
    warn:    { bg: "rgba(251,191,36,0.20)", color: "#fef3c7", border: "rgba(251,191,36,0.45)" },
    info:    { bg: "rgba(56,189,248,0.20)", color: "#e0f2fe", border: "rgba(56,189,248,0.45)" },
  };
  const t = TONES[tone] || TONES.neutral;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 999,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
        fontWeight: 700,
        fontSize: "0.86rem",
        whiteSpace: "nowrap",
        backdropFilter: "blur(4px)",
      }}
    >
      <span style={{ fontSize: "1rem" }} aria-hidden="true">{icon}</span>
      <span style={{ opacity: 0.85 }}>{label}</span>
      <span style={{ fontWeight: 900, marginLeft: 2 }}>{value}</span>
    </div>
  );
}

/** Circular progress ring. */
function ProgressRing({ percent, size = 84, stroke = 8, label, sublabel }) {
  const p = Math.max(0, Math.min(100, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#fef08a"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: "1.15rem", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{label}</div>
        {sublabel && <div style={{ fontSize: "0.62rem", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 4, opacity: 0.78 }}>{sublabel}</div>}
      </div>
    </div>
  );
}

/**
 * GameMasterDashboard — drop-in top-of-page banner. Props are all
 * read-only — no callbacks, no state writes back. Existing
 * functionality stays beneath this layer.
 *
 *   roomCode       — string, room code (e.g. "OT")
 *   roomState      — the existing roomState object from LiveSession
 *   taskset        — currently loaded taskset (object or null)
 *   status         — connection status string ("Connected.", etc.)
 *   isActive       — bool, true when session has been started
 *   ownerLabel     — optional "Presented by …" string
 *   tasksetOwnerLabel — optional "TaskSet from …" string
 */
export default function GameMasterDashboard({
  roomCode,
  roomState,
  taskset,
  status,
  isActive,
  ownerLabel,
  tasksetOwnerLabel,
}) {
  const tasks = Array.isArray(taskset?.tasks) ? taskset.tasks : [];
  const totalTasks = tasks.length;
  const taskIdx = Number.isInteger(roomState?.taskIndex) ? roomState.taskIndex : -1;
  const currentRoundN = totalTasks > 0 && taskIdx >= 0 ? Math.min(taskIdx + 1, totalTasks) : 0;
  const progressPct = totalTasks > 0 ? (currentRoundN / totalTasks) * 100 : 0;

  const teams = roomState?.teams || {};
  const teamCount = Object.keys(teams).length;
  const activeTeams = Object.values(teams).filter(
    (t) => Array.isArray(t?.members) && t.members.length > 0
  ).length;
  const studentCount = Object.values(teams).reduce(
    (n, t) => n + (Array.isArray(t?.members) ? t.members.length : 0),
    0
  );

  const treats = roomState?.treatsConfig || {};
  const treatsGiven = Number(treats.given) || 0;
  const treatsTotal = Number(treats.total) || 0;
  const treatsLeft = treats.enabled ? Math.max(0, treatsTotal - treatsGiven) : 0;

  const countdown = useCountdown(roomState?.endsAt);

  // Headline copy adapts to phase.
  const phase = !taskset
    ? "awaiting-taskset"
    : !isActive
    ? "ready-to-launch"
    : countdown?.finished
    ? "session-ending"
    : taskIdx < 0
    ? "warming-up"
    : currentRoundN >= totalTasks
    ? "final-stretch"
    : "in-flight";

  const HEADLINES = {
    "awaiting-taskset": { eyebrow: "Game Master", title: "Pick a taskset to begin", sub: "Choose a set below — or jump to Quick Start for one-click launch." },
    "ready-to-launch":  { eyebrow: "Game Master", title: "Ready when you are 🎬", sub: `${totalTasks} task${totalTasks === 1 ? "" : "s"} loaded. Hit Start to bring the room to life.` },
    "warming-up":       { eyebrow: "Live", title: "Warming up the room ⚡", sub: "Teams are joining — launch the first round when you're ready." },
    "in-flight":        { eyebrow: "Now Playing", title: `Round ${currentRoundN} of ${totalTasks}`, sub: tasks[taskIdx]?.title || "Live round in progress" },
    "final-stretch":    { eyebrow: "Final Stretch", title: "Last round — bring it home 🏁", sub: tasks[taskIdx]?.title || "Final round" },
    "session-ending":   { eyebrow: "Wrapping Up", title: "Time's up — generating the report 🎉", sub: "Reports email out as soon as it's ready." },
  };
  const headline = HEADLINES[phase];

  // Background changes by phase — info → purple → emerald → amber → green.
  const BG = {
    "awaiting-taskset": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #0f172a 100%)",
    "ready-to-launch":  "linear-gradient(135deg, #4338ca 0%, #6366f1 50%, #312e81 100%)",
    "warming-up":       "linear-gradient(135deg, #1d4ed8 0%, #6366f1 50%, #312e81 100%)",
    "in-flight":        "linear-gradient(135deg, #047857 0%, #10b981 50%, #064e3b 100%)",
    "final-stretch":    "linear-gradient(135deg, #b45309 0%, #f59e0b 50%, #78350f 100%)",
    "session-ending":   "linear-gradient(135deg, #0f766e 0%, #14b8a6 50%, #134e4a 100%)",
  };

  return (
    <div
      data-testid="gm-dashboard"
      style={{
        position: "relative",
        borderRadius: 22,
        padding: "22px 26px",
        background: BG[phase] || BG["ready-to-launch"],
        color: "#fff",
        overflow: "hidden",
        marginBottom: 18,
        boxShadow: "0 18px 50px rgba(15,23,42,0.18)",
      }}
    >
      {/* Subtle animated sheen — under 1% perf cost, polish boost */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 15% 15%, rgba(255,255,255,0.18), transparent 45%), " +
            "radial-gradient(circle at 85% 85%, rgba(255,255,255,0.10), transparent 50%)",
          pointerEvents: "none",
        }}
      />
      <style>{`
        @keyframes gmPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.06);opacity:0.85} }
        @keyframes gmDot   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes gmShine { 0%{transform:translateX(-100%)} 100%{transform:translateX(220%)} }
      `}</style>

      <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center", justifyContent: "space-between" }}>
        {/* LEFT — headline + sub */}
        <div style={{ minWidth: 240, flex: "1 1 320px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 12px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.16)",
              fontWeight: 800,
              fontSize: "0.72rem",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isActive ? "#fef08a" : "#cbd5e1",
                animation: isActive ? "gmDot 1.4s ease-in-out infinite" : "none",
              }}
            />
            {headline.eyebrow}
          </div>
          <div style={{ fontSize: "1.85rem", fontWeight: 900, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
            {headline.title}
          </div>
          <div style={{ marginTop: 6, fontSize: "0.95rem", opacity: 0.92, lineHeight: 1.4, maxWidth: 540 }}>
            {headline.sub}
          </div>

          {/* Glance pills */}
          <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <GlancePill icon="🏷️" label="Room" value={roomCode || "—"} />
            <GlancePill icon="👥" label="Teams" value={teamCount} tone="info" />
            <GlancePill icon="🧑‍🎓" label="Players" value={studentCount} tone="info" />
            {treats.enabled && (
              <GlancePill icon="🍬" label="Treats left" value={treatsLeft} tone="warn" />
            )}
            {countdown && (
              <GlancePill
                icon="⏱"
                label="Ends in"
                value={countdown.finished ? "now" : countdown.label}
                tone={countdown.urgent ? "warn" : "neutral"}
              />
            )}
          </div>

          {(tasksetOwnerLabel || ownerLabel) && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, fontSize: "0.74rem", opacity: 0.86 }}>
              {tasksetOwnerLabel && <span>📦 {tasksetOwnerLabel}</span>}
              {tasksetOwnerLabel && ownerLabel && <span aria-hidden="true">·</span>}
              {ownerLabel && <span>🧑‍🏫 {ownerLabel}</span>}
            </div>
          )}
        </div>

        {/* RIGHT — round counter + progress ring + score */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
          {totalTasks > 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "14px 20px",
                borderRadius: 16,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.16)",
                minWidth: 124,
                backdropFilter: "blur(6px)",
              }}
            >
              <div style={{ fontSize: "0.66rem", letterSpacing: 0.8, textTransform: "uppercase", opacity: 0.82, fontWeight: 800 }}>
                Round
              </div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4, marginTop: 4 }}>
                <AnimatedNumber value={currentRoundN} fontSize="2.6rem" />
                <span style={{ fontSize: "1.05rem", fontWeight: 700, opacity: 0.78 }}>/ {totalTasks}</span>
              </div>
            </div>
          )}
          {countdown && (
            <div
              style={{
                textAlign: "center",
                padding: "14px 20px",
                borderRadius: 16,
                background: countdown.urgent ? "rgba(248,113,113,0.18)" : "rgba(255,255,255,0.10)",
                border: countdown.urgent ? "1px solid rgba(248,113,113,0.55)" : "1px solid rgba(255,255,255,0.16)",
                minWidth: 124,
                backdropFilter: "blur(6px)",
                animation: countdown.urgent ? "gmPulse 1.6s ease-in-out infinite" : "none",
              }}
            >
              <div style={{ fontSize: "0.66rem", letterSpacing: 0.8, textTransform: "uppercase", opacity: 0.82, fontWeight: 800 }}>
                {countdown.finished ? "Ended" : "Bell in"}
              </div>
              <div style={{ marginTop: 4, fontSize: "2.6rem", fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {countdown.finished ? "—" : countdown.label}
              </div>
            </div>
          )}
          {totalTasks > 0 && (
            <ProgressRing
              percent={progressPct}
              label={`${Math.round(progressPct)}%`}
              sublabel="Done"
              size={96}
              stroke={9}
            />
          )}
        </div>
      </div>

      {/* Progress bar — always visible during in-flight phases */}
      {totalTasks > 0 && (
        <div style={{ position: "relative", marginTop: 18 }}>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "rgba(255,255,255,0.14)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, #fef08a 0%, #fbbf24 60%, #f59e0b 100%)",
                borderRadius: 999,
                transition: "width 0.6s cubic-bezier(.22,1,.36,1)",
                boxShadow: "0 0 14px rgba(254,240,138,0.55)",
              }}
            />
            {/* moving sheen */}
            {isActive && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: 60,
                  height: "100%",
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
                  animation: "gmShine 3.4s ease-in-out infinite",
                }}
              />
            )}
          </div>
          <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: "0.72rem", fontWeight: 700, opacity: 0.84 }}>
            <span>{status || "Connecting…"}</span>
            <span>{currentRoundN} of {totalTasks} rounds complete</span>
          </div>
        </div>
      )}
    </div>
  );
}
