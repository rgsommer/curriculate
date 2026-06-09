// backend/behavior/lib/aiNote.js
//
// Composes the parent-facing note home (brief §8). An AI call frames the note
// so it reads naturally and adapts tone to history (1st note = collaborative;
// repeat = clear about escalation, still respectful). Engineering requirements:
//   • API key is read from server-side env ONLY — never logged, never stored on
//     a record, never sent to the client.
//   • Provider + model are configurable (config.aiProvider / config.aiModel) —
//     no hardcoded model string.
//   • FAIL SAFE: if the model errors or times out, fall back to a deterministic
//     template so a notice still goes out. The AI is never load-bearing.
//   • PII minimisation: only the student's PREFERRED name + pronoun and the
//     behaviour/date/detail lines are sent — no surname, no parent contact, no
//     ethnicity.
//
// `composeNotice` accepts an injectable `aiClient` so the fallback path is
// unit-testable without any network access.

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * @typedef {Object} NoteContext
 * @property {string} studentName      preferred name (or first name)
 * @property {string} pronoun          e.g. "they/them" (optional)
 * @property {Array}  incidents        [{ behaviorName, teacherName, date, detail }]
 * @property {Array}  positives        recent positive behaviours to acknowledge [{ behaviorName, date, detail }]
 * @property {string[]} consequences   consequence text(s) for the triggering behaviour(s)
 * @property {number} sequenceNo       1 = first notice this period
 * @property {number} daysSinceFirst   days since the first incident this period
 * @property {string} schoolName
 * @property {string} signature        the sending teacher's signature block
 * @property {string} toneGuidance     division tone guidance
 * @property {boolean} ccVp            whether the VP is CC'd (affects wording)
 */

/** Human-readable date for the note body. */
function fmtDate(d) {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/**
 * Deterministic template note — the guaranteed fallback. Also a fine note in
 * its own right, so a delivery never silently fails because of the AI (§8).
 */
export function deterministicNote(ctx) {
  const name = ctx.studentName || "your child";
  const isFirst = (ctx.sequenceNo || 1) <= 1;
  const lines = [];

  lines.push(`Dear Parent/Guardian,`);
  lines.push("");
  if (isFirst) {
    lines.push(
      `I am writing to let you know about some behaviour concerns involving ${name} at ${ctx.schoolName || "school"}. We want to work with you to support ${name} in meeting our shared expectations.`
    );
  } else {
    lines.push(
      `I am following up regarding continued behaviour concerns involving ${name} at ${ctx.schoolName || "school"}. This is notice #${ctx.sequenceNo} this period, and we want to address the pattern together before it escalates further.`
    );
  }
  lines.push("");
  lines.push(`The following were recorded${ctx.daysSinceFirst ? ` over the past ${ctx.daysSinceFirst} day(s)` : ""}:`);
  for (const inc of ctx.incidents || []) {
    const date = fmtDate(inc.date);
    const who = inc.teacherName ? ` (logged by ${inc.teacherName})` : "";
    const detail = inc.detail ? ` — ${inc.detail}` : "";
    lines.push(`  • ${date ? date + ": " : ""}${inc.behaviorName}${who}${detail}`);
  }
  lines.push("");
  if ((ctx.consequences || []).length) {
    lines.push(`Consequence:`);
    for (const c of ctx.consequences) lines.push(`  • ${c}`);
    lines.push("");
  }
  // A balancing positive note — positive behaviours are acknowledged, never
  // counted against the student.
  if ((ctx.positives || []).length) {
    const names = [...new Set(ctx.positives.map((p) => p.behaviorName).filter(Boolean))];
    if (names.length) {
      lines.push(
        `On a positive note, we also want to recognise ${name} for ${names.slice(0, 3).join(", ")} recently — thank you for encouraging that at home too.`
      );
      lines.push("");
    }
  }
  lines.push(
    isFirst
      ? `Please take a moment to talk with ${name} about these expectations. Thank you for your partnership.`
      : `We would appreciate your support at home in addressing this. Please reach out if you would like to discuss it.`
  );
  if (ctx.ccVp) lines.push(`(Our Vice-Principal has been copied on this notice.)`);
  lines.push("");
  lines.push(ctx.signature || `Sincerely,\n${ctx.schoolName || ""}`);

  return lines.join("\n");
}

/** Build the instruction prompt for the AI provider from de-identified context. */
export function buildPrompt(ctx) {
  const incidentLines = (ctx.incidents || [])
    .map((inc) => `- ${fmtDate(inc.date)}: ${inc.behaviorName}${inc.detail ? ` (${inc.detail})` : ""}`)
    .join("\n");

  // Background history is for the model's AWARENESS only — it shapes tone but is
  // NEVER summarized, listed, or quoted; at most an oblique reference is allowed.
  const h = ctx.history;
  const hasHistory = h && (h.priorNotices > 0 || h.priorIncidentCount > 0);
  const historyBlock = hasHistory
    ? [
        `BACKGROUND (for your awareness ONLY — do NOT summarize, list, quote, count, or enumerate any of this in the note):`,
        `- This student has ${h.priorNotices} prior notice(s) home and ${h.priorIncidentCount} earlier incident(s) on record.`,
        h.behaviourTypes?.length ? `- Earlier behaviours have included: ${h.behaviourTypes.join(", ")}.` : "",
        h.lastBeforeDays != null ? `- The most recent prior incident was about ${h.lastBeforeDays} day(s) ago.` : "",
        `You MAY make at most a brief, OBLIQUE reference to this background — e.g. that this is part of an ongoing pattern, the general kinds of behaviour, or how recent past issues were — only if it fits naturally. Do NOT recount specifics.`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // Recent positive behaviours to acknowledge — included as a genuine, balancing
  // note, never weighed against the student.
  const positives = (ctx.positives || []).map((p) => p.behaviorName).filter(Boolean);
  const positivesBlock = positives.length
    ? `POSITIVES TO ACKNOWLEDGE: this student was recently recognised for: ${[...new Set(positives)].slice(0, 4).join(", ")}. Include ONE brief, warm sentence near the end acknowledging this positive — frame it as genuine encouragement, NOT as offsetting or excusing the concerns above, and do not assign or mention points.`
    : "";

  return [
    `You are a teacher writing a brief, respectful note home to a parent about a student's behaviour.`,
    ctx.toneGuidance ? `Division tone guidance: ${ctx.toneGuidance}` : "",
    `This is notice number ${ctx.sequenceNo || 1} this period. ${
      (ctx.sequenceNo || 1) <= 1
        ? "Use a first-contact, collaborative, informative tone."
        : "Use a clear escalating tone about the repeated pattern, while staying respectful."
    }`,
    `Student preferred name: ${ctx.studentName}${ctx.pronoun ? ` (pronoun: ${ctx.pronoun})` : ""}.`,
    `School: ${ctx.schoolName || ""}.`,
    ctx.daysSinceFirst ? `Days since first incident this period: ${ctx.daysSinceFirst}.` : "",
    `The note should be ABOUT only these current incidents:\n${incidentLines}`,
    historyBlock,
    positivesBlock,
    (ctx.consequences || []).length ? `Consequence(s) to state: ${ctx.consequences.join("; ")}.` : "",
    ctx.ccVp ? `Mention that the Vice-Principal has been copied.` : "",
    `Sign off with this signature block exactly:\n${ctx.signature || ""}`,
    `Write only the note body (no subject line). Keep it under 220 words. Do not invent facts beyond those given, and do not recount the background history.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Compose the note. Tries the AI client (with a timeout); on ANY failure falls
 * back to the deterministic template.
 *
 * @param {NoteContext} ctx
 * @param {object} opts  { aiClient, timeoutMs }
 *   aiClient: { async complete(prompt) -> string } or null to force fallback.
 * @returns {Promise<{ text: string, aiUsed: boolean }>}
 */
export async function composeNotice(ctx, opts = {}) {
  const aiClient = opts.aiClient;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  if (!aiClient) {
    return { text: deterministicNote(ctx), aiUsed: false };
  }

  try {
    const prompt = buildPrompt(ctx);
    const text = await withTimeout(aiClient.complete(prompt), timeoutMs);
    const trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("empty AI response");
    return { text: trimmed, aiUsed: true };
  } catch (err) {
    // Fail safe — never let a notice die because of the AI.
    console.warn("[behavior/aiNote] AI compose failed, using template:", err?.message || err);
    return { text: deterministicNote(ctx), aiUsed: false };
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("AI timeout")), ms)),
  ]);
}

/**
 * Build the default AI client from config + env, or null when no key is set
 * (which makes composeNotice fall back deterministically). Provider/model are
 * configurable; the key is read from env only.
 */
export function makeDefaultAiClient(config = {}) {
  const provider = (config.aiProvider || process.env.BEHAVIOR_AI_PROVIDER || "openai").toLowerCase();

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    const model = config.aiModel || process.env.BEHAVIOR_AI_MODEL || "gpt-4o-mini";
    return {
      async complete(prompt) {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey: key });
        const resp = await client.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5,
          max_tokens: 500,
        });
        return resp.choices?.[0]?.message?.content || "";
      },
    };
  }

  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    const model = config.aiModel || process.env.BEHAVIOR_AI_MODEL || "claude-3-5-haiku-latest";
    return {
      async complete(prompt) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: key });
        const resp = await client.messages.create({
          model,
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        });
        return resp.content?.map((b) => (b.type === "text" ? b.text : "")).join("") || "";
      },
    };
  }

  return null;
}
