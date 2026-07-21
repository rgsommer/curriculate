// backend/services/stocksEncryption.js
//
// AES-256-GCM at-rest encryption for user-provided secrets (Gmail app
// password, future broker API keys, etc). One key per environment,
// loaded from STOCKS_INTEGRATION_KEY (32 bytes, base64-encoded).
//
// The envelope format we persist is a single base64-encoded JSON blob:
//   { v: 1, iv: b64, ct: b64, tag: b64 }
// so the schema only needs one string column and the envelope is
// self-contained if we ever migrate ciphers.

import crypto from "crypto";

const ENV_VAR = "STOCKS_INTEGRATION_KEY";

function loadKey() {
  const raw = process.env[ENV_VAR];
  if (!raw) {
    const err = new Error(`${ENV_VAR} not set — generate 32 bytes: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" and add to Render env`);
    err.code = "MISSING_ENCRYPTION_KEY";
    throw err;
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    const err = new Error(`${ENV_VAR} must decode to exactly 32 bytes; got ${buf.length}`);
    err.code = "INVALID_ENCRYPTION_KEY";
    throw err;
  }
  return buf;
}

export function isEncryptionConfigured() {
  try { loadKey(); return true; } catch { return false; }
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string") throw new Error("encryptSecret expects a string");
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = {
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function decryptSecret(envelopeB64) {
  if (typeof envelopeB64 !== "string" || !envelopeB64) throw new Error("decryptSecret expects a non-empty string");
  const key = loadKey();
  let env;
  try { env = JSON.parse(Buffer.from(envelopeB64, "base64").toString("utf8")); }
  catch { throw new Error("decryptSecret: envelope is not valid base64-encoded JSON"); }
  if (env.v !== 1) throw new Error(`decryptSecret: unknown envelope version ${env.v}`);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(env.ct, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

// Return a masked preview of a secret for UI display. Never expose the
// full string — the browser only ever sees the mask + length hint.
export function maskSecret(plaintext) {
  if (!plaintext) return "";
  if (plaintext.length <= 6) return "•".repeat(plaintext.length);
  return `${plaintext.slice(0, 2)}${"•".repeat(Math.max(4, plaintext.length - 4))}${plaintext.slice(-2)}`;
}
