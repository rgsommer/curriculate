// backend/services/taskImageGen.js
//
// Pre-generates the images for image-based tasks at TASKSET-CREATION time so
// rendering is instant (no waiting, no flaky external fetch at play time).
//
// Sources, in priority:
//   - AI image generation (OpenAI gpt-image-1) when allowed by the teacher
//   - photo-real search (Openverse, CC-licensed, keyless) otherwise / as fallback
// then uploads the bytes to S3 and rewrites the task's image fields to the
// stored URL.
//
// Authenticity rule: historical-doc / art-view / legends ALWAYS prefer real
// photos (an AI-generated "Mona Lisa" or "Lincoln" would be a misleading
// fabrication), so they ignore the AI-allowed toggle and search. diff-detective
// "compare" mode (e.g. a 1950s vs a 2025 microscope) honors the toggle.
//
// Everything here is best-effort and env-guarded: with no OPENAI_API_KEY / no
// S3 bucket it no-ops and the task keeps its existing fallbacks (SVG scene,
// text descriptions, bundled local images).

import OpenAI from "openai";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3_BUCKET = process.env.S3_BUCKET || "";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const PRESIGN_SECONDS = 7 * 24 * 60 * 60; // SigV4 max (7 days)

// Image model config. gpt-image-1 is OpenAI's best, but Google's Gemini image
// model is stronger on likeness + instruction-following (better for accurate
// historical portraits). Prefer it when its key is set; otherwise fall back to
// OpenAI at HIGH quality. All env-overridable.
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image-preview";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

let _s3 = null;
function s3() {
  if (_s3) return _s3;
  if (!S3_BUCKET) return null;
  _s3 = new S3Client({ region: AWS_REGION });
  return _s3;
}

let _oai = null;
function oai() {
  if (_oai) return _oai;
  if (!process.env.OPENAI_API_KEY) return null;
  _oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _oai;
}

/**
 * Sign a stored S3 key into a temporary GET URL. Lets reports/viewers resolve
 * submitted artifacts that were stored as a bare key (or refresh an expired
 * URL). Returns null if S3 isn't configured or the key is missing.
 */
export async function signS3Key(key, expiresIn = 7 * 24 * 60 * 60) {
  const client = s3();
  if (!client || !key) return null;
  try {
    return await getSignedUrl(client, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn });
  } catch {
    return null;
  }
}

export function imageStorageAvailable() {
  return !!s3();
}

async function uploadImage(buffer, contentType, label) {
  const client = s3();
  if (!client) return null;
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const key = `task-images/${Date.now()}-${Math.random().toString(16).slice(2)}-${label}.${ext}`;
  await client.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: contentType })
  );
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn: PRESIGN_SECONDS }
  );
  return { key, url };
}

// Google Gemini native image generation (generateContent + IMAGE modality).
async function genGeminiImage(fullPrompt) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p?.inlineData?.data);
  if (!img) return null;
  return {
    buffer: Buffer.from(img.inlineData.data, "base64"),
    contentType: img.inlineData.mimeType || "image/png",
  };
}

// OpenAI gpt-image-1 at HIGH quality.
async function genOpenAiImage(fullPrompt) {
  const client = oai();
  if (!client) return null;
  const resp = await client.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt: fullPrompt,
    size: "1024x1024",
    quality: "high",
    n: 1,
  });
  const b64 = resp?.data?.[0]?.b64_json;
  if (!b64) return null;
  return { buffer: Buffer.from(b64, "base64"), contentType: "image/png" };
}

// Generate one image, preferring the stronger model when configured.
async function genAiImage(prompt) {
  const fullPrompt = `Clear, classroom-appropriate, well-lit, neutral-background image. ${prompt}`;
  try {
    const g = await genGeminiImage(fullPrompt);
    if (g) return g;
  } catch (_) {}
  try {
    return await genOpenAiImage(fullPrompt);
  } catch (_) {
    return null;
  }
}

async function searchPhoto(query) {
  try {
    const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial&page_size=5`;
    const res = await fetch(u, { headers: { "User-Agent": "Curriculate/1.0 (classroom)" } });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (data?.results || []).find((r) => r?.url);
    if (!hit?.url) return null;
    const imgRes = await fetch(hit.url, { headers: { "User-Agent": "Curriculate/1.0 (classroom)" } });
    if (!imgRes.ok) return null;
    const ct = imgRes.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return { buffer, contentType: ct };
  } catch {
    return null;
  }
}

// Source ONE image: AI-gen (if allowed) → photo search fallback → null. Upload
// to S3 and return { key, url } or null.
async function sourceOne({ prompt, query, allowAi, label }) {
  let img = null;
  if (allowAi) {
    try { img = await genAiImage(prompt); } catch (_) {}
  }
  if (!img) {
    img = await searchPhoto(query || prompt);
  }
  if (!img) return null;
  try {
    return await uploadImage(img.buffer, img.contentType, label);
  } catch (_) {
    return null;
  }
}

/**
 * Pre-generate images for an image-based task. Mutates + returns the task.
 * Always graceful — on any failure or missing config the task is left unchanged
 * so its existing fallbacks (SVG scene / text / bundled image) still apply.
 *
 * @param {object} task
 * @param {{ allowAi?: boolean }} opts - allowAi from TeacherProfile.allowAiGeneratedImages
 */
export async function pregenerateTaskImages(task, { allowAi = true } = {}) {
  if (!task || typeof task !== "object") return task;
  if (!imageStorageAvailable()) return task; // nowhere to store → skip
  const type = String(task.taskType || task.type || "");
  const cfg = task.config || {};

  try {
    // diff-detective "compare two real subjects" (honors the AI toggle)
    if (type === "diff-detective" && task.subjectA && task.subjectB) {
      const [a, b] = await Promise.all([
        sourceOne({ prompt: task.imagePromptA || task.subjectA, query: task.subjectA, allowAi, label: "a" }),
        sourceOne({ prompt: task.imagePromptB || task.subjectB, query: task.subjectB, allowAi, label: "b" }),
      ]);
      if (a && b) {
        task.mode = "image";
        task.imageA = a.url; task.imageAKey = a.key;
        task.imageB = b.url; task.imageBKey = b.key;
        task.labelA = task.labelA || task.subjectA;
        task.labelB = task.labelB || task.subjectB;
      }
      // else: keep mode "compare" → renderer shows the text descriptions + list
      return task;
    }

    // Label Me: generate the diagram from imagePrompt (honors the AI toggle).
    if (type === "labelme" && !task.imageUrl) {
      const prompt = task.imagePrompt || task.config?.imagePrompt || task.title;
      if (prompt) {
        const got = await sourceOne({
          prompt: `Clean, high-contrast educational diagram, simple flat illustration, no text or letter labels. ${prompt}`,
          query: String(task.title || prompt).slice(0, 80),
          allowAi,
          label: "labelme",
        });
        if (got) {
          task.imageUrl = got.url;
          task.imageS3Key = got.key;
        }
      }
      return task;
    }

    // Authenticity-critical: always source a REAL image (ignore AI toggle).
    if (type === "historical-doc" || type === "art-view") {
      const subject =
        cfg.imageTitle || cfg.docTitle || cfg.imageDescription || task.title || "";
      if (subject) {
        const got = await sourceOne({ prompt: subject, query: subject, allowAi: false, label: type });
        if (got) {
          task.config = cfg;
          task.config.imageUrl = got.url;
          task.config.imageS3Key = got.key;
        }
      }
      return task;
    }

    if (type === "legends") {
      // Unlike documents/artworks (which must be the real artifact), a figure's
      // portrait CAN be AI-generated as long as it's historically accurate — so
      // legends honors the teacher's allowAiGeneratedImages toggle. The prompt
      // demands fidelity to the real, documented appearance; search is the
      // fallback (and the only source when AI is off).
      const fig = cfg.figure || {};
      if (fig.name) {
        const got = await sourceOne({
          prompt:
            `Historically accurate, realistic portrait of ${fig.name}` +
            (fig.era ? `, ${fig.era}` : "") +
            `. True to their real, documented appearance — period-accurate face, clothing, and setting. No text or captions.`,
          query: fig.name,
          allowAi,
          label: "legend",
        });
        if (got && task.config?.figure) {
          task.config.figure.portraitUrl = got.url;
          task.config.figure.portraitS3Key = got.key;
        }
      }
      return task;
    }
  } catch (e) {
    console.warn("[taskImageGen] pregenerate failed (non-fatal):", e?.message);
  }
  return task;
}

export default pregenerateTaskImages;
