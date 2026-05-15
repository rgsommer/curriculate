/**
 * Trading-card evaluator routes.
 *
 *   POST /cards/grade
 *     body: {
 *       mode: "identify" | "evaluate",
 *       frontDataUrl: "data:image/jpeg;base64,...",
 *       backDataUrl:  "data:image/jpeg;base64,...",
 *       meta?: { type, year, name, set, number, graded, notes }   // evaluate only
 *     }
 *     returns: { result: <parsed-json-from-openai> }
 *
 * Backs the public /cards page on curriculate.net. Uses the same OpenAI
 * key (process.env.OPENAI_API_KEY) and lazy client pattern as the rest of
 * the backend.
 *
 * Default model: gpt-4o-mini. Override with CARDS_OPENAI_MODEL.
 */
import express from "express";
import OpenAI from "openai";

const router = express.Router();
const MODEL = process.env.CARDS_OPENAI_MODEL || "gpt-4o-mini";

// ---------- lazy OpenAI client (same pattern as index.js) ----------
let _openai = null;
function openai() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  _openai = new OpenAI({ apiKey });
  return _openai;
}

// ---------- light per-IP rate limit ----------
const RATE = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 40; // per IP per 10 min
function rateLimit(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const arr = (RATE.get(ip) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) return res.status(429).json({ error: "rate_limit" });
  arr.push(now);
  RATE.set(ip, arr);
  next();
}

// ---------- prompts ----------
function identifyPrompt() {
  return [
    "You are an expert trading-card identifier. Look at the two attached images of a single trading card (front, then back) and identify what it is.",
    "",
    "Return ONLY a single JSON object — no prose, no markdown, no code fences. Use this exact schema:",
    "{",
    '  "type": "Pokemon | Baseball | Hockey | Basketball | Football | Soccer | Magic: The Gathering | Yu-Gi-Oh! | Other / Unknown",',
    '  "year": "string year or empty",',
    '  "name": "player or character name, or empty",',
    '  "set": "set / brand name, or empty",',
    '  "number": "card number as printed (e.g. 4/102), or empty",',
    '  "graded": "Raw | PSA | BGS / Beckett | CGC | SGC | Other slab"',
    "}",
    "",
    'Use the exact type strings shown. If a field is not visible or you are unsure, return "". For "graded", "Raw" means the card is not in a graded slab.',
  ].join("\n");
}

function evaluatePrompt(meta = {}) {
  return [
    "You are an expert trading-card grader and appraiser with deep knowledge of Pokemon, sports cards (baseball, hockey, basketball, football, soccer), MTG, Yu-Gi-Oh!, and other collectibles.",
    "",
    "Two images of a single trading card are attached (front, then back), followed by user-supplied details. Inspect the images for centering, corner wear, edge whitening/chipping, surface scratches/print defects, glossiness, and any condition issues. If the images are unclear, lean conservatively but still produce an estimate using the user's details.",
    "",
    "Return ONLY a single JSON object — no prose, no markdown, no code fences. Use this exact schema:",
    "{",
    '  "identification": { "type": "...", "player_or_character": "...", "year": "...", "set": "...", "card_number": "...", "rarity": "...", "notes": "..." },',
    '  "scales": { "centering": 0-10, "corners": 0-10, "edges": 0-10, "surface": 0-10 },',
    '  "overall_grade": 0-10,',
    '  "grade_label": "Gem Mint | Mint | NM-MT | Near Mint | EX-MT | Excellent | VG-EX | Very Good | Good | Fair | Poor",',
    '  "authenticity_confidence": "High | Medium | Low",',
    '  "valuation_usd": { "low": <number>, "mid": <number>, "high": <number> },',
    '  "highlights": ["..."],',
    '  "concerns": ["..."],',
    '  "recommendations": ["..."]',
    "}",
    "",
    "All four scale values must be numbers 0–10 (decimals allowed). overall_grade is a holistic 0–10 (decimals like 8.5 are fine). Valuation is a realistic raw/ungraded market estimate in USD unless the user indicates the card is already slabbed — in which case price it as graded at that company at that grade.",
    "",
    "USER-SUPPLIED DETAILS:",
    `- Card type: ${meta.type || "(unknown)"}`,
    `- Year: ${meta.year || "(unknown)"}`,
    `- Player / Character: ${meta.name || "(unknown)"}`,
    `- Set / Brand: ${meta.set || "(unknown)"}`,
    `- Card number: ${meta.number || "(unknown)"}`,
    `- Grading status: ${meta.graded || "Raw"}`,
    `- User observations: ${meta.notes || "(none)"}`,
  ].join("\n");
}

// ---------- json extraction (defensive in case the model wraps the JSON) ----------
function extractJson(text) {
  if (!text) throw new Error("Model returned an empty response.");
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Model did not return JSON.");
  }
  return JSON.parse(s.slice(first, last + 1));
}

function isDataUrl(s) {
  return typeof s === "string" && s.startsWith("data:image/");
}

// ---------- POST /cards/grade ----------
router.post("/grade", rateLimit, async (req, res) => {
  try {
    const { mode, frontDataUrl, backDataUrl, meta } = req.body || {};

    if (mode !== "identify" && mode !== "evaluate") {
      return res.status(400).json({ error: "mode must be 'identify' or 'evaluate'." });
    }
    if (!isDataUrl(frontDataUrl) || !isDataUrl(backDataUrl)) {
      return res
        .status(400)
        .json({ error: "frontDataUrl and backDataUrl must be base64 data: URLs (image/*)." });
    }

    const prompt = mode === "identify" ? identifyPrompt() : evaluatePrompt(meta || {});

    const completion = await openai().chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: frontDataUrl, detail: "high" } },
            { type: "image_url", image_url: { url: backDataUrl, detail: "high" } },
          ],
        },
      ],
    });

    const text = completion?.choices?.[0]?.message?.content || "";
    const result = extractJson(text);
    res.json({ result });
  } catch (err) {
    const message = err?.message || "Unknown error";
    console.error("[cards/grade] error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
