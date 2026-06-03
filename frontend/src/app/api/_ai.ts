// Thin OpenAI wrapper for narrative drafts (summaries + cover letters) across
// the TeeBee suite. Reads OPENAI_API_KEY from the Next.js env; when it's absent
// aiConfigured() is false and callers return a clean 503 rather than erroring.
// AI_MOCK=1 returns a canned draft so the full flow can be tested without a key.
//
// Everything produced here is a DRAFT for CPA review — never an issued opinion.

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export function aiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY || process.env.AI_MOCK === "1";
}

// Returns { summary, cover_letter }. The model is told to reply as JSON.
export async function draftSummaryAndLetter(system: string, user: string): Promise<{ summary: string; cover_letter: string }> {
  if (process.env.AI_MOCK === "1") {
    return {
      summary: "DRAFT (mock) — executive summary.\n\n" + user.slice(0, 240).replace(/\s+/g, " ") + " …",
      cover_letter: "DRAFT (mock) — cover letter.\n\nDear Client,\n\nPlease find enclosed the attached report for your review.\n\nYours faithfully,\nTeeBee Accountants Ltd",
    };
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("AI is not configured (OPENAI_API_KEY missing).");

  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 1300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system + "\n\nReply ONLY with a JSON object: {\"summary\": string, \"cover_letter\": string}. Both are professional prose. This is a DRAFT for CPA review — hedge appropriately and never claim to issue a final opinion." },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`AI request failed (${r.status}). ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content || "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(content); } catch { parsed = { summary: content, cover_letter: "" }; }
  return {
    summary: String(parsed.summary || "").trim(),
    cover_letter: String(parsed.cover_letter || "").trim(),
  };
}
