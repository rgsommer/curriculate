// shared/brandContext.js
//
// Host-aware brand identity. One codebase deploys to BOTH curriculate.net
// (Curriculate — Pulse Grading + legacy games) and qrewzi.com (Qrewzi —
// live classroom games, kid-facing rebrand). The current hostname decides
// which brand's name / URLs / copy the page should use.
//
// Everything is a plain function so it re-evaluates on each call — no
// module-level state that gets frozen at build/SSR time. Safe to call from
// any React component, server-side (returns Curriculate default), or
// during React hydration.
//
// Add a new host by extending QREWZI_HOSTS.

const QREWZI_HOSTS = new Set([
  "qrewzi.com",
  "www.qrewzi.com",
  "play.qrewzi.com",
  "set.qrewzi.com",
  "qrewzi.ca",
  "www.qrewzi.ca",
]);

function currentHost() {
  if (typeof window === "undefined") return "";
  return window.location.hostname;
}

export function isQrewziHost() {
  return QREWZI_HOSTS.has(currentHost());
}

// Human-readable brand name — for titles, share text, mascot dialog, etc.
export function brandName() {
  return isQrewziHost() ? "Qrewzi" : "Curriculate";
}

// Bare domain — for footers, "visit us at X", meta descriptions.
export function brandDomain() {
  return isQrewziHost() ? "qrewzi.com" : "curriculate.net";
}

// Absolute root — for building brand-facing URLs (pricing, contact, etc).
export function brandRootUrl() {
  return isQrewziHost() ? "https://qrewzi.com" : "https://curriculate.net";
}

// Build a URL against the current brand's root.
//   brandUrl("/pricing")           → https://qrewzi.com/pricing  (on qrewzi)
//                                  → https://curriculate.net/pricing (else)
//   brandUrl("/pricing?ref=share") → ...same with query preserved
export function brandUrl(path = "/") {
  const p = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${brandRootUrl()}${p}`;
}

// Static asset host (mascot images, share art, marketing PNGs). Assets
// physically live at curriculate.net today; when they're migrated to
// qrewzi.com's CDN, flip this to `brandRootUrl()` and delete the note.
// Cross-origin loads from qrewzi hosts work fine (no auth needed).
export function brandAssetBase() {
  return "https://curriculate.net";
}

// The play surface host — used by the QR scanner and deep-link detectors
// to recognize a "this is one of ours" URL regardless of which brand
// domain the app is currently running under. Both hosts are accepted.
export const PLAY_HOSTS = ["play.curriculate.net", "play.qrewzi.com"];

// The teacher/GameMaster host — same idea.
export const TEACHER_HOSTS = ["set.curriculate.net", "set.qrewzi.com"];

// Recognize a scanned or pasted URL as one of our own play-surface links.
export function isPlaySurfaceUrl(str) {
  if (typeof str !== "string") return false;
  return PLAY_HOSTS.some((h) => str.includes(`${h}/`));
}

// Mascot identity — same fox 🦊, different name per brand.
// Old brand called it "Crue", new brand calls it "Qrew".
export function mascotName() {
  return isQrewziHost() ? "Qrew" : "Crue";
}
