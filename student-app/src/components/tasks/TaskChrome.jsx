// StudentApp/src/components/tasks/TaskChrome.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CHROME_THEME } from "./taskChrome.theme";

/**
 * TaskChrome
 * ----------
 * A single, unified shell for every task type.
 *
 * Contract:
 * - TaskChrome owns: header, prompt zone, feedback zone, control bar, intro video lifecycle, locking, submit flow.
 * - Task content renders ONLY in "body" via children render prop.
 *
 * Submit flow:
 * - Task registers an async submit handler via registerSubmitHandler(fn)
 * - Chrome calls it when user taps Submit
 * - Handler returns: { ok: boolean, feedback?: { type, message }, advance?: boolean }
 *   - If advance === false, chrome stays on task (retry)
 *   - Otherwise chrome calls onAdvance()
 */
export default function TaskChrome({
  task,
  index = 0,
  total = 1,

  // Optional chrome behavior
  showTimer = false,
  timerSeconds = null,
  introVideoUrl = null,
  introSkippableAfterMs = 2000,

  // Navigation callbacks
  onAdvance,
  onSkip,
  onHelp,

  // Optional: allow disabling skip per task type
  canSkip = true,

  // Children render prop:
  // children({ isLocked, setCanSubmit, registerSubmitHandler, bumpFeedback })
  children,
}) {
  const theme = CHROME_THEME;

  // --- Intro video lifecycle (Chrome-owned, never restarts on re-render)
  const [introState, setIntroState] = useState(() => ({
    enabled: !!introVideoUrl,
    canSkip: false,
    done: !introVideoUrl,
  }));
  const introVideoRef = useRef(null);
  const introSkipTimerRef = useRef(null);

  useEffect(() => {
    // Reset intro when task changes (by id or taskType+title fallback)
    const key = task?.id || `${task?.taskType || "task"}:${task?.title || ""}`;
    // If introVideoUrl exists, show it once per task load
    setIntroState({
      enabled: !!introVideoUrl,
      canSkip: false,
      done: !introVideoUrl,
      _key: key,
    });

    if (introSkipTimerRef.current) clearTimeout(introSkipTimerRef.current);
    if (introVideoUrl) {
      introSkipTimerRef.current = setTimeout(() => {
        setIntroState((s) => ({ ...s, canSkip: true }));
      }, introSkippableAfterMs);
    }

    return () => {
      if (introSkipTimerRef.current) clearTimeout(introSkipTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introVideoUrl, task?.id, task?.taskType, task?.title]);

  const endIntro = () => {
    setIntroState((s) => ({ ...s, done: true }));
    // Pause video to avoid background audio on route changes
    try {
      introVideoRef.current?.pause?.();
    } catch {}
  };

  // --- Submit & lock management
  const [canSubmit, setCanSubmit] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const submitHandlerRef = useRef(null);
  const registerSubmitHandler = (fn) => {
    submitHandlerRef.current = fn;
  };

  // --- Feedback (Chrome-owned)
  const [feedback, setFeedback] = useState(null); // { type: "success"|"error"|"warn"|"info", message }
  const feedbackTimerRef = useRef(null);

  const bumpFeedback = (fb, { autoDismissMs = 1400 } = {}) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback(fb || null);
    if (fb && autoDismissMs != null) {
      feedbackTimerRef.current = setTimeout(() => setFeedback(null), autoDismissMs);
    }
  };

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // --- Optional timer display (visual only)
  const timerLabel = useMemo(() => {
    if (!showTimer || typeof timerSeconds !== "number") return null;
    const m = Math.floor(timerSeconds / 60);
    const s = timerSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [showTimer, timerSeconds]);

  const taskTypeLabel = useMemo(() => {
    const tt = task?.taskType || "task";
    return tt.replace(/-/g, " ");
  }, [task?.taskType]);

  const progressLabel = useMemo(() => {
    const i = Math.max(0, index) + 1;
    const t = Math.max(1, total);
    return `Step ${i} of ${t}`;
  }, [index, total]);

  const onSubmit = async () => {
    if (isLocked) return;
    if (!canSubmit) return;

    const fn = submitHandlerRef.current;
    if (typeof fn !== "function") {
      bumpFeedback({ type: "error", message: "Submit handler not registered." });
      return;
    }

    setIsLocked(true);
    try {
      const res = await fn();

      // Normalize result
      const ok = !!res?.ok;
      const advance = res?.advance !== false; // default true
      const fb =
        res?.feedback ||
        (ok
          ? { type: "success", message: "Correct!" }
          : { type: "error", message: "Try again." });

      bumpFeedback(fb);

      if (advance && typeof onAdvance === "function") {
        // slight delay so feedback is perceived
        setTimeout(() => onAdvance(), 350);
      } else {
        // retry case
        setIsLocked(false);
      }
    } catch (e) {
      bumpFeedback({ type: "error", message: "Something went wrong. Try again." });
      setIsLocked(false);
    }
  };

  const onSkipClick = () => {
    if (!canSkip || isLocked) return;
    bumpFeedback({ type: "info", message: "Skipped." }, { autoDismissMs: 700 });
    onSkip?.();
  };

  // --- Chrome layout
  return (
    <div style={theme.page}>
      {/* Intro Video (Chrome-owned) */}
      {!introState.done && introVideoUrl ? (
        <div style={theme.introWrap}>
          <video
            ref={introVideoRef}
            style={theme.introVideo}
            src={introVideoUrl}
            autoPlay
            playsInline
            onEnded={endIntro}
          />
          <div style={theme.introOverlay}>
            <div style={theme.introTitle}>{task?.title || "Get Ready"}</div>
            <div style={theme.introSub}>{taskTypeLabel}</div>

            <div style={theme.introActions}>
              <button
                type="button"
                onClick={endIntro}
                disabled={!introState.canSkip}
                style={{
                  ...theme.buttonSecondary,
                  opacity: introState.canSkip ? 1 : 0.55,
                  cursor: introState.canSkip ? "pointer" : "default",
                }}
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Main Chrome */}
      <div style={theme.shell}>
        {/* Top Bar */}
        <div style={theme.topBar}>
          <div style={theme.topLeft}>
            <div style={theme.title}>{task?.title || "Task"}</div>
            <div style={theme.badges}>
              <span style={theme.badge}>{taskTypeLabel}</span>
            </div>
          </div>

          <div style={theme.topRight}>
            <div style={theme.progress}>{progressLabel}</div>
            {timerLabel ? <div style={theme.timer}>⏱ {timerLabel}</div> : null}
          </div>
        </div>

        {/* Prompt Zone */}
        <div style={theme.promptZone}>
          <div style={theme.promptText}>{task?.prompt || ""}</div>
        </div>

        {/* Task Body */}
        <div style={theme.body}>
          {typeof children === "function"
            ? children({
                isLocked,
                setCanSubmit,
                registerSubmitHandler,
                bumpFeedback,
              })
            : children}
        </div>

        {/* Feedback Zone */}
        <div style={theme.feedbackZone}>
          {feedback ? (
            <div
              style={{
                ...theme.feedbackPill,
                ...(feedback.type === "success"
                  ? theme.feedbackSuccess
                  : feedback.type === "error"
                  ? theme.feedbackError
                  : feedback.type === "warn"
                  ? theme.feedbackWarn
                  : theme.feedbackInfo),
              }}
            >
              {feedback.message}
            </div>
          ) : (
            <div style={{ height: 32 }} />
          )}
        </div>

        {/* Control Bar */}
        <div style={theme.controlBar}>
          <div style={theme.controlsLeft}>
            {onHelp ? (
              <button
                type="button"
                style={theme.buttonSecondary}
                onClick={onHelp}
                disabled={isLocked}
              >
                Help
              </button>
            ) : null}

            {canSkip ? (
              <button
                type="button"
                style={theme.buttonSecondary}
                onClick={onSkipClick}
                disabled={isLocked}
              >
                Skip
              </button>
            ) : null}
          </div>

          <div style={theme.controlsRight}>
            <button
              type="button"
              style={{
                ...theme.buttonPrimary,
                opacity: canSubmit && !isLocked ? 1 : 0.55,
                cursor: canSubmit && !isLocked ? "pointer" : "default",
              }}
              onClick={onSubmit}
              disabled={!canSubmit || isLocked}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
