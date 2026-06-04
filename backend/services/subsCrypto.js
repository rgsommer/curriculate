// backend/services/subsCrypto.js
//
// Encryption-at-rest for sensitive lesson-plan credentials (challenge #6:
// classroom-system logins/passwords). AES-256-GCM with a key from
// SUBS_ENCRYPTION_KEY. We refuse to store credentials when no key is set —
// we NEVER persist them in plaintext — and we never log decrypted values.
//
// Stored form: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>". GCM gives us
// authenticated encryption, so tampering is detected on decrypt.

import crypto from "crypto";

function getKey() {
  const raw = process.env.SUBS_ENCRYPTION_KEY || "";
  if (!raw) return null;
  // Accept hex (64 chars) or base64; must resolve to 32 bytes.
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    // Last resort: derive a 32-byte key so a misformatted but present key
    // still works deterministically (better than failing closed in dev).
    buf = crypto.createHash("sha256").update(raw).digest();
  }
  return buf;
}

export function encryptionAvailable() {
  return !!getKey();
}

export function encryptSecret(plaintext) {
  const key = getKey();
  if (!key) throw new Error("SUBS_ENCRYPTION_KEY not set — cannot store credentials securely");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored) {
  const key = getKey();
  if (!key) throw new Error("SUBS_ENCRYPTION_KEY not set — cannot decrypt credentials");
  const [v, ivB64, tagB64, ctB64] = String(stored || "").split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("Malformed encrypted value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
