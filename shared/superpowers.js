// shared/superpowers.js
//
// Superpower catalogue. A rare (~1 in 4) team gets one at join time
// and holds it secretly — the projector never knows, the other teams
// never know, only that team's device shows the badge.
//
// Design constraints (locked with user):
//   - Rarity: 1 in 4 teams.
//   - Reveal: on join (student sees it while waiting for the game).
//   - Server-authoritative: attach on team-create, dedupe by
//     (device-fingerprint + roomCode) so refreshes / team-rename
//     spam always yield the same result. New room = new roll.
//   - Never surfaced in room:state broadcast — sent only to that
//     team's socket via `superpower:assigned`.
//
// Adding a superpower:
//   1. Append an entry below with a unique id.
//   2. If its activation is wired end-to-end (button click actually
//      does something on the student's screen or in scoring), set
//      activationImplemented: true. Only implemented powers are in
//      the roll pool — otherwise teams get a "coming soon" badge,
//      which reads worse than not having a power at all.

export const SUPERPOWER_FLAVORS = {
  HELP: "help",              // A — free help
  POINTS: "points",          // B — point manipulation
  MECHANICS: "mechanics",    // C — physical / session mechanics
  WILD: "wild",              // wildcards
};

/**
 * Full catalog. Every entry is a plausible power; activationImplemented
 * gates whether it's actually part of the roll pool right now.
 */
export const SUPERPOWERS = {
  // ────────────── Flavor A — Free help ──────────────
  FREE_CLUE: {
    id: "free_clue",
    emoji: "🔍",
    name: "Free Clue",
    tagline: "Reveal one hint on any task.",
    description: "Tap to reveal a hint on whatever task is on your screen.",
    flavor: SUPERPOWER_FLAVORS.HELP,
    weight: 3,
    activationImplemented: true, // reference implementation ships this turn
  },
  XRAY: {
    id: "xray",
    emoji: "👀",
    name: "X-Ray",
    tagline: "Eliminate a wrong answer.",
    description: "On the next multiple choice question, one wrong option is greyed out for your team.",
    flavor: SUPERPOWER_FLAVORS.HELP,
    weight: 3,
    activationImplemented: true,
  },
  SLOW_TIME: {
    id: "slow_time",
    emoji: "⏱️",
    name: "Slow Time",
    tagline: "+30 seconds on any task.",
    description: "Add 30 seconds to the next timed task before the countdown starts.",
    flavor: SUPERPOWER_FLAVORS.HELP,
    weight: 2,
    activationImplemented: true,
  },
  TRUTH_SEEKER: {
    id: "truth_seeker",
    emoji: "🔮",
    name: "Truth Seeker",
    tagline: "Uncover what's next.",
    description: "See the type and title of the next task before your team submits this one.",
    flavor: SUPERPOWER_FLAVORS.HELP,
    weight: 2,
    activationImplemented: true,
  },
  SECOND_CHANCE: {
    id: "second_chance",
    emoji: "✋",
    name: "Second Chance",
    tagline: "Re-try a wrong answer.",
    description: "The next time your team gets an answer wrong, it doesn't count — you get to try again.",
    flavor: SUPERPOWER_FLAVORS.HELP,
    weight: 2,
    activationImplemented: true,
  },

  // ────────────── Flavor B — Point manipulation ──────────────
  BONUS_BOOSTER: {
    id: "bonus_booster",
    emoji: "🎁",
    name: "Bonus Booster",
    tagline: "Double points on one task.",
    description: "Tap before you submit any task — you'll earn double points on that one.",
    flavor: SUPERPOWER_FLAVORS.POINTS,
    weight: 2,
    activationImplemented: true,
  },
  POINT_SHIELD: {
    id: "point_shield",
    emoji: "🛡️",
    name: "Point Shield",
    tagline: "Block a point loss.",
    description: "Absorbs the next point-reduction from a wrong answer or opposing bonus.",
    flavor: SUPERPOWER_FLAVORS.POINTS,
    weight: 2,
    activationImplemented: true,
  },
  BLUFF: {
    id: "bluff",
    emoji: "🎭",
    name: "Bluff",
    tagline: "Look one rank lower.",
    description: "Your team appears one rank behind on the public leaderboard until you tap again — perfect for setting up an upset.",
    flavor: SUPERPOWER_FLAVORS.POINTS,
    weight: 1,
    activationImplemented: false,
  },
  SNIPE: {
    id: "snipe",
    emoji: "🎯",
    name: "Snipe",
    tagline: "Steal 20 points from #1.",
    description: "One-time strike — pulls 20 points off the current leader and adds them to your team.",
    flavor: SUPERPOWER_FLAVORS.POINTS,
    weight: 1,
    activationImplemented: false,
  },

  // ────────────── Flavor C — Session mechanics ──────────────
  JUMP_HIGHER: {
    id: "jump_higher",
    emoji: "🦘",
    name: "Jump Higher",
    tagline: "Motion Mission sensitivity boost.",
    description: "For the next Motion Mission, the accelerometer counts smaller movements — great for teams with a cautious player.",
    flavor: SUPERPOWER_FLAVORS.MECHANICS,
    weight: 2,
    activationImplemented: true,
  },
  TORCHLIGHT: {
    id: "torchlight",
    emoji: "🔦",
    name: "Torchlight",
    tagline: "Peek at the right QR.",
    description: "On the next Mad Dash, get a 3-second glimpse of the correct station colour before the round starts.",
    flavor: SUPERPOWER_FLAVORS.MECHANICS,
    weight: 2,
    activationImplemented: true,
  },
  WILD_CARD: {
    id: "wild_card",
    emoji: "🃏",
    name: "Wild Card",
    tagline: "Swap this task for a random one.",
    description: "Don't like the task on screen? Swap it once — Curriculate rolls you a fresh task on the same topic but a different type.",
    flavor: SUPERPOWER_FLAVORS.MECHANICS,
    weight: 1,
    activationImplemented: true,
  },
  MYSTERY_GIFT: {
    id: "mystery_gift",
    emoji: "🎁",
    name: "Mystery Gift",
    tagline: "Reveals at your next scan.",
    description: "The next time your team scans a station, a random bonus reveals itself — could be points, could be a clue.",
    flavor: SUPERPOWER_FLAVORS.MECHANICS,
    weight: 1,
    activationImplemented: true,
  },
  TIME_WARP: {
    id: "time_warp",
    emoji: "💫",
    name: "Time Warp",
    tagline: "Freeze the clock for 15s.",
    description: "One shot — pauses the session countdown for 15 seconds while you think.",
    flavor: SUPERPOWER_FLAVORS.MECHANICS,
    weight: 1,
    activationImplemented: true,
  },

  // ────────────── Wildcards ──────────────
  COMEDIAN: {
    id: "comedian",
    emoji: "🎪",
    name: "Comedian",
    tagline: "Get a bonus riddle break.",
    description: "One free comic riddle card appears between rounds — no scoring, just a laugh.",
    flavor: SUPERPOWER_FLAVORS.WILD,
    weight: 1,
    activationImplemented: false,
  },
};

/**
 * Return an ARRAY of superpower ids weighted by rarity, from which the
 * assignment service picks one. Only implemented powers are in the pool.
 * If nothing is implemented yet (dev safety net), returns [] so callers
 * know to treat this as "no power available."
 */
export function getRollPool() {
  const pool = [];
  for (const sp of Object.values(SUPERPOWERS)) {
    if (!sp.activationImplemented) continue;
    const weight = Math.max(1, Number(sp.weight) || 1);
    for (let i = 0; i < weight; i += 1) pool.push(sp.id);
  }
  return pool;
}

export function getSuperpower(id) {
  return Object.values(SUPERPOWERS).find((sp) => sp.id === id) || null;
}

export const SUPERPOWER_ROLL_PROBABILITY = 0.25;
