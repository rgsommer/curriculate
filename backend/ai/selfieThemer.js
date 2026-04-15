// backend/ai/selfieThemer.js
// AI-themed team selfie image generation.
//
// Takes a team selfie photo and generates a themed version based on the
// taskset subject / topic. For example, a history lesson generates a
// period-era version of the team photo; a science lesson places them
// in a lab; a math lesson adds a famous mathematician, etc.

import { openai } from "./openai.js";
import { toFile } from "openai";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

// Lazy S3 client getter (avoid circular imports — mirrors the pattern in index.js)
let _s3 = null;
async function getS3() {
  if (_s3) return _s3;
  const { S3Client } = await import("@aws-sdk/client-s3");
  _s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-2" });
  return _s3;
}

const BUCKET = process.env.S3_BUCKET;
const GET_EXPIRY = Number(process.env.S3_GET_URL_EXPIRY_SECONDS || 3600);

// ── Theme prompt templates ──────────────────────────────────────────────
// The AI prompt is composed based on subject + optional theme hint.
// These provide the "lens" for the image transformation.

const SUBJECT_PROMPTS = {
  history: "Transform this group photo into a historical scene. Dress the people in period-appropriate clothing and set the background to a historical setting matching the era: {theme}. Keep faces and expressions recognizable. Painterly, rich color palette.",
  science: "Transform this group photo into a science lab scene. Dress the people in lab coats and safety goggles, surround them with beakers, microscopes, and scientific equipment. Background should be a well-equipped laboratory. Keep faces recognizable. Bright, clean style.",
  math: "Transform this group photo into a mathematics-themed scene. Add mathematical symbols, equations, and geometric shapes floating around them. Place a famous mathematician (like Euler or Gauss) standing with the group. Chalkboard background with elegant equations. Keep all original faces recognizable.",
  english: "Transform this group photo into a literary scene. Dress the people as characters from classic literature in a grand library setting with towering bookshelves. Quill pens and scrolls on the desk. Warm, golden lighting. Keep faces recognizable.",
  geography: "Transform this group photo into an explorer/adventure scene. Dress the people as explorers with maps, compasses, and binoculars. Background shows a dramatic landscape with mountains, rivers, and a vintage map overlay. Keep faces recognizable.",
  art: "Transform this group photo into a Renaissance painting style. Dress the people in Renaissance clothing in an artist's studio with easels, palettes, and classical sculptures. Rich, warm oil-painting aesthetic. Keep faces recognizable.",
  music: "Transform this group photo into a concert/music scene. Give the people musical instruments and stage lighting. Background is a concert hall or recording studio. Dynamic, vibrant style. Keep faces recognizable.",
  french: "Transform this group photo into a Parisian scene. Place the people in front of the Eiffel Tower, dress them in classic French fashion with berets and scarves. Sidewalk cafe setting. Charming, watercolor style. Keep faces recognizable.",
  spanish: "Transform this group photo into a vibrant Spanish/Latin scene. Colorful market or plaza setting with traditional architecture. Warm, festive atmosphere. Keep faces recognizable.",
  physical_education: "Transform this group photo into an Olympic podium scene. Dress the people in athletic gear with gold medals. Stadium background with cheering crowd. Dynamic, energetic style. Keep faces recognizable.",
  religion: "Transform this group photo into a scene of historical scholars studying ancient texts. Scholarly robes, scrolls, and a grand stone library. Warm candlelight atmosphere. Respectful and dignified tone. Keep faces recognizable.",
  default: "Transform this group photo into a creative, fun, themed scene related to: {theme}. Keep all faces recognizable. Vibrant, colorful style that students would enjoy.",
};

/**
 * Build the generation prompt from subject + theme.
 */
function buildPrompt(subject, theme) {
  const key = (subject || "").toLowerCase().replace(/[^a-z_]/g, "_");
  let template = SUBJECT_PROMPTS[key] || SUBJECT_PROMPTS.default;
  template = template.replace(/\{theme\}/g, theme || subject || "school");
  return template;
}

/**
 * Download an image from S3 by key, returning a Buffer.
 */
async function downloadFromS3(key) {
  const s3 = await getS3();
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const res = await s3.send(cmd);

  // Convert readable stream to buffer
  const chunks = [];
  for await (const chunk of res.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Upload a buffer to S3, return the key and a signed GET URL.
 */
async function uploadToS3(buffer, roomCode, teamId, contentType = "image/png") {
  const s3 = await getS3();
  const ext = contentType.includes("png") ? "png" : "jpg";
  const key = `sessions/${roomCode}/${teamId}/team-selfie/themed-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: { purpose: "themed-selfie", roomcode: roomCode, teamid: teamId },
    })
  );

  const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const signedUrl = await getSignedUrl(s3, getCmd, { expiresIn: GET_EXPIRY });

  return { key, signedUrl };
}

/**
 * Generate a themed version of the team selfie.
 *
 * @param {object} opts
 * @param {string} opts.selfieKey  - S3 key of the original selfie JPEG
 * @param {string} opts.subject    - e.g. "history", "math", "science"
 * @param {string} opts.theme      - more specific topic: "Ancient Rome", "Algebra", etc.
 * @param {string} opts.roomCode
 * @param {string} opts.teamId
 * @returns {Promise<{ themedKey: string, themedUrl: string }>}
 */
export async function generateThemedSelfie({ selfieKey, subject, theme, roomCode, teamId }) {
  if (!openai) throw new Error("OpenAI client not configured");
  if (!BUCKET) throw new Error("S3_BUCKET not configured");
  if (!selfieKey) throw new Error("selfieKey is required");

  console.log(`[selfieThemer] Generating themed selfie: subject=${subject}, theme=${theme}, key=${selfieKey}`);

  // 1. Download original selfie from S3
  const originalBuffer = await downloadFromS3(selfieKey);

  // 2. Build prompt
  const prompt = buildPrompt(subject, theme);
  console.log(`[selfieThemer] Prompt: ${prompt.slice(0, 120)}...`);

  // 3. Call OpenAI image edit API
  // We use images.edit for image transformation (keeps the original as reference)
  // Convert buffer to a File-like object for the OpenAI API (Node 18+ compat)
  const imageFile = await toFile(originalBuffer, "selfie.jpg", { type: "image/jpeg" });

  let resultBuffer;
  try {
    // Try gpt-image-1 first (best quality for edits)
    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "low", // keep costs reasonable for classroom use
    });

    // gpt-image-1 returns base64
    const b64 = response.data?.[0]?.b64_json;
    if (b64) {
      resultBuffer = Buffer.from(b64, "base64");
    } else if (response.data?.[0]?.url) {
      // Some models return a URL instead
      const imgRes = await fetch(response.data[0].url);
      resultBuffer = Buffer.from(await imgRes.arrayBuffer());
    } else {
      throw new Error("No image data in OpenAI response");
    }
  } catch (editErr) {
    console.warn(`[selfieThemer] Image edit failed, trying generation fallback:`, editErr.message);

    // Fallback: generate a themed illustration (no actual photo transformation)
    try {
      const fallbackPrompt = `A fun, colorful illustrated team card for a group of students. ${prompt}. Cartoon/illustration style suitable for a classroom. Include text area for team name.`;
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: fallbackPrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
        response_format: "b64_json",
      });

      const b64 = response.data?.[0]?.b64_json;
      if (!b64) throw new Error("No image data in fallback response");
      resultBuffer = Buffer.from(b64, "base64");
    } catch (genErr) {
      console.error(`[selfieThemer] Both image edit and generation failed:`, genErr.message);
      throw new Error("AI image generation failed — please try again later");
    }
  }

  // 4. Upload themed image to S3
  const { key, signedUrl } = await uploadToS3(resultBuffer, roomCode, teamId, "image/png");

  console.log(`[selfieThemer] Themed selfie saved: ${key}`);
  return { themedKey: key, themedUrl: signedUrl };
}
