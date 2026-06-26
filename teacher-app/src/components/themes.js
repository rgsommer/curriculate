// teacher-app/src/components/themes.js
//
// Pass-4 theme system for Game Master Mode. Each theme is a small
// palette + label bundle: backdrop gradient, accent for live-events,
// streak ember, badge tone, and the round-label flavour text shown
// in the StageTimeline.
//
// Pure data — no React, no side effects. Components read whichever
// fields they care about.
//
// Adding a theme: drop a new entry into THEMES and it auto-shows in
// the picker.

export const THEMES = {
  "neon-night": {
    id: "neon-night",
    name: "Neon Night",
    emoji: "🌙",
    blurb: "Default — purple-blue broadcast",
    backdrop: "linear-gradient(180deg, #0b1024 0%, #111a3a 100%)",
    accent: "#a855f7",
    accentSecondary: "#38bdf8",
    streakGlow: "rgba(168,85,247,0.55)",
    surface: "rgba(255,255,255,0.06)",
    surfaceBorder: "rgba(255,255,255,0.10)",
    chipBg: "rgba(168,85,247,0.18)",
    text: "#fff",
    textMuted: "rgba(255,255,255,0.75)",
    roundLabel: (n) => `Round ${n}`,
    warmupLabel: "Warm-up",
    finalLabel: "Final Challenge",
  },
  "ancient-egypt": {
    id: "ancient-egypt",
    name: "Ancient Egypt",
    emoji: "🐪",
    blurb: "Sandstone, papyrus gold, lapis sky",
    backdrop: "linear-gradient(180deg, #2a1d0c 0%, #523a18 60%, #6e4a1e 100%)",
    accent: "#facc15",
    accentSecondary: "#fde68a",
    streakGlow: "rgba(250,204,21,0.55)",
    surface: "rgba(253,230,138,0.08)",
    surfaceBorder: "rgba(253,230,138,0.22)",
    chipBg: "rgba(250,204,21,0.20)",
    text: "#fef3c7",
    textMuted: "#fde68a",
    roundLabel: (n) => `Scroll ${n}`,
    warmupLabel: "Caravan",
    finalLabel: "Pharaoh's Test",
  },
  "mission-control": {
    id: "mission-control",
    name: "Mission Control",
    emoji: "🚀",
    blurb: "Houston ops — green phosphor on slate",
    backdrop: "linear-gradient(180deg, #0a1018 0%, #0f1a2b 60%, #142941 100%)",
    accent: "#22d3ee",
    accentSecondary: "#34d399",
    streakGlow: "rgba(52,211,153,0.55)",
    surface: "rgba(34,211,238,0.08)",
    surfaceBorder: "rgba(34,211,238,0.22)",
    chipBg: "rgba(34,211,238,0.18)",
    text: "#e0f2fe",
    textMuted: "#7dd3fc",
    roundLabel: (n) => `T-${n}`,
    warmupLabel: "Pre-flight",
    finalLabel: "Splashdown",
  },
  "game-show": {
    id: "game-show",
    name: "Game Show",
    emoji: "🎤",
    blurb: "Studio lights, magenta + electric blue",
    backdrop: "linear-gradient(180deg, #1a0824 0%, #310a52 60%, #4a0c6e 100%)",
    accent: "#ec4899",
    accentSecondary: "#facc15",
    streakGlow: "rgba(236,72,153,0.55)",
    surface: "rgba(250,204,21,0.08)",
    surfaceBorder: "rgba(250,204,21,0.22)",
    chipBg: "rgba(236,72,153,0.20)",
    text: "#fff",
    textMuted: "#fbcfe8",
    roundLabel: (n) => `Round ${n}`,
    warmupLabel: "Opening Bell",
    finalLabel: "Showcase",
  },
  "dragon-realm": {
    id: "dragon-realm",
    name: "Dragon Realm",
    emoji: "🐉",
    blurb: "Forge fire, ember, obsidian",
    backdrop: "linear-gradient(180deg, #1c0a0a 0%, #3d0f12 55%, #5a1715 100%)",
    accent: "#fb923c",
    accentSecondary: "#f87171",
    streakGlow: "rgba(251,146,60,0.65)",
    surface: "rgba(251,146,60,0.10)",
    surfaceBorder: "rgba(251,146,60,0.25)",
    chipBg: "rgba(248,113,113,0.20)",
    text: "#fff7ed",
    textMuted: "#fed7aa",
    roundLabel: (n) => `Trial ${n}`,
    warmupLabel: "Forge",
    finalLabel: "Dragon's Lair",
  },
};

export const DEFAULT_THEME_ID = "neon-night";

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME_ID];
}

export function listThemes() {
  return Object.values(THEMES);
}
