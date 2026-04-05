// backend/ai/openai.js
// Singleton OpenAI client — import { openai } from "../ai/openai.js" anywhere in the backend.

import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn("[openai] OPENAI_API_KEY is not set — AI features will fail at runtime.");
}

export const openai = apiKey ? new OpenAI({ apiKey }) : null;

export default openai;
