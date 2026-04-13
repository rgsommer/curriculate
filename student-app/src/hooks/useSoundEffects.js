// student-app/src/hooks/useSoundEffects.js
import { useRef, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// All sounds are local (public/sounds/) — instant load, no
// network dependency, and way more fun than generic Google SFX.
// ─────────────────────────────────────────────────────────────
const SFX = {
  scanBeep:      "/sounds/scan-beep.mp3",    // QR scan accepted
  taskArrival:   "/sounds/task-arrival.mp3",  // new task lands on screen
  correct:       "/sounds/correct.mp3",       // got it right
  wrong:         "/sounds/wrong.mp3",         // got it wrong
  yay:           "/sounds/yay.mp3",           // celebration / treat / victory moment
  treatChime:    "/sounds/treat-chime.mp3",   // random treat awarded
  ding:          "/sounds/ding.mp3",          // subtle positive cue (echo, narration, reading, venn)
  powerUp:       "/sounds/power-up.mp3",      // task-type launch cues (roleplay, fakeout, hunt, debate)
  scanAlert:     "/sounds/scan-alert.mp3",    // scan waiting / alert
  timerWarning:  "/sounds/timer-warning.mp3", // countdown warning beep
  sessionEnd:    "/sounds/TreasureRunnerIntro.mp3", // end-of-taskset celebration fanfare
};

/**
 * Hook for managing sound effects throughout the app.
 * Returns an object with all the tryPlay* functions.
 */
export function useSoundEffects() {
  // One ref per logical sound so overlapping plays work correctly
  const refs = useRef({});

  // Preload all local sound files on mount
  useEffect(() => {
    try {
      for (const [key, src] of Object.entries(SFX)) {
        const audio = new Audio(src);
        audio.preload = "auto";
        // Keep volumes moderate — classroom setting
        audio.volume = key === "yay" ? 0.25 : key === "wrong" ? 0.15 : 0.2;
        refs.current[key] = audio;
      }
    } catch (err) {
      console.warn("Could not preload audio:", err);
    }
  }, []);

  // Helper: safely play a sound, restarting if already playing
  const play = useCallback((key) => {
    try {
      const audio = refs.current[key];
      if (!audio) return;
      // If the same sound is already playing, rewind so it fires again instantly
      if (!audio.paused) {
        audio.currentTime = 0;
      }
      audio.play().catch(() => {});
    } catch {
      // autoplay may be blocked on first interaction — safe to ignore
    }
  }, []);

  // ── Play functions (stable references via useCallback) ─────

  // Station scan accepted (was: alarm_clock.ogg — the culprit behind 5 beeps!)
  const tryPlayAlertSound = useCallback(() => play("scanBeep"), [play]);

  // Treat awarded
  const tryPlayTreatSound = useCallback(() => play("treatChime"), [play]);

  // EchoChain launch
  const tryPlayEchoSound = useCallback(() => play("ding"), [play]);

  // Correct answer
  const tryPlayCorrectSound = useCallback(() => play("correct"), [play]);

  // Wrong answer
  const tryPlayWrongSound = useCallback(() => play("wrong"), [play]);

  // Narration / StoryBuilder launch
  const tryPlayNarrationSound = useCallback(() => play("ding"), [play]);

  // ScriptPlay launch
  const tryPlayScriptPlaySound = useCallback(() => play("ding"), [play]);

  // ReadingComp launch
  const tryPlayReadingSound = useCallback(() => play("ding"), [play]);

  // RolePlayDeck launch
  const tryPlayRolePlaySound = useCallback(() => play("powerUp"), [play]);

  // FakeOut launch
  const tryPlayFakeOutSound = useCallback(() => play("powerUp"), [play]);

  // WordWeaver launch
  const tryPlayWordWeaverSound = useCallback(() => play("ding"), [play]);

  // AI Debate Judge launch
  const tryPlayDebateSound = useCallback(() => play("powerUp"), [play]);

  // Photo / PhotoJournal launch
  const tryPlayPhotoSound = useCallback(() => play("ding"), [play]);

  // SpeedDraw / DrawMime launch
  const tryPlaySketchSound = useCallback(() => play("ding"), [play]);

  // VennSort launch
  const tryPlayVennSound = useCallback(() => play("ding"), [play]);

  // HideNSeek launch
  const tryPlayHuntSound = useCallback(() => play("powerUp"), [play]);

  // ── Bonus: new sounds not in original hook ──

  // Big celebration (task complete, victory)
  const tryPlayYaySound = useCallback(() => play("yay"), [play]);

  // Task arrival
  const tryPlayTaskArrivalSound = useCallback(() => play("taskArrival"), [play]);

  // Timer warning
  const tryPlayTimerWarningSound = useCallback(() => play("timerWarning"), [play]);

  // Session end fanfare (feedback screen)
  const tryPlaySessionEndSound = useCallback(() => play("sessionEnd"), [play]);

  // Setup global window functions for external access
  useEffect(() => {
    window.__curriculatePlayWrongSound = () => play("wrong");
    window.__curriculatePlayCorrectSound = () => play("correct");
    window.__curriculatePlayYaySound = () => play("yay");

    return () => {
      delete window.__curriculatePlayWrongSound;
      delete window.__curriculatePlayCorrectSound;
      delete window.__curriculatePlayYaySound;
    };
  }, [play]);

  return {
    tryPlayAlertSound,
    tryPlayTreatSound,
    tryPlayEchoSound,
    tryPlayCorrectSound,
    tryPlayWrongSound,
    tryPlayNarrationSound,
    tryPlayScriptPlaySound,
    tryPlayReadingSound,
    tryPlayRolePlaySound,
    tryPlayFakeOutSound,
    tryPlayWordWeaverSound,
    tryPlayDebateSound,
    tryPlayPhotoSound,
    tryPlaySketchSound,
    tryPlayVennSound,
    tryPlayHuntSound,
    // New sounds
    tryPlayYaySound,
    tryPlayTaskArrivalSound,
    tryPlayTimerWarningSound,
    tryPlaySessionEndSound,
  };
}
