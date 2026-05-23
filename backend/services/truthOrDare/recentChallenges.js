// backend/services/truthOrDare/recentChallenges.js
//
// Simple in-memory dedupe tracker per roomCode. Stores the last ~50
// prompt-hashes seen so the generator can avoid same-text repeats
// within a session. Resets on server restart, which is fine — sessions
// don't span restarts.
//
// (The bloom-filter / Redis-backed cross-session dedupe described in
//  TRUTH_OR_DARE_PLAN.md §2 is a v2 follow-on; this MVP keeps it
//  per-room and in-memory.)

import crypto from "node:crypto";

const _rooms = new Map(); // roomCode → { hashes: Set, list: [] }

const MAX_PER_ROOM = 50;

function _hash(text) {
  return crypto.createHash("sha1")
    .update(String(text || "").toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex")
    .slice(0, 12);
}

export function rememberChallenge(roomCode, { id, prompt }) {
  if (!roomCode) return;
  const code = String(roomCode).toUpperCase();
  if (!_rooms.has(code)) _rooms.set(code, { hashes: new Set(), list: [], ids: new Set() });
  const room = _rooms.get(code);
  const h = _hash(prompt);
  if (id) room.ids.add(String(id));
  room.hashes.add(h);
  room.list.push({ id, h, ts: Date.now() });
  while (room.list.length > MAX_PER_ROOM) {
    const dropped = room.list.shift();
    if (dropped) {
      room.hashes.delete(dropped.h);
      if (dropped.id) room.ids.delete(String(dropped.id));
    }
  }
}

export function hasSeenChallenge(roomCode, { id, prompt }) {
  if (!roomCode) return false;
  const code = String(roomCode).toUpperCase();
  const room = _rooms.get(code);
  if (!room) return false;
  if (id && room.ids.has(String(id))) return true;
  if (prompt && room.hashes.has(_hash(prompt))) return true;
  return false;
}

export function recentIdsForRoom(roomCode) {
  const code = String(roomCode || "").toUpperCase();
  const room = _rooms.get(code);
  return room ? [...room.ids] : [];
}

export function clearRoom(roomCode) {
  _rooms.delete(String(roomCode || "").toUpperCase());
}
