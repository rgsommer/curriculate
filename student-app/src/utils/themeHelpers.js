// student-app/src/utils/themeHelpers.js

/**
 * Theme definitions for the student app.
 * Each theme has static shell styles + a CSS keyframe animation
 * that gets injected into a <style> tag for the animated background.
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
    pageBg: "#0a0a1a",
    cardBg: "rgba(15,15,35,0.95)",
    cardBorder: "1px solid rgba(139,92,246,0.7)",
    text: "#f0f0ff",
    accent: "#8b5cf6",
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
          linear-gradient(rgba(139,92,246,0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(139,92,246,0.12) 1px, transparent 1px);
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
    pageBg: "#041c32",
    cardBg: "rgba(4,28,50,0.88)",
    cardBorder: "1px solid rgba(34,211,238,0.35)",
    text: "#ecfeff",
    accent: "#22d3ee",
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
          transparent 40px,
          rgba(34,211,238,0.06) 40px,
          rgba(34,211,238,0.06) 42px
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
  };
}

/**
 * Returns "dark" or "light" depending on theme.
 * Bold and Dyno are dark themes; Eager is light.
 */
export function getThemeMode(uiTheme) {
  if (uiTheme === "bold" || uiTheme === "dyno") return "dark";
  return "light";
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
