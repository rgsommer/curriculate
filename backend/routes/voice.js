// backend/routes/voice.js
import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import TeacherProfile from "../models/TeacherProfile.js";
import { authRequired } from "../middleware/authRequired.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!ELEVENLABS_API_KEY) {
  console.error("ELEVENLABS_API_KEY is missing in .env");
}

// Helper: Get or create cloned voice for teacher
async function getOrCreateTeacherVoice(teacherId) {
  let profile = await TeacherProfile.findOne({ userId: teacherId });

  if (profile?.voiceId) {
    return profile.voiceId;
  }

  // Create new profile if none exists
  if (!profile) {
    profile = new TeacherProfile({ userId: teacherId });
  }

  // Use a high-quality default voice as fallback
  const fallbackVoiceId = "EXAVITQu4vr4xnSDxMaL"; // Rachel - clear, warm, professional

  // Optional: auto-clone on first use if sample exists
  if (profile.voiceSampleUrl) {
    try {
      const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `Teacher_${teacherId}`,
          description: `Auto-cloned voice for teacher ${teacherId}`,
          files: [{ file_name: "sample.wav", file_data: profile.voiceSampleUrl.split(",")[1] }],
        }),
      });

      const data = await response.json();
      if (response.ok && data.voice_id) {
        profile.voiceId = data.voice_id;
        profile.voiceClonedAt = new Date();
        await profile.save();
        return data.voice_id;
      }
    } catch (err) {
      console.error("Auto-cloning failed for teacher", teacherId, err);
    }
  }

  // Final fallback
  profile.voiceId = fallbackVoiceId;
  await profile.save();
  return fallbackVoiceId;
}

// POST /api/voice/clone - Teacher uploads a 15-60 sec sample
router.post("/clone", authRequired, upload.single("sample"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const base64Audio = req.file.buffer.toString("base64");

    const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Teacher_${req.user.id}_${Date.now()}`,
        description: `Cloned voice for teacher ${req.user.name || req.user.id}`,
        files: [{
          file_name: "sample.wav",
          file_data: base64Audio,
        }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.detail || "ElevenLabs cloning failed" });
    }

    await TeacherProfile.findOneAndUpdate(
      { userId: req.user.id },
      {
        voiceId: data.voice_id,
        voiceSampleUrl: `data:audio/wav;base64,${base64Audio}`,
        voiceClonedAt: new Date(),
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: "Your voice has been cloned successfully!",
      voiceId: data.voice_id,
    });
  } catch (err) {
    console.error("Voice clone error:", err);
    res.status(500).json({ error: "Failed to clone voice" });
  }
});

// POST /api/voice/generate - Generate speech in teacher's cloned voice
router.post("/generate", authRequired, async (req, res) => {
  const { text, teacherId } = req.body;

  if (!text?.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  const targetTeacherId = teacherId || req.user.id;

  try {
    const voiceId = await getOrCreateTeacherVoice(targetTeacherId);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.85,
          similarity_boost: 0.92,
          style: 0.1,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("ElevenLabs TTS failed:", err);
      return res.status(500).json({ error: "Speech generation failed" });
    }

    // Stream directly to client (for low latency)
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    response.body.pipe(res);
  } catch (err) {
    console.error("Voice generation error:", err);
    res.status(500).json({ error: "Failed to generate speech" });
  }
});

// GET /api/voice/status - Check if teacher has cloned voice
router.get("/status", authRequired, async (req, res) => {
  try {
    const profile = await TeacherProfile.findOne({ userId: req.user.id });
    res.json({
      hasClonedVoice: !!profile?.voiceId && profile.voiceId !== "EXAVITQu4vr4xnSDxMaL",
      voiceId: profile?.voiceId,
      clonedAt: profile?.voiceClonedAt,
    });
  } catch (err) {
    console.error("Voice status error:", err);
    res.status(500).json({ error: "Failed to check voice status" });
  }
});

export default router;