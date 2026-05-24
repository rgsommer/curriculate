// student-app/src/utils/playerName.js
//
// The player's display name in solo practice. DemoMode sets
// window.__CURRICULATE_PRACTICE__ = { email, name, ... } at start. Bot rosters
// should show the player's real name (tester ask: "always include the player's
// name as one of the names") instead of a generic "You". Falls back to the
// provided default when the name is unknown (e.g. live sessions, demo page).
export function getPlayerName(fallback = "You") {
  try {
    const n =
      (typeof window !== "undefined" && window.__CURRICULATE_PRACTICE__ && window.__CURRICULATE_PRACTICE__.name) ||
      "";
    const trimmed = String(n).trim();
    return trimmed || fallback;
  } catch {
    return fallback;
  }
}

export default getPlayerName;
