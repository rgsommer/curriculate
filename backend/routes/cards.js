/**
 * Trading-card evaluator routes.
 *
 *   POST /cards/grade
 *     body: {
 *       mode: "identify" | "evaluate",
 *       frontDataUrls: ["data:image/jpeg;base64,...", ...],   // 1–6 images
 *       backDataUrls:  ["data:image/jpeg;base64,...", ...],   // 1–6 images
 *       meta?: { type, year, name, set, number, graded, notes }   // evaluate only
 *     }
 *     (Legacy single-image fields `frontDataUrl` / `backDataUrl` are also
 *     accepted for backwards compat.)
 *
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

// Self-consistency: fan out N evaluate calls in parallel and aggregate.
// Set CARDS_EVAL_RUNS=1 to disable. Default 3 ≈ 3× cost (~$0.04–0.06/card).
const EVAL_RUNS = Math.max(1, Math.min(7, parseInt(process.env.CARDS_EVAL_RUNS || "3", 10)));
const EVAL_TEMPERATURE = Number(process.env.CARDS_EVAL_TEMPERATURE || "0.7");

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
function identifyPrompt(frontCount, backCount) {
  const sentence =
    frontCount === 1 && backCount === 1
      ? "The first image is the FRONT and the second image is the BACK of one trading card."
      : `The first ${frontCount} image(s) are FRONT shots of one trading card; the next ${backCount} image(s) are BACK shots of the same card (different angles or lighting). Treat them all as one card.`;
  return [
    "You are an expert trading-card identifier.",
    sentence,
    "Identify what it is.",
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

function evaluatePrompt(meta = {}, frontCount = 1, backCount = 1) {
  const layout =
    frontCount === 1 && backCount === 1
      ? "Two images of a single trading card are attached (front, then back)"
      : `${frontCount} FRONT image(s) of a single trading card are attached first, followed by ${backCount} BACK image(s) of the same card (these may be different angles or lighting — treat them all as the same physical card)`;
  return [
    "You are an expert trading-card grader and appraiser with deep knowledge of Pokemon, sports cards (baseball, hockey, basketball, football, soccer), MTG, Yu-Gi-Oh!, and other collectibles.",
    "",
    `${layout}, followed by user-supplied details. Inspect the images for centering, corner wear, edge whitening/chipping, surface scratches/print defects, glossiness, and any condition issues. If the images are unclear, lean conservatively but still produce an estimate using the user's details.`,
    "",
    "PRICING REFERENCES — base your valuation_usd on typical recent prices from these three sources (use your training knowledge of how they price; you don't have live access):",
    "  • LOW  ≈ PriceCharting 'loose / ungraded' price tier for the same card. PriceCharting is the standard reference for the bottom end of the market — raw cards in played condition.",
    "  • MID  ≈ Recent eBay SOLD listings for the same card in roughly the condition you've graded above (raw if the user said Raw; graded at that company at that grade if slabbed). eBay sold listings are the most reliable real-world signal.",
    "  • HIGH ≈ Active TCGplayer market price (or near-mint asking) for the same card in similar or better condition. TCGplayer leans higher than eBay sold.",
    "",
    "If a source typically doesn't carry the card type (e.g., TCGplayer has limited sports-card depth), use your best judgment and lean on the others. Always produce three numbers, even if the spread is wide. Be realistic — don't anchor on hype prices.",
    "",
    "Also produce a clean 'search_query' string the user can paste into any of those sites to verify (e.g. '1999 Pokemon Base Set Charizard 4/102 Holo' — include year, set, name, card number, and rarity if visible). Keep it 4–10 words, no punctuation other than slashes for card numbers.",
    "",
    "Return ONLY a single JSON object — no prose, no markdown, no code fences. Use this exact schema:",
    "{",
    '  "identification": { "type": "...", "player_or_character": "...", "year": "...", "set": "...", "card_number": "...", "rarity": "...", "notes": "..." },',
    '  "scales": { "centering": 0-10, "corners": 0-10, "edges": 0-10, "surface": 0-10 },',
    '  "overall_grade": 0-10,',
    '  "grade_label": "Gem Mint | Mint | NM-MT | Near Mint | EX-MT | Excellent | VG-EX | Very Good | Good | Fair | Poor",',
    '  "authenticity_confidence": "High | Medium | Low",',
    '  "valuation_usd": { "low": <number>, "mid": <number>, "high": <number> },',
    '  "valuation_basis": { "low": "short note: e.g. \\"PriceCharting loose ~$30\\"", "mid": "short note: e.g. \\"recent eBay sold avg ~$50 for NM raw\\"", "high": "short note: e.g. \\"TCGplayer market ~$72\\"" },',
    '  "search_query": "compact query string for comp lookup",',
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

const MAX_PHOTOS_PER_SIDE = 6;

// Coerce input that may be a single data URL, an array of data URLs, or missing.
// Returns { ok: true, urls: [...] } or { ok: false, error: "..." }.
function coercePhotos(input, fallbackSingle, sideLabel) {
  let urls = [];
  if (Array.isArray(input)) {
    urls = input.filter((s) => typeof s === "string");
  } else if (typeof input === "string") {
    urls = [input];
  } else if (typeof fallbackSingle === "string") {
    urls = [fallbackSingle];
  }
  if (urls.length === 0) {
    return { ok: false, error: `Missing ${sideLabel} photo(s).` };
  }
  if (urls.length > MAX_PHOTOS_PER_SIDE) {
    return { ok: false, error: `Too many ${sideLabel} photos (max ${MAX_PHOTOS_PER_SIDE}).` };
  }
  for (const u of urls) {
    if (!isDataUrl(u)) {
      return { ok: false, error: `${sideLabel} photos must be base64 data: URLs (image/*).` };
    }
  }
  return { ok: true, urls };
}

// ---------- one OpenAI call ----------
async function runOpenAI({ prompt, frontDataUrls, backDataUrls, temperature }) {
  const imageContent = [
    ...frontDataUrls.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } })),
    ...backDataUrls.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } })),
  ];
  const completion = await openai().chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    temperature,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }, ...imageContent],
      },
    ],
  });
  const text = completion?.choices?.[0]?.message?.content || "";
  return extractJson(text);
}

// ---------- aggregation helpers (evaluate mode) ----------
function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function mean(nums) {
  const xs = nums.filter(isNum);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(nums) {
  const xs = nums.filter(isNum).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
function modeOrFirst(values) {
  const counts = new Map();
  let bestKey = null;
  let bestCount = 0;
  for (const v of values) {
    if (v == null || v === "") continue;
    const k = String(v);
    const c = (counts.get(k) || 0) + 1;
    counts.set(k, c);
    if (c > bestCount) {
      bestCount = c;
      bestKey = k;
    }
  }
  return bestKey || "";
}
function unionDedupe(arrays) {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const s = String(item || "").trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    }
  }
  return out;
}
function num(x) {
  return isNum(Number(x)) ? Number(x) : null;
}

function aggregateEvaluations(runs) {
  // runs: array of raw JSON objects from each call.
  const grades = runs.map((r) => num(r?.overall_grade)).filter(isNum);
  const scaleAt = (k) => runs.map((r) => num(r?.scales?.[k])).filter(isNum);
  const valAt = (k) => runs.map((r) => num(r?.valuation_usd?.[k])).filter(isNum);

  // Identification: prefer the most "complete" run (most non-empty fields), tie-break to first.
  const idScore = (id) => {
    if (!id) return -1;
    let s = 0;
    for (const v of Object.values(id)) if (v && String(v).trim()) s++;
    return s;
  };
  let bestIdRun = runs[0];
  let bestScore = idScore(runs[0]?.identification);
  for (let i = 1; i < runs.length; i++) {
    const s = idScore(runs[i]?.identification);
    if (s > bestScore) {
      bestScore = s;
      bestIdRun = runs[i];
    }
  }

  // search_query: prefer the longest non-empty value across runs.
  const queries = runs
    .map((r) => (typeof r?.search_query === "string" ? r.search_query.trim() : ""))
    .filter(Boolean);
  const search_query = queries.sort((a, b) => b.length - a.length)[0] || "";

  // valuation_basis: take from the run that's "most complete" (most non-empty notes).
  const basisScore = (b) => {
    if (!b) return -1;
    let s = 0;
    for (const v of ["low", "mid", "high"]) if (b[v] && String(b[v]).trim()) s++;
    return s;
  };
  let bestBasis = runs[0]?.valuation_basis || {};
  let bestBasisScore = basisScore(bestBasis);
  for (let i = 1; i < runs.length; i++) {
    const s = basisScore(runs[i]?.valuation_basis);
    if (s > bestBasisScore) {
      bestBasisScore = s;
      bestBasis = runs[i].valuation_basis;
    }
  }

  return {
    identification: bestIdRun?.identification || {},
    scales: {
      centering: mean(scaleAt("centering")),
      corners: mean(scaleAt("corners")),
      edges: mean(scaleAt("edges")),
      surface: mean(scaleAt("surface")),
    },
    overall_grade: mean(grades),
    grade_label: modeOrFirst(runs.map((r) => r?.grade_label)),
    authenticity_confidence: modeOrFirst(runs.map((r) => r?.authenticity_confidence)),
    valuation_usd: {
      low: median(valAt("low")),
      mid: median(valAt("mid")),
      high: median(valAt("high")),
    },
    valuation_basis: {
      low: bestBasis?.low || "",
      mid: bestBasis?.mid || "",
      high: bestBasis?.high || "",
    },
    search_query,
    highlights: unionDedupe(runs.map((r) => r?.highlights)),
    concerns: unionDedupe(runs.map((r) => r?.concerns)),
    recommendations: unionDedupe(runs.map((r) => r?.recommendations)),
    // Spread metadata — the UI uses this to show ranges next to means/medians.
    runs: {
      count: runs.length,
      overall_grade: grades,
      scales: {
        centering: scaleAt("centering"),
        corners: scaleAt("corners"),
        edges: scaleAt("edges"),
        surface: scaleAt("surface"),
      },
      valuation_usd: {
        low: valAt("low"),
        mid: valAt("mid"),
        high: valAt("high"),
      },
    },
  };
}

// ---------- POST /cards/grade ----------
router.post("/grade", rateLimit, async (req, res) => {
  try {
    const { mode, frontDataUrl, backDataUrl, frontDataUrls, backDataUrls, meta } = req.body || {};

    if (mode !== "identify" && mode !== "evaluate") {
      return res.status(400).json({ error: "mode must be 'identify' or 'evaluate'." });
    }

    const front = coercePhotos(frontDataUrls, frontDataUrl, "front");
    if (!front.ok) return res.status(400).json({ error: front.error });
    const back = coercePhotos(backDataUrls, backDataUrl, "back");
    if (!back.ok) return res.status(400).json({ error: back.error });

    // Identify mode: single deterministic call.
    if (mode === "identify") {
      const result = await runOpenAI({
        prompt: identifyPrompt(front.urls.length, back.urls.length),
        frontDataUrls: front.urls,
        backDataUrls: back.urls,
        temperature: 0.2,
      });
      return res.json({ result });
    }

    // Evaluate mode: fan out N parallel calls and aggregate.
    const prompt = evaluatePrompt(meta || {}, front.urls.length, back.urls.length);
    const settled = await Promise.allSettled(
      Array.from({ length: EVAL_RUNS }, () =>
        runOpenAI({
          prompt,
          frontDataUrls: front.urls,
          backDataUrls: back.urls,
          temperature: EVAL_TEMPERATURE,
        })
      )
    );
    const runs = settled
      .filter((s) => s.status === "fulfilled")
      .map((s) => s.value);

    if (runs.length === 0) {
      const firstErr = settled.find((s) => s.status === "rejected");
      const message = firstErr?.reason?.message || "All evaluation runs failed.";
      console.error("[cards/grade] all runs failed:", message);
      return res.status(502).json({ error: message });
    }

    const failures = settled.length - runs.length;
    if (failures > 0) {
      console.warn(`[cards/grade] ${failures}/${settled.length} runs failed; aggregating the rest`);
    }

    const result = aggregateEvaluations(runs);
    res.json({ result });
  } catch (err) {
    const message = err?.message || "Unknown error";
    console.error("[cards/grade] error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
