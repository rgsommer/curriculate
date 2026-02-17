// utils/refCode.js
export function genAA123() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = letters[Math.floor(Math.random() * 26)];
  const b = letters[Math.floor(Math.random() * 26)];
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
