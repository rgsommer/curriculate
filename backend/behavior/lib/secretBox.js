// backend/behavior/lib/secretBox.js
//
// Tiny authenticated-encryption helper for secrets stored at rest (brief §4.3,
// §10) — specifically the Edsby session cookie. AES-256-GCM with a key derived
// from BEHAVIOR_SECRET_KEY (falls back to JWT_SECRET so prod works without a new
// env var). Secrets are NEVER stored in plaintext and NEVER returned to clients.

import crypto from "crypto";

function key() {
  const s = process.env.BEHAVIOR_SECRET_KEY || process.env.JWT_SECRET;
  if (!s) throw new Error("No BEHAVIOR_SECRET_KEY / JWT_SECRET set for secret encryption");
  return crypto.createHash("sha256").update(String(s)).digest(); // 32 bytes
}

/** Encrypt a UTF-8 string → base64 blob (iv|tag|ciphertext). */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt a base64 blob from encrypt() → UTF-8 string. Returns "" on failure. */
export function decrypt(b64) {
  try {
    const buf = Buffer.from(String(b64 || ""), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}
