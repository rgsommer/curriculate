// backend/routes/voice.js
import express from "express";
import OpenAI from "openai";
import { getTeacherVoice } from "../services/voiceCloning.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post("/generate", async (req, res) => {
  const { text, teacherId } = req.body;

  if (!text || !teacherId) {
    return res.status(400).json({ error: "Missing text or teacherId" });
  }

  try {
    // Step 1: Get teacher's cloned voice ID (cached)
    const voiceId = await getTeacherVoice(teacherId); // returns ElevenLabs voice ID

    // Step 2: Generate speech in teacher's voice
    const mp3 = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability: 0.8, similarity_boost: 0.9 },
      }),
    });

    const audioBuffer = await mp3.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString("base64");
    const audioUrl = `data:audio/mp3;base64,${base64}`;

    res.json({ audioUrl });
  } catch (err) {
    console.error("Voice generation failed:", err);
    res.status(500).json({ error: "Failed to generate voice" });
  }
});

export default router;