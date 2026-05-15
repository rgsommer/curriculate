import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/cards/grade
 *
 * Body:
 *   {
 *     mode: "identify" | "evaluate",
 *     frontDataUrl: string,        // data:image/jpeg;base64,...
 *     backDataUrl:  string,        // data:image/jpeg;base64,...
 *     meta?: {                     // only used when mode === "evaluate"
 *       type?: string;
 *       year?: string;
 *       name?: string;             // player / character
 *       set?: string;
 *       number?: string;
 *       graded?: string;
 *       notes?: string;
 *     }
 *   }
 *
 * Calls OpenAI's chat completions API with vision (gpt-4o-mini by default).
 * Returns the parsed JSON the model produced.
 */

export const runtime = "nodejs";        // node runtime so process.env works everywhere
export const maxDuration = 60;          // allow up to 60s for vision call

const MODEL = process.env.CARDS_OPENAI_MODEL || "gpt-4o-mini";

type Mode = "identify" | "evaluate";

interface Body {
  mode: Mode;
  frontDataUrl: string;
  backDataUrl: string;
  meta?: Record<string, string>;
}

function identifyPrompt(): string {
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

function evaluatePrompt(meta: Record<string, string> = {}): string {
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

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  return text.trim();
}

function extractJson(text: string): unknown {
  const stripped = stripFences(text);
  const first = stripped.indexOf("{");
  const last  = stripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Model did not return JSON.");
  }
  return JSON.parse(stripped.slice(first, last + 1));
}

async function callOpenAI(prompt: string, frontDataUrl: string, backDataUrl: string): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set on the server.");
  }

  const body = {
    model: MODEL,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: frontDataUrl, detail: "high" } },
          { type: "image_url", image_url: { url: backDataUrl,  detail: "high" } },
        ],
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = await res.json();
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenAI returned an empty response.");
  return extractJson(text);
}

function isDataUrl(s: unknown): s is string {
  return typeof s === "string" && s.startsWith("data:image/");
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.mode !== "identify" && body.mode !== "evaluate") {
    return NextResponse.json({ error: "mode must be 'identify' or 'evaluate'." }, { status: 400 });
  }
  if (!isDataUrl(body.frontDataUrl) || !isDataUrl(body.backDataUrl)) {
    return NextResponse.json(
      { error: "frontDataUrl and backDataUrl must be base64 data: URLs (image/*)." },
      { status: 400 }
    );
  }

  const prompt = body.mode === "identify" ? identifyPrompt() : evaluatePrompt(body.meta || {});

  try {
    const result = await callOpenAI(prompt, body.frontDataUrl, body.backDataUrl);
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
