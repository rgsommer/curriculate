// student-app/src/components/tasks/types/BodyBreakTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import StepCircle from "../StepCircle";
import { getPlayerName } from "../../../utils/playerName";

function parseStepsFromPrompt(promptText) {
  const t = String(promptText || "").trim();
  if (!t) return [];

  const hasNumbered = /(^|\s)\d+[\)\.]\s/.test(t);
  if (hasNumbered) {
    // If the prompt has a label before the list (e.g., "BODY BREAK (45s): 1) ..."),
    // strip everything before the first numbered item so we don't treat the label as a "step".
    const firstIdx = t.search(/\d+[\)\.]\s/);
    const numberedPart = firstIdx >= 0 ? t.slice(firstIdx) : t;

    const normalized = numberedPart.replace(/(\d+)[\)\.]\s*/g, "\n$1) ");
    return normalized
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^\d+[\)\.]\s*/, "").trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  }

  const lines = t
    .split(/\n|;/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length <= 1) return t ? [{ text: t }] : [];
  return lines.map((text) => ({ text: text }));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// Solo-practice bot teammates — mirrors TruthOrDare so a single player still
// feels the team accountability loop (tester: "show bots in practice mode").
// The player's own name is always included (tester: "always include the
// player's name as one of the names"); the rest auto-tap Done after a beat.
const PRACTICE_BOTS = ["Ada", "Newton", "Maya"];

export default function BodyBreakTask({ task, onSubmit, disabled, stagingPhase, canStartTask, memberNames = [], practiceMode = false }) {
  const promptText = String(task?.prompt || "");
  const SHOW_TOP_MOVES_LIST = false;

  // In live sessions we use the real team. In solo practice (no real team), we
  // inject the player + bot roster so the player sees teammates finish.
  const realMembers = (Array.isArray(memberNames) ? memberNames : []).filter(Boolean);
  const usePracticeBots = practiceMode && realMembers.length < 2;
  const me = getPlayerName();
  const effectiveMembers = usePracticeBots ? [me, ...PRACTICE_BOTS] : realMembers;
  // Bots = everyone except the human player when running practice bots.
  const botNames = usePracticeBots ? PRACTICE_BOTS.slice() : [];

  // Hide Start until the TaskRunner staging/intro animation is fully gone.
  // TaskRunner passes canStartTask=true when stagingPhase === 'gone'.
  const canStart = Boolean(canStartTask) || stagingPhase === "gone" || stagingPhase == null;

  const steps = useMemo(() => {
    const cfgSteps = task?.config?.steps;
    if (Array.isArray(cfgSteps) && cfgSteps.length) {
      const mapped = cfgSteps
        .map((s) => ({
          icon: s.icon || s.emoji || null,
          text: String(s.text || s.instruction || "").trim(),
          seconds: Number.isFinite(s.seconds)
            ? s.seconds
            : Number.isFinite(s.holdSeconds)
            ? s.holdSeconds
            : null,
        }))
        .filter((s) => s.text);

      // If config.steps exists but is malformed/empty, fall back to parsing the prompt.
      if (mapped.length) return mapped;
    }
    return parseStepsFromPrompt(promptText);
  }, [task?.config?.steps, promptText]);

  const totalSecondsRaw =
    task?.config?.totalSeconds ??
    task?.timeLimitSeconds ??
    task?.config?.timeLimitSeconds ??
    null;

  const promptSeconds = (() => {
    const s = String(task?.prompt || task?.config?.prompt || "");
    const m = s.match(/\((\d+)\s*s\)/i) || s.match(/\b(\d+)\s*s\b/i);
    const n = m ? Number(m[1]) : null;
    return Number.isFinite(n) ? n : null;
  })();

  let totalSeconds = null;

// IMPORTANT: Number(null) === 0, which broke timers when totalSecondsRaw was missing.
// Only coerce totalSecondsRaw if it's truly present.
if (totalSecondsRaw !== null && totalSecondsRaw !== undefined && String(totalSecondsRaw).trim() !== "") {
  const n = Number(totalSecondsRaw);
  if (Number.isFinite(n) && n > 0) totalSeconds = n;
}

if (!Number.isFinite(totalSeconds) && Number.isFinite(promptSeconds) && promptSeconds > 0) {
  totalSeconds = promptSeconds;
}

  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(totalSeconds);

  // Peer-rating phase (tester ask, accountability): once everyone has tapped
  // Done, a randomly-chosen team member rates the others. Only for teams of
  // 2+; solo/unknown teams submit immediately as before.
  const [ratingPhase, setRatingPhase] = useState(null); // { doneBy, judge } | null

  const handleAllDone = (names) => {
    const team = effectiveMembers;
    if (team.length >= 2) {
      // The human is always the judge in practice (you rate the bots);
      // in a live team the judge is random.
      const judge = usePracticeBots ? me : team[Math.floor(Math.random() * team.length)];
      setRatingPhase({ doneBy: names, judge });
    } else {
      onSubmit?.({ done: true, doneBy: names, count: names.length });
    }
  };

  // Only hard-reset the timer when the *task instance* changes.
  // (Some screens re-render/refresh task objects during staging transitions; we don't want that to cancel the timer.)
  const instanceKey = useMemo(() => {
    const idPart = task?._id || task?.id || task?.taskId || task?.key || "";
    const promptPart = typeof task?.prompt === "string" ? task.prompt : "";
    return String(idPart) + "|" + promptPart;
  }, [task?._id, task?.id, task?.taskId, task?.key, task?.prompt]);

  const prevInstanceKeyRef = useRef(instanceKey);
  const prevTotalSecondsRef = useRef(totalSeconds);

  useEffect(() => {
    const prevKey = prevInstanceKeyRef.current;
    const prevTotal = prevTotalSecondsRef.current;

    // New task instance → reset everything.
    if (prevKey !== instanceKey) {
      prevInstanceKeyRef.current = instanceKey;
      prevTotalSecondsRef.current = totalSeconds;
      setRunning(false);
      setTimeLeft(totalSeconds);
      return;
    }

    // Same task instance, but duration changed (late-arriving config/prompt).
    // Keep UI consistent, but don't interrupt an in-progress timer.
    if (!running && prevTotal !== totalSeconds) {
      prevTotalSecondsRef.current = totalSeconds;
      setTimeLeft(totalSeconds);
    }
  }, [instanceKey, totalSeconds, running]);

  useEffect(() => {
    if (!running) return;
    if (!Number.isFinite(timeLeft)) return;
    if (timeLeft <= 0) return;
    const t = window.setTimeout(() => setTimeLeft((x) => (x == null ? x : x - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [running, timeLeft]);


  const startPause = () => {
    if (disabled) return;

    // When starting, ensure the countdown has a valid positive timeLeft.
    if (!running) {
      if (Number.isFinite(totalSeconds)) {
        setTimeLeft((tl) => {
          const n = Number(tl);
          if (Number.isFinite(n) && n > 0) return n;
          return totalSeconds;
        });
      }
      setRunning(true);
      return;
    }

    // Pause
    setRunning(false);
  };

  const movesLines = useMemo(() => {
    if (!steps || steps.length === 0) return "";
    return steps.map((s, i) => `${i + 1}) ${String(s?.text || "").trim()}`).filter(Boolean).join("\n");
  }, [steps]);
  const finishText =
    String(task?.config?.finishText || "").trim() || "Nice work — tap DONE when your group is finished.";

  const percent =
    Number.isFinite(totalSeconds) && Number.isFinite(timeLeft) && totalSeconds > 0
      ? clamp(Math.round((timeLeft / totalSeconds) * 100), 0, 100)
      : null;

  const isMovement =
    /jump|stretch|stand|move|bend|twist|run/i.test(promptText) ||
    !!task?.movement ||
    !!task?.config?.movement ||
    task?.isPhysical ||
    task?.config?.isPhysical;

  const styles = {
    shell: { height: "100%", padding: 16 },
    hero: {
      borderRadius: 24,
      padding: 22,
      border: "1px solid rgba(15,23,42,0.10)",
      background:
        "radial-gradient(1200px 500px at 10% 0%, rgba(56,189,248,0.30), rgba(255,255,255,0.0)), linear-gradient(135deg, rgba(255,255,255,0.92), rgba(255,255,255,0.72))",
      boxShadow: "0 18px 60px rgba(15,23,42,0.10)",
      overflow: "hidden",
      position: "relative",
    },
    sparkle: {
      position: "absolute",
      inset: -60,
      background:
        "radial-gradient(circle at 25% 25%, rgba(34,197,94,0.14), transparent 55%), radial-gradient(circle at 75% 35%, rgba(99,102,241,0.14), transparent 55%), radial-gradient(circle at 55% 75%, rgba(250,204,21,0.14), transparent 55%)",
      filter: "blur(0px)",
      pointerEvents: "none",
    },
    topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 12px",
      borderRadius: 999,
      border: "1px solid rgba(15,23,42,0.10)",
      background: "rgba(255,255,255,0.75)",
      fontWeight: 900,
      fontSize: 13,
    },
    title: { fontSize: 22, fontWeight: 1000, margin: 0, letterSpacing: 0.3, color: "#0f172a" },
    sub: { marginTop: 5, fontSize: 14, opacity: 1, color: "#334155", fontWeight: 700 },
    stepsWrap: { marginTop: 20, display: "grid", gap: 14 },
    stepCard: {
      borderRadius: 22,
      border: "1px solid rgba(15,23,42,0.08)",
      background: "rgba(255,255,255,0.88)",
      boxShadow: "0 12px 36px rgba(15,23,42,0.07)",
      padding: "20px 18px",
      display: "flex",
      gap: 16,
      alignItems: "flex-start",
    },
    num: {
      width: 32,
      height: 32,
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 900,
      fontSize: 15,
      color: "#fff",
      flex: "0 0 auto",
    },
    stepText: { fontSize: 20, fontWeight: 850, lineHeight: 1.4, letterSpacing: 0.1, color: "#0f172a" },
    stepMeta: { marginTop: 8, fontSize: 14, opacity: 1, color: "#475569", fontWeight: 800 },
    controls: { marginTop: 20, display: "grid", gap: 12 },
    btn: {
      width: "100%",
      borderRadius: 18,
      padding: "14px 16px",
      fontWeight: 1000,
      border: "1px solid rgba(15,23,42,0.14)",
      background: "rgba(255,255,255,0.82)",
      cursor: "pointer",
      fontSize: 17,
    },
    btnDone: {
      width: "100%",
      borderRadius: 18,
      padding: "14px 16px",
      fontWeight: 1000,
      border: "1px solid rgba(15,23,42,0.14)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.90), rgba(14,165,233,0.65))",
      color: "#07121f",
      cursor: "pointer",
      fontSize: 17,
    },
    progressOuter: {
      height: 10,
      borderRadius: 999,
      background: "rgba(15,23,42,0.08)",
      overflow: "hidden",
      border: "1px solid rgba(15,23,42,0.08)",
      marginTop: 10,
    },
    progressInner: {
      height: "100%",
      width: `${percent ?? 0}%`,
      background: "linear-gradient(90deg, rgba(14,165,233,0.85), rgba(34,197,94,0.85))",
      transition: "width 250ms linear",
    },
    footer: { marginTop: 10, textAlign: "center", fontSize: 12, opacity: 1, color: "#475569", fontWeight: 800 },
  };

  return (
    <div style={styles.shell}>
      <style>{`
        @keyframes bbFloat {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes bbPulse {
          0%,100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.04); opacity: 1; }
        }
        .bb-orb { animation: bbFloat 2.6s ease-in-out infinite; }
        .bb-go  { animation: bbPulse 1.2s ease-in-out infinite; }
      `}</style>

      <div style={styles.hero}>
        <div style={styles.sparkle} />

        <div style={styles.topRow}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div
              className="bb-orb"
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                display: "grid",
                placeItems: "center",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.30), rgba(56,189,248,0.22))",
                border: "1px solid rgba(15,23,42,0.10)",
                boxShadow: "0 16px 40px rgba(15,23,42,0.08)",
                fontSize: 26,
              }}
              aria-hidden="true"
            >
              {isMovement ? "🤸" : "🧘"}
            </div>

            <div style={{ minWidth: 0 }}>
              <h3 style={styles.title}>
                {task?.config?.label || "Quick reset"}
              </h3>
              <div style={styles.sub}>
                Do this together
                {Number.isFinite(totalSeconds) ? ` • ${totalSeconds}s` : ""}
              </div>
            </div>
          </div>

          {Number.isFinite(totalSeconds) ? (
            <div style={styles.badge}>
              ⏱ <span style={{ fontVariantNumeric: "tabular-nums" }}>{timeLeft ?? totalSeconds}s</span>
            </div>
          ) : (
            <div style={{ ...styles.badge, color: "#0f172a" }}>✨ Refresh</div>
          )}
        </div>

        {percent != null && (
          <div style={styles.progressOuter} aria-label="Timer progress">
            <div style={styles.progressInner} />
          </div>
        )}

        {SHOW_TOP_MOVES_LIST && movesLines ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: "1px solid rgba(15,23,42,0.10)",
              background: "rgba(255,255,255,0.78)",
              padding: 12,
              fontWeight: 850,
              fontSize: 14,
              lineHeight: 1.35,
              whiteSpace: "pre-line",
            }}
            aria-label="Activities (one per line)"
          >
            {movesLines}
          </div>
        ) : null}

        <div style={styles.stepsWrap}>
          {steps.length ? (
            steps.map((s, idx) => (
              <div key={idx} style={styles.stepCard}>
                <StepCircle n={idx + 1} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={styles.stepText}>
                    {s.icon ? <span style={{ marginRight: 8 }}>{s.icon}</span> : null}
                    {s.text}
                  </div>
                  {s.seconds ? <div style={styles.stepMeta}>Hold for {s.seconds}s</div> : null}
                </div>
              </div>
            ))
          ) : (
            <div style={styles.stepCard}>
              <div style={styles.num}>!</div>
              <div style={styles.stepText}>{promptText || "Stand up, stretch, and reset."}</div>
            </div>
          )}
        </div>

        <div style={styles.controls}>
          {ratingPhase ? (
            <PeerRating
              judge={ratingPhase.judge}
              members={effectiveMembers}
              disabled={disabled}
              onFinish={(ratings) =>
                onSubmit?.({
                  done: true,
                  doneBy: ratingPhase.doneBy,
                  count: ratingPhase.doneBy.length,
                  judge: ratingPhase.judge,
                  ratings,
                })
              }
            />
          ) : (
            <>
              {Number.isFinite(totalSeconds) && canStart ? (
                <>
                  {!running && (
                    <div style={{ textAlign: "center", fontSize: 13, fontWeight: 800, color: "#475569", marginBottom: 6 }}>
                      👇 Tap to start the {totalSeconds}s timer, then do the moves together
                    </div>
                  )}
                  <button
                    type="button"
                    style={{
                      ...styles.btn,
                      opacity: disabled ? 0.6 : 1,
                      ...(running ? null : {
                        background: "linear-gradient(135deg, #22c55e, #16a34a)",
                        color: "#fff",
                        border: "none",
                        fontSize: 19,
                      }),
                    }}
                    onClick={(e) => {
                      e?.preventDefault?.();
                      e?.stopPropagation?.();
                      startPause();
                    }}
                    disabled={disabled}
                    className={!running ? "bb-go" : undefined}
                  >
                    {running ? "Pause ⏸" : "▶️ START TIMER"}
                  </button>
                </>
              ) : Number.isFinite(totalSeconds) ? (
                <div style={{ fontSize: 12, opacity: 0.75, padding: "6px 2px" }}>
                  Intro playing… Start will appear in a moment.
                </div>
              ) : null}

              {/* Per-player Done buttons (single-device, peer-pressure
                  encouragement).  Each name lights up green as they tap.
                  When everyone has tapped, we move to peer-rating (teams of
                  2+) or auto-submit (solo).  Falls back to a single big DONE
                  if we don't know team names. */}
              <PlayerDoneRow
                memberNames={effectiveMembers}
                botNames={botNames}
                botsActive={running || !Number.isFinite(totalSeconds)}
                disabled={disabled}
                onAllDone={handleAllDone}
              />

              {/* Honor-system reminder — addresses tester feedback:
                  "What will prevent kids from just saying Done? maybe just
                  honor system". Setting the expectation in copy is cheaper
                  than any anti-cheat we could build. */}
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(34,197,94,0.10)",
                  border: "1px solid rgba(34,197,94,0.30)",
                  color: "#bbf7d0",
                  fontSize: "0.8rem",
                  lineHeight: 1.4,
                  textAlign: "center",
                  fontWeight: 600,
                }}
              >
                🤝 Honor system — your team trusts you to actually do the moves before tapping Done.
              </div>

              <div style={styles.footer}>{finishText}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PlayerDoneRow                                                     */
/*  Per-player "Done" button — single device, social pressure.        */
/* ------------------------------------------------------------------ */
function PlayerDoneRow({ memberNames = [], botNames = [], botsActive = false, disabled, onAllDone }) {
  const names = (Array.isArray(memberNames) ? memberNames : []).filter(Boolean);
  const botSet = useMemo(
    () => new Set((Array.isArray(botNames) ? botNames : []).filter(Boolean)),
    [botNames]
  );
  const [doneSet, setDoneSet] = useState(() => new Set());
  const submittedRef = useRef(false);

  const total = names.length;
  const doneCount = doneSet.size;

  // Practice bots auto-tap Done at staggered intervals once the timer is
  // running — the player watches teammates finish (social pressure), then
  // taps their own name. Mirrors TruthOrDare's bot turns.
  useEffect(() => {
    if (!botsActive || botSet.size === 0) return;
    const timers = [...botSet].map((name, i) =>
      window.setTimeout(() => {
        setDoneSet((prev) => {
          if (prev.has(name)) return prev;
          const next = new Set(prev);
          next.add(name);
          return next;
        });
      }, 1400 + i * 1100 + Math.random() * 600)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [botsActive, botSet]);

  // Auto-submit once everyone's marked done.
  useEffect(() => {
    if (submittedRef.current) return;
    if (total === 0) return;
    if (doneCount >= total) {
      submittedRef.current = true;
      onAllDone?.([...doneSet]);
    }
  }, [doneCount, total, doneSet, onAllDone]);

  // Fallback: no team names known → single big DONE button (legacy UX).
  if (total === 0) {
    return (
      <button
        type="button"
        style={{
          padding: "16px 22px",
          borderRadius: 16,
          border: "none",
          background: "linear-gradient(135deg, #22c55e, #16a34a)",
          color: "#fff",
          fontWeight: 900,
          fontSize: 16,
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(34,197,94,0.4)",
          opacity: disabled ? 0.6 : 1,
        }}
        onClick={() => {
          if (submittedRef.current) return;
          submittedRef.current = true;
          onAllDone?.([]);
        }}
        disabled={disabled}
      >
        DONE ✅
      </button>
    );
  }

  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: "rgba(15,23,42,0.7)",
          marginBottom: 8,
        }}
      >
        Tap your name when you finish — {doneCount}/{total} done
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {names.map((name) => {
          const isDone = doneSet.has(name);
          const isBot = botSet.has(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => {
                if (disabled || submittedRef.current || isBot) return;
                setDoneSet((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                });
              }}
              disabled={disabled || isBot}
              style={{
                padding: "10px 16px",
                borderRadius: 14,
                border: "2px solid",
                borderColor: isDone ? "#16a34a" : "rgba(15,23,42,0.18)",
                background: isDone
                  ? "linear-gradient(135deg, #22c55e, #16a34a)"
                  : "rgba(255,255,255,0.94)",
                color: isDone ? "#fff" : "#0f172a",
                fontWeight: 900,
                fontSize: 14,
                cursor: isBot ? "default" : disabled ? "default" : "pointer",
                opacity: isBot && !isDone ? 0.7 : 1,
                boxShadow: isDone ? "0 4px 14px rgba(34,197,94,0.45)" : "0 2px 6px rgba(0,0,0,0.08)",
                transform: isDone ? "scale(1.02)" : "scale(1)",
                transition: "transform 0.12s ease, box-shadow 0.12s ease",
              }}
              aria-pressed={isDone}
              title={
                isBot
                  ? `${name} is a practice teammate`
                  : isDone
                  ? `Tap again to undo ${name}'s Done`
                  : `Mark ${name} as done`
              }
            >
              {isDone
                ? `✅ ${name} is done`
                : isBot
                ? `${name} — doing it…`
                : `${name} — tap when done`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PeerRating                                                        */
/*  A randomly-chosen "judge" rates each teammate 1-5 stars after the */
/*  break — drives accountability (tester ask). Ratings are optional; */
/*  the Finish button is always enabled so the task can never stall.  */
/* ------------------------------------------------------------------ */
function PeerRating({ judge, members = [], disabled, onFinish }) {
  const others = (Array.isArray(members) ? members : []).filter((m) => m && m !== judge);
  const [ratings, setRatings] = useState({}); // { name: 1..5 }
  const submittedRef = useRef(false);

  const setStars = (name, stars) => {
    if (disabled || submittedRef.current) return;
    setRatings((prev) => ({ ...prev, [name]: stars }));
  };

  const finish = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onFinish?.(ratings);
  };

  return (
    <div>
      <div
        style={{
          textAlign: "center",
          fontWeight: 1000,
          fontSize: 16,
          color: "#0f172a",
          marginBottom: 4,
        }}
      >
        🎲 {judge}, you're the judge!
      </div>
      <div
        style={{
          textAlign: "center",
          fontSize: 13,
          fontWeight: 700,
          color: "#475569",
          marginBottom: 12,
        }}
      >
        Rate how well each teammate did the moves.
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {others.map((name) => {
          const current = ratings[name] || 0;
          return (
            <div
              key={name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid rgba(15,23,42,0.12)",
                background: "rgba(255,255,255,0.92)",
              }}
            >
              <span style={{ fontWeight: 900, fontSize: 14, color: "#0f172a", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {name}
              </span>
              <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setStars(name, star)}
                    disabled={disabled}
                    aria-label={`${star} star${star > 1 ? "s" : ""} for ${name}`}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: disabled ? "default" : "pointer",
                      fontSize: 22,
                      lineHeight: 1,
                      padding: 0,
                      filter: star <= current ? "none" : "grayscale(1)",
                      opacity: star <= current ? 1 : 0.35,
                      transition: "opacity 0.12s ease",
                    }}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={finish}
        disabled={disabled}
        style={{
          marginTop: 14,
          width: "100%",
          borderRadius: 18,
          padding: "14px 16px",
          fontWeight: 1000,
          fontSize: 16,
          border: "none",
          background: "linear-gradient(135deg, rgba(34,197,94,0.90), rgba(14,165,233,0.65))",
          color: "#07121f",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        Finish ▶
      </button>
    </div>
  );
}
