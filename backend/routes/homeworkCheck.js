// backend/routes/homeworkCheck.js
//
// "Homework Check" mode for the grading tool.
//
// Different problem from rubric grading: the student works in a PRINTED
// workbook (JUMP Math AP Book). The questions are printed; only the answers are
// handwritten. The teacher walks the room shooting continuously on the phone's
// native camera, then uploads the whole batch afterwards.
//
// Two marks, never merged:
//   completeness /10 — of the assigned questions, how many were attempted
//   correctness  /10 — of those attempted, how many match the answer key
//
// The pipeline is deliberately three phases so the teacher can correct the
// grouping BEFORE any grading happens (a mis-group silently attributes work to
// the wrong child, which is the worst failure this tool can have):
//
//   1. UPLOAD   photos arrive one at a time, resumable    → uploadId
//   2. GROUP    a name on the page starts a new student   → contact sheet
//   3. CHECK    teacher-confirmed groups are graded       → jobId → table
//
// Endpoints
//   POST   /homework/upload/init          → { uploadId }
//   POST   /homework/upload/photo         one photo; resumable
//   GET    /homework/upload/:id           what's arrived (for resume)
//   DELETE /homework/upload/:id
//   POST   /homework/group                name-delimited grouping → contact sheet
//   POST   /homework/slate                read a whiteboard photo → date + lesson
//   POST   /homework/answer-key           extract a book's key, one doc per lesson
//   GET    /homework/answer-key/list
//   GET    /homework/answer-key/lookup
//   DELETE /homework/answer-key/:id
//   POST   /homework/check                start grading → { jobId }
//   GET    /homework/check/job/:id        poll
//   GET    /homework/batches              history for a class
//   GET    /homework/batches/:id
//   GET    /homework/student-history
//   DELETE /homework/batches/:id

import express from "express";
import crypto from "crypto";
import OpenAI from "openai";
import HomeworkAnswerKey from "../models/HomeworkAnswerKey.js";
import HomeworkCheckBatch from "../models/HomeworkCheckBatch.js";
import ClassRoster from "../models/ClassRoster.js";
import PublishedResult from "../models/PublishedResult.js";
import { genAA123 } from "../utils/refCode.js";
import { resultExpiryDate } from "../utils/retention.js";
import { notifyNewGrade } from "../email/gradeNotification.js";

const router = express.Router();

const MODEL = process.env.HOMEWORK_OPENAI_MODEL || process.env.AI_MODEL_FULL || "gpt-4.1";
// Students graded at once. Each student is its own vision call.
const CONCURRENCY = Math.max(1, Math.min(6, parseInt(process.env.HOMEWORK_CONCURRENCY || "3", 10)));
// Photos per name-detection call. Detection only needs the top of each page, so
// batching keeps a 50-photo class down to a handful of calls.
const GROUP_CHUNK = Math.max(4, Math.min(24, parseInt(process.env.HOMEWORK_GROUP_CHUNK || "12", 10)));
const MAX_PHOTOS = 200;

// ---------- lazy OpenAI client (same pattern as index.js / routes/cards.js) ----------
let _openai = null;
function openai() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  _openai = new OpenAI({ apiKey });
  return _openai;
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") return null;
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

function isDataUrlImage(s) {
  return typeof s === "string" && /^data:image\/(png|jpe?g|webp|heic|heif);base64,/i.test(s);
}

const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

// ===========================================================================
// Resumable upload store
//
// Photos arrive one at a time so a dropped connection loses one photo, not a
// 50-photo class set. Held in memory with a TTL — they only need to survive
// long enough to be grouped and graded.
// ===========================================================================
const uploads = new Map(); // uploadId -> { teacherEmail, createdAt, photos: Map<idx,{dataUrl,capturedAt}>, expected }
const UPLOAD_TTL_MS = 3 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  for (const [id, u] of uploads) if (u.createdAt < cutoff) uploads.delete(id);
}, 10 * 60 * 1000).unref();

router.post("/upload/init", (req, res) => {
  const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
  const expected = parseInt(req.body?.expected, 10) || 0;
  if (expected > MAX_PHOTOS) {
    return res.status(413).json({ ok: false, error: `Too many photos in one batch (max ${MAX_PHOTOS}).` });
  }
  const uploadId = crypto.randomUUID();
  uploads.set(uploadId, { teacherEmail, createdAt: Date.now(), photos: new Map(), expected });
  return res.json({ ok: true, uploadId, expected });
});

router.post("/upload/photo", (req, res) => {
  const { uploadId, index, dataUrl, capturedAt } = req.body || {};
  const u = uploads.get(String(uploadId || ""));
  if (!u) return res.status(404).json({ ok: false, error: "Upload session not found or expired. Start the upload again." });
  const i = parseInt(index, 10);
  if (!Number.isFinite(i) || i < 0 || i >= MAX_PHOTOS) {
    return res.status(400).json({ ok: false, error: "Bad photo index." });
  }
  if (!isDataUrlImage(dataUrl)) {
    return res.status(400).json({ ok: false, error: "Photo must be a data URL image." });
  }
  u.photos.set(i, { dataUrl, capturedAt: capturedAt || null });
  u.createdAt = Date.now(); // keep the session alive while it's being filled
  return res.json({ ok: true, received: u.photos.size, expected: u.expected });
});

router.get("/upload/:id", (req, res) => {
  const u = uploads.get(String(req.params.id || ""));
  if (!u) return res.status(404).json({ ok: false, error: "Upload session not found or expired." });
  return res.json({
    ok: true,
    received: [...u.photos.keys()].sort((a, b) => a - b),
    count: u.photos.size,
    expected: u.expected,
  });
});

router.delete("/upload/:id", (req, res) => {
  uploads.delete(String(req.params.id || ""));
  return res.json({ ok: true });
});

// Pull an upload out as a dense, index-ordered array. Returns null if any
// expected photo is missing — we never grade a batch with a hole in it.
function materialiseUpload(uploadId) {
  const u = uploads.get(String(uploadId || ""));
  if (!u) return { error: "Upload session not found or expired. Please upload the photos again." };
  const indexes = [...u.photos.keys()].sort((a, b) => a - b);
  if (!indexes.length) return { error: "No photos were uploaded." };
  const expected = u.expected || indexes.length;
  const missing = [];
  for (let i = 0; i < expected; i++) if (!u.photos.has(i)) missing.push(i);
  if (missing.length) {
    return {
      error: `${missing.length} photo(s) never finished uploading. Resume the upload before grouping.`,
      missing,
    };
  }
  const images = [];
  const capturedAt = [];
  for (let i = 0; i < expected; i++) {
    images.push(u.photos.get(i).dataUrl);
    capturedAt.push(u.photos.get(i).capturedAt);
  }
  return { images, capturedAt, teacherEmail: u.teacherEmail };
}

// ===========================================================================
// Assigned-question parsing
//
// Teachers write the assignment the way it appears on the board:
//   "NS7-3 Core: 1ab, 3bc, 5bc, 7ab, 9ab, 10ab"
// meaning 1a, 1b, 3b, 3c, 5b, 5c, 7a, 7b, 9a, 9b, 10a, 10b.
// ===========================================================================
export function parseAssignedQuestions(raw) {
  const out = [];
  const unparsed = [];
  let text = String(raw || "").trim();
  if (!text) return { questions: [], unparsed: [] };

  // Drop a leading lesson code / label: everything before the last colon.
  if (text.includes(":")) text = text.slice(text.lastIndexOf(":") + 1);
  // "2(a)(c)" → "2ac"
  text = text.replace(/\((\s*[a-z]\s*)\)/gi, (_m, g) => g.trim());

  const tokens = text.split(/[,;]+|\s+/).map((t) => t.trim()).filter(Boolean);

  for (const tok of tokens) {
    const t = tok.replace(/\./g, "").replace(/[–—]/g, "-").toLowerCase();
    if (!t) continue;

    let m = t.match(/^(\d+)\s*-\s*(\d+)$/); // "2-5"
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 60) {
        for (let i = a; i <= b; i++) out.push(String(i));
        continue;
      }
      unparsed.push(tok);
      continue;
    }

    m = t.match(/^(\d+)([a-z]+)$/); // "1ab" → 1a, 1b
    if (m) {
      for (const letter of m[2].split("")) out.push(`${m[1]}${letter}`);
      continue;
    }

    m = t.match(/^(\d+)$/); // "7"
    if (m) { out.push(m[1]); continue; }

    unparsed.push(tok);
  }

  const seen = new Set();
  const questions = out.filter((q) => (seen.has(q) ? false : (seen.add(q), true)));
  return { questions, unparsed };
}

// ===========================================================================
// Roster name matching — refuses a weak match rather than attaching work to
// the wrong child.
// ===========================================================================
function matchRosterStudent(name, roster) {
  const target = normName(name);
  if (!target) return null;
  const parts = String(name).trim().toLowerCase().split(/\s+/).filter(Boolean);

  let best = null;
  let bestScore = 0;
  for (const s of roster) {
    const fn = normName(s.firstName);
    const ln = normName(s.lastName);
    const full = fn + ln;
    let score = 0;
    if (target === full) score = 100;
    else if (parts.length >= 2 && normName(parts[0]) === fn && normName(parts[parts.length - 1]) === ln) score = 95;
    else if (parts.length >= 2 && normName(parts[0]) === ln && normName(parts[parts.length - 1]) === fn) score = 90;
    else if (fn.length >= 3 && parts.some((p) => normName(p) === fn)) score = 60;
    else if (full && (full.includes(target) || target.includes(full)) && target.length >= 4) score = 45;
    if (score > bestScore) { bestScore = score; best = s; }
  }

  // Below 60 ("first name matched exactly") we would be guessing.
  if (!best || bestScore < 60) return null;
  return { student: best, score: bestScore, confidence: bestScore >= 90 ? "high" : "medium" };
}

async function loadRoster({ teacherEmail, className, rosterIn }) {
  let roster = (Array.isArray(rosterIn) ? rosterIn : [])
    .map((s) => ({
      firstName: String(s?.firstName || "").trim(),
      lastName: String(s?.lastName || "").trim(),
      studentId: String(s?.studentId || "").trim(),
      edsbyId: String(s?.edsbyId || "").trim(),
    }))
    .filter((s) => s.firstName || s.lastName);

  let rosterId = null;
  if (!roster.length && className && teacherEmail) {
    const doc = await ClassRoster.findOne({ teacherEmail, className }).lean();
    if (doc) {
      rosterId = doc._id;
      roster = (doc.students || []).map((s) => ({
        firstName: s.firstName || "", lastName: s.lastName || "",
        studentId: s.studentId || "", edsbyId: s.edsbyId || "",
      }));
    }
  }
  return { roster, rosterId };
}

// ===========================================================================
// PHASE 2 — name-delimited grouping
//
// A page showing a handwritten name (and usually a class) at the top starts a
// new student. Pages after it with no name belong to that same student. Pages
// per student is therefore variable — it is a validation signal, not an input.
// ===========================================================================
const PAGE_SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          kind: { type: "string", enum: ["named_page", "continuation", "slate", "unusable"] },
          nameAsWritten: { type: ["string", "null"] },
          classAsWritten: { type: ["string", "null"] },
          slateDate: { type: ["string", "null"] },
          slateLessonCode: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
        },
        required: ["index", "kind", "nameAsWritten", "classAsWritten", "slateDate", "slateLessonCode", "note"],
      },
    },
  },
  required: ["pages"],
};

function buildPageScanPrompt({ rosterNames, startIndex, count }) {
  const rosterBlock = rosterNames.length
    ? rosterNames.map((n) => `  - ${n}`).join("\n")
    : "  (no roster supplied)";

  return `You are sorting a teacher's batch of homework photos into students.

The teacher walked the room photographing each student's printed maths workbook
(a JUMP Math AP Book), shooting continuously. Some students needed one photo,
others two or three. The photos are in shooting order.

You are given ${count} photo(s), numbered ${startIndex} to ${startIndex + count - 1}.
Classify EACH ONE.

  named_page    the page has a HANDWRITTEN student name at the top (usually with
                a class like "7A"). This STARTS a new student.
  continuation  a workbook page with NO handwritten name at the top. It belongs
                to whichever student came before it.
  slate         a whiteboard or notepad showing a date and/or a lesson code and
                NO student name. The teacher shoots this to label the batch.
  unusable      too blurred, too dark, or too cropped to tell — say why in note.

For a named_page, put the name EXACTLY as you read the handwriting in
"nameAsWritten" (do not correct it to a roster name — the server does the
matching). Put any class written beside it in "classAsWritten".
For a slate, fill "slateDate" and "slateLessonCode" with what is written.
Leave fields null where they do not apply.

This roster is for CONTEXT ONLY — it helps you read messy handwriting. Do NOT
force a page onto a roster name, and do NOT mark a page "named_page" just
because a roster name looks similar:
${rosterBlock}

Be conservative. Calling a continuation page "named_page" splits one student
into two; missing a real name merges two students into one. If a page genuinely
has a handwritten name, say so; if you cannot tell, use "unusable" and say why.

Return JSON only, with one entry per photo, in the order given.`;
}

async function scanPages({ images, rosterNames }) {
  const out = new Array(images.length).fill(null);
  const chunks = [];
  for (let i = 0; i < images.length; i += GROUP_CHUNK) {
    chunks.push({ start: i, imgs: images.slice(i, i + GROUP_CHUNK) });
  }

  await Promise.all(chunks.map(async ({ start, imgs }) => {
    try {
      const resp = await openai().responses.create({
        model: MODEL,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: buildPageScanPrompt({ rosterNames, startIndex: start, count: imgs.length }) },
            ...imgs.map((img) => ({ type: "input_image", image_url: img })),
          ],
        }],
        text: { format: { type: "json_schema", name: "page_scan", strict: true, schema: PAGE_SCAN_SCHEMA } },
        max_output_tokens: 3000,
      });
      const parsed = safeJsonParse(resp.output_text);
      const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
      // Map by position within the chunk — the model echoes our numbering but
      // we don't depend on it being right.
      pages.forEach((p, k) => {
        const abs = Number.isFinite(p?.index) && p.index >= start && p.index < start + imgs.length
          ? p.index
          : start + k;
        if (abs >= 0 && abs < images.length && !out[abs]) out[abs] = p;
      });
    } catch (err) {
      console.warn(`[homework/group] page scan chunk @${start} failed:`, err?.message || err);
    }
  }));

  // Anything the scan missed is "unusable" rather than silently a continuation
  // — a wrong continuation attaches a page to the previous student.
  return out.map((p, i) => p || {
    index: i, kind: "unusable", nameAsWritten: null, classAsWritten: null,
    slateDate: null, slateLessonCode: null, note: "This photo could not be read during sorting.",
  });
}

// Turn the per-page scan into student groups.
function buildGroups({ scans, roster }) {
  const groups = [];
  let slate = null;
  const warnings = [];
  let current = null;

  scans.forEach((p, i) => {
    if (p.kind === "slate") {
      // Only the first slate labels the batch; a later one is noted, not used.
      if (!slate) {
        slate = {
          photoIndex: i,
          date: p.slateDate || "",
          lessonCode: p.slateLessonCode ? String(p.slateLessonCode).toUpperCase().trim() : "",
          raw: [p.slateDate, p.slateLessonCode].filter(Boolean).join(" "),
        };
      } else {
        warnings.push(`Photo ${i + 1} looks like another slate — ignored for grouping.`);
      }
      return; // excluded from student grouping entirely
    }

    if (p.kind === "named_page") {
      const m = roster.length ? matchRosterStudent(p.nameAsWritten || "", roster) : null;
      current = {
        nameAsWritten: String(p.nameAsWritten || "").trim(),
        classAsWritten: String(p.classAsWritten || "").trim(),
        studentName: m ? `${m.student.firstName} ${m.student.lastName}`.trim() : "",
        studentId: m?.student?.studentId || "",
        edsbyId: m?.student?.edsbyId || "",
        matched: !!m,
        matchConfidence: m?.confidence || "none",
        photoIndexes: [i],
        superseded: false,
        notes: [],
      };
      groups.push(current);
      return;
    }

    // continuation / unusable
    if (!current) {
      // A page before any name — can't be attributed to anyone.
      groups.push({
        nameAsWritten: "", classAsWritten: "", studentName: "", studentId: "", edsbyId: "",
        matched: false, matchConfidence: "none",
        photoIndexes: [i], superseded: false,
        notes: ["This photo came before any named page, so it has no student."],
        orphan: true,
      });
      current = null;
      return;
    }
    current.photoIndexes.push(i);
    if (p.kind === "unusable" && p.note) current.notes.push(`Photo ${i + 1}: ${p.note}`);
  });

  // Retakes: the same name starting two groups means the teacher reshot the
  // student. Keep the LATER group, mark the earlier one superseded. Never
  // merge them silently — the pages may be of different work.
  const lastByName = new Map();
  groups.forEach((g, gi) => {
    const key = normName(g.studentName || g.nameAsWritten);
    if (!key) return;
    if (lastByName.has(key)) {
      const prev = lastByName.get(key);
      groups[prev].superseded = true;
      groups[prev].notes.push(`Superseded — this student was shot again later (group ${gi + 1}).`);
      warnings.push(
        `"${g.studentName || g.nameAsWritten}" starts more than one group. ` +
        `Keeping the later one (photos ${g.photoIndexes.map((n) => n + 1).join(", ")}); ` +
        `the earlier one is marked superseded, not merged.`
      );
    }
    lastByName.set(key, gi);
  });

  // Page-count validation: report anyone off the batch's most common count.
  const active = groups.filter((g) => !g.superseded && !g.orphan);
  const counts = {};
  for (const g of active) counts[g.photoIndexes.length] = (counts[g.photoIndexes.length] || 0) + 1;
  let modalPageCount = null;
  let best = 0;
  for (const [n, c] of Object.entries(counts)) {
    if (c > best) { best = c; modalPageCount = parseInt(n, 10); }
  }
  for (const g of active) {
    if (modalPageCount != null && g.photoIndexes.length !== modalPageCount) {
      g.pageCountOutlier = true;
      g.notes.push(`${g.photoIndexes.length} page(s) — most students in this batch have ${modalPageCount}.`);
    }
  }

  // Roster students with no group at all.
  const seen = new Set(active.filter((g) => g.matched).map((g) => normName(g.studentName)));
  const missingStudents = roster
    .map((s) => `${s.firstName} ${s.lastName}`.trim())
    .filter((full) => full && !seen.has(normName(full)));

  return { groups, slate, modalPageCount, warnings, missingStudents };
}

// POST /homework/group  { uploadId, teacherEmail, className, roster? }
router.post("/group", async (req, res) => {
  try {
    const b = req.body || {};
    const teacherEmail = String(b.teacherEmail || "").trim().toLowerCase();
    const className = String(b.className || "").trim();

    const mat = materialiseUpload(b.uploadId);
    if (mat.error) return res.status(400).json({ ok: false, error: mat.error, missing: mat.missing });

    const { roster } = await loadRoster({ teacherEmail, className, rosterIn: b.roster });
    const rosterNames = roster.map((s) => `${s.firstName} ${s.lastName}`.trim()).filter(Boolean);

    const scans = await scanPages({ images: mat.images, rosterNames });
    const grouped = buildGroups({ scans, roster });

    return res.json({
      ok: true,
      photoCount: mat.images.length,
      scans: scans.map((p, i) => ({
        index: i,
        kind: p.kind,
        nameAsWritten: p.nameAsWritten || "",
        classAsWritten: p.classAsWritten || "",
        note: p.note || "",
      })),
      ...grouped,
    });
  } catch (err) {
    console.error("[homework/group]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not sort the batch into students." });
  }
});

// ===========================================================================
// PHASE 0 — the assignment page
//
// Before the capture lap the teacher shoots 1-3 photos of the textbook page(s)
// being assigned. We read the question numbers and question text off them.
// This also labels the batch (it replaces the old whiteboard slate).
//
// Reading the question TEXT matters for loose-paper mode: when a student works
// in a notebook the photo shows answers with hand-written numbers and no
// questions, so the only way to line them up is the assignment page.
// ===========================================================================
const ASSIGNMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lessonCode: { type: ["string", "null"] },
    pageLabel: { type: ["string", "null"] },
    subjectGuess: { type: ["string", "null"] },
    workType: { type: "string", enum: ["discrete", "extended_writing", "mixed", "unknown"] },
    workTypeReason: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: { type: "string" },
          text: { type: "string" },
          parts: { type: "array", items: { type: "string" } },
        },
        required: ["number", "text", "parts"],
      },
    },
  },
  required: ["lessonCode", "pageLabel", "subjectGuess", "workType", "workTypeReason", "questions"],
};

router.post("/assignment", async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) return res.status(400).json({ ok: false, error: "At least one photo of the assignment page is required." });
    if (images.length > 3) return res.status(400).json({ ok: false, error: "Up to 3 assignment-page photos." });
    if (!images.every(isDataUrlImage)) return res.status(400).json({ ok: false, error: "Every image must be a data URL." });

    const resp = await openai().responses.create({
      model: MODEL,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: `These ${images.length} photo(s) are the textbook page(s) a teacher is about to
assign for homework. Read the page and list the questions on it.

For each question:
  number   the printed question number, exactly as printed: "7", "12"
  text     the printed question itself, transcribed. Keep it short but faithful —
           this is used later to line up answers a student wrote in a notebook
           with no questions beside them. Trim to about 200 characters.
  parts    the lettered parts the question has, e.g. ["a","b","c"]. Empty array
           when the question has no parts.

Also report:
  lessonCode  the lesson/section code if the page shows one ("NS7-3", "3.4"), else null
  pageLabel   how a teacher would refer to this page ("p. 142", "Unit 3 Review"), else null
  subjectGuess  the subject, in one or two words

  workType    whether this page can be correctness-checked against an answer key:
    discrete           questions have short definite answers — sums, equations,
                       fill-in-the-blank, vocabulary, labelled diagrams, grammar
                       exercises. These can be compared to a key.
    extended_writing   paragraphs, essays, reflections, "explain your thinking",
                       open-ended responses. These CANNOT be checked against a key.
    mixed              genuinely both on the same page
    unknown            you cannot tell from these photos
  workTypeReason  one sentence saying why, in plain language for a teacher.

List EVERY question you can see on the page, in printed order. Do not invent
questions that are not printed. If the page numbering restarts or is ambiguous,
transcribe what is printed rather than renumbering.

Return JSON only.`,
          },
          ...images.map((img) => ({ type: "input_image", image_url: img })),
        ],
      }],
      text: { format: { type: "json_schema", name: "assignment_page", strict: true, schema: ASSIGNMENT_SCHEMA } },
      max_output_tokens: 6000,
    });

    const parsed = safeJsonParse(resp.output_text);
    const questions = (Array.isArray(parsed?.questions) ? parsed.questions : [])
      .map((q) => ({
        number: String(q?.number || "").trim(),
        text: String(q?.text || "").trim().slice(0, 400),
        parts: (Array.isArray(q?.parts) ? q.parts : []).map((p) => String(p || "").trim()).filter(Boolean),
      }))
      .filter((q) => q.number);

    if (!questions.length) {
      return res.status(422).json({
        ok: false,
        error: "No questions could be read from that page. Try a straighter, better-lit photo of the whole page.",
      });
    }

    return res.json({
      ok: true,
      lessonCode: parsed?.lessonCode ? String(parsed.lessonCode).toUpperCase().trim() : "",
      pageLabel: parsed?.pageLabel || "",
      subjectGuess: parsed?.subjectGuess || "",
      workType: parsed?.workType || "unknown",
      workTypeReason: parsed?.workTypeReason || "",
      questions,
    });
  } catch (err) {
    console.error("[homework/assignment]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not read the assignment page." });
  }
});

// ---------------------------------------------------------------------------
// Expand an assignment page into the subset the teacher actually set.
// The app cannot infer this, so the UI asks: All / Odds / Evens / custom.
// ---------------------------------------------------------------------------
export function expandSubset({ questions, mode, customRaw }) {
  const all = [];
  for (const q of questions) {
    if (q.parts && q.parts.length) {
      for (const p of q.parts) all.push(`${q.number}${p}`);
    } else {
      all.push(String(q.number));
    }
  }

  if (mode === "custom") return parseAssignedQuestions(customRaw).questions;

  const numOf = (label) => parseInt(String(label).match(/^(\d+)/)?.[1] ?? "", 10);
  if (mode === "odds") return all.filter((l) => Number.isFinite(numOf(l)) && numOf(l) % 2 === 1);
  if (mode === "evens") return all.filter((l) => Number.isFinite(numOf(l)) && numOf(l) % 2 === 0);
  return all;
}

// POST /homework/subset  { questions, mode, customRaw }
// Returns the expanded label list so the UI can show exactly what will be checked.
router.post("/subset", (req, res) => {
  const questions = (Array.isArray(req.body?.questions) ? req.body.questions : [])
    .map((q) => ({
      number: String(q?.number || "").trim(),
      parts: (Array.isArray(q?.parts) ? q.parts : []).map((p) => String(p || "").trim()).filter(Boolean),
    }))
    .filter((q) => q.number);
  const mode = ["all", "odds", "evens", "custom"].includes(req.body?.mode) ? req.body.mode : "all";
  const assigned = expandSubset({ questions, mode, customRaw: req.body?.customRaw || "" });
  return res.json({ ok: true, mode, assignedQuestions: assigned, count: assigned.length });
});

// ---------------------------------------------------------------------------
// POST /homework/coverage
//
// Most textbooks print answers for ODD questions only. The teacher should know
// how much of their set is actually verifiable BEFORE they walk the room.
// ---------------------------------------------------------------------------
router.post("/coverage", async (req, res) => {
  try {
    const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
    const lessonCode = String(req.body?.lessonCode || "").trim().toUpperCase();
    const bookName = String(req.body?.bookName || "").trim();
    const assigned = (Array.isArray(req.body?.assignedQuestions) ? req.body.assignedQuestions : [])
      .map((q) => String(q || "").trim()).filter(Boolean);
    const workType = String(req.body?.workType || "unknown");

    if (!assigned.length) return res.status(400).json({ ok: false, error: "assignedQuestions is required." });

    const fit = assessSubjectFit({ workType, hasAnswerKey: true });

    // A key chosen by the teacher answers this outright; the lessonCode lookup
    // is only the fallback for a batch labelled from an assignment page.
    const answerKeyId = String(req.body?.answerKeyId || "").trim();
    if (!teacherEmail || (!lessonCode && !answerKeyId)) {
      return res.json({
        ok: true, hasAnswerKey: false, covered: 0, total: assigned.length,
        coveredQuestions: [], uncovered: assigned,
        correctnessAvailable: false,
        reason: "No answer key on file for this lesson — this batch will report completeness only.",
        workTypeOk: fit.ok, workTypeReason: fit.reason,
      });
    }

    let doc = null;
    if (answerKeyId) {
      doc = await HomeworkAnswerKey.findOne({ _id: answerKeyId, teacherEmail }).lean().catch(() => null);
    } else {
      const q = { teacherEmail, lessonCode };
      if (bookName) q.bookName = bookName;
      doc = await HomeworkAnswerKey.findOne(q).lean();
    }
    const keyQs = doc?.questions || [];
    const keySet = new Set(keyQs.map((k) => String(k.q).trim().toLowerCase()));

    const coveredQuestions = assigned.filter((a) => keySet.has(a.toLowerCase()));
    const uncovered = assigned.filter((a) => !keySet.has(a.toLowerCase()));

    const hasAnswerKey = keyQs.length > 0;
    const fit2 = assessSubjectFit({ workType, hasAnswerKey: hasAnswerKey && coveredQuestions.length > 0 });

    return res.json({
      ok: true,
      hasAnswerKey,
      bookName: doc?.bookName || bookName,
      covered: coveredQuestions.length,
      total: assigned.length,
      coveredQuestions,
      uncovered,
      correctnessAvailable: fit2.ok && coveredQuestions.length > 0,
      reason: fit2.ok
        ? (coveredQuestions.length
            ? `Key covers ${coveredQuestions.length} of your ${assigned.length} questions. The other ${uncovered.length} will be marked "no key" and left out of the correctness score.`
            : "The key on file doesn't cover any of your assigned questions — this batch will report completeness only.")
        : fit2.reason,
      workTypeOk: fit2.ok,
      workTypeReason: fit2.reason,
    });
  } catch (err) {
    console.error("[homework/coverage]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not work out key coverage." });
  }
});

// Correctness needs discrete checkable answers AND something to compare to.
// Anything else gets completeness-only, with the reason said plainly.
function assessSubjectFit({ workType, hasAnswerKey }) {
  if (workType === "extended_writing") {
    return {
      ok: false,
      reason: "This page looks like extended writing, so there are no discrete answers to compare against a key. " +
              "Homework Check will report completeness only — for marking the writing itself, use the rubric grading mode.",
    };
  }
  if (!hasAnswerKey) {
    return {
      ok: false,
      reason: "No answer key covers this assignment, so correctness can't be judged. Completeness only.",
    };
  }
  return { ok: true, reason: "" };
}

// ===========================================================================
// Answer keys
// ===========================================================================
// Pages per model call. A JUMP answer-key page is four dense columns holding
// several lessons; the whole book in one call blew past max_output_tokens and
// came back with the first three lessons and nothing else.
const KEY_PAGES_PER_CALL = 3;
const KEY_CALL_CONCURRENCY = 3;

// The heading over each lesson reads "AP Book NS7-1". Strip the words, and
// repair the separator: a dot or dash where the book prints a hyphen is the
// same lesson, and filing it as "NS7.1" makes it unfindable.
function normaliseLessonCode(raw) {
  let c = String(raw || "").trim().toUpperCase();
  if (!c) return "";
  c = c.replace(/^AP\s*BOOK\s*/i, "").replace(/\s+/g, "");
  c = c.replace(/^([A-Z]{1,4}\d+)[.–—_\/](\d+)$/, "$1-$2");
  // "7.1" is the BOOK — it appears in the running footer on every page, and
  // taking it for a lesson code files the whole book under one bogus key.
  if (!/^[A-Z]{1,4}\d+-\d+[A-Z]?$/.test(c)) return "";
  return c;
}

async function extractKeyChunk(images) {
  const resp = await openai().responses.create({
    model: MODEL,
    input: [{
      role: "user",
      content: [
        {
          type: "input_text",
          text: `These images are pages from the ANSWER KEY section of a maths workbook
(a JUMP Math AP Book). Transcribe them.

HOW THESE PAGES ARE LAID OUT — read them this way or the answers will be
attributed to the wrong lessons:
  - Each page is FOUR NARROW COLUMNS. Read all the way down column 1, then
    column 2, then 3, then 4. Do NOT read straight across the page.
  - Several lessons share a page. A lesson starts at a heading reading
    "AP Book NS7-1" (or PA7-4, ME8-12, G7-2 ...), usually with "page 14"
    under it. Everything after that heading belongs to that lesson until the
    next heading — including where it continues into the next column, or onto
    the next page.
  - "BONUS" inside a lesson is part of that lesson. Keep its answers, labelled
    as the book labels them.
  - The running header ("Number Sense - AP Book 7, Part 1: Unit 1") and the
    footer ("Answer Keys for AP Book 7.1", "J-3") are NOT lesson codes. Never
    return "7.1" or "J-3" as a lessonCode.

WHAT TO RETURN
  - lessonCode exactly as the heading prints it: "NS7-1", not "NS7.1".
  - Keep question labels exactly as the book writes them: "1a", "3", "10b".
    Where a question has roman-numeral sub-parts, write them "4a-ii".
  - Keep answers as text, including units, fractions and short explanations.
    Do not convert or simplify them.
  - A lesson may begin before these pages or run past them. Transcribe the part
    you can see; it will be joined to the rest.
  - Transcribe only what is printed. If something is illegible, omit that one
    question rather than guessing — a missing key entry is safe, a wrong one
    silently marks students wrong.

Return JSON only.`,
        },
        ...images.map((img) => ({ type: "input_image", image_url: img })),
      ],
    }],
    text: {
      format: {
        type: "json_schema", name: "answer_key", strict: true,
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            lessons: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                properties: {
                  lessonCode: { type: "string" },
                  questions: {
                    type: "array",
                    items: {
                      type: "object", additionalProperties: false,
                      properties: { q: { type: "string" }, answer: { type: "string" } },
                      required: ["q", "answer"],
                    },
                  },
                },
                required: ["lessonCode", "questions"],
              },
            },
            note: { type: ["string", "null"] },
          },
          required: ["lessons", "note"],
        },
      },
    },
    max_output_tokens: 16000,
  });
  const parsed = safeJsonParse(resp.output_text);
  return {
    lessons: Array.isArray(parsed?.lessons) ? parsed.lessons : [],
    note: parsed?.note || "",
  };
}

// Read every chunk, merging as we go. Nothing is written until all of it is
// read: a lesson split across a chunk boundary must be stitched back together
// before it lands, or the second half would overwrite the first.
async function extractAnswerKey(images, onProgress) {
  const chunks = [];
  for (let i = 0; i < images.length; i += KEY_PAGES_PER_CALL) {
    chunks.push(images.slice(i, i + KEY_PAGES_PER_CALL));
  }

  const merged = new Map();   // lessonCode -> Map(q -> answer)
  const notes = [];
  const failed = [];
  let done = 0;

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(KEY_CALL_CONCURRENCY, chunks.length) },
    async () => {
      while (cursor < chunks.length) {
        const idx = cursor++;
        try {
          const { lessons, note } = await extractKeyChunk(chunks[idx]);
          if (note) notes.push(note);
          for (const lesson of lessons) {
            const code = normaliseLessonCode(lesson.lessonCode);
            if (!code) continue;
            if (!merged.has(code)) merged.set(code, new Map());
            const bucket = merged.get(code);
            for (const q of (Array.isArray(lesson.questions) ? lesson.questions : [])) {
              const label = String(q?.q || "").trim();
              const answer = String(q?.answer || "").trim();
              // First reading wins: a chunk that only caught the tail of a
              // lesson shouldn't overwrite a fuller reading of the same label.
              if (label && !bucket.has(label)) bucket.set(label, answer);
            }
          }
        } catch (err) {
          console.error(`[homework/answer-key] chunk ${idx + 1} failed:`, err?.message || err);
          failed.push(idx + 1);
        }
        done++;
        onProgress?.(done, chunks.length);
      }
    }
  );
  await Promise.all(workers);

  return { merged, notes, failed, chunkCount: chunks.length };
}

async function saveAnswerKey({ teacherEmail, bookName, images, onProgress }) {
  const { merged, notes, failed, chunkCount } = await extractAnswerKey(images, onProgress);

  const saved = [];
  for (const [lessonCode, bucket] of merged) {
    const questions = [...bucket.entries()]
      .map(([q, answer]) => ({ q, answer }))
      .filter((x) => x.q);
    if (!questions.length) continue;
    await HomeworkAnswerKey.findOneAndUpdate(
      { teacherEmail, bookName, lessonCode },
      { teacherEmail, bookName, lessonCode, questions, sourcePageCount: images.length, extractionNote: notes.join(" ") },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    saved.push({ lessonCode, questionCount: questions.length });
  }
  saved.sort((a, b) => a.lessonCode.localeCompare(b.lessonCode, undefined, { numeric: true }));

  console.log(
    `[homework/answer-key] ${teacherEmail} "${bookName}" ${images.length}p → `
    + `${saved.length} lesson(s)${failed.length ? `, ${failed.length}/${chunkCount} chunks failed` : ""}`
  );
  return {
    lessons: saved,
    note: notes.join(" "),
    // Say so rather than quietly filing a key with holes in it.
    warning: failed.length
      ? `${failed.length} of ${chunkCount} page groups couldn't be read, so some lessons may be missing or incomplete. Re-uploading will fill the gaps.`
      : "",
  };
}

router.post("/answer-key", async (req, res) => {
  try {
    const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
    const bookName = String(req.body?.bookName || "").trim();
    const images = Array.isArray(req.body?.images) ? req.body.images : [];

    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    if (!images.length) return res.status(400).json({ ok: false, error: "At least one answer-key photo is required." });
    if (images.length > 60) return res.status(400).json({ ok: false, error: "Too many pages in one upload (max 60)." });
    if (!images.every(isDataUrlImage)) return res.status(400).json({ ok: false, error: "Every image must be a data URL." });

    // A whole book takes minutes, which no proxy will hold open. Short uploads
    // — a photographed spread — still answer directly.
    if (images.length > KEY_PAGES_PER_CALL) {
      const jobId = crypto.randomUUID();
      jobs.set(jobId, { status: "processing", progress: 0, stage: "reading pages", createdAt: Date.now() });
      res.json({ ok: true, jobId, pageCount: images.length });
      (async () => {
        try {
          const out = await saveAnswerKey({
            teacherEmail, bookName, images,
            onProgress: (d, t) => setJob(jobId, {
              progress: Math.round((d / Math.max(1, t)) * 100),
              stage: `read ${d} of ${t} page groups`,
            }),
          });
          if (!out.lessons.length) {
            setJob(jobId, { status: "error", error: "No lessons could be read from those pages. Check they are answer-key pages." });
            return;
          }
          setJob(jobId, { status: "done", progress: 100, result: out });
        } catch (err) {
          console.error("[homework/answer-key job]", err?.message || err);
          setJob(jobId, { status: "error", error: "Answer-key extraction failed." });
        }
      })();
      return;
    }

    const out = await saveAnswerKey({ teacherEmail, bookName, images });
    if (!out.lessons.length) {
      return res.status(422).json({
        ok: false,
        error: "No lessons could be read from those pages. Check they are answer-key pages and try a sharper photo.",
      });
    }
    return res.json({ ok: true, bookName, ...out });
  } catch (err) {
    console.error("[homework/answer-key]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Answer-key extraction failed." });
  }
});

router.get("/answer-key/job/:id", (req, res) => {
  const j = jobs.get(String(req.params.id || ""));
  if (!j) return res.status(404).json({ ok: false, error: "Job not found or expired." });
  return res.json({ ok: true, ...j });
});

router.get("/answer-key/list", async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const q = { teacherEmail };
    if (req.query.bookName) q.bookName = String(req.query.bookName);
    const docs = await HomeworkAnswerKey.find(q)
      .select("bookName lessonCode questions updatedAt")
      .sort({ bookName: 1, lessonCode: 1 }).lean();
    return res.json({
      ok: true,
      keys: docs.map((d) => ({
        id: String(d._id), bookName: d.bookName, lessonCode: d.lessonCode,
        questionCount: (d.questions || []).length, updatedAt: d.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[homework/answer-key/list]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not list answer keys." });
  }
});

router.get("/answer-key/lookup", async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || "").trim().toLowerCase();
    const lessonCode = String(req.query.lessonCode || "").trim().toUpperCase();
    if (!teacherEmail || !lessonCode) {
      return res.status(400).json({ ok: false, error: "teacherEmail and lessonCode are required." });
    }
    const q = { teacherEmail, lessonCode };
    if (req.query.bookName) q.bookName = String(req.query.bookName);
    const doc = await HomeworkAnswerKey.findOne(q).lean();
    if (!doc) return res.json({ ok: true, found: false, questions: [] });
    return res.json({ ok: true, found: true, bookName: doc.bookName, lessonCode: doc.lessonCode, questions: doc.questions || [] });
  } catch (err) {
    console.error("[homework/answer-key/lookup]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Lookup failed." });
  }
});

router.delete("/answer-key/:id", async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const r = await HomeworkAnswerKey.deleteOne({ _id: req.params.id, teacherEmail });
    return res.json({ ok: true, deleted: r.deletedCount || 0 });
  } catch (err) {
    console.error("[homework/answer-key delete]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Delete failed." });
  }
});

// ===========================================================================
// PHASE 3 — grading the teacher-confirmed groups
// ===========================================================================

// What counts as set, when the teacher hasn't said. Everything printed counts,
// minus the things textbooks universally mark as extra — which is the common
// case and keeps a bonus question from reading as homework left undone.
const DEFAULT_SCOPE_RULE =
  "Everything printed on the page except questions the book marks as bonus, "
  + "extension, investigation or challenge.";
function buildCheckPrompt({ assigned, keyLines, pageCount, studentLabel, workSurface, assignmentQuestions, keyIdea, scopeRule }) {
  const keyBlock = keyLines.length
    ? `
ANSWER KEY — AUTHORITATIVE. DO NOT DO THE MATHEMATICS YOURSELF.
${keyLines.map((l) => `  ${l}`).join("\n")}

For every question you marked "attempted", set "correct" to:
  correct    the student's written answer matches the key above
  incorrect  it does not match the key above
  no_key     that question does not appear in the key above

You are COMPARING against the key, not solving the problem. If your own
calculation disagrees with the key, the key wins — never mark a student
incorrect on the strength of your own arithmetic. Set "checkedBy" to "key".

WHERE THE KEY IS SILENT — most books print odd answers only.
For a question that does NOT appear in the key above, work the answer out
yourself, then compare. Set "checkedBy" to "worked" so the teacher can see
which marks rest on the book and which on you.
  - Do the mathematics carefully and completely before deciding.
  - Only do this where the answer is a matter of fact — an arithmetic result,
    a solved equation, a value read off a table. Where the question asks for an
    explanation, an estimate, a drawing, an opinion, or anything with more than
    one defensible answer, do NOT judge it: "no_key", checkedBy "none".
  - If you are not confident, "no_key" with checkedBy "none" is the right
    answer. A question left unjudged costs the teacher nothing; a student
    marked wrong because of YOUR slip is a mark they have to argue their way
    out of. Prefer saying nothing.

IMPORTANT: this key is probably incomplete. Most textbooks print answers for
odd-numbered questions only. A question missing from the key above is "no_key" —
it is NOT wrong, and it is NOT your job to work out the answer. Never mark a
question incorrect because it is absent from the key.`
    : `
NO ANSWER KEY IS AVAILABLE for this assignment.
Set "correct" to null and "checkedBy" to "none" for every question. Do not
judge correctness at all.`;

  const surfaceBlock = workSurface === "loose"
    ? `
WHAT THESE IMAGES ARE
${pageCount === 1
      ? "This image is ONE student's handwritten work on loose paper or in a notebook."
      : `These ${pageCount} images are ONE student's handwritten work on loose paper or in a notebook, in order.`}
${studentLabel ? `The teacher has confirmed this work belongs to: ${studentLabel}\n` : ""}
The questions are NOT on the page. The student has written answers with a
question number beside each one. Everything on the page is the student's
handwriting.

MATCHING ANSWERS TO QUESTIONS — this is the delicate part.
Line up each answer with an assigned question using the NUMBER the student
wrote beside it. Here are the questions as printed in the textbook, so you can
sanity-check a match:
${assignmentQuestions.slice(0, 60).map((q) => `  ${q.number}. ${String(q.text || "").slice(0, 140)}`).join("\n") || "  (question text unavailable)"}

  - Match on the student's written number FIRST. The question text is only there
    to confirm a number that is hard to read.
  - If an answer's number cannot be matched to an assigned question — it's
    illegible, it's out of range, or the student numbered things their own way —
    put it in "unmatchedAnswers" with what you can read. DO NOT guess which
    question it belongs to. A wrongly-attached answer is worse than one the
    teacher checks by hand.
  - An assigned question with no answer carrying its number is "not_attempted".
  - There is no "sample" on loose paper — the book pre-fills nothing here.`
    : `
WHAT THESE IMAGES ARE
${pageCount === 1
      ? "This image is one page of ONE student's printed workbook."
      : `These ${pageCount} images are consecutive pages of ONE student's printed workbook, in order.`}
${studentLabel ? `The teacher has confirmed these pages belong to: ${studentLabel}\n` : ""}The questions are PRINTED in the book. Only the answers are HANDWRITTEN.

THE MOST IMPORTANT DISTINCTION — printed ink is the book, handwriting is the student.
  - Printed question text and printed question numbers are NOT student work.
  - This book pre-fills some parts as worked examples for the student to follow.
    That printed working is the BOOK's, not the student's. Mark such a part
    "sample". A sample is neither attempted nor not-attempted — it was never
    the student's to do.
  - ONLY handwriting counts as the student attempting a question.`;

  const keyIdeaBlock = keyIdea
    ? `\nTHE LESSON'S KEY IDEA (use this when a slip is not identifiable):\n  "${keyIdea}"\n`
    : "\n(No Key Idea is on file for this lesson. Where a slip is not identifiable, say plainly that it needs another look rather than inventing a reason.)\n";

  return `You are checking whether a student completed their assigned homework, and
writing short formative feedback the student will read and act on.
${surfaceBlock}

WHICH QUESTIONS WERE ACTUALLY SET — set "scope" on every question.
A printed page carries more than the teacher assigned. Work nobody was asked to
do must never read as work left undone, so judge each question against this,
which is how this teacher describes what they set:

  ${scopeRule}

  core     the question falls inside that description — it was set
  bonus    it is on the page but outside it — not set, whatever the reason
  unclear  you genuinely cannot tell

A description comes in two kinds and may mix them:

  BY NUMBER OR PART — "1, 3, 5", "odds", "1 to 12", "first three parts of each",
  "a and b only", "1-10 but just the first two letters". Work it out from the
  question's own printed number and part letter. "The first three letters of 1,
  3, 5" means 1a 1b 1c, 3a 3b 3c, 5a 5b 5c are core and everything else on the
  page — including 1d, and including all of 2 and 4 — is bonus. Letters and
  parts mean the same thing: a, b, c.

  BY SECTION — "Core only", "skip the Investigation", "not the bonus". Decide
  from what is PRINTED: a heading, a label, a star, a shaded box.

Two rules hold either way. Never infer from whether the student did it — a
blank question is exactly the case this has to get right, and "they skipped it
so it must not have been set" would erase the finding. And when you genuinely
cannot tell, "unclear" is the honest answer; it will be counted as core, so
guessing "bonus" to be kind would quietly excuse real work.
${assigned.length ? `
THE ASSIGNED QUESTIONS — report on exactly these and no others:
${assigned.map((q) => `  ${q}`).join("\n")}` : `THE ASSIGNED QUESTIONS — the teacher did not supply a list, because the
questions are printed on these pages. Read them off the page yourself:
  - Report on every printed question on these pages, in the order they appear.
  - Use the question's own printed number as its label, exactly as printed
    (including any part letter: "3b", not "3 b" or "question 3b").
  - A question printed on the page but left blank is "not_attempted". Do not
    leave it out — a skipped question is the finding, and omitting it would
    silently shrink the denominator and flatter the student.
  - Do not invent questions that are not printed on these pages.`}

For each assigned question set "work" to one of:
  attempted      handwriting is present showing an answer or working
  not_attempted  nothing handwritten for this question
  unreadable     handwriting is present but you cannot read it confidently
  sample         the book pre-filled this part as a worked example${workSurface === "loose" ? " (not applicable here)" : ""}
${keyBlock}

NEVER GUESS IN ORDER TO COMPLETE A ROW. If you cannot read something, it is
"unreadable" with a short note saying why (too faint, cut off, blurred,
overwritten). A short honest "unreadable" list is far more useful to the
teacher than a confident wrong table.

═══════════════════════════════════════════════════════════════════════
STUDENT-FACING FEEDBACK — "studentNote" per question
═══════════════════════════════════════════════════════════════════════
This is written TO THE STUDENT and will appear on their own progress page.
A verdict is not feedback. Give them something to do.

Per question, by case:
  finished and correct   Leave studentNote as an empty string. Nothing to act on.
  finished, not correct  Name the question and say what to do NEXT.
                         Prefer "Check whether you took the same amount off both
                         sides" over "wrong".
  not attempted          Neutral and factual: "Not done yet." NEVER "you failed
                         to", never any implication of laziness or character.
  unreadable             Leave studentNote EMPTY. Unreadable work goes to the
                         teacher only — the student never sees that flag.
  no key                 "I didn't check this one."
  sample                 Leave studentNote empty — it was never theirs to do.

NAMING THE SLIP — the important restraint.
Only name a specific mistake when the comparison to the key ACTUALLY SHOWS IT:
  - a sign error
  - a place-value shift
  - an answer that is the right value for a different part of the question
  - a unit left off or converted the wrong way
If the slip is NOT clear from the written answer alone, do NOT invent a
diagnosis. Fall back to the Key Idea below and point at it.
${keyIdeaBlock}
TONE — these are rules, not preferences:
  - Second person, present tense, next-step oriented. "Try…", "Check…", "Look again at…".
  - NO comparison to classmates. NO ranking. Never mention other students at all.
  - NO cumulative character judgements. Never "you always", "you keep",
    "you struggle with", "as usual". Comment ONLY on this piece of work.
  - Short. TWO SENTENCES MAXIMUM per question. One is usually better.
  - Plain language a student of this age actually uses.

"encouragement" — ONE line for the whole check.
Name something specific this student genuinely did well on THIS work: "Your
working on 5b is laid out clearly and easy to follow." It must be EARNED and
SPECIFIC — never generic praise like "good effort" or "well done". If the work
genuinely gives you nothing to praise (e.g. nothing was attempted), return an
empty string rather than manufacturing something. An empty encouragement is
honest; a hollow one is not.

"lessonSeen" — what the PAGE says this work is.
Copy the lesson code and/or title printed at the top of the page, exactly as
printed: "NS7-1", "PA7-8 Patterns and Rules", "Unit 3 Review". This is read
off the page, never worked out: if the page carries no such heading, return
null. Every student's copy is the same page, so their answers are compared
with one another — a guess from one of them would corrupt that agreement, and
null from all of them is a perfectly good answer.

Return JSON only.`;
}

const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          q: { type: "string" },
          work: { type: "string", enum: ["attempted", "not_attempted", "unreadable", "sample"] },
          correct: { type: ["string", "null"], enum: ["correct", "incorrect", "no_key", null] },
          // Teacher-facing diagnostic.
          note: { type: ["string", "null"] },
          // Student-facing formative line. Empty when there's nothing to act on.
          studentNote: { type: "string" },
          // Was this question actually set? A printed page carries more than
          // was assigned — bonus, extension, investigation — and a question
          // nobody was asked to do must not count as work left undone.
          scope: { type: "string", enum: ["core", "bonus", "unclear"] },
          // How "correct" was decided. The key is authoritative; "worked"
          // means the book printed no answer and this was solved instead,
          // which is worth separating in the tally.
          checkedBy: { type: "string", enum: ["key", "worked", "none"] },
        },
        required: ["q", "work", "correct", "note", "studentNote", "scope", "checkedBy"],
      },
    },
    encouragement: { type: "string" },
    // Loose-paper mode: answers whose question number couldn't be matched.
    // Reported rather than guessed at.
    unmatchedAnswers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          labelAsWritten: { type: "string" },
          answerAsWritten: { type: "string" },
          note: { type: "string" },
        },
        required: ["labelAsWritten", "answerAsWritten", "note"],
      },
    },
    pageNote: { type: ["string", "null"] },
    // What the page says it is — the printed lesson code and/or title. Read
    // from the page, never inferred; 15-20 students agreeing is what makes it
    // usable, and a guess would poison that agreement.
    lessonSeen: { type: ["string", "null"] },
  },
  required: ["questions", "unmatchedAnswers", "encouragement", "pageNote", "lessonSeen"],
};

// Belt-and-braces on the tone rules. The prompt forbids these, but a phrase
// that slips through would be read by a child on their own progress page, so
// we drop the line rather than ship it. Cheap insurance.
const BANNED_TONE = [
  /\byou always\b/i, /\byou keep\b/i, /\byou (?:seem to )?struggle\b/i,
  /\byou never\b/i, /\bas usual\b/i, /\byou failed\b/i, /\byou didn'?t bother\b/i,
  /\bthe class\b/i, /\bother students\b/i, /\bclassmates\b/i,
  /\bbetter than\b/i, /\bworse than\b/i, /\baverage\b/i, /\brank\b/i,
  /\blazy\b/i, /\bcareless\b/i,
];
function sanitizeStudentText(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  if (BANNED_TONE.some((re) => re.test(t))) return "";
  // Two sentences max.
  const sentences = t.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return sentences.slice(0, 300);
}

// What the class's own pages say this assignment is. Every student holds a
// copy of the same page, so the heading printed on it is reported 15-20 times
// over — agreement across the batch is what makes it trustworthy, and it costs
// nothing beyond a field the model was already looking at.
//
// A plurality is required, not a majority: on a bad photo most pages read as
// nothing, and two clear readings out of twenty with nothing contradicting
// them is still the answer. What is refused is a lone reading, or a genuine
// split, where the honest outcome is to leave the field to the teacher.
function consensusLesson(results) {
  const seen = results
    .map((r) => String(r?.lessonSeen || "").trim())
    .filter(Boolean);
  if (seen.length < 2) return null;

  const tally = new Map();
  for (const v of seen) {
    const k = v.toUpperCase();
    if (!tally.has(k)) tally.set(k, { text: v, n: 0 });
    tally.get(k).n++;
  }
  const ranked = [...tally.values()].sort((a, b) => b.n - a.n);
  const top = ranked[0];
  const runnerUp = ranked[1]?.n || 0;
  if (top.n < 2) return null;
  if (top.n <= runnerUp) return null; // a real split — say nothing

  // The code, where the heading carries one ("PA7-8 Patterns and Rules").
  const codeMatch = top.text.match(/\b([A-Z]{1,4}\d+-\d+[A-Z]?)\b/i);
  return {
    text: top.text,
    code: codeMatch ? codeMatch[1].toUpperCase() : "",
    agreed: top.n,
    of: seen.length,
  };
}

// Two independent marks, never merged.
function scoreStudent(questions, hasAnswerKey) {
  const qs = Array.isArray(questions) ? questions : [];
  // Book-pre-filled samples were never the student's work, so they leave the
  // denominator rather than counting against them.
  // Out of the denominator: a book's pre-filled worked example was never the
  // student's to do, and neither was a question they weren't asked to do. This
  // is the whole point of scope — a bonus left blank is not work left undone.
  // "unclear" counts as core, so an unreadable page errs towards asking.
  const gradable = qs.filter((q) => q.work !== "sample" && q.scope !== "bonus");
  // "unreadable" means handwriting IS present — the student did attempt it.
  const attempted = gradable.filter((q) => q.work === "attempted" || q.work === "unreadable");

  const assignedCount = gradable.length;
  const attemptedCount = attempted.length;
  const completeness = assignedCount > 0
    ? Math.round((attemptedCount / assignedCount) * 10 * 10) / 10
    : null;

  let correctness = null;
  let correctCount = 0;
  let keyedAttemptedCount = 0;
  let workedCount = 0;   // judged without the book, by working the answer out
  if (hasAnswerKey) {
    const judged = attempted.filter((q) => q.correct === "correct" || q.correct === "incorrect");
    keyedAttemptedCount = judged.length;
    correctCount = judged.filter((q) => q.correct === "correct").length;
    // Kept separate so the teacher can see how much of the mark rests on the
    // book and how much on arithmetic done here. Both count towards the score
    // — a mark over odds only would answer half the question asked of it —
    // but which is which should never be invisible.
    workedCount = judged.filter((q) => q.checkedBy === "worked").length;
    correctness = keyedAttemptedCount > 0
      ? Math.round((correctCount / keyedAttemptedCount) * 10 * 10) / 10
      : null;
  }
  return { completeness, correctness, assignedCount, attemptedCount, correctCount, keyedAttemptedCount, workedCount };
}

// ---------- background job store ----------
const jobs = new Map();
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) if (j.createdAt < cutoff) jobs.delete(id);
}, 10 * 60 * 1000).unref();

function setJob(id, patch) {
  const cur = jobs.get(id);
  if (!cur) return;
  jobs.set(id, { ...cur, ...patch });
}

// POST /homework/check
// { uploadId, teacherEmail, className, lessonCode, bookName, assignedQuestions,
//   groups: [{ studentName, studentId, edsbyId, photoIndexes, superseded? }],
//   batchDate?, slateRead?, roster? }
router.post("/check", async (req, res) => {
  try {
    const b = req.body || {};
    const teacherEmail = String(b.teacherEmail || "").trim().toLowerCase();
    const className = String(b.className || "").trim();
    const lessonCode = String(b.lessonCode || "").trim().toUpperCase();
    const bookName = String(b.bookName || "").trim();
    const groupsIn = Array.isArray(b.groups) ? b.groups : [];
    const workSurface = b.workSurface === "loose" ? "loose" : "workbook";
    const subsetMode = ["all", "odds", "evens", "custom"].includes(b.subsetMode) ? b.subsetMode : "all";
    const assignment = b.assignment && typeof b.assignment === "object" ? b.assignment : {};
    const assignmentQuestions = (Array.isArray(assignment.questions) ? assignment.questions : [])
      .map((q) => ({
        number: String(q?.number || "").trim(),
        text: String(q?.text || "").trim(),
        parts: (Array.isArray(q?.parts) ? q.parts : []).map((p) => String(p || "").trim()).filter(Boolean),
      }))
      .filter((q) => q.number);

    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    if (!groupsIn.length) return res.status(400).json({ ok: false, error: "No student groups were supplied." });

    const mat = materialiseUpload(b.uploadId);
    if (mat.error) return res.status(400).json({ ok: false, error: mat.error, missing: mat.missing });

    // The assigned set comes either pre-expanded from the subset step, or as
    // free text the teacher typed.
    let assigned = (Array.isArray(b.assignedQuestions) ? b.assignedQuestions : [])
      .map((q) => String(q || "").trim()).filter(Boolean);
    let unparsed = [];
    const assignedRaw = Array.isArray(b.assignedQuestions)
      ? assigned.join(", ")
      : String(b.assignedQuestions || "").trim();
    if (!assigned.length) {
      const p = parseAssignedQuestions(assignedRaw);
      assigned = p.questions;
      unparsed = p.unparsed;
    }
    // On printed pages the questions are ON the student's own sheets, so the
    // assignment photo is a convenience, not a prerequisite: with no list the
    // model reports every question printed on the pages it is given. Loose
    // paper is the genuine exception — there the questions are nowhere in the
    // images, so without a list there is nothing to report against.
    const discoverQuestions = !assigned.length && workSurface !== "loose";
    if (!assigned.length && !discoverQuestions) {
      return res.status(400).json({
        ok: false,
        error: "This work is on loose paper, so the questions aren't in the photos. Shoot the assignment page, or type a list like \"1ab, 3bc, 5bc\".",
        unparsed,
      });
    }

    // Only grade groups the teacher kept: superseded retakes and orphans are
    // carried into the record but not sent to the model.
    const groups = groupsIn
      .map((g) => ({
        studentName: String(g?.studentName || "").trim(),
        studentId: String(g?.studentId || "").trim(),
        edsbyId: String(g?.edsbyId || "").trim(),
        nameAsWritten: String(g?.nameAsWritten || "").trim(),
        matched: !!g?.matched,
        matchConfidence: String(g?.matchConfidence || "none"),
        superseded: !!g?.superseded,
        photoIndexes: (Array.isArray(g?.photoIndexes) ? g.photoIndexes : [])
          .map((n) => parseInt(n, 10))
          .filter((n) => Number.isFinite(n) && n >= 0 && n < mat.images.length),
      }))
      .filter((g) => g.photoIndexes.length);

    if (!groups.some((g) => !g.superseded)) {
      return res.status(400).json({ ok: false, error: "Every group is marked superseded — nothing to grade." });
    }

    const { roster, rosterId } = await loadRoster({ teacherEmail, className, rosterIn: b.roster });

    // The teacher can name the key outright. Matching on (bookName, lessonCode)
    // is a guess that only works when the batch is labelled from an assignment
    // page — and with the assignment page optional, and a teacher holding keys
    // for several subjects, picking one from the list is the plain way to say
    // which answers this check should be marked against.
    let keyQuestions = [];
    let keyIdea = String(b.keyIdea || "").trim();
    const answerKeyId = String(b.answerKeyId || "").trim();
    let keyDoc = null;
    if (answerKeyId) {
      // Scoped to the teacher: an id alone must not reach another teacher's key.
      keyDoc = await HomeworkAnswerKey.findOne({ _id: answerKeyId, teacherEmail }).lean().catch(() => null);
    } else if (lessonCode) {
      const kq = { teacherEmail, lessonCode };
      if (bookName) kq.bookName = bookName;
      keyDoc = await HomeworkAnswerKey.findOne(kq).lean();
    }
    if (keyDoc) {
      keyQuestions = keyDoc.questions || [];
      if (!keyIdea) keyIdea = keyDoc.keyIdea || "";
    }

    // Key coverage: most textbooks print odd answers only, so this is usually
    // partial. Uncovered questions are excluded from correctness, never wrong.
    //
    // In discovery mode there is no assigned list yet — the questions are read
    // off the students' pages during grading — so intersecting with it gives
    // zero and would declare a perfectly good key uncovered. That is exactly
    // what happened to a PA7-8 batch sitting next to a PA7-8 key with 37
    // answers in it. With no list, having a key at all is the test, and
    // coverage is worked out per question while grading.
    const keySet = new Set(keyQuestions.map((k) => String(k.q).trim().toLowerCase()));
    const coveredQuestions = assigned.filter((a) => keySet.has(a.toLowerCase()));
    const uncovered = assigned.filter((a) => !keySet.has(a.toLowerCase()));
    const hasAnswerKey = assigned.length
      ? coveredQuestions.length > 0
      : keyQuestions.length > 0;

    // Subject fit: no key, or extended writing, means completeness only — and
    // we say why rather than emitting a correctness number with nothing behind it.
    const fit = assessSubjectFit({ workType: assignment.workType || "unknown", hasAnswerKey });
    const correctnessAvailable = fit.ok;

    const gradable = groups.filter((g) => !g.superseded);
    const jobId = crypto.randomUUID();
    jobs.set(jobId, {
      status: "processing", createdAt: Date.now(),
      progress: 0, stage: "starting", studentTotal: gradable.length,
    });

    res.json({
      ok: true, jobId,
      studentCount: gradable.length,
      hasAnswerKey,
      correctnessAvailable,
      correctnessSkippedReason: fit.ok ? "" : fit.reason,
      keyCoverage: { covered: coveredQuestions.length, total: assigned.length, uncovered },
      assignedQuestions: assigned,
      unparsedTokens: unparsed,
    });

    runCheckJob({
      jobId, teacherEmail, className, rosterId, lessonCode, bookName,
      assignmentName: String(b.assignmentName || "").trim().slice(0, 120),
      scopeRule: String(b.assignmentScope || "").trim().slice(0, 400),
      assignedRaw, assigned, groups, images: mat.images, roster,
      keyQuestions, hasAnswerKey: correctnessAvailable, keyIdea,
      keyCoverage: { covered: coveredQuestions.length, total: assigned.length, uncovered },
      correctnessAvailable, correctnessSkippedReason: fit.ok ? "" : fit.reason,
      workSurface, subsetMode,
      assignment: {
        pageLabel: assignment.pageLabel || "",
        questions: assignmentQuestions,
        workType: assignment.workType || "unknown",
        workTypeReason: assignment.workTypeReason || "",
        subjectGuess: assignment.subjectGuess || "",
      },
      batchDate: b.batchDate ? new Date(b.batchDate) : new Date(),
      uploadId: String(b.uploadId || ""),
    }).catch((err) => {
      console.error("[homework/check] job fatal:", jobId, err?.message || err);
      setJob(jobId, { status: "error", error: "Homework check failed.", finishedAt: Date.now() });
    });
  } catch (err) {
    if (res.headersSent) return;
    console.error("[homework/check]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not start the homework check." });
  }
});

async function runCheckJob(ctx) {
  const {
    jobId, teacherEmail, className, rosterId, lessonCode, bookName,
    assignedRaw, assigned, groups, images, roster,
    keyQuestions, hasAnswerKey, batchDate, uploadId,
    keyCoverage, correctnessAvailable, correctnessSkippedReason,
    workSurface, subsetMode, assignment, scopeRule, assignmentName,
  } = ctx;

  const started = Date.now();
  const keyed = keyQuestions.filter((k) => assigned.includes(k.q));
  // If label filtering leaves nothing, send the whole lesson key rather than
  // silently grading with no key at all.
  const effectiveKeyLines = (keyed.length ? keyed : keyQuestions).map((k) => `${k.q} = ${k.answer}`);

  const gradable = groups.filter((g) => !g.superseded);
  const results = new Array(groups.length).fill(null);
  let done = 0;

  setJob(jobId, { stage: "grading", progress: 5 });

  async function gradeGroup(gi) {
    const g = groups[gi];

    // Superseded retakes and orphan pages are recorded, never graded.
    if (g.superseded) {
      results[gi] = {
        ...blankResult(g, assigned),
        flags: ["Superseded by a later retake — not graded"],
        superseded: true,
      };
      return;
    }

    const groupImages = g.photoIndexes.map((i) => images[i]);
    const label = g.studentName || g.nameAsWritten || "";

    try {
      const resp = await openai().responses.create({
        model: MODEL,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildCheckPrompt({
                assigned,
                keyLines: hasAnswerKey ? effectiveKeyLines : [],
                pageCount: groupImages.length,
                studentLabel: label,
                workSurface,
                assignmentQuestions: assignment?.questions || [],
                keyIdea: ctx.keyIdea || "",
                scopeRule: ctx.scopeRule || DEFAULT_SCOPE_RULE,
              }),
            },
            ...groupImages.map((img) => ({ type: "input_image", image_url: img })),
          ],
        }],
        text: { format: { type: "json_schema", name: "homework_check", strict: true, schema: CHECK_SCHEMA } },
        max_output_tokens: 3000,
      });

      const parsed = safeJsonParse(resp.output_text);
      if (!parsed) throw new Error("Model returned unparseable JSON");

      const byQ = new Map(
        (Array.isArray(parsed.questions) ? parsed.questions : [])
          .map((q) => [String(q?.q || "").trim().toLowerCase(), q])
      );
      // With a list, the model can neither drop a row nor invent one. Without
      // one — printed pages, no assignment photo — the model's own rows ARE the
      // result: it read the questions off the page, so there is nothing to
      // normalise against and mapping over an empty list would discard them all.
      const rows = assigned.length
        ? assigned.map((q) => ({ q, hit: byQ.get(q.toLowerCase()) }))
        : (Array.isArray(parsed.questions) ? parsed.questions : [])
            .map((h) => ({ q: String(h?.q || "").trim(), hit: h }))
            .filter((r) => r.q);
      const questions = rows.map(({ q, hit }) => {
        if (!hit) return { q, work: "unreadable", correct: null, scope: "unclear", checkedBy: "none", note: "The model did not report on this question." };
        const work = ["attempted", "not_attempted", "unreadable", "sample"].includes(hit.work) ? hit.work : "unreadable";
        let correct = null;
        if (hasAnswerKey && (work === "attempted" || work === "unreadable")) {
          correct = ["correct", "incorrect", "no_key"].includes(hit.correct) ? hit.correct : "no_key";
        }
        // Student-facing line, with the cases that must stay silent enforced
        // here rather than trusted to the prompt: a correct answer needs no
        // commentary, and an unreadable one is the teacher's business only.
        const scope = ["core", "bonus", "unclear"].includes(hit.scope) ? hit.scope : "unclear";
        const checkedBy = correct === "correct" || correct === "incorrect"
          ? (["key", "worked"].includes(hit.checkedBy) ? hit.checkedBy : "key")
          : "none";
        let studentNote = sanitizeStudentText(hit.studentNote);
        if (work === "unreadable" || work === "sample" || correct === "correct") studentNote = "";
        // A bonus question was never theirs to do, so "Not done yet." would be
        // an accusation about work nobody set. Attempting one is credit, not a
        // requirement, so it only ever gets a line when they actually did it.
        if (scope === "bonus" && work !== "attempted") studentNote = "";
        else if (work === "not_attempted" && !studentNote) studentNote = "Not done yet.";
        if (correct === "no_key" && !studentNote) studentNote = "I didn't check this one.";
        return { q, work, correct, note: String(hit.note || ""), studentNote, scope, checkedBy };
      });

      const score = scoreStudent(questions, hasAnswerKey);
      const unmatchedAnswers = (Array.isArray(parsed.unmatchedAnswers) ? parsed.unmatchedAnswers : [])
        .map((u) => ({
          labelAsWritten: String(u?.labelAsWritten || "").trim(),
          answerAsWritten: String(u?.answerAsWritten || "").trim(),
          note: String(u?.note || "").trim(),
        }))
        .filter((u) => u.labelAsWritten || u.answerAsWritten);

      const flags = [];
      const unreadable = questions.filter((q) => q.work === "unreadable");
      if (unreadable.length) flags.push(`${unreadable.length} answer(s) need checking by hand`);
      if (unmatchedAnswers.length) {
        flags.push(`${unmatchedAnswers.length} answer(s) couldn't be matched to a question — check by hand`);
      }
      if (!g.matched) flags.push("Name could not be matched to the roster");
      if (parsed.pageNote) flags.push(String(parsed.pageNote));
      const lessonSeen = String(parsed.lessonSeen || "").trim().slice(0, 120);

      results[gi] = {
        lessonSeen,
        unmatchedAnswers,
        encouragement: sanitizeStudentText(parsed.encouragement),
        studentName: g.studentName || "",
        studentId: g.studentId || "",
        edsbyId: g.edsbyId || "",
        nameAsWritten: g.nameAsWritten || "",
        matched: !!g.matched,
        matchConfidence: g.matchConfidence || "none",
        unmatched: !g.matched,
        noPageFound: false,
        superseded: false,
        ...score,
        questions,
        photoIndexes: g.photoIndexes,
        flags,
        error: "",
      };
    } catch (err) {
      console.warn(`[homework/check] group ${gi} failed:`, err?.message || err);
      results[gi] = {
        ...blankResult(g, assigned),
        questions: assigned.map((q) => ({ q, work: "unreadable", correct: null, note: "This page could not be processed." })),
        flags: ["These pages could not be processed — check them by hand"],
        error: "processing_failed",
      };
    } finally {
      done += 1;
      setJob(jobId, {
        progress: Math.round(5 + (done / Math.max(1, gradable.length)) * 85),
        stage: `checked ${Math.min(done, gradable.length)} of ${gradable.length}`,
      });
    }
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, groups.length) }, async () => {
    while (cursor < groups.length) await gradeGroup(cursor++);
  });
  await Promise.all(workers);

  setJob(jobId, { stage: "finishing", progress: 92 });

  // Every roster student with no page is reported. Silently dropping a student
  // is the worst failure this tool can have.
  const seen = new Set(results.filter((r) => r && r.matched && !r.superseded).map((r) => normName(r.studentName)));
  const missingStudents = [];
  for (const s of roster) {
    const full = `${s.firstName} ${s.lastName}`.trim();
    if (!full || seen.has(normName(full))) continue;
    missingStudents.push(full);
    results.push({
      studentName: full, studentId: s.studentId || "", edsbyId: s.edsbyId || "",
      nameAsWritten: "", matched: true, matchConfidence: "none",
      unmatched: false, noPageFound: true, superseded: false,
      completeness: null, correctness: null,
      assignedCount: assigned.length, attemptedCount: 0, correctCount: 0, keyedAttemptedCount: 0,
      questions: [], photoIndexes: [],
      flags: ["No page found for this student in this batch"],
      error: "",
    });
  }

  // Fill the label from the pages when the teacher left it blank. Never
  // overwrite what they typed — they were in the room and the page was not.
  const detected = consensusLesson(results);
  let effectiveName = assignmentName || "";
  let effectiveCode = lessonCode || "";
  if (detected) {
    if (!effectiveName) effectiveName = detected.text;
    if (!effectiveCode && detected.code) effectiveCode = detected.code;
  }
  // The pages disagreeing with the teacher is worth saying out loud: it is how
  // a batch graded against the wrong lesson's key announces itself.
  const lessonMismatch =
    detected?.code && lessonCode && detected.code !== String(lessonCode).toUpperCase()
      ? `The pages read "${detected.code}" (${detected.agreed} of ${detected.of}) but this batch was labelled ${lessonCode}.`
      : "";

  const unmatchedPhotoIndexes = results
    .filter((r) => r && r.unmatched && !r.superseded)
    .flatMap((r) => r.photoIndexes || []);
  const unreadableCount = results.reduce(
    (n, r) => n + ((r?.questions || []).filter((q) => q.work === "unreadable").length), 0
  );

  const doc = {
    teacherEmail, className, rosterId,
    lessonCode: effectiveCode,
    bookName,
    batchDate: batchDate || new Date(),
    assignment: assignment || {},
    subsetMode: subsetMode || "all",
    assignedQuestionsRaw: assignedRaw,
    assignedQuestions: assigned,
    assignmentScope: scopeRule || "",
    assignmentName: effectiveName,
    detectedLesson: detected ? `${detected.text} (${detected.agreed}/${detected.of} pages)` : "",
    lessonMismatch,
    workSurface: workSurface || "workbook",
    photoCount: images.length,
    hasAnswerKey,
    keyCoverage: keyCoverage || { covered: 0, total: assigned.length, uncovered: assigned },
    correctnessAvailable: !!correctnessAvailable,
    correctnessSkippedReason: correctnessSkippedReason || "",
    results,
    unmatchedPhotoIndexes,
    missingStudents,
    unreadableCount,
    model: MODEL,
    responseTimeMs: Date.now() - started,
  };

  let batchId = null;
  try {
    const saved = await HomeworkCheckBatch.create(doc);
    batchId = String(saved._id);
  } catch (err) {
    // A failed save must not lose the teacher's work — they still get the table.
    console.error("[homework/check] batch save failed:", err?.message || err);
  }

  // The photos have served their purpose; free the memory.
  if (uploadId) uploads.delete(uploadId);

  setJob(jobId, {
    status: "done", progress: 100, stage: "done", finishedAt: Date.now(),
    result: { ...doc, batchId },
  });
}

function blankResult(g, assigned) {
  return {
    studentName: g.studentName || "", studentId: g.studentId || "", edsbyId: g.edsbyId || "",
    nameAsWritten: g.nameAsWritten || "",
    matched: !!g.matched, matchConfidence: g.matchConfidence || "none",
    unmatched: !g.matched, noPageFound: false, superseded: !!g.superseded,
    completeness: null, correctness: null,
    assignedCount: assigned.length, attemptedCount: 0, correctCount: 0, keyedAttemptedCount: 0,
    questions: [], photoIndexes: g.photoIndexes || [], flags: [], error: "",
  };
}

router.get("/check/job/:id", (req, res) => {
  const j = jobs.get(String(req.params.id || ""));
  if (!j) return res.status(404).json({ ok: false, error: "Job not found or expired." });
  return res.json({
    ok: true,
    status: j.status,
    progress: j.progress ?? null,
    stage: j.stage || null,
    error: j.error || null,
    result: j.status === "done" ? j.result : null,
  });
});

// ===========================================================================
// History
// ===========================================================================
router.get("/batches", async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const q = { teacherEmail };
    if (req.query.className) q.className = String(req.query.className);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const docs = await HomeworkCheckBatch.find(q)
      .select("className lessonCode bookName batchDate assignedQuestionsRaw photoCount hasAnswerKey missingStudents unreadableCount results.studentName results.completeness results.correctness createdAt")
      .sort({ batchDate: -1, createdAt: -1 }).limit(limit).lean();

    return res.json({
      ok: true,
      batches: docs.map((d) => ({
        id: String(d._id), className: d.className, lessonCode: d.lessonCode, bookName: d.bookName,
        batchDate: d.batchDate, assignedQuestionsRaw: d.assignedQuestionsRaw,
        photoCount: d.photoCount, hasAnswerKey: d.hasAnswerKey,
        studentCount: (d.results || []).length,
        missingCount: (d.missingStudents || []).length,
        unreadableCount: d.unreadableCount, createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    console.error("[homework/batches]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not list batches." });
  }
});

router.get("/batches/:id", async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const doc = await HomeworkCheckBatch.findOne({ _id: req.params.id, teacherEmail }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Batch not found." });
    return res.json({ ok: true, batch: { ...doc, id: String(doc._id) } });
  } catch (err) {
    console.error("[homework/batches/:id]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not load that batch." });
  }
});

router.get("/student-history", async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || "").trim().toLowerCase();
    const studentId = String(req.query.studentId || "").trim();
    const studentName = String(req.query.studentName || "").trim();
    if (!teacherEmail || (!studentId && !studentName)) {
      return res.status(400).json({ ok: false, error: "teacherEmail and studentId (or studentName) are required." });
    }
    const q = { teacherEmail };
    if (req.query.className) q.className = String(req.query.className);
    const docs = await HomeworkCheckBatch.find(q).sort({ batchDate: -1 }).limit(200).lean();

    const target = normName(studentName);
    const history = [];
    for (const d of docs) {
      const hit = (d.results || []).find((r) =>
        (studentId && (r.studentId === studentId || r.edsbyId === studentId)) ||
        (target && normName(r.studentName) === target)
      );
      if (!hit) continue;
      history.push({
        batchId: String(d._id), batchDate: d.batchDate, lessonCode: d.lessonCode, className: d.className,
        completeness: hit.completeness, correctness: hit.correctness,
        noPageFound: hit.noPageFound,
        attemptedCount: hit.attemptedCount, assignedCount: hit.assignedCount,
      });
    }
    return res.json({ ok: true, history });
  } catch (err) {
    console.error("[homework/student-history]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not load history." });
  }
});

// ===========================================================================
// Publishing to /results → /progress
//
// Homework Check results reach the student portal the same way every other
// grading mode does: one PublishedResult per student, keyed by
// meta.studentId, which is what studentProgress.js queries.
//
// The difference is WHEN. Other modes publish as they grade. Homework Check
// publishes only on Release, because the whole point of the gate is that
// nothing appears on /progress until the teacher has checked the flags.
// Un-releasing deletes the published copies again.
// ===========================================================================

// The plain-text body the student reads at /results/{code}. Headings match the
// ones the results page parser already understands ("Next Steps:",
// "Overall Comment:"), so this renders without touching that page.
//
// This function is the student-facing boundary: anything the student must
// never see has to be absent HERE, not merely hidden in the UI.
function buildStudentPayloadText(batch, r, code) {
  const lines = [];

  // Completeness is the mark that posts to the gradebook, and the regex in
  // resultsRoutes' notifier reads "n / m" off this line.
  if (r.completeness != null) lines.push(`Grade: ${r.completeness} / 10`);
  else lines.push("Homework check");
  lines.push("");

  // The teacher's own name for it first — it is what the student was told in
  // class. The code and page label stay behind it for anyone cross-referencing.
  const label = [batch.assignmentName, batch.lessonCode, batch.assignment?.pageLabel]
    .filter(Boolean).join(" · ");
  if (label) { lines.push(`Assignment: ${label}`); lines.push(""); }

  // Counts, never percentages — "you finished 4 of 6", not "67%".
  lines.push(`You finished ${r.attemptedCount} of ${r.assignedCount} questions.`);
  if (batch.correctnessAvailable && r.keyedAttemptedCount > 0) {
    lines.push(`Of the ${r.keyedAttemptedCount} I could check, ${r.correctCount} were right.`);
  }
  lines.push("");

  // Per-question next steps. Only questions with something to act on carry a
  // studentNote — correct answers, samples and unreadable work are all blank
  // by construction upstream, so nothing leaks here.
  const actionable = (r.questions || []).filter((q) => q.studentNote);
  if (actionable.length) {
    lines.push("Next Steps:");
    for (const q of actionable) lines.push(`- ${q.q}: ${q.studentNote}`);
    lines.push("");
  }

  // Correct answers only once the teacher has flipped the second toggle, so
  // the page is somewhere to try again before it's somewhere to copy.
  if (batch.answersReleased && Array.isArray(batch._answerLookup) && batch._answerLookup.length) {
    const wanted = new Set(
      (r.questions || [])
        .filter((q) => q.correct === "incorrect" || q.work === "not_attempted")
        .map((q) => String(q.q).toLowerCase())
    );
    const shown = batch._answerLookup.filter((k) => wanted.has(String(k.q).toLowerCase()));
    if (shown.length) {
      lines.push("Answers:");
      for (const k of shown) lines.push(`- ${k.q}: ${k.answer}`);
      lines.push("");
    }
  }

  lines.push("Overall Comment:");
  if (r.encouragement) lines.push(r.encouragement);
  const toRevisit = actionable.length;
  lines.push(
    toRevisit
      ? `There ${toRevisit === 1 ? "is 1 question" : `are ${toRevisit} questions`} to look at again above.`
      : "Nothing to revisit on this one."
  );
  lines.push("");
  lines.push(`View this online: www.curriculate.net/results/${code}`);

  return lines.join("\n");
}

// Create one PublishedResult per eligible student. Idempotent: a second
// release updates the existing rows rather than duplicating them.
async function publishBatchToPortal(batch) {
  // Answers are only needed when the teacher has released them.
  let answerLookup = [];
  if (batch.answersReleased && batch.lessonCode) {
    const keyDoc = await HomeworkAnswerKey.findOne({
      teacherEmail: batch.teacherEmail,
      lessonCode: batch.lessonCode,
      ...(batch.bookName ? { bookName: batch.bookName } : {}),
    }).lean();
    answerLookup = keyDoc?.questions || [];
  }
  const ctx = { ...batch, _answerLookup: answerLookup };

  // A student only gets a portal entry if we know who they are and there is
  // something to show. No page found / superseded retakes / unmatched pages
  // are teacher-side concerns and never become a student result.
  const eligible = (batch.results || []).filter(
    (r) => (r.studentId || r.edsbyId) && !r.noPageFound && !r.superseded && !r.unmatched && r.completeness != null
  );

  const expiresAt = resultExpiryDate();
  const batchId = String(batch._id);
  let created = 0;
  let updated = 0;

  for (const r of eligible) {
    const studentId = r.studentId || r.edsbyId;
    const meta = {
      source: "homework-check",
      homeworkBatchId: batchId,
      studentId,
      studentName: r.studentName,
      className: batch.className || "",
      teacherEmail: batch.teacherEmail,
      title: `Homework ${batch.assignmentName || batch.lessonCode || batch.assignment?.pageLabel || ""}`.trim(),
      subject: batch.assignment?.subjectGuess || "",
      assessmentType: "Homework",
      score: r.completeness,
      outOf: 10,
    };

    // One row per (batch, student) — re-release updates in place.
    const existing = await PublishedResult.findOne({
      "meta.homeworkBatchId": batchId,
      "meta.studentId": studentId,
    });

    if (existing) {
      existing.payload = buildStudentPayloadText(ctx, r, existing.code);
      existing.meta = meta;
      existing.expiresAt = expiresAt;
      await existing.save();
      updated += 1;
      continue;
    }

    // Fresh code, retrying on the (rare) unique-index collision.
    let saved = null;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      const code = genAA123();
      try {
        saved = await PublishedResult.create({
          code,
          payload: buildStudentPayloadText(ctx, r, code),
          meta,
          sessionId: `homework-${batchId}`,
          expiresAt,
        });
      } catch (err) {
        if (err?.code !== 11000) throw err; // not a duplicate-code clash
      }
    }
    if (saved) {
      created += 1;
      // Same notification path every other grading mode uses.
      notifyNewGrade(studentId, {
        title: meta.title,
        subject: meta.subject,
        code: saved.code,
        scoreText: `${r.completeness}/10`,
      }).catch((e) => console.warn("[homework/publish] notify failed:", e?.message || e));
    }
  }

  console.log(`[homework/publish] batch ${batchId}: ${created} created, ${updated} updated of ${eligible.length} eligible`);
  return { created, updated, eligible: eligible.length };
}

async function unpublishBatch(batchId) {
  const r = await PublishedResult.deleteMany({ "meta.homeworkBatchId": String(batchId) });
  console.log(`[homework/publish] batch ${batchId}: removed ${r.deletedCount || 0} portal entries`);
  return r.deletedCount || 0;
}

// ===========================================================================
// TEACHER RELEASE GATE
//
// Nothing reaches the student portal automatically. The teacher reviews the
// batch, fixes any mis-grouping or misread, and releases deliberately.
// Answers are a SECOND, separate toggle so the portal can be somewhere to try
// the question again before it becomes somewhere to copy the answer.
// ===========================================================================
router.post("/batches/:id/release", async (req, res) => {
  try {
    const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const release = req.body?.released !== false; // default true; pass false to un-release

    const doc = await HomeworkCheckBatch.findOneAndUpdate(
      { _id: req.params.id, teacherEmail },
      release
        ? { released: true, releasedAt: new Date(), releasedBy: teacherEmail }
        : { released: false, releasedAt: null },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Batch not found." });

    // This is the moment the results actually reach the student portal — one
    // PublishedResult per student, exactly like every other grading mode.
    let portal = null;
    try {
      portal = release ? await publishBatchToPortal(doc) : { removed: await unpublishBatch(doc._id) };
    } catch (pubErr) {
      // The release itself stands; we just couldn't push to the portal. Say so
      // rather than reporting a clean success the teacher would trust.
      console.error("[homework/release] portal publish failed:", pubErr?.message || pubErr);
      return res.json({
        ok: true,
        released: doc.released,
        releasedAt: doc.releasedAt,
        portalError: "The batch was released, but publishing to the student portal failed. Press Release again to retry.",
      });
    }

    console.log(`[homework/release] ${teacherEmail} ${release ? "released" : "un-released"} batch ${req.params.id}`);
    return res.json({ ok: true, released: doc.released, releasedAt: doc.releasedAt, portal });
  } catch (err) {
    console.error("[homework/release]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Release failed." });
  }
});

router.post("/batches/:id/release-answers", async (req, res) => {
  try {
    const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const show = req.body?.answersReleased !== false;

    const doc = await HomeworkCheckBatch.findOneAndUpdate(
      { _id: req.params.id, teacherEmail },
      show
        ? { answersReleased: true, answersReleasedAt: new Date() }
        : { answersReleased: false, answersReleasedAt: null },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Batch not found." });

    // Already-published payloads have to be rewritten, or the toggle would
    // only affect students who hadn't looked yet.
    if (doc.released) {
      try { await publishBatchToPortal(doc); }
      catch (e) { console.error("[homework/release-answers] republish failed:", e?.message || e); }
    }
    return res.json({ ok: true, answersReleased: doc.answersReleased });
  } catch (err) {
    console.error("[homework/release-answers]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Toggle failed." });
  }
});

// ---------------------------------------------------------------------------
// GET /homework/student-view
//
// What the student portal reads. This is the ONLY route that should ever serve
// homework data to a student, because it is where the "never sees" rules live:
//   - unreleased batches are invisible, full stop
//   - unreadable flags, teacher notes and internal flags are stripped
//   - correct answers are withheld until the teacher flips answersReleased
//   - counts, never percentages; no class average, no ranking, no other students
// ---------------------------------------------------------------------------
router.get("/student-view", async (req, res) => {
  try {
    const studentId = String(req.query.studentId || "").trim();
    const studentName = String(req.query.studentName || "").trim();
    if (!studentId && !studentName) {
      return res.status(400).json({ ok: false, error: "studentId or studentName is required." });
    }

    const q = { released: true };
    if (req.query.teacherEmail) q.teacherEmail = String(req.query.teacherEmail).trim().toLowerCase();
    if (req.query.className) q.className = String(req.query.className);

    const docs = await HomeworkCheckBatch.find(q).sort({ batchDate: -1 }).limit(60).lean();
    const target = normName(studentName);

    const checks = [];
    for (const d of docs) {
      const hit = (d.results || []).find((r) =>
        (studentId && (r.studentId === studentId || r.edsbyId === studentId)) ||
        (target && normName(r.studentName) === target)
      );
      // A student with no page, or a superseded retake, has nothing to show.
      if (!hit || hit.noPageFound || hit.superseded) continue;

      // Key lookup only when the teacher has released answers.
      let answerByQ = new Map();
      if (d.answersReleased && d.lessonCode) {
        const keyDoc = await HomeworkAnswerKey.findOne({
          teacherEmail: d.teacherEmail, lessonCode: d.lessonCode,
          ...(d.bookName ? { bookName: d.bookName } : {}),
        }).lean();
        answerByQ = new Map((keyDoc?.questions || []).map((k) => [String(k.q).toLowerCase(), k.answer]));
      }

      const questions = (hit.questions || [])
        // Unreadable never reaches the student — it's a teacher task.
        .filter((qq) => qq.work !== "unreadable" && qq.work !== "sample")
        .map((qq) => ({
          q: qq.q,
          done: qq.work === "attempted",
          // Correctness is only meaningful where a key covered it.
          status: qq.correct === "correct" ? "correct"
            : qq.correct === "incorrect" ? "revisit"
            : qq.work === "not_attempted" ? "not_done"
            : "not_checked",
          note: qq.studentNote || "",
          // Held back until the teacher releases answers, so this page is
          // somewhere to try again rather than somewhere to copy.
          answer: d.answersReleased ? (answerByQ.get(String(qq.q).toLowerCase()) || null) : null,
        }));

      const doneCount = questions.filter((x) => x.done).length;
      checks.push({
        batchId: String(d._id),
        date: d.batchDate,
        lessonCode: d.lessonCode,
        pageLabel: d.assignment?.pageLabel || "",
        // Counts, not percentages — "you finished 4 of 6", never "67%".
        finished: doneCount,
        assigned: questions.length,
        // Completeness is kept for the student's OWN trend line only.
        completeness: hit.completeness,
        encouragement: hit.encouragement || "",
        answersReleased: !!d.answersReleased,
        questions,
      });
    }

    return res.json({
      ok: true,
      checks,
      // The student's own trend across the term. Deliberately no class average
      // and no ranking — there is nobody else on this page.
      trend: checks
        .filter((c) => c.completeness != null)
        .map((c) => ({ date: c.date, lessonCode: c.lessonCode, completeness: c.completeness }))
        .reverse(),
    });
  } catch (err) {
    console.error("[homework/student-view]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not load homework." });
  }
});

router.delete("/batches/:id", async (req, res) => {
  try {
    const teacherEmail = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const r = await HomeworkCheckBatch.deleteOne({ _id: req.params.id, teacherEmail });
    // Don't leave orphaned entries on students' progress pages pointing at a
    // batch that no longer exists.
    const removed = await unpublishBatch(req.params.id);
    return res.json({ ok: true, deleted: r.deletedCount || 0, portalRemoved: removed });
  } catch (err) {
    console.error("[homework/batches delete]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Delete failed." });
  }
});

export default router;
