// backend/routes/upvote.js
//
// POST /api/upvote/coach — returns AI-generated reasoning for an UpVote
// proposition. The student app shows the strongest case for AND against
// after voting; in practice mode the player also sees a "have you
// considered…" counter-argument tailored to their pick.
//
// All copy is intentionally short (one or two sentences) — these panels
// surface alongside the tally, not as a full essay.

import express from "express";
import OpenAI from "openai";

const router = express.Router();

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[upvote] OPENAI_API_KEY is not set");
  return (_client = new OpenAI({ apiKey }));
}

function _safeStr(s, max = 800) {
  return String(s || "").trim().slice(0, max);
}

router.post("/coach", async (req, res) => {
  try {
    const proposition = _safeStr(req.body?.proposition, 400);
    const playerVote = req.body?.playerVote;
    const worldview = _safeStr(req.body?.worldview, 32) || "general";
    const subject = _safeStr(req.body?.subject, 64);
    const unitName = _safeStr(req.body?.unitName, 120);
    const gradeLevel = req.body?.gradeLevel != null ? Number(req.body.gradeLevel) : null;

    if (!proposition) {
      return res.status(400).json({ ok: false, error: "proposition required" });
    }

    // Without an API key (test/dev), return a graceful stub so the UI
    // still renders something sensible.
    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        ok: true,
        strongestFor:
          "A defensible case can be built from the unit material — point at the strongest piece of evidence on this side.",
        strongestAgainst:
          "The opposing side has at least one strong objection — name it before defending your vote.",
        counterArgument:
          "Try to articulate the OTHER side's best argument. If you can't refute it, your vote might rest on weaker ground than you think.",
      });
    }

    const worldviewNote =
      worldview === "faith"
        ? " The class works within a faith-tradition frame; treat the tradition's truth claims as shared and frame interpretive questions interior to it."
        : "";
    const sysPrompt =
      `You are an experienced classroom teacher helping a class debate a proposition.` +
      ` You write SHORT, age-appropriate reasoning (1-2 sentences per side, ≤ 35 words each), in a clear voice a student would actually use.` +
      worldviewNote +
      ` Never moralise or call one side "correct" — both sides must read as defensible.`;

    const gradeLine = gradeLevel ? ` for grade ${gradeLevel}` : "";
    const subjLine = subject ? ` in ${subject}${unitName ? ` (${unitName})` : ""}` : "";
    const voteLine =
      playerVote === "for"
        ? `\nThe player voted FOR. Their counter-argument should target the FOR side's weakest assumption and invite them to defend it.`
        : playerVote === "against"
        ? `\nThe player voted AGAINST. Their counter-argument should target the AGAINST side's weakest assumption and invite them to defend it.`
        : `\nThe player abstained — write a counter-argument that pushes them off the fence.`;

    const userPrompt =
      `Proposition${subjLine}${gradeLine}: "${proposition}"\n\n` +
      `Return JSON only with three string fields:\n` +
      `- strongestFor: one or two sentences defending the FOR side. ≤ 35 words.\n` +
      `- strongestAgainst: one or two sentences defending the AGAINST side. ≤ 35 words.\n` +
      `- counterArgument: one or two sentences that challenge the player to reconsider, tailored to their vote (if known).` +
      voteLine;

    const openai = getClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 350,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    return res.json({
      ok: true,
      strongestFor: _safeStr(parsed.strongestFor, 500),
      strongestAgainst: _safeStr(parsed.strongestAgainst, 500),
      counterArgument: _safeStr(parsed.counterArgument, 500),
    });
  } catch (err) {
    console.warn("[upvote/coach] failed:", err?.message);
    return res.status(500).json({ ok: false, error: "coach failed" });
  }
});

export default router;
