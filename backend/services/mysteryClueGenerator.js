// backend/services/mysteryClueGenerator.js
//
// Real-gameplay-driven clue generator for the Whodunnit overlay.
// Subscribes to the in-room event log (room.mysteryEventLog[]) which is
// populated by index.js subscribers on existing gameplay events.
//
// CRITICAL: clues must be TRUE (the suspect actually did the referenced thing)
// AND ambiguous (at least 1 other student matches the same activity), per
// WHODUNNIT_PLAN.md §4. The generator returns null if no good clue is available.

import MysterySession from "../models/MysterySession.js";

const NAME_LETTERS_MIN = 1;
const AMBIGUITY_BANDS = {
  easy:   { min: 1, max: 3 },
  medium: { min: 2, max: 4 },
  hard:   { min: 3, max: 6 },
  expert: { min: 4, max: 8 },
};

function _bucketByPlayer(events, sinceMs = null) {
  const cutoff = sinceMs ? Date.now() - sinceMs : 0;
  const byPlayer = {};
  for (const e of events || []) {
    if (!e || !e.playerName) continue;
    if (cutoff && e.ts < cutoff) continue;
    if (!byPlayer[e.playerName]) byPlayer[e.playerName] = [];
    byPlayer[e.playerName].push(e);
  }
  return byPlayer;
}

function _pickClueFromMovement(suspect, eventsByPlayer, ambiguityBand) {
  const sEvents = (eventsByPlayer[suspect] || []).filter((e) => e.kind === "scan");
  if (sEvents.length === 0) return null;
  // Pick the most recent scan
  const event = sEvents[sEvents.length - 1];
  // Count how many other players also scanned the same station recently
  const ambig = Object.keys(eventsByPlayer).filter((p) => {
    if (p === suspect) return false;
    return (eventsByPlayer[p] || []).some((e) => e.kind === "scan" && e.station === event.station);
  }).length;
  if (ambig < ambiguityBand.min || ambig > ambiguityBand.max) return null;
  return {
    type: "movement",
    text: `The suspect recently scanned at the ${event.station || "station"}.`,
    ambiguityCount: ambig,
    sourceEvent: { kind: "scan", station: event.station, ts: event.ts },
  };
}

function _pickClueFromIdentity(suspect, allPlayers, ambiguityBand) {
  // Only reveal CHOSEN safe properties: first letter, length-bracket, contains-letter, team color.
  // Avoid anything that uniquely identifies in a single shot.
  if (!suspect || suspect.length === 0) return null;

  const candidates = [];

  // First letter
  const firstLetter = suspect[0].toLowerCase();
  const ambigFirst = allPlayers.filter((p) => p !== suspect && p[0]?.toLowerCase() === firstLetter).length;
  if (ambigFirst >= ambiguityBand.min && ambigFirst <= ambiguityBand.max) {
    candidates.push({
      type: "identity",
      text: `The suspect's first name starts with "${suspect[0].toUpperCase()}".`,
      ambiguityCount: ambigFirst,
    });
  }

  // Name length bracket
  const sLen = suspect.length;
  const bracket = sLen <= 4 ? "4 letters or fewer" : sLen <= 6 ? "5 or 6 letters" : "more than 6 letters";
  const ambigLen = allPlayers.filter((p) => {
    if (p === suspect) return false;
    if (bracket === "4 letters or fewer") return p.length <= 4;
    if (bracket === "5 or 6 letters") return p.length === 5 || p.length === 6;
    return p.length > 6;
  }).length;
  if (ambigLen >= ambiguityBand.min && ambigLen <= ambiguityBand.max) {
    candidates.push({
      type: "identity",
      text: `The suspect's first name has ${bracket}.`,
      ambiguityCount: ambigLen,
    });
  }

  // Contains a letter (pick the 2nd character if it's a vowel — more ambiguous in classroom names)
  if (suspect.length >= 2) {
    const secondCh = suspect[1].toLowerCase();
    const ambigContains = allPlayers.filter((p) => p !== suspect && p.toLowerCase().includes(secondCh)).length;
    if (ambigContains >= ambiguityBand.min && ambigContains <= ambiguityBand.max) {
      candidates.push({
        type: "identity",
        text: `The suspect's first name contains the letter "${secondCh}".`,
        ambiguityCount: ambigContains,
      });
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function _pickClueFromTiming(suspect, eventsByPlayer, ambiguityBand) {
  const recentSince = 2 * 60 * 1000;
  const cutoff = Date.now() - recentSince;
  const sRecent = (eventsByPlayer[suspect] || []).filter((e) => e.ts >= cutoff);
  if (sRecent.length === 0) return null;
  const ambig = Object.keys(eventsByPlayer).filter((p) => {
    if (p === suspect) return false;
    return (eventsByPlayer[p] || []).some((e) => e.ts >= cutoff);
  }).length;
  if (ambig < ambiguityBand.min || ambig > ambiguityBand.max) return null;
  return {
    type: "timing",
    text: "The suspect was active within the last 2 minutes.",
    ambiguityCount: ambig,
    sourceEvent: { kind: "recent-activity", ts: Date.now() },
  };
}

/**
 * Generate ONE clue for the suspect from real gameplay activity, respecting the
 * difficulty's ambiguity band. Returns null if no good clue is available.
 *
 * @param {Object} opts
 * @param {string} opts.roomCode
 * @param {Object} opts.room               in-memory room object (must have .mysteryEventLog and .teams)
 * @param {string[]} [opts.alreadyReleasedTexts]  texts of previously-released clues (to avoid dupes)
 */
export async function generateClue({ roomCode, room, alreadyReleasedTexts = [] }) {
  const session = await MysterySession.findOne({ roomCode: String(roomCode || "").toUpperCase() });
  if (!session || !session.enabled || session.ended) return null;
  const suspect = session.suspectPlayerId;
  if (!suspect) return null;

  const band = AMBIGUITY_BANDS[session.difficulty] || AMBIGUITY_BANDS.medium;
  const events = Array.isArray(room?.mysteryEventLog) ? room.mysteryEventLog : [];
  const recentEvents = events.filter((e) => e.ts >= Date.now() - 10 * 60 * 1000);
  const byPlayer = _bucketByPlayer(recentEvents);

  // All known player names — union of event log + team members
  const allPlayers = new Set(Object.keys(byPlayer));
  for (const team of Object.values(room?.teams || {})) {
    for (const m of team?.members || []) {
      const n = typeof m === "string" ? m : m?.name || m?.playerName;
      if (typeof n === "string" && n.trim()) allPlayers.add(n.trim());
    }
  }
  const playerList = Array.from(allPlayers);

  // Try clue types in rotation, prefer movement → identity → timing
  const generators = [
    () => _pickClueFromMovement(suspect, byPlayer, band),
    () => _pickClueFromIdentity(suspect, playerList, band),
    () => _pickClueFromTiming(suspect, byPlayer, band),
  ];

  const usedTexts = new Set(alreadyReleasedTexts);
  for (let i = 0; i < generators.length; i++) {
    const clue = generators[i]();
    if (clue && !usedTexts.has(clue.text)) {
      return {
        id: `clue-${Date.now()}-${i}`,
        truth: true,
        releasedAt: new Date(),
        releasedBy: "auto",
        ...clue,
      };
    }
  }
  return null;
}

export default { generateClue };
