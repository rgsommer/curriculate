// backend/routes/speech.js
import express from "express";
import multer from "multer";
import { openai } from "../ai/openai.js"; // assuming you have an openai instance exported
import { authRequired } from "../middleware/authRequired.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Ensure OpenAI client is available
if (!openai) {
  console.error("OpenAI client not initialized in openai.js");
}

/**
 * POST /api/speech/transcribe
 * 
 * Accepts:
 * - audio file (webm, mp3, wav, etc.)
 * - Optional: language code (e.g., "en", "es")
 * 
 * Returns:
 * {
 *   transcript: "Hello, how are you today?",
 *   confidence: 0.98,
 *   language: "en"
 * }
 */
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const { language } = req.body; // optional language hint

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname || "speech.webm";
    const mimeType = req.file.mimetype || "audio/webm";

    // Create a proper File object for OpenAI
    const audioFile = new File([fileBuffer], fileName, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
      language: language || undefined, // let Whisper auto-detect if not provided
      response_format: "verbose_json", // gives confidence, language, etc.
    });

    res.json({
      success: true,
      transcript: transcription.text.trim(),
      confidence: transcription.segments?.[0]?.avg_logprob
        ? Math.exp(transcription.segments[0].avg_logprob)
        : 0.95,
      language: transcription.language || "unknown",
      duration: transcription.duration || null,
    });
  } catch (err) {
    console.error("Whisper transcription failed:", err.message || err);

    // Handle specific OpenAI errors
    if (err.status === 401) {
      return res.status(500).json({ error: "OpenAI API key invalid" });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: "Rate limited by OpenAI" });
    }
    if (err.message?.includes("file size")) {
      return res.status(400).json({ error: "Audio file too large" });
    }

    res.status(500).json({ error: "Speech transcription failed" });
  }
});

/**
 * POST /api/speech/transcribe/stream
 * 
 * For live streaming transcription (used in debate live display)
 * Accepts raw audio chunks
 */
router.post("/transcribe/stream", upload.single("chunk"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio chunk" });
    }

    const audioChunk = req.file.buffer;
    const file = new File([audioChunk], "chunk.webm", { type: "audio/webm" });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      response_format: "text",
    });

    res.json({ transcript: transcription.trim() });
  } catch (err) {
    console.error("Live transcription chunk failed:", err);
    res.status(500).json({ error: "Live transcription failed" });
  }
});

export default router;