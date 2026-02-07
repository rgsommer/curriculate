// teacher-app/src/disallowedRoomCodes.js

// Add anything here you *never* want to appear as a room code.
// Always use UPPERCASE.
export const DISALLOWED_ROOM_CODES = new Set([
  "FK",
  "FU",
  "FUQ", // future proofing if you go to 3 letters
  "FU2",
  "FML",
  "KKK",
  "SEX",
  "XXX",
  "ASS",
  "WTF",
  "BS",
  // add more as you think of them
]);
