// utils/refCode.js

// Two-letter combos to avoid (offensive, confusing, or inappropriate for a school context)
const BLOCKED_PAIRS = new Set([
  "FK", "FU", "FK", "BS", "BJ", "SS", "KK", "AH", "AS", "DD",
  "DK", "FG", "HO", "KY", "NI", "PP", "SH", "TT", "WC", "WP",
  "XX", "FQ", "CK", "CF",
]);

export function genAA123() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let a, b;
  do {
    a = letters[Math.floor(Math.random() * 26)];
    b = letters[Math.floor(Math.random() * 26)];
  } while (BLOCKED_PAIRS.has(`${a}${b}`));
  const n = Math.floor(Math.random() * 1000); // 0..999
  const d = String(n).padStart(3, "0");
  return `${a}${b}${d}`;
}

export function normalizeCode(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}
