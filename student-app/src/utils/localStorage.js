// student-app/src/utils/localStorage.js

/**
 * Local storage keys for persisting room and team session data
 */
export const LS_KEYS = {
  roomCode: "curriculate.roomCode",
  teamSessionId: "curriculate.teamSessionId",
  teamName: "curriculate.teamName",
  members: "curriculate.members",
};

/**
 * Get a value from localStorage (safe wrapper)
 */
export function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Set a value in localStorage (safe wrapper)
 */
export function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/**
 * Delete a value from localStorage (safe wrapper)
 */
export function lsDel(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/**
 * Clear all saved join data
 */
export function clearSavedJoin() {
  lsDel(LS_KEYS.roomCode);
  lsDel(LS_KEYS.teamSessionId);
  lsDel(LS_KEYS.teamName);
  lsDel(LS_KEYS.members);
}
