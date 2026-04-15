// shared/skins.js
// ====================================================================
//  Skin definitions and unlock tier system for Curriculate.
//  Skins are cosmetic rewards earned through cumulative participation.
//  Each skin has a category, visual properties, and an unlock condition.
//
//  Categories:
//    border     – colored/animated border around the team card
//    celebration – victory screen animation style
//    avatar     – avatar frame/decoration on the team banner
//    theme      – full color theme for the student UI
// ====================================================================

/**
 * Unlock conditions keyed by the stat they check.
 * Each threshold triggers unlocking all skins at or below that level.
 *
 *   sessionsPlayed  – total sessions completed
 *   currentStreak   – consecutive session-days without 14+ day gap
 *   tasksCompleted   – lifetime tasks finished
 *   totalPoints      – lifetime cumulative points
 */

export const SKIN_CATALOG = [
  // ── SESSION MILESTONE SKINS ──
  {
    id: "border-blue",
    category: "border",
    label: "Blue Border",
    description: "A clean blue border for your team card.",
    unlock: { stat: "sessionsPlayed", threshold: 1 },
    css: { borderColor: "#3b82f6", borderWidth: 3 },
  },
  {
    id: "border-green",
    category: "border",
    label: "Green Border",
    description: "Fresh green — you're getting into it.",
    unlock: { stat: "sessionsPlayed", threshold: 3 },
    css: { borderColor: "#22c55e", borderWidth: 3 },
  },
  {
    id: "border-purple",
    category: "border",
    label: "Purple Border",
    description: "Royal purple for a seasoned player.",
    unlock: { stat: "sessionsPlayed", threshold: 5 },
    css: { borderColor: "#a855f7", borderWidth: 3 },
  },
  {
    id: "border-gold",
    category: "border",
    label: "Gold Border",
    description: "Gold standard. You've put in the work.",
    unlock: { stat: "sessionsPlayed", threshold: 10 },
    css: { borderColor: "#eab308", borderWidth: 4 },
  },
  {
    id: "border-rainbow",
    category: "border",
    label: "Rainbow Border",
    description: "A shimmering rainbow edge. Legendary.",
    unlock: { stat: "sessionsPlayed", threshold: 25 },
    css: { borderImage: "linear-gradient(135deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #a855f7) 1", borderWidth: 4 },
  },

  // ── CELEBRATION SKINS ──
  {
    id: "celebration-confetti",
    category: "celebration",
    label: "Confetti Burst",
    description: "Colorful confetti on the victory screen.",
    unlock: { stat: "sessionsPlayed", threshold: 2 },
    effect: "confetti",
  },
  {
    id: "celebration-fireworks",
    category: "celebration",
    label: "Fireworks",
    description: "Fireworks light up when your team finishes.",
    unlock: { stat: "sessionsPlayed", threshold: 8 },
    effect: "fireworks",
  },
  {
    id: "celebration-sparkle",
    category: "celebration",
    label: "Sparkle Rain",
    description: "Glittering sparkles cascade down the screen.",
    unlock: { stat: "sessionsPlayed", threshold: 15 },
    effect: "sparkle",
  },

  // ── AVATAR FRAME SKINS ──
  {
    id: "avatar-star",
    category: "avatar",
    label: "Star Frame",
    description: "A star-shaped frame around your team photo.",
    unlock: { stat: "tasksCompleted", threshold: 20 },
    frame: "star",
  },
  {
    id: "avatar-flame",
    category: "avatar",
    label: "Flame Frame",
    description: "Your avatar is on fire. Literally.",
    unlock: { stat: "tasksCompleted", threshold: 50 },
    frame: "flame",
  },
  {
    id: "avatar-crown",
    category: "avatar",
    label: "Crown Frame",
    description: "A golden crown sits atop your team photo.",
    unlock: { stat: "tasksCompleted", threshold: 100 },
    frame: "crown",
  },
  {
    id: "avatar-diamond",
    category: "avatar",
    label: "Diamond Frame",
    description: "Diamond-encrusted frame. Pure prestige.",
    unlock: { stat: "tasksCompleted", threshold: 200 },
    frame: "diamond",
  },

  // ── STREAK SKINS ──
  {
    id: "theme-streak-3",
    category: "theme",
    label: "Hot Streak",
    description: "Warm orange tones for a 3-session streak.",
    unlock: { stat: "currentStreak", threshold: 3 },
    palette: { primary: "#f97316", accent: "#fbbf24", bg: "#fff7ed" },
  },
  {
    id: "theme-streak-5",
    category: "theme",
    label: "On Fire",
    description: "Red-hot theme for a 5-session streak.",
    unlock: { stat: "currentStreak", threshold: 5 },
    palette: { primary: "#ef4444", accent: "#f97316", bg: "#fef2f2" },
  },
  {
    id: "theme-streak-10",
    category: "theme",
    label: "Unstoppable",
    description: "Electric blue for a 10-session streak. You can't be stopped.",
    unlock: { stat: "currentStreak", threshold: 10 },
    palette: { primary: "#0ea5e9", accent: "#6366f1", bg: "#f0f9ff" },
  },

  // ── POINTS MILESTONE SKINS ──
  {
    id: "border-bronze-pts",
    category: "border",
    label: "Bronze Achiever",
    description: "Bronze border for reaching 5,000 lifetime points.",
    unlock: { stat: "totalPoints", threshold: 5000 },
    css: { borderColor: "#cd7f32", borderWidth: 3 },
  },
  {
    id: "border-silver-pts",
    category: "border",
    label: "Silver Achiever",
    description: "Silver border for reaching 25,000 lifetime points.",
    unlock: { stat: "totalPoints", threshold: 25000 },
    css: { borderColor: "#c0c0c0", borderWidth: 3 },
  },
  {
    id: "border-platinum-pts",
    category: "border",
    label: "Platinum Achiever",
    description: "Platinum border for reaching 100,000 lifetime points.",
    unlock: { stat: "totalPoints", threshold: 100000 },
    css: { borderColor: "#e5e4e2", borderWidth: 4, boxShadow: "0 0 12px rgba(229,228,226,0.6)" },
  },
];

/**
 * Given a student's cumulative stats, return the list of skin IDs they qualify for.
 */
export function computeUnlockedSkins(stats) {
  const { sessionsPlayed = 0, currentStreak = 0, tasksCompleted = 0, totalPoints = 0 } = stats || {};
  const values = { sessionsPlayed, currentStreak, tasksCompleted, totalPoints };

  return SKIN_CATALOG
    .filter((skin) => {
      const { stat, threshold } = skin.unlock;
      return (values[stat] || 0) >= threshold;
    })
    .map((skin) => skin.id);
}

/**
 * Given newly computed unlocked skins and previously unlocked skins,
 * return { allUnlocked, newlyUnlocked } so the client can show "NEW" badges.
 */
export function diffUnlocks(previousSkins, currentStats) {
  const prev = new Set(previousSkins || []);
  const nowUnlocked = computeUnlockedSkins(currentStats);
  const newlyUnlocked = nowUnlocked.filter((id) => !prev.has(id));
  return { allUnlocked: nowUnlocked, newlyUnlocked };
}

/**
 * Look up a skin definition by ID.
 */
export function getSkinById(skinId) {
  return SKIN_CATALOG.find((s) => s.id === skinId) || null;
}

/**
 * Get all skins grouped by category for display.
 */
export function getSkinsByCategory() {
  const grouped = {};
  for (const skin of SKIN_CATALOG) {
    if (!grouped[skin.category]) grouped[skin.category] = [];
    grouped[skin.category].push(skin);
  }
  return grouped;
}
