/**
 * Weighted report-card averages — backs the public /avgs page on curriculate.net.
 *
 *   POST /avgs/extract
 *     body: {
 *       text?: string,                                  // extracted report-card text (one chunk)
 *       images?: ["data:image/jpeg;base64,...", ...],   // scanned/rendered pages (max 8)
 *       weightRules?: string                            // user-editable weighting rules
 *     }
 *     returns: { students: [{ name, gradeLevel, courses: [{ course, finalGradeRaw,
 *                finalGradePercent, daysPerWeek, weight }] }] }
 *
 * The /avgs page splits the uploaded blob into chunks, sends one request per
 * chunk, and merges students + computes weighted averages client-side, so this
 * endpoint is stateless. Uses the same OpenAI key (OPENAI_API_KEY) and lazy
 * client pattern as the rest of the backend.
 *
 * Default model: gpt-4.1 (grade digits from scans need the full model).
 * Override with AVGS_OPENAI_MODEL.
 */
import express from "express";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";

const router = express.Router();
const MODEL = process.env.AVGS_OPENAI_MODEL || "gpt-4.1";
const MAX_IMAGES = 8;
const MAX_TEXT_CHARS = 60000;

// ---------- lazy OpenAI client (same pattern as cards.js / index.js) ----------
let _openai = null;
function openai() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  _openai = new OpenAI({ apiKey });
  return _openai;
}

// Paid AI calls behind this — keep casual scripting out without bothering a
// teacher uploading a long PDF (a big upload can be ~30 chunks = 30 requests).
const avgsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a few minutes and try again." },
});

const DEFAULT_WEIGHT_RULES = `Weight = (days per week the class meets) ÷ 5.
- Math: 4×/week → weight 0.8
- English / Language Arts: 4×/week → weight 0.8
- Science: 4×/week → weight 0.8
- Social Studies / Socials: 4×/week → weight 0.8
- French / second language: 4×/week → weight 0.8
- Art: 2×/week → weight 0.4
- Music / Band / Drama: 2×/week → weight 0.4
- PE (Physical Education): 1×/week → weight 0.2
- CE (Career Education): meets every day, but counts at half value → weight 0.5
- Anything else: estimate from a typical school timetable; if unsure, 2×/week → weight 0.4
- If the report card itself states how often a course meets, use that instead.`;

const EXTRACTION_SCHEMA = {
  name: "report_card_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      students: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: "Full student name as printed" },
            gradeLevel: { type: "string", description: "Student grade level, e.g. '6', 'K'. Empty string if not shown." },
            courses: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  course: { type: "string", description: "Course/subject name as printed" },
                  finalGradeRaw: { type: "string", description: "Final grade exactly as printed, e.g. '87%', 'A-', 'Proficient'" },
                  finalGradePercent: { type: ["number", "null"], description: "Final grade as a percent 0-100, or null if not convertible" },
                  daysPerWeek: { type: "number", description: "Days per week the course meets, per the weighting rules" },
                  weight: { type: "number", description: "Course weight 0-1, per the weighting rules" },
                },
                required: ["course", "finalGradeRaw", "finalGradePercent", "daysPerWeek", "weight"],
              },
            },
          },
          required: ["name", "gradeLevel", "courses"],
        },
      },
    },
    required: ["students"],
  },
};

function buildPrompt(weightRules) {
  return `You are extracting FINAL grades from school report cards. The input is one chunk of a larger upload and may contain report cards for several students, possibly across grade levels, and may begin or end mid-report-card.

For EVERY student that appears in this chunk:
- name: the student's full name as printed.
- gradeLevel: the student's grade level (e.g. "6", "7", "K"). Empty string if not shown.
- courses: one entry per course/subject that has a FINAL grade in this chunk.
  - Use ONLY the final/overall grade for the course. If the report card shows term or interim marks alongside a final mark, ignore the term marks. If only a single reporting-period grade exists, use it.
  - Ignore comments, learning-skills/work-habits ratings, effort marks, and attendance.
  - finalGradeRaw: the grade exactly as printed (e.g. "87%", "A-", "Proficient").
  - finalGradePercent: the grade as a number 0-100. Percentages map directly. Convert letter grades: A+ 97, A 93, A- 90, B+ 87, B 83, B- 80, C+ 77, C 73, C- 70, D+ 67, D 63, D- 60, F 50. Convert proficiency-scale grades: Extending 95, Proficient 85, Developing 70, Emerging 55. If the grade cannot reasonably be mapped to a number (e.g. "Incomplete", "N/A"), use null.
  - daysPerWeek and weight: assign per the weighting rules below, based on the course name.

WEIGHTING RULES (apply exactly as written):
${weightRules}

List every distinct student found in this chunk. If part of the input is unreadable, skip that part rather than guessing.`;
}

router.post("/extract", avgsLimiter, async (req, res) => {
  try {
    const { text, images, weightRules } = req.body || {};
    const textChunk = typeof text === "string" ? text.slice(0, MAX_TEXT_CHARS) : "";
    const imgs = (Array.isArray(images) ? images : [])
      .filter((u) => typeof u === "string" && u.startsWith("data:image/"))
      .slice(0, MAX_IMAGES);

    if (!textChunk.trim() && imgs.length === 0) {
      return res.status(400).json({ error: "No report-card content provided." });
    }

    const rules = (typeof weightRules === "string" && weightRules.trim())
      ? weightRules.trim().slice(0, 4000)
      : DEFAULT_WEIGHT_RULES;

    const userContent = [{ type: "input_text", text: buildPrompt(rules) }];
    if (textChunk.trim()) {
      userContent.push({ type: "input_text", text: `REPORT CARD TEXT:\n${textChunk}` });
    }
    for (const img of imgs) {
      userContent.push({ type: "input_image", image_url: img });
    }

    const response = await openai().responses.create({
      model: MODEL,
      input: [{ role: "user", content: userContent }],
      text: {
        format: {
          type: "json_schema",
          name: EXTRACTION_SCHEMA.name,
          strict: true,
          schema: EXTRACTION_SCHEMA.schema,
        },
      },
      max_output_tokens: 8000,
    });

    let parsed = null;
    try { parsed = JSON.parse(response.output_text); } catch { /* fall through */ }
    if (!parsed || !Array.isArray(parsed.students)) {
      console.error("[avgs] unparseable AI output:", String(response.output_text).slice(0, 500));
      return res.status(502).json({ error: "AI returned an unreadable result for this chunk. Please retry." });
    }

    res.json({ students: parsed.students });
  } catch (err) {
    console.error("POST /avgs/extract error:", err);
    res.status(500).json({ error: "Extraction failed. Please try again." });
  }
});

export default router;
