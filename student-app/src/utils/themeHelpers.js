// student-app/src/utils/themeHelpers.js

/**
 * Theme definitions for the student app.
 * Each theme has static shell styles + a CSS keyframe animation
 * that gets injected into a <style> tag for the animated background.
 *
 * Token set (use getThemeShell() to read these in components):
 *   text          primary text on the page/card
 *   textMuted     secondary/supporting text
 *   accent        brand accent (borders, highlights — NOT body text; low ratio)
 *   surface       solid card/panel background (use instead of hardcoding #fff)
 *   surfaceBorder card/panel border
 *   inputBg / inputBorder   form controls
 *   success / error / warn / info   semantic colors, pre-tuned per theme so
 *                 they stay legible on that theme's background
 *
 * These are OPT-IN. Existing theme-blind tasks are not retrofitted, but new or
 * updated tasks should read tokens from getThemeShell(uiTheme) (or the "light"/
 * "dark" mode via getThemeMode) instead of hardcoding colors — that is what
 * makes Bold vs Dyno actually look different inside a task, not just in the
 * background.
 */

export const THEMES = {
  eager: {
    label: "Eager",
    emoji: "🔥",
    pageBg: "linear-gradient(135deg, #ff6b6b, #ffa502, #ff6348)",
    cardBg: "rgba(255,255,255,0.92)",
    cardBorder: "1px solid rgba(255,107,107,0.3)",
    text: "#1a1a2e",
    accent: "#ff6b6b",
    // --- Extended tokens (opt-in; see getThemeShell + header note) ---
    textMuted: "rgba(26,26,46,0.66)",
    surface: "#ffffff",
    surfaceBorder: "rgba(26,26,46,0.14)",
    inputBg: "#ffffff",
    inputBorder: "rgba(26,26,46,0.18)",
    success: "#15803d",
    error: "#dc2626",
    warn: "#b45309",
    info: "#1d4ed8",
    // Animated background: warm floating blobs
    animationCSS: `
      @keyframes eager-drift {
        0%, 100% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(30px, -20px) scale(1.1); }
        66% { transform: translate(-20px, 15px) scale(0.95); }
      }
      .theme-bg-eager {
        position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
        background: linear-gradient(135deg, #ff6b6b 0%, #ffa502 50%, #ff6348 100%);
      }
      .theme-bg-eager::before {
        content: '';
        position: absolute;
        width: 500px; height: 500px;
        top: -100px; left: -80px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,165,2,0.5), transparent 70%);
        animation: eager-drift 8s ease-in-out infinite;
      }
      .theme-bg-eager::after {
        content: '';
        position: absolute;
        width: 600px; height: 600px;
        bottom: -150px; right: -120px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,99,72,0.4), transparent 70%);
        animation: eager-drift 10s ease-in-out infinite reverse;
      }
    `,
    // Extra floating shapes rendered as divs
    shapes: [
      { size: 200, top: "20%", left: "60%", color: "rgba(255,200,0,0.25)", duration: 12 },
      { size: 300, top: "50%", left: "10%", color: "rgba(255,107,107,0.2)", duration: 14 },
      { size: 150, top: "70%", left: "75%", color: "rgba(255,165,2,0.3)", duration: 9 },
    ],
  },

  bold: {
    label: "Bold",
    emoji: "⚡",
    // Bold leans into deep electric VIOLET to separate it clearly from Dyno's teal.
    pageBg: "#0d0620",
    cardBg: "rgba(26,14,52,0.95)",
    cardBorder: "1px solid rgba(139,92,246,0.7)",
    text: "#f0f0ff",
    accent: "#8b5cf6",
    // --- Extended tokens (opt-in) ---
    textMuted: "rgba(240,240,255,0.66)",
    surface: "#180c30",
    surfaceBorder: "rgba(139,92,246,0.45)",
    inputBg: "rgba(255,255,255,0.06)",
    inputBorder: "rgba(139,92,246,0.4)",
    success: "#4ade80",
    error: "#f87171",
    warn: "#fbbf24",
    info: "#a78bfa",
    animationCSS: `
      @keyframes bold-pulse {
        0%, 100% { opacity: 0.15; transform: scale(1); }
        50% { opacity: 0.3; transform: scale(1.05); }
      }
      @keyframes bold-grid {
        0% { background-position: 0px 0px; }
        100% { background-position: 60px 60px; }
      }
      .theme-bg-bold {
        position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
        background: radial-gradient(ellipse at 30% 20%, #1a0a3e 0%, #0a0a1a 60%);
      }
      .theme-bg-bold::before {
        content: '';
        position: absolute; inset: 0;
        background-image:
          linear-gradient(rgba(139,92,246,0.18) 1px, transparent 1px),
          linear-gradient(90deg, rgba(139,92,246,0.18) 1px, transparent 1px);
        background-size: 60px 60px;
        animation: bold-grid 4s linear infinite;
      }
      .theme-bg-bold::after {
        content: '';
        position: absolute;
        width: 600px; height: 600px;
        top: -200px; right: -200px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(139,92,246,0.25), transparent 60%);
        animation: bold-pulse 4s ease-in-out infinite;
      }
    `,
    shapes: [
      { size: 400, top: "60%", left: "5%", color: "rgba(99,102,241,0.2)", duration: 8 },
      { size: 250, top: "10%", left: "70%", color: "rgba(168,85,247,0.18)", duration: 11 },
      { size: 180, top: "80%", left: "50%", color: "rgba(59,130,246,0.15)", duration: 7 },
    ],
  },

  dyno: {
    label: "Dyno",
    emoji: "🚀",
    // Dyno leans into brighter deep-ocean TEAL/CYAN, a touch lighter than Bold's
    // violet so the two dark themes differ in both hue and value.
    pageBg: "#04243d",
    cardBg: "rgba(5,38,62,0.9)",
    cardBorder: "1px solid rgba(34,211,238,0.35)",
    text: "#ecfeff",
    accent: "#22d3ee",
    // --- Extended tokens (opt-in) ---
    textMuted: "rgba(236,254,255,0.68)",
    surface: "#052a44",
    surfaceBorder: "rgba(34,211,238,0.3)",
    inputBg: "rgba(255,255,255,0.05)",
    inputBorder: "rgba(34,211,238,0.35)",
    success: "#34d399",
    error: "#fb7185",
    warn: "#fbbf24",
    info: "#38bdf8",
    animationCSS: `
      @keyframes dyno-slide {
        0% { transform: translateX(-100%) rotate(-45deg); }
        100% { transform: translateX(200%) rotate(-45deg); }
      }
      @keyframes dyno-float {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-25px) rotate(3deg); }
      }
      .theme-bg-dyno {
        position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
        background: linear-gradient(160deg, #041c32 0%, #064663 40%, #04293a 100%);
      }
      .theme-bg-dyno::before {
        content: '';
        position: absolute;
        width: 200%; height: 200%;
        top: -50%; left: -50%;
        background: repeating-linear-gradient(
          -45deg,
          transparent,
          transparent 38px,
          rgba(34,211,238,0.11) 38px,
          rgba(34,211,238,0.11) 42px
        );
        animation: dyno-slide 20s linear infinite;
      }
      .theme-bg-dyno::after {
        content: '';
        position: absolute;
        width: 500px; height: 500px;
        top: -80px; left: 30%;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(34,211,238,0.2), transparent 60%);
        animation: dyno-float 6s ease-in-out infinite;
      }
    `,
    shapes: [
      { size: 300, top: "65%", left: "70%", color: "rgba(34,211,238,0.12)", duration: 10 },
      { size: 220, top: "30%", left: "5%", color: "rgba(16,185,129,0.1)", duration: 13 },
      { size: 180, top: "85%", left: "25%", color: "rgba(59,130,246,0.08)", duration: 8 },
    ],
  },
};

/**
 * Get theme shell styles for a given theme key.
 * Falls back to "eager" if unknown.
 */
export function getThemeShell(uiTheme) {
  const t = THEMES[uiTheme] || THEMES.eager;
  return {
    pageBg: t.pageBg,
    cardBg: t.cardBg,
    cardBorder: t.cardBorder,
    text: t.text,
    accent: t.accent,
    // Extended tokens (fall back to the legacy values when a theme predates them)
    textMuted: t.textMuted ?? t.text,
    surface: t.surface ?? t.cardBg,
    surfaceBorder: t.surfaceBorder ?? t.cardBorder,
    inputBg: t.inputBg ?? t.cardBg,
    inputBorder: t.inputBorder ?? t.cardBorder,
    success: t.success ?? "#16a34a",
    error: t.error ?? "#dc2626",
    warn: t.warn ?? "#d97706",
    info: t.info ?? "#2563eb",
  };
}

/**
 * True for dark themes. This is the single source of truth for "is this a dark
 * theme" — components must use this instead of `theme === "dark"`, because the
 * theme key flowing through ThemeModeContext is now the specific theme
 * ("eager" | "bold" | "dyno"), not the literal "light"/"dark".
 * (The legacy literals "light"/"dark" are still accepted for back-compat.)
 */
export function isDarkTheme(theme) {
  return theme === "bold" || theme === "dyno" || theme === "dark";
}

/**
 * Returns "dark" or "light" depending on theme.
 * Bold and Dyno are dark themes; Eager is light.
 */
export function getThemeMode(uiTheme) {
  return isDarkTheme(uiTheme) ? "dark" : "light";
}

/**
 * Format milliseconds as MM:SS
 */
export function formatRemainingMs(ms) {
  if (!ms || ms <= 0) return "00:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
