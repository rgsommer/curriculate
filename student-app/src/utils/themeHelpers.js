// student-app/src/utils/themeHelpers.js

/**
 * Get theme shell styles for different UI themes
 */
export function getThemeShell(uiTheme) {
  switch (uiTheme) {
    case "bold":
      return {
        pageBg: "radial-gradient(circle at top, #0f172a, #020617)",
        cardBg: "rgba(15,23,42,0.95)",
        cardBorder: "1px solid rgba(148,163,184,0.5)",
        text: "#e5e7eb",
      };
    case "minimal":
      return {
        pageBg: "#f3f4f6",
        cardBg: "#ffffff",
        cardBorder: "1px solid #e5e7eb",
        text: "#111827",
      };
    default: // "modern" / Theme 1
      return {
        pageBg: "linear-gradient(135deg, #0ea5e9, #6366f1)",
        cardBg: "#ffffff",
        cardBorder: "1px solid rgba(148,163,184,0.6)",
        text: "#0f172a",
      };
  }
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
