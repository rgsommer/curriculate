// backend/controllers/importExternalTaskset.js
//
// "Import from Kahoot / Blooket" — turn a shared link or pasted questions
// into a Curriculate TaskSet full of multiple-choice tasks.
//
// Two entry points, both mounted under /api/ai/tasksets:
//
//   POST /import-url   { url }
//     Fetches a Kahoot share link's underlying public JSON and transforms
//     each quiz question into an MCQ item. Non-MCQ Kahoot question types
//     (jumble/survey/open-ended) are skipped. If the fetch or parse fails
//     the client gets `canFallbackToText: true` so the UI can offer the
//     paste-text flow instead.
//
//   POST /import-text  { text, source: "kahoot" | "blooket", title? }
//     AI parses whatever the teacher pastes (copied from the Kahoot editor,
//     a Blooket deck printout, a Google Doc of questions) into MCQ items.
//     Blooket is paste-only — its share URLs sit behind auth.
//
// Both paths emit the same persisted shape (one or more multiple-choice
// tasks with `items[].{prompt, options, correctAnswer}`) which clears
// shared/taskPlayability.js#assessTaskPlayability without a separate pass.
//
// Blooket URL support is intentionally omitted: their public share surface
// does not expose question JSON without a signed session. If that changes,
// extend extractProviderFromUrl() and add a fetchBlooket() alongside
// fetchKahoot().
import OpenAI from "openai";
import TaskSet from "../models/TaskSet.js";

const AI_MODEL =
  process.env.AI_REVIEW_MODEL || process.env.AI_MODEL || "gpt-4.1-mini";

let _openAiClient = null;
function getOpenAi() {
  if (_openAiClient) return _openAiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("[importExternalTaskset] OPENAI_API_KEY is not set");
  }
  return (_openAiClient = new OpenAI({ apiKey }));
}

// ──────────────────────────────────────────────────────────────────────────
// Kahoot URL → UUID extraction
// ──────────────────────────────────────────────────────────────────────────
// Share links take several shapes, all of which carry the same UUID:
//   https://create.kahoot.it/share/<slug>/<uuid>
//   https://create.kahoot.it/details/<uuid>
//   https://embed.kahoot.it/<uuid>
//   https://play.kahoot.it/v2/?quizId=<uuid>
//   https://kahoot.com/academy/kahoots/<uuid>
// A kahoot.it/challenge/<pin> is a *challenge PIN*, not the UUID — the
// quiz behind it isn't reachable without being signed in, so we reject
// those and point the teacher at the paste-text fallback.
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractKahootUuid(url) {
  if (typeof url !== "string") return null;
  const lower = url.toLowerCase();
  if (!lower.includes("kahoot")) return null;
  // explicit query param wins over bare UUID in the path
  try {
    const u = new URL(url);
    const qp =
      u.searchParams.get("quizId") ||
      u.searchParams.get("kahootId") ||
      "";
    if (qp && UUID_RE.test(qp)) return qp.toLowerCase();
  } catch {
    // not a parseable URL — try the raw-regex path below
  }
  const m = url.match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

async function fetchKahootPublic(uuid) {
  // Kahoot's unauthenticated REST endpoint for public kahoots. Not an
  // official API — but it's the same URL their own share pages hit, so
  // it's been stable for years. Returns 401 for private, 404 for missing.
  const url = `https://create.kahoot.it/rest/kahoots/${encodeURIComponent(uuid)}`;
  const r = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "curriculate-import/1.0",
    },
    // Short timeout so a stalling vendor doesn't tie up the request budget.
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const trimmed = body.slice(0, 200);
    if (r.status === 401 || r.status === 403) {
      throw new Error(
        "that Kahoot is private — only you can see it signed in. Paste the questions as text instead."
      );
    }
    if (r.status === 404) {
      throw new Error("Kahoot says that quiz doesn't exist (deleted, or wrong link).");
    }
    throw new Error(`Kahoot API ${r.status}${trimmed ? `: ${trimmed}` : ""}`);
  }
  return await r.json();
}

// Kahoot questions arrive as:
//   { type: "quiz" | "multiple_select_quiz" | "jumble" | "survey" | "open_ended" | "content" | "word_cloud" | "poll",
//     question: "...",
//     choices: [{ answer, correct }, ...] }
// Only `quiz` and `multiple_select_quiz` map cleanly to our MCQ shell;
// everything else is skipped and reported to the client so the teacher
// knows what fell off.
function kahootQuestionToMcqItem(q, i) {
  const type = String(q?.type || "").toLowerCase();
  if (type !== "quiz" && type !== "multiple_select_quiz") return null;

  const prompt = String(q?.question || "").trim();
  const rawChoices = Array.isArray(q?.choices) ? q.choices : [];
  const choices = rawChoices
    .map((c) => ({
      answer: String(c?.answer || "").trim(),
      correct: Boolean(c?.correct),
    }))
    .filter((c) => c.answer);
  if (!prompt || choices.length < 2) return null;

  // Multiple-select: the first correct wins. Our MCQ shell is single-answer;
  // a true multi-answer import would need a different task type. Flagging as
  // single-answer is lossy but keeps every imported Kahoot playable.
  const correctAnswer = choices.findIndex((c) => c.correct);
  if (correctAnswer < 0) return null;

  return {
    id: `q${i + 1}`,
    prompt,
    options: choices.map((c) => c.answer),
    correctAnswer,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Taskset builder (shared by URL and text paths)
// ──────────────────────────────────────────────────────────────────────────
// Group items into MCQ tasks of ≤5 (preferredItemsPerTask.max in
// shared/taskTypes.js). Teachers reading the taskset expect several
// bite-sized tasks rather than one 30-question monster.
const ITEMS_PER_TASK_MAX = 5;

function buildMcqTask(items, { title }) {
  return {
    taskType: "multiple-choice",
    title: String(title || "Imported Quiz").slice(0, 120),
    prompt:
      "Read each question carefully and select the best answer.",
    items,
    config: {},
  };
}

async function createTasksetFromMcqItems({
  userId,
  items,
  title,
  source,
  subject = "General",
  gradeLevel = 7,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No multiple-choice questions to import.");
  }
  const tasks = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_TASK_MAX) {
    const slice = items.slice(i, i + ITEMS_PER_TASK_MAX);
    tasks.push(
      buildMcqTask(slice, {
        title:
          tasks.length === 0
            ? title
            : `${title} — part ${tasks.length + 1}`,
      })
    );
  }

  // TaskSetSchema has `name`, no `title`. ownerId (not createdBy) scopes
  // the taskset to this teacher so it shows up in their TaskSets list.
  const displayName = `${title} (from ${source})`;
  const doc = await TaskSet.create({
    name: displayName,
    subject,
    gradeLevel,
    tasks,
    ownerId: userId,
    meta: {
      source: `import:${source}`,
      importedAt: new Date().toISOString(),
      importedQuestionCount: items.length,
      importedTaskCount: tasks.length,
    },
  });
  return doc;
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ai/tasksets/import-url   { url }
// ──────────────────────────────────────────────────────────────────────────
export async function importFromUrl(req, res) {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) {
      return res.status(400).json({ ok: false, error: "Missing url" });
    }

    const uuid = extractKahootUuid(url);
    if (!uuid) {
      return res.status(400).json({
        ok: false,
        error:
          "That doesn't look like a Kahoot share link. Paste the questions as text instead.",
        canFallbackToText: true,
      });
    }

    let kahoot;
    try {
      kahoot = await fetchKahootPublic(uuid);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: `Couldn't fetch that one — ${e.message}`,
        canFallbackToText: true,
      });
    }

    const questions = Array.isArray(kahoot?.questions) ? kahoot.questions : [];
    const items = questions.map(kahootQuestionToMcqItem).filter(Boolean);

    if (items.length === 0) {
      return res.status(422).json({
        ok: false,
        error:
          "No multiple-choice questions in that Kahoot (jumble/survey/open-ended questions aren't imported).",
        canFallbackToText: true,
      });
    }

    const title = String(
      kahoot?.title || kahoot?.quiz?.title || "Kahoot Import"
    ).slice(0, 100);

    const doc = await createTasksetFromMcqItems({
      userId: req.userId,
      items,
      title,
      source: "Kahoot",
    });

    return res.json({
      ok: true,
      taskset: doc,
      imported: items.length,
      skipped: Math.max(0, questions.length - items.length),
    });
  } catch (err) {
    console.error("[import-url] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ai/tasksets/import-text   { text, source, title? }
// ──────────────────────────────────────────────────────────────────────────
const IMPORT_SYSTEM_PROMPT = [
  "You convert pasted quiz text into multiple-choice JSON for a classroom app.",
  "",
  "OUTPUT: ONE JSON object exactly in this shape, with no prose, no markdown fence:",
  '  { "items": [ { "prompt": "...", "options": ["...", "..."], "correctAnswer": 0 } ] }',
  "",
  "RULES:",
  "- correctAnswer is a 0-based integer index into options.",
  "- Each item needs 2 to 6 options.",
  "- Keep the original wording of the question and each option. Do not paraphrase or translate.",
  "- Skip anything that is not a multiple-choice question (open-ended, drawings, surveys, matching, true/false with no options listed).",
  "- If no multiple-choice questions are present, return { \"items\": [] }.",
].join("\n");

export async function importFromText(req, res) {
  try {
    const text = String(req.body?.text || "").trim();
    const sourceRaw = String(req.body?.source || "paste").toLowerCase();
    const source =
      sourceRaw === "kahoot"
        ? "Kahoot"
        : sourceRaw === "blooket"
          ? "Blooket"
          : "paste";
    const titleHint = String(req.body?.title || "").trim();

    if (text.length < 20) {
      return res
        .status(400)
        .json({ ok: false, error: "Paste at least one question." });
    }
    if (text.length > 50_000) {
      return res.status(413).json({
        ok: false,
        error:
          "That paste is too long — try splitting it into a few smaller imports.",
      });
    }

    const client = getOpenAi();
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: AI_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: IMPORT_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      });
    } catch (e) {
      console.error("[import-text] openai error:", e);
      return res.status(502).json({
        ok: false,
        error:
          "AI parsing failed. Try again, or trim the paste to just the question list.",
      });
    }

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        ok: false,
        error:
          "The AI returned something we couldn't parse. Try the import again.",
      });
    }

    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const items = rawItems
      .map((it, i) => {
        const prompt = String(it?.prompt || it?.question || "").trim();
        const options = Array.isArray(it?.options)
          ? it.options.map((o) => String(o).trim()).filter(Boolean)
          : [];
        // Accept either naming — the playability check at
        // shared/taskPlayability.js takes both; we normalize to the
        // backend's canonical correctAnswer field.
        const correctAnswer = Number.isInteger(it?.correctAnswer)
          ? it.correctAnswer
          : Number.isInteger(it?.correctIndex)
            ? it.correctIndex
            : -1;
        if (
          !prompt ||
          options.length < 2 ||
          correctAnswer < 0 ||
          correctAnswer >= options.length
        ) {
          return null;
        }
        return { id: `q${i + 1}`, prompt, options, correctAnswer };
      })
      .filter(Boolean);

    if (items.length === 0) {
      return res.status(422).json({
        ok: false,
        error:
          "The AI didn't find any multiple-choice questions in that paste. Make sure each question has its options listed under it.",
      });
    }

    const title =
      titleHint ||
      (source === "Kahoot"
        ? "Kahoot Import"
        : source === "Blooket"
          ? "Blooket Import"
          : "Imported Quiz");

    const doc = await createTasksetFromMcqItems({
      userId: req.userId,
      items,
      title,
      source,
    });

    return res.json({ ok: true, taskset: doc, imported: items.length });
  } catch (err) {
    console.error("[import-text] error:", err);
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
}
