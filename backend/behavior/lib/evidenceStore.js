// backend/behavior/lib/evidenceStore.js
//
// Private storage for behaviour photo/video evidence. These are images of
// minors, so they live in a PRIVATE S3 bucket — we keep only the bare object
// key on the incident and hand out short-lived signed URLs on demand, never a
// public link. Mirrors the app's existing S3 usage (services/taskImageGen.js).

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const S3_BUCKET = process.env.S3_BUCKET || "";
const AWS_REGION = process.env.AWS_REGION || "us-east-2";
const GET_EXPIRY = Number(process.env.S3_GET_URL_EXPIRY_SECONDS || 3600); // 1h

let _s3 = null;
function s3() {
  if (_s3) return _s3;
  if (!S3_BUCKET) return null;
  _s3 = new S3Client({ region: AWS_REGION });
  return _s3;
}

export function evidenceStorageAvailable() {
  return !!s3();
}

const EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/3gpp": "3gp",
};

export function kindFor(contentType) {
  return String(contentType || "").startsWith("video/") ? "video" : "image";
}

export function isAllowedType(contentType) {
  const c = String(contentType || "").toLowerCase();
  return c.startsWith("image/") || c.startsWith("video/");
}

/**
 * Store one evidence file under a school-namespaced key. Returns the metadata to
 * persist on the incident (never a URL — sign on demand).
 */
export async function uploadEvidence({ buffer, contentType, schoolId }) {
  const client = s3();
  if (!client) throw new Error("Evidence storage is not configured (S3_BUCKET missing).");
  const ext = EXT[String(contentType || "").toLowerCase()] || (kindFor(contentType) === "video" ? "mp4" : "jpg");
  const rand = crypto.randomBytes(8).toString("hex");
  const key = `behavior-evidence/${schoolId}/${Date.now()}-${rand}.${ext}`;
  await client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  return { key, kind: kindFor(contentType), contentType, size: buffer.length };
}

/** Short-lived signed GET URL for a stored key (null if unavailable). */
export async function signEvidenceKey(key, expiresIn = GET_EXPIRY) {
  const client = s3();
  if (!client || !key) return null;
  try {
    return await getSignedUrl(client, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn });
  } catch {
    return null;
  }
}

/** Best-effort delete (used when an incident is removed). Never throws. */
export async function deleteEvidenceKey(key) {
  const client = s3();
  if (!client || !key) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch {
    /* ignore — orphaned objects are harmless */
  }
}
