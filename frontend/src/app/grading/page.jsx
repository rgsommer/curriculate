"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import BatchGrading from "./BatchGrading";
import VideoGrading from "./VideoGrading";
import AudioGrading from "./AudioGrading";
import { buildResultsPdf, buildStripsPdf, sessionItemToResult, buildSessionEdsbyCsv, preloadPdfLibs } from "./pdfReports";

/**
 * app/grading/page.jsx
 *
 * Requires:
 *   NEXT_PUBLIC_BACKEND_URL=https://api.curriculate.net
 *
 * Backend:
 *   POST {BACKEND}/grading
 *   Body: { images: [dataUrl...], rubricOverride?: string|null, meta?: object }
 *
 * Backend may return:
 *   1) assessment object directly
 *   2) { result: "{...json string...}" }
 *   3) { error: "...", raw: "{...json string...}" }
 *   4) { error: "...", raw: "" }  (rare)
 */

const DEFAULT_RUBRIC_INSTRUCTIONS = `
You are a teacher grading student assignments from photos.
Grade for: completeness, accuracy, clarity, and effort.

If you see a rubric with checkboxes/levels, assume it is a teacher scoring rubric template unless it is clearly filled in by the teacher. Unchecked boxes do NOT mean the student failed to include something.

Formatting deduction (apply ONCE total, –1), if any are missing/unclear:
- date (do not apply to posters or art work)
- proper descriptive title (not just "check-in"; do not apply to art work)
- page/question reference (if there is one; do not apply to posters, tests or art work)

Return JSON only with:
score_out_of_10,
deductions (array of {reason, points}),
final_score_out_of_10,
strengths (array of strings),
improvements (array of strings),
teacher_comment (string).
`.trim();

const GRADE_BANDS = [
  { value: "3-5", label: "Grades 3–5" },
  { value: "6-8", label: "Grades 6–8 (default)" },
  { value: "9-10", label: "Grades 9–10" },
  { value: "11+", label: "Grades 11+" },
];

const VOICE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "warm", label: "Warm & encouraging (default)" },
  { value: "direct", label: "Direct & concise" },
  { value: "coach", label: "Detailed coach" },
  { value: "gentle_firm", label: "Gentle but firm" },
  { value: "journal_response", label: "Journal Response (reflective, teacher voice)" },
  { value: "witty_light", label: "Witty (light)" },
  { value: "standards", label: "Standards-based (rubric language)" },
  { value: "student_friendly", label: "Student-friendly (simple wording)" },
  { value: "iep_supportive", label: "IEP-supportive (extra encouraging, partial-credit friendly)" },
  { value: "student_conference", label: "Student Conference (jot points)" },
  { value: "pudewa_mastery", label: "Mastery / IEW-style (Pudewa)" },
  { value: "tutor", label: "Tutor (process-focused, step-by-step)" },
];

const STANDARDS_OPTIONS = [
  { value: "canada", label: "Canada (Ontario)" },
  { value: "us", label: "US (Common Core)" },
  { value: "uk", label: "UK (National Curriculum)" },
  { value: "eu", label: "EU (Key Competences)" },
];

const SUBJECT_AREAS = [
  { value: "", label: "Auto-detect (default)" },
  { value: "math", label: "Mathematics" },
  { value: "english", label: "English / Language Arts" },
  { value: "science", label: "Science" },
  { value: "history", label: "History" },
  { value: "geography", label: "Geography" },
  { value: "languages", label: "Languages (French, Spanish, etc.)" },
];

const SUBJECT_GRADING_NOTES = {
  math: "Grade mathematically: check each step of working, mark partial credit for correct method with arithmetic errors, verify final answers against the solution. Do NOT penalise unconventional notation if the math is sound.",
  english: "Grade as English/Language Arts: assess thesis strength, evidence use, structure, grammar, and voice. Weight content and argument above mechanics unless rubric specifies otherwise.",
  science: "Grade as Science: check scientific accuracy, proper use of terminology, experimental method understanding, and data interpretation. Credit correct reasoning even if the final answer has minor errors.",
  history: "Grade as History: assess use of evidence, historical reasoning, cause-and-effect analysis, and source evaluation. Value substantiated arguments over recall of dates.",
  geography: "Grade as Geography: assess understanding of spatial relationships, use of geographic terminology, map/data interpretation, and connections between human and physical geography.",
  languages: "Grade as a World Language: assess communication effectiveness, grammar accuracy, vocabulary range, and cultural awareness. Weight communicative competence above perfect grammar.",
};

const SUBJECT_KEY = "curriculate_grading_subject_v1";
const STANDARDS_KEY = "curriculate_grading_standards_v1";
const GRADE_BAND_KEY = "curriculate_grading_band_v1";
const VOICE_KEY = "curriculate_grading_voice_v1";
const RUBRIC_OVERRIDE_KEY = "curriculate_rubric_override_v1";
const SAVED_RUBRICS_KEY = "curriculate_saved_rubrics_v1";
const VOICE_OVERRIDE_KEY = "curriculate_grading_voice_override_v1";
const VOICE_OVERRIDE_VALUE_KEY = "curriculate_grading_voice_override_value_v1";
const STRICTNESS_KEY = "curriculate_strictness_bias_v1";
const SESSION_ID_KEY = "curriculate_session_id_v1";
const ANON_ID_KEY = "curriculate_anon_id_v1";
const TEACHER_EMAIL_KEY = "curriculate_report_email";

const DEFAULT_MAX_W = 1800;
const DEFAULT_QUALITY = 0.85;

// Feedback prompt (localStorage)
const FEEDBACK_USES_KEY = "curriculate_feedback_uses_v1";
const FEEDBACK_DISMISSED_UNTIL_KEY = "curriculate_feedback_dismissed_until_v1";
const FEEDBACK_LAST_SHOWN_AT_KEY = "curriculate_feedback_last_shown_at_v1";
const FEEDBACK_SUBMITTED_KEY = "curriculate_feedback_submitted_v1"; // "1" once submitted

// Tuning
const FEEDBACK_TRIGGER_1 = 10;  // first prompt at 10 uses
const FEEDBACK_TRIGGER_2 = 30;  // optional: 2nd prompt at 30 uses (set null/0 to disable)
const FEEDBACK_SNOOZE_DAYS = 14; // if dismissed, don't show again for 14 days
const FEEDBACK_COOLDOWN_DAYS = 7; // even if eligible, don't show more than once per week

// Referral prompt (localStorage) — shown after sustained use
const REFERRAL_TRIGGER = 15;  // show referral invite after 15 gradings
const REFERRAL_DISMISSED_KEY = "curriculate_referral_dismissed_v1";
const REFERRAL_SUBMITTED_KEY = "curriculate_referral_submitted_v1";

const FEEDBACK_SUBMITTED_AT_KEY = "curriculate_feedback_submitted_at_v1";

// ── Freemium gating config ──────────────────────────────────────────
// Mirrors shared/freemiumConfig.js — kept inline because Next.js can't
// import from the shared/ directory without extra bundler config.
const FREEMIUM_ACTIVATION_DATE = new Date("2026-11-30T00:00:00Z");
const FREEMIUM_FREE_VOICE = "warm";
const FREEMIUM_FREE_MODES = ["paste"];
const FREEMIUM_GATED_VOICES = [
  "professional", "direct", "coach", "gentle_firm",
  "journal_response", "witty_light", "standards",
  "student_friendly", "iep_supportive", "student_conference",
  "pudewa_mastery", "tutor",
];
const FREEMIUM_GATED_MODES = ["photo", "batch", "video", "audio"];
const FREEMIUM_UPGRADE_URL = "/pricing";
const FREEMIUM_PLUS_PRICE = "$4.99 CAD/month";

function isFreemiumActive() {
  if (typeof window === "undefined") return false;
  return new Date() >= FREEMIUM_ACTIVATION_DATE;
}

/** Padlock state: "unlocked" (preview), "locked" (enforced), or "none" */
function getPadlockForFeature(/* userTier */) {
  // Currently all grading users are anonymous / free
  if (!isFreemiumActive()) return "unlocked";
  return "locked";
}

/** Tiny padlock icon — unlocked or locked */
function PadlockIcon({ locked, size = 13, style: extra }) {
  const color = locked ? "#94a3b8" : "#94a3b8";
  const opacity = locked ? 0.7 : 0.4;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity, flexShrink: 0, ...extra }}
      aria-hidden="true"
    >
      {locked ? (
        <>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <circle cx="12" cy="16" r="1.5" fill={color} stroke="none" />
          <line x1="12" y1="17.5" x2="12" y2="19.5" strokeWidth={2} />
        </>
      ) : (
        <>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </>
      )}
    </svg>
  );
}

// Parent note prompt (localStorage) — reminds teachers to share info with parents
const PARENT_NOTE_TRIGGER = 20;           // first show after 20 gradings
const PARENT_NOTE_REPEAT_EVERY = 50;      // re-show every 50 gradings after that
const PARENT_NOTE_DISMISSED_UNTIL_KEY = "curriculate_parent_note_dismissed_until_v1";
const PARENT_NOTE_SNOOZE_DAYS = 30;       // if dismissed, don't show again for 30 days

// Feature tour (floating tooltips)
const TOUR_SEEN_KEY = "curriculate_tour_seen_v1";
const TOUR_PHASE2_SEEN_KEY = "curriculate_tour_phase2_seen_v1";
const TOUR_PHASE3_SEEN_KEY = "curriculate_tour_phase3_seen_v1";
const TOUR_PHASE4_SEEN_KEY = "curriculate_tour_phase4_seen_v1";
const TOUR_STEPS = [
  // Phase 1 — after first result: the basics
  {
    id: "tap-to-copy",
    title: "Tap to Copy & Share",
    body: "After grading, tap the result card to copy feedback to your clipboard. This also generates a unique reference code — write it on the student's paper so parents can view the full feedback online at curriculate.net/results.",
    target: "tourTargetResult",
    phase: 1,
  },
  {
    id: "batch-intro",
    title: "Got a Whole Class to Grade?",
    body: "Switch to the Batch tab to upload a scanned PDF of all your students' papers at once. The AI splits by student, reads names, and grades each one — a whole class in minutes.",
    target: "tourTargetBatch",
    phase: 1,
  },
  // Phase 2 — after 2nd grading: sharing tools
  {
    id: "copy-session",
    title: "Email Reports — Class Analysis",
    body: "The number in brackets shows how many papers you've graded this session. Tap 'Email Reports' to get an AI-generated analysis of patterns across all papers plus half-page and cut-strip PDF reports emailed to you.",
    target: "tourTargetCopySession",
    phase: 2,
  },
  {
    id: "note-to-parents",
    title: "Note to Parents",
    body: "Copies a ready-made message you can send home explaining how parents can view their child's feedback online using the reference code.",
    target: "tourTargetParentNote",
    phase: 2,
  },
  // Phase 3 — after 5th grading: fine-tuning
  {
    id: "strictness-chevrons",
    title: "Adjust Strictness",
    body: "Not happy with a grade? Use the ‹ › chevrons next to the score to adjust. Tap ‹ (left) for stricter, › (right) for more lenient. You can nudge up to 3 levels in either direction.",
    target: "tourTargetChevrons",
    phase: 3,
  },
  {
    id: "feedback-voice",
    title: "Change Your Feedback Voice",
    body: "Choose from 13 feedback voices — Encouraging Coach, Socratic Guide, Journal Response, and more. The AI adapts its tone to match your teaching style.",
    target: "tourTargetVoice",
    phase: 3,
  },
  // Phase 4 — after 10th grading: pro workflow
  {
    id: "batch-mode",
    title: "Batch Grade a Whole Class",
    body: "Got a stack of papers? Switch to the Batch tab, upload a scanned PDF, and the AI splits by student, reads names, and grades each one. You get individual feedback plus a class summary.",
    target: "tourTargetBatch",
    phase: 4,
  },
  {
    id: "edsby-export",
    title: "Export Grades to Your Gradebook",
    body: "In Batch mode, upload your Edsby class CSV to auto-match students by name. After grading, export a ready-to-import CSV with scores, dates, and feedback links.",
    target: "tourTargetBatch",
    phase: 4,
  },
];

function submittedKeyForTrigger(t) {
  return `curriculate_feedback_submitted_for_${t}_v1`;
}

function hasSubmittedForTrigger(t) {
  return readStrLS(submittedKeyForTrigger(t), "0") === "1";
}

function markSubmittedForTrigger(t) {
  writeStrLS(submittedKeyForTrigger(t), "1");
}

// ---------- Google Analytics custom events ----------
// Safe wrapper: no-ops if gtag isn't loaded yet.
function trackEvent(eventName, params = {}) {
  try { if (typeof window !== "undefined" && window.gtag) window.gtag("event", eventName, params); } catch {}
}

function readIntLS(key, fallback = 0) {
  if (typeof window === "undefined") return fallback;
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeIntLS(key, n) {
  try { localStorage.setItem(key, String(Number(n) || 0)); } catch {}
}
function readStrLS(key, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeStrLS(key, v) {
  try { localStorage.setItem(key, String(v ?? "")); } catch {}
}
function daysFromNow(d) {
  const ms = Number(d) * 24 * 60 * 60 * 1000;
  return String(Date.now() + ms);
}

function getAnonId() {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id =
        (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
        "a_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function getSessionId() {
  try {
    let id = localStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
        String(Date.now()) + "_" + Math.random().toString(16).slice(2);
      localStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function loadLS(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function saveLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

async function compressDataUrlToJpeg(dataUrl, maxW = DEFAULT_MAX_W, quality = DEFAULT_QUALITY) {
  const img = new Image();
  img.src = dataUrl;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}

function safeJsonParse(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!s) return null;

  const tryParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  // 1) normal
  const direct = tryParse(s);
  if (direct) return direct;

  // Helper: extract the largest {...} block
  const extractObjectBlock = (str) => {
    const start = str.indexOf("{");
    const end = str.lastIndexOf("}");
    if (start >= 0 && end > start) return str.slice(start, end + 1);
    return null;
  };

  // 2) rescue {...}
  const rescued = extractObjectBlock(s);
  if (rescued) {
    const parsed = tryParse(rescued);
    if (parsed) return parsed;
  }

  // 3) handle "escaped JSON looking" payloads like: { \"overall_score\": 18, ... }
  const looksEscaped =
    /\\\"(response_format_detected|overall_score|overall_out_of|sections|student_name|teacher_comment|strengths|improvements|deductions)\\\"/.test(s) ||
    /\\\"score_out_of_10\\\"|\\\"final_score_out_of_10\\\"/.test(s) ||
    /\\n/.test(s);

  if (looksEscaped) {
    const candidate = rescued || s;

    // Unescape common sequences. Order matters.
    const unescaped = candidate
      .replace(/\\\\/g, "\\")   // \\ -> \
      .replace(/\\"/g, '"')    // \" -> "
      .replace(/\\n/g, "\n")   // \n -> newline
      .replace(/\\t/g, "\t");  // \t -> tab

    const parsed2 = tryParse(unescaped);
    if (parsed2) return parsed2;

    const rescued2 = extractObjectBlock(unescaped);
    if (rescued2) {
      const parsed3 = tryParse(rescued2);
      if (parsed3) return parsed3;
    }
  }

  return null;
}

function extractJsonStringValue(text, key) {
  if (typeof text !== "string") return null;
  const needle = `"${key}"`;
  const k = text.indexOf(needle);
  if (k < 0) return null;

  // Find the colon after "key"
  let i = k + needle.length;
  while (i < text.length && text[i] !== ":") i++;
  if (i >= text.length) return null;
  i++; // past ':'

  // Skip whitespace
  while (i < text.length && /\s/.test(text[i])) i++;

  // Expect opening quote for a JSON string value
  if (text[i] !== '"') return null;
  i++; // past opening quote

  let out = "";
  let escaped = false;

  for (; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      // keep escape sequences as-is; safeJsonParse/parseEscapedJsonString will handle
      out += "\\" + ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      // end of string
      return out;
    }

    out += ch;
  }

  return null;
}

function parseEscapedJsonString(raw) {
  if (typeof raw !== "string") return null;

  // raw may already be unescaped JSON, or an escaped JSON string
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try direct parse first
  const direct = safeJsonParse(trimmed);
  if (direct) return direct;

  // Unescape common sequences (same idea as safeJsonParse looksEscaped branch,
  // but raw here is usually the inner string WITHOUT outer quotes)
  const unescaped = trimmed
    .replace(/\\\\/g, "\\")   // \\ -> \
    .replace(/\\"/g, '"')    // \" -> "
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");

  const parsed = safeJsonParse(unescaped);
  if (parsed) return parsed;

  // Last-ditch: extract object block and parse
  const start = unescaped.indexOf("{");
  const end = unescaped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeJsonParse(unescaped.slice(start, end + 1));
  }

  return null;
}

function isAssessmentObject(o) {
  if (!o || typeof o !== "object") return false;

  const hasOverallScore =
    typeof o.overall_score === "number" &&
    typeof o.overall_out_of === "number";

  const has10Score =
    typeof o.score_out_of_10 === "number" ||
    typeof o.final_score_out_of_10 === "number";

  if (!hasOverallScore && !has10Score) return false;

  const hasSections = Array.isArray(o.sections) && o.sections.length > 0;

  const hasFeedback =
    Array.isArray(o.strengths) ||
    Array.isArray(o.improvements) ||
    typeof o.teacher_comment === "string" ||
    Array.isArray(o.deductions);

  return hasSections || hasFeedback;
}

/**
 * Single, canonical normalizer.
 * Returns { assessment, wrapperError, rawTextUsed }
 */
function normalizeFromAny(serverTextOrObj) {
  // 1) already an assessment object
  if (isAssessmentObject(serverTextOrObj)) {
    return { assessment: serverTextOrObj, wrapperError: "", rawTextUsed: "" };
  }

  // 2) wrapper object: { raw: "...", error?: "..." } OR { result: "..." }
  if (serverTextOrObj && typeof serverTextOrObj === "object") {
    const wrapped =
      typeof serverTextOrObj.raw === "string"
        ? serverTextOrObj.raw
        : (typeof serverTextOrObj.result === "string" ? serverTextOrObj.result : null);

    if (wrapped != null) {
      const parsed = safeJsonParse(wrapped);
      if (parsed) return normalizeFromAny(parsed);

      const salvaged = parseEscapedJsonString(wrapped);
      if (salvaged) return normalizeFromAny(salvaged);

      return {
        assessment: null,
        wrapperError: String(serverTextOrObj.error || serverTextOrObj.details || ""),
        rawTextUsed: wrapped,
      };
    }
  }

  // 3) plain string => try parse
  if (typeof serverTextOrObj === "string") {
    const parsed = safeJsonParse(serverTextOrObj);
    if (parsed) return normalizeFromAny(parsed);
    return { assessment: null, wrapperError: "", rawTextUsed: serverTextOrObj };
  }

  // 4) nothing usable
  return { assessment: null, wrapperError: "", rawTextUsed: "" };
}

function extractDetectedRubric(anyObj) {
  if (!anyObj) return null;

  // Direct shapes
  if (typeof anyObj.rubricText === "string" && anyObj.rubricText.trim()) {
    return {
      text: anyObj.rubricText.trim(),
      confidence: Number(anyObj.rubricConfidence ?? anyObj.confidence ?? 0),
      detected: Boolean(anyObj.rubricDetected ?? true),
      source: "captured",
    };
  }

  if (anyObj.detectedRubric && typeof anyObj.detectedRubric.text === "string" && anyObj.detectedRubric.text.trim()) {
    return {
      text: anyObj.detectedRubric.text.trim(),
      confidence: Number(anyObj.detectedRubric.confidence ?? 0),
      detected: Boolean(anyObj.detectedRubric.detected ?? true),
      source: "captured",
    };
  }

  // Nested common places
  const candidates = [
    anyObj.meta,
    anyObj.data,
    anyObj.assessment,
    anyObj.result,
    anyObj.raw,
  ].filter(Boolean);

  for (const c of candidates) {
    const found = extractDetectedRubric(c);
    if (found) return found;
  }

  return null;
}

function extractDetectedAnswerKey(anyObj) {
  if (!anyObj) return null;

  if (typeof anyObj.answerKeyText === "string" && anyObj.answerKeyText.trim()) {
    return {
      text: anyObj.answerKeyText.trim(),
      confidence: Number(anyObj.answerKeyConfidence ?? 0),
      detected: Boolean(anyObj.answerKeyDetected ?? true),
    };
  }

  const candidates = [
    anyObj.meta,
    anyObj.data,
    anyObj.assessment,
    anyObj.result,
    anyObj.raw,
  ].filter(Boolean);

  for (const c of candidates) {
    const found = extractDetectedAnswerKey(c);
    if (found) return found;
  }

  return null;
}

function formatIncorrectItemHtml(item, idx, escapeHtml) {
  if (!item || typeof item !== "object") return "";

  const prompt = String(item.prompt || "").trim();
  const student = String(item.student_answer || "").trim();
  const correct = String(item.correct_answer || "").trim();

  return `<li style="margin:2px 0;">
    <b>Q${idx + 1}:</b> ${escapeHtml(prompt || "(question)")}
    <div style="opacity:0.9; margin-left:10px;">
      <span><b>Your:</b> ${escapeHtml(student || "(blank)")}</span>
      <span style="margin-left:10px;"><b>Correct:</b> ${escapeHtml(correct || "(unknown)")}</span>
    </div>
  </li>`;
}

function toArrayStrings(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return [String(v)];
}

function formatPoints(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n === 0) return "";
  return `(\u2013${Math.abs(n)})`; // always show as "–1"
}

function tightenCropToContent(canvas, { pad = 12, threshold = 245 } = {}) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  function rowHasInk(y) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // treat near-white as background
      if (r < threshold || g < threshold || b < threshold) return true;
    }
    return false;
  }

  function colHasInk(x) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < threshold || g < threshold || b < threshold) return true;
    }
    return false;
  }

  let top = 0, bottom = h - 1, left = 0, right = w - 1;

  while (top < h && !rowHasInk(top)) top++;
  while (bottom > 0 && !rowHasInk(bottom)) bottom--;
  while (left < w && !colHasInk(left)) left++;
  while (right > 0 && !colHasInk(right)) right--;

  // If we found nothing, don't change
  if (top >= bottom || left >= right) return canvas;

  top = Math.max(0, top - pad);
  left = Math.max(0, left - pad);
  bottom = Math.min(h - 1, bottom + pad);
  right = Math.min(w - 1, right + pad);

  const cw = right - left + 1;
  const ch = bottom - top + 1;

  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const outCtx = out.getContext("2d");
  outCtx.drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
  return out;
}

function buildFullTeacherPayloadText(assessment, codeLocal = "", gradeBandForKita = "", rubricOverride = "") {
  const links = Array.isArray(assessment?.assignment_images) ? assessment.assignment_images : [];

  const lines = [];
  const g = getDisplayScore(assessment);
  const links2 = getAssignmentLinksFromAssessment(assessment);

  if (links2.length) {
    lines.push("Links / evidence:");
    links2.forEach((l, i) => {
      const label = l?.label || `Item ${i + 1}`;
      const url = l?.url;
      lines.push(url ? `- ${label}: ${url}` : `- ${label}`);
    });
    lines.push("");
  }

  const submittedText = String(assessment?.submitted_text || "").trim();
  if (submittedText) {
    lines.push("Submitted text (evidence):");
    lines.push(submittedText);
    lines.push("");
  }

  if (g.score !== "") {
    lines.push(`Grade: ${g.score} / ${g.outOf}${codeLocal ? `  Ref: ${codeLocal}` : ""}`);
    lines.push("");
  }

  // Include rubric override if the teacher typed one in
  const rubricNote = (rubricOverride || "").trim();
  if (rubricNote) {
    lines.push(`Rubric: ${rubricNote}`);
    lines.push("");
  }

  if (codeLocal) {
    lines.push(`View feedback online: www.curriculate.net/results (code: ${codeLocal})`);
    lines.push("");
  }

  // Deduction (first one only, as you display)
  if (Array.isArray(assessment.deductions) && assessment.deductions.length) {
    const d0 = assessment.deductions[0];
    const reason = String(d0?.reason || "").trim();
    if (reason) {
      lines.push("Deduction:");
      lines.push(`- ${reason} ${formatPoints(d0?.points)}`.trim());
      lines.push("");
    }
  }

  if (Array.isArray(assessment.strengths) && assessment.strengths.length) {
    lines.push("Strengths:");
    assessment.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  if (Array.isArray(assessment.improvements) && assessment.improvements.length) {
    lines.push("Next Steps:");
    assessment.improvements.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  // Soft KITA summary (advisory, non-scoring)
  if (Array.isArray(assessment.achievement_summary) && assessment.achievement_summary.length) {
    lines.push("Achievement Categories:");
    assessment.achievement_summary.forEach((k) => {
      // Generate short label: use known mappings, fall back to first letters of words
      const knownShort = {
        "Knowledge & Understanding": "K", "Thinking": "T", "Communication": "C", "Application": "A",
        "Knowledge & Recall (AO1)": "AO1", "Analysis & Application (AO2)": "AO2",
        "Evaluation & Context (AO3)": "AO3", "Technical Accuracy (AO4)": "AO4",
        "Content Knowledge": "CK", "Critical Thinking": "CT",
        "Subject Knowledge": "SK", "Analytical Thinking": "AT", "Applied Learning": "AL",
        "Understanding": "U", "Problem Solving": "PS", "Effort & Growth": "EG",
        "Skills & Application": "SA", "Progress & Effort": "PE",
        "Thinking & Problem Solving": "TPS",
      };
      const short = knownShort[k.category] || k.category.split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase();
      const scoreStr = typeof k.score === "number" && typeof k.out_of === "number" ? ` ${k.score.toFixed(2)}/${k.out_of.toFixed(2)}` : "";
      lines.push(`- ${short} ${k.category}${scoreStr} [${k.level}]: ${k.comment}`);
    });
    lines.push("");
  }

  if (String(assessment.teacher_comment || "").trim()) {
    lines.push("Overall Comment:");
    lines.push(String(assessment.teacher_comment).trim());
    lines.push("");
  }

  // ✅ Sections + incorrect items (with KITA detection)
  const kita = detectKita(assessment);
  if (kita) {
    const weights = getKitaWeights(gradeBandForKita, kita);
    const weightedPct = computeKitaWeightedPercent(kita, weights);
    lines.push("Achievement Categories (KITA):");
    kita.forEach((cat, i) => {
      lines.push(
        `- ${cat.short} ${cat.name}: ${cat.score}/${cat.outOf} (${weights[i]}%)${
          cat.comment ? ` — ${cat.comment}` : ""
        }`
      );
    });
    lines.push(`Weighted Total: ${weightedPct}%`);
    lines.push("");
  } else if (Array.isArray(assessment.sections) && assessment.sections.length) {
    lines.push("Sections:");
    assessment.sections.forEach((sec) => {
      lines.push(
        `- ${sec.name}: ${sec.score}/${sec.out_of}${
          sec.teacher_comment ? ` — ${String(sec.teacher_comment).trim()}` : ""
        }`
      );

      if (Array.isArray(sec.incorrect_items) && sec.incorrect_items.length) {
        lines.push(`  Incorrect:`);
        sec.incorrect_items.forEach((it, idx) => {
          const p = String(it?.prompt || `Item ${idx + 1}`).trim();
          const sa = String(it?.student_answer || "—").trim();
          const ca = String(it?.correct_answer || "—").trim();
          lines.push(`  - ${p} (you: ${sa}; correct: ${ca})`);
        });
      }
    });
    lines.push("");
  }

  // (Optional) keep links in portal payload too
  if (links.length) {
    lines.push("Saved captures (30-day links):");
    links.forEach((img) => lines.push(`Photo ${img.index}: ${img.url}`));
    lines.push("");
  }

  return lines.join("\n").trim();
}

const SESSION_KEY = "curriculate_grading_session_v1";
const RUBRIC_STICKY_TEXT_KEY = "curriculate_grading_rubric_sticky_text_v1";
const RUBRIC_STICKY_SRC_KEY = "curriculate_grading_rubric_sticky_src_v1"; // "captured" | "manual"
const RUBRIC_STICKY_TS_KEY = "curriculate_grading_rubric_sticky_ts_v1";

const ANSWERKEY_STICKY_TEXT_KEY = "curriculate_grading_answerkey_sticky_text_v1";
const ANSWERKEY_STICKY_TS_KEY = "curriculate_grading_answerkey_sticky_ts_v1";

const RUBRIC_TIP_DISMISSED_KEY = "curriculate_rubric_tip_dismissed_v1";

  function loadSession() {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function getAssignmentLinksFromAssessment(a) {
    return Array.isArray(a?.assignment_links) ? a.assignment_links : [];
  }

  function saveSession(items) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(items));
    } catch {}
  }

  function getPrimaryScoreLine(a) {
    const outOf = Number(a?.overall_out_of);
    const score = Number(a?.overall_score);
    if (Number.isFinite(outOf) && Number.isFinite(score)) return `${score}/${outOf}`;

    const f10 = a?.final_score_out_of_10;
    if (f10 != null) return `${f10}/10`;
    const s10 = a?.score_out_of_10;
    if (s10 != null) return `${s10}/10`;

    return "(no score)";
  }

  function getDisplayScore(a) {
    const outOf = Number(a?.overall_out_of);
    const score = Number(a?.overall_score);

    if (Number.isFinite(outOf) && Number.isFinite(score)) {
      return { score, outOf };
    }

    const f10 = a?.final_score_out_of_10;
    if (f10 != null) return { score: f10, outOf: 10 };

    const s10 = a?.score_out_of_10;
    if (s10 != null) return { score: s10, outOf: 10 };

    return { score: "", outOf: 10 };
  }

  // KITA (Ontario achievement categories) detection and weighting
  const KITA_NAMES = ["Knowledge & Understanding", "Thinking", "Communication", "Application"];
  const KITA_SHORT = ["K", "T", "C", "A"];

  function detectKita(assessment) {
    if (!assessment || !Array.isArray(assessment.sections) || !assessment.sections.length) return null;
    const secs = assessment.sections;

    // Map each section to a KITA category (if it matches one)
    const matched = [];
    for (const s of secs) {
      const n = (s?.name || "").trim().toLowerCase();
      const idx = KITA_NAMES.findIndex((k) => n.startsWith(k.toLowerCase().slice(0, 8)));
      if (idx === -1) return null; // non-KITA section found — not a KITA response
      matched.push({
        kitaIndex: idx,
        name: KITA_NAMES[idx],
        short: KITA_SHORT[idx],
        score: Number(s.score) || 0,
        outOf: Number(s.out_of) || 5,
        comment: s.teacher_comment || "",
      });
    }
    if (!matched.length) return null;
    return matched;
  }

  // Full KITA weights by index: K=0, T=1, C=2, A=3
  const KITA_WEIGHTS_ALL = {
    "9-10": [25, 25, 25, 25],
    "11+": [20, 30, 20, 30],
  };

  function getKitaWeights(band, kita) {
    const allW = KITA_WEIGHTS_ALL[band] || [25, 25, 25, 25];
    // Return weights for only the categories present
    return kita.map((cat) => allW[cat.kitaIndex]);
  }

  function computeKitaWeightedPercent(kita, weights) {
    let totalWeighted = 0;
    let totalWeight = 0;
    for (let i = 0; i < kita.length; i++) {
      const pct = kita[i].outOf > 0 ? (kita[i].score / kita[i].outOf) : 0;
      totalWeighted += pct * weights[i];
      totalWeight += weights[i];
    }
    // Normalize to 0-100 when not all categories are present
    if (totalWeight > 0 && totalWeight !== 100) {
      return Math.round((totalWeighted / totalWeight) * 100);
    }
    return Math.round(totalWeighted); // 0-100
  }

  // -----------------------------
  // Session analysis (for Copy Session)
  // -----------------------------

  // Prefer: prompts like "Q4: Treaty of Paris" / "Matching: Acadians" etc.
  function keyFromIncorrectItem(it) {
    const p = String(it?.prompt || "").trim();
    if (!p) return "";
    // Keep short, stable concept key
    return p.replace(/\s+/g, " ").slice(0, 80);
  }

  // Prefer the actual improvement bullet text as the "concept"
  function keyFromImprovement(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    return t.replace(/\s+/g, " ").slice(0, 120);
  }

  function VoiceBadge({ feedbackVoice }) {
    if (feedbackVoice !== "iep_supportive") return null;

    return (
      <span
        title="IEP-supportive voice is active"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderRadius: 999,
          fontSize: 12,
          lineHeight: "12px",
          border: "1px solid rgba(0,0,0,.18)",
          background: "rgba(0,0,0,.04)",
          color: "rgba(0,0,0,.75)",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "rgba(0,0,0,.35)",
            display: "inline-block",
          }}
        />
        IEP voice
      </span>
    );
  }

  async function copyRefCodeLinkOnly(refCode) {
    const code = String(refCode || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return false;

    const url = `https://www.curriculate.net/results/${encodeURIComponent(code)}`;

    // Plain text (what pastes into basic fields)
    const plain = url;

    // HTML (what makes it clickable in Gmail/Docs/Word when supported)
    const html = `<a href="${url}">${code}</a>`;

    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plain], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      return true;
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        return true;
      } catch {
        return false;
      }
    }
  }

export default function GradingPage() {
    // Prevent SSR hydration mismatch — this page reads localStorage in 17+ useState
    // initializers. Rendering nothing on the server avoids React error #418.
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const [sessionItems, setSessionItems] = useState(() => {
      if (typeof window === "undefined") return [];
      return loadSession();
    });
    const [copyEnabled, setCopyEnabled] = useState(false);
    const [copiedRef, setCopiedRef] = useState(false);

    const [showFeedbackPrompt, setShowFeedbackPrompt] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");
    const [feedbackSending, setFeedbackSending] = useState(false);
    const [feedbackSent, setFeedbackSent] = useState(false);
    const lastSubmitKeyRef = useRef("");
    const lastWorkKeyRef = useRef(""); // tracks same student work (ignoring settings) for ref code reuse
    const [submissionAttempt, setSubmissionAttempt] = useState(0);
    const [retryNotice, setRetryNotice] = useState(""); // UX text
    const [feedbackTrigger, setFeedbackTrigger] = useState(null);
   
    useEffect(() => {
      saveSession(sessionItems);
    }, [sessionItems]);

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const canvasRef = useRef(null);
    const rubricFileRef = useRef(null);

    const isMobile = useMemo(() => {
      if (typeof navigator === "undefined") return false;
      return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    }, []);

    const [cameraReady, setCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState("");
    const [usingFrontCamera, setUsingFrontCamera] = useState(false);
    const lastPhotoTapRef = useRef(0);
    const responseRef = useRef(null);
    const [lastUsedCompression, setLastUsedCompression] = useState(null);

    const [flash, setFlash] = useState(false);
    const [photos, setPhotos] = useState([]); // { id, dataUrl, createdAt }
    // photoTags: Map<id, "key" | "rubric"> — three-state cycle when tapping a thumbnail.
    // (absent) -> "key" -> "rubric" -> (absent)
    const [photoTags, setPhotoTags] = useState(new Map());
    const [showAnswerKeyTagHint, setShowAnswerKeyTagHint] = useState(false);

    // Counts derived from photoTags (memoized-style recompute on each render — fine for small Maps)
    const keyPhotoCount = (() => {
      let n = 0;
      for (const v of photoTags.values()) if (v === "key") n++;
      return n;
    })();
    const rubricPhotoCount = (() => {
      let n = 0;
      for (const v of photoTags.values()) if (v === "rubric") n++;
      return n;
    })();
    const taggedPhotoCount = keyPhotoCount + rubricPhotoCount;
    const [busyCapture, setBusyCapture] = useState(false);
    const [busyUpload, setBusyUpload] = useState(false);
    const photosRef = useRef([]);
    const fileInputRef = useRef(null);
    
    useEffect(() => { photosRef.current = photos; }, [photos]);
    
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [freemiumLimitHit, setFreemiumLimitHit] = useState(false);

    // Total number of successful gradings this user has run (persisted across sessions).
    // Used to hide introductory tips once the teacher clearly knows the workflow.
    const [gradingUses, setGradingUses] = useState(() => {
      if (typeof window === "undefined") return 0;
      return readIntLS(FEEDBACK_USES_KEY, 0);
    });
    const TIPS_HIDDEN_AFTER = 10;
    const tipsHidden = gradingUses >= TIPS_HIDDEN_AFTER;

    // ✅ One raw response string (always)
    const [serverText, setServerText] = useState("");

    // Optional rubric override UI
    const [showRubric, setShowRubric] = useState(false);
    const [rubricOverride, setRubricOverride] = useState(() => loadLS(RUBRIC_OVERRIDE_KEY, ""));
    // Saved rubrics: [{ name: string, text: string }]
    const [savedRubrics, setSavedRubrics] = useState(() => {
      try { return JSON.parse(localStorage.getItem(SAVED_RUBRICS_KEY) || "[]"); } catch { return []; }
    });
    useEffect(() => {
      try { localStorage.setItem(SAVED_RUBRICS_KEY, JSON.stringify(savedRubrics)); } catch {}
    }, [savedRubrics]);
    const [gradeBand, setGradeBand] = useState(() => {
      if (typeof window === "undefined") return "6-8";
      return loadLS(GRADE_BAND_KEY, "6-8");
    });

    const [standards, setStandards] = useState(() => {
      if (typeof window === "undefined") return "canada";
      return loadLS(STANDARDS_KEY, "canada");
    });

    // Subject area (shown for grade 9+)
    const [subjectArea, setSubjectArea] = useState(() => {
      if (typeof window === "undefined") return "";
      return loadLS(SUBJECT_KEY, "");
    });

    // ── Teacher email + roster (shared across all modes) ──
    const [teacherEmail, setTeacherEmail] = useState(() => {
      if (typeof window === "undefined") return "";
      try { return localStorage.getItem(TEACHER_EMAIL_KEY) || ""; } catch { return ""; }
    });
    const [rosterClasses, setRosterClasses] = useState([]);
    const [rosterLoading, setRosterLoading] = useState(false);

    // Persist teacher email
    useEffect(() => {
      if (teacherEmail) try { localStorage.setItem(TEACHER_EMAIL_KEY, teacherEmail); } catch {}
    }, [teacherEmail]);

    // Input mode: photo vs paste vs batch
    const [inputMode, setInputMode] = useState("photo"); // "photo" | "paste" | "batch" | "video" | "audio"
    
    const [workInput, setWorkInput] = useState("");
    useEffect(() => {
          lastSubmitKeyRef.current = "";
          lastWorkKeyRef.current = "";
          setSubmissionAttempt(0);
          setRetryNotice("");
        }, [inputMode, workInput, photos.length]);

    // ✅ Sticky rubric captured from rubric photo (session-level)
    const [stickyRubricText, setStickyRubricText] = useState(() => {
      if (typeof window === "undefined") return "";
      return loadLS(RUBRIC_STICKY_TEXT_KEY, "");
    });
    const [stickyRubricSource, setStickyRubricSource] = useState(() => {
      if (typeof window === "undefined") return "";
      return loadLS(RUBRIC_STICKY_SRC_KEY, "");
    });
    const [stickyRubricCapturedAt, setStickyRubricCapturedAt] = useState(() => {
      if (typeof window === "undefined") return "";
      return loadLS(RUBRIC_STICKY_TS_KEY, "");
    });

    // Persist sticky rubric
    useEffect(() => saveLS(RUBRIC_STICKY_TEXT_KEY, stickyRubricText || ""), [stickyRubricText]);
    useEffect(() => saveLS(RUBRIC_STICKY_SRC_KEY, stickyRubricSource || ""), [stickyRubricSource]);
    useEffect(() => saveLS(RUBRIC_STICKY_TS_KEY, stickyRubricCapturedAt || ""), [stickyRubricCapturedAt]);

    // ✅ Sticky answer key captured from solution sheet (session-level)
    const [stickyAnswerKeyText, setStickyAnswerKeyText] = useState(() => {
      if (typeof window === "undefined") return "";
      return loadLS(ANSWERKEY_STICKY_TEXT_KEY, "");
    });
    const [stickyAnswerKeyCapturedAt, setStickyAnswerKeyCapturedAt] = useState(() => {
      if (typeof window === "undefined") return "";
      return loadLS(ANSWERKEY_STICKY_TS_KEY, "");
    });

    useEffect(() => saveLS(ANSWERKEY_STICKY_TEXT_KEY, stickyAnswerKeyText || ""), [stickyAnswerKeyText]);
    useEffect(() => saveLS(ANSWERKEY_STICKY_TS_KEY, stickyAnswerKeyCapturedAt || ""), [stickyAnswerKeyCapturedAt]);

    // First-use rubric/answer key tip
    const [showRubricTip, setShowRubricTip] = useState(() => {
      if (typeof window === "undefined") return false;
      return loadLS(RUBRIC_TIP_DISMISSED_KEY, "") !== "1";
    });

    // Feedback Voice (tone/personality)
    const [voice, setVoice] = useState(() => {
      if (typeof window === "undefined") return "warm";
      return loadLS(VOICE_KEY, "warm");
    });
    const [voiceOverrideOn, setVoiceOverrideOn] = useState(() => {
      if (typeof window === "undefined") return false;
      return loadLS(VOICE_OVERRIDE_KEY, "0") === "1";
    });
    const [voiceOverride, setVoiceOverride] = useState(() => {
      if (typeof window === "undefined") return "warm";
      return loadLS(VOICE_OVERRIDE_VALUE_KEY, "warm");
    });
    const [strictnessBias, setStrictnessBias] = useState(() => {
      if (typeof window === "undefined") return 0;
      const v = parseInt(loadLS(STRICTNESS_KEY, "0"), 10);
      return Number.isFinite(v) ? Math.max(-3, Math.min(3, v)) : 0;
    });
    const prevVoiceBeforeIepRef = useRef(null);
    const activeVoice = voiceOverrideOn ? voiceOverride : voice;
    const isTutorMode = activeVoice === "tutor";

    // Persist
    useEffect(() => saveLS(GRADE_BAND_KEY, gradeBand), [gradeBand]);
    useEffect(() => saveLS(STANDARDS_KEY, standards), [standards]);
    useEffect(() => saveLS(SUBJECT_KEY, subjectArea), [subjectArea]);
    useEffect(() => {
      // Don't overwrite saved default with the temporary IEP voice
      if (voice !== "iep_supportive") saveLS(VOICE_KEY, voice);
    }, [voice]);
    useEffect(() => saveLS(VOICE_OVERRIDE_KEY, voiceOverrideOn ? "1" : "0"), [voiceOverrideOn]);
    useEffect(() => saveLS(RUBRIC_OVERRIDE_KEY, rubricOverride), [rubricOverride]);
    useEffect(() => saveLS(VOICE_OVERRIDE_VALUE_KEY, voiceOverride), [voiceOverride]);
    useEffect(() => saveLS(STRICTNESS_KEY, String(strictnessBias)), [strictnessBias]);

    // Upload Rubric from electronic document
    const [uploadingRubricFile, setUploadingRubricFile] = useState(false);

    async function handleRubricFileUpload(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadingRubricFile(true);
      try {
        let text = "";
        const name = file.name.toLowerCase();

        if (name.endsWith(".txt") || name.endsWith(".rtf")) {
          text = await file.text();
        } else if (name.endsWith(".pdf")) {
          // Use PDF.js if available, otherwise fall back to reading as text
          if (typeof pdfjsLib !== "undefined") {
            const buf = await file.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data: buf }).promise;
            const pages = [];
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              const content = await page.getTextContent();
              pages.push(content.items.map((it) => it.str).join(" "));
            }
            text = pages.join("\n\n");
          } else {
            text = await file.text();
          }
        } else if (file.type?.startsWith("image/")) {
          // Convert image to data URL and extract via a simple note
          text = `[Rubric uploaded as image: ${file.name}]`;
          // Read the image as a data URL so we can show it
          const reader = new FileReader();
          const dataUrl = await new Promise((resolve) => {
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });
          // For images, set it as a sticky rubric photo
          setStickyRubricText(`[Rubric image: ${file.name}]`);
          setStickyRubricSource("uploaded");
          setStickyRubricCapturedAt(new Date().toLocaleString());
          // Add as a rubric-tagged photo
          const photoObj = {
            id: String(Date.now()) + "_rubric",
            dataUrl,
            rawDataUrl: dataUrl,
            createdAt: Date.now(),
          };
          setPhotos((prev) => [...prev, photoObj]);
          setPhotoTags((prev) => new Map(prev).set(photoObj.id, "rubric"));
          setUploadingRubricFile(false);
          if (rubricFileRef.current) rubricFileRef.current.value = "";
          return;
        } else {
          // .doc, .docx — read as text (basic fallback)
          text = await file.text();
        }

        if (text.trim()) {
          setRubricOverride(text.trim());
        } else {
          alert("Could not extract text from the uploaded file. Try pasting the rubric instead.");
        }
      } catch (err) {
        console.error("Rubric upload error:", err);
        alert("Failed to read rubric file: " + (err?.message || "Unknown error"));
      }
      setUploadingRubricFile(false);
      if (rubricFileRef.current) rubricFileRef.current.value = "";
    }

    // Learning Recommendations
    const [sessionSummary, setSessionSummary] = useState(""); // was null object
    const [sessionSummaryError, setSessionSummaryError] = useState("");
    const [summarizingSession, setSummarizingSession] = useState(false);
    
    // Copy UX
    const [copied, setCopied] = useState(false);
    const [copiedFlash, setCopiedFlash] = useState(false);
    // AA123 reference code per result (shown + copied)
    const [refCode, setRefCode] = useState("");

    // Email Reports (session)
    const [showSessionEmailPrompt, setShowSessionEmailPrompt] = useState(false);
    const [sessionEmailTo, setSessionEmailTo] = useState(() => loadLS("curriculate_report_email", ""));
    const [sessionEmailSending, setSessionEmailSending] = useState(false);
    const [sessionEmailSent, setSessionEmailSent] = useState(false);
    const [showSessionClearPrompt, setShowSessionClearPrompt] = useState(false);
    useEffect(() => { if (sessionEmailTo) saveLS("curriculate_report_email", sessionEmailTo); }, [sessionEmailTo]);

    const backendBase = useMemo(
      () => stripTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_URL),
      []
    );

    // user feedback
    const [feedbackName, setFeedbackName] = useState("");
    const [feedbackCity, setFeedbackCity] = useState("");
    const [okToQuote, setOkToQuote] = useState(false);

    // Referral prompt state
    const [showReferralPrompt, setShowReferralPrompt] = useState(false);
    const [referralName, setReferralName] = useState("");
    const [referralEmail, setReferralEmail] = useState("");
    const [referralSending, setReferralSending] = useState(false);
    const [referralDone, setReferralDone] = useState(false); // "applied" | "already" | false
    const [referralError, setReferralError] = useState("");

    // Parent note prompt state
    const [showParentNote, setShowParentNote] = useState(false);

    // Feature tour state
    const [tourStep, setTourStep] = useState(-1); // -1 = inactive
    const [tourPhase, setTourPhase] = useState(0); // which phase triggered
    const tourTargetResultRef = useRef(null);
    const tourTargetCopySessionRef = useRef(null);
    const tourTargetParentNoteRef = useRef(null);
    const tourTargetChevronsRef = useRef(null);
    const tourTargetVoiceRef = useRef(null);
    const tourTargetBatchRef = useRef(null);
    const tourRefs = {
      tourTargetResult: tourTargetResultRef,
      tourTargetCopySession: tourTargetCopySessionRef,
      tourTargetParentNote: tourTargetParentNoteRef,
      tourTargetChevrons: tourTargetChevronsRef,
      tourTargetVoice: tourTargetVoiceRef,
      tourTargetBatch: tourTargetBatchRef,
    };

    function startTour(phase) {
      const steps = TOUR_STEPS.filter((s) => s.phase <= phase);
      if (!steps.length) return;
      setTourPhase(phase);
      setTourStep(0);
    }
    function markTourPhasesSeen(phase) {
      if (phase >= 1) writeStrLS(TOUR_SEEN_KEY, "1");
      if (phase >= 2) writeStrLS(TOUR_PHASE2_SEEN_KEY, "1");
      if (phase >= 3) writeStrLS(TOUR_PHASE3_SEEN_KEY, "1");
      if (phase >= 4) writeStrLS(TOUR_PHASE4_SEEN_KEY, "1");
    }
    function advanceTour() {
      const steps = TOUR_STEPS.filter((s) => s.phase <= tourPhase);
      const next = tourStep + 1;
      if (next >= steps.length) {
        setTourStep(-1);
        markTourPhasesSeen(tourPhase);
      } else {
        setTourStep(next);
      }
    }
    function dismissTour() {
      setTourStep(-1);
      markTourPhasesSeen(tourPhase);
    }

    const tourPhase1Fired = useRef(false);
    const tourPhase2Fired = useRef(false);
    const tourPhase3Fired = useRef(false);
    const tourPhase4Fired = useRef(false);

    const gradingUrl = useMemo(() => {
      if (!backendBase) return "";
      return `${backendBase.replace(/\/$/, "")}/grading`;
    }, [backendBase]);

    // Load rosters when email is set
    useEffect(() => {
      if (!teacherEmail || !teacherEmail.includes("@") || !gradingUrl) { setRosterClasses([]); return; }
      const rosterBase = gradingUrl.replace(/\/grading$/, "/class-roster");
      setRosterLoading(true);
      fetch(`${rosterBase}/list?teacherEmail=${encodeURIComponent(teacherEmail)}`)
        .then((r) => r.ok ? r.json() : { rosters: [] })
        .then((data) => setRosterClasses(data.rosters || []))
        .catch(() => {})
        .finally(() => setRosterLoading(false));
    }, [teacherEmail, gradingUrl]);

    const resultsCreateUrl = useMemo(() => {
      if (!backendBase) return "";
      return `${backendBase.replace(/\/$/, "")}/results`;
    }, [backendBase]);

    // ── Simple roster name matcher for single-photo results ──
    function matchStudentToRoster(name, classFilter = "") {
      if (!name || !rosterClasses.length) return null;
      const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
      const aiNorm = norm(name);
      if (!aiNorm) return null;
      const aiParts = name.trim().toLowerCase().split(/\s+/);
      let best = null;
      let bestScore = 0;
      for (const rc of rosterClasses) {
        if (classFilter && rc.className !== classFilter) continue;
        for (const s of (rc.students || [])) {
          const fn = norm(s.firstName);
          const ln = norm(s.lastName);
          const full = fn + ln;
          let score = 0;
          // Exact full match
          if (aiNorm === full) score = 100;
          // First + last parts match
          else if (aiParts.length >= 2 && norm(aiParts[0]) === fn && norm(aiParts[aiParts.length - 1]) === ln) score = 90;
          // Last + first (reversed)
          else if (aiParts.length >= 2 && norm(aiParts[0]) === ln && norm(aiParts[aiParts.length - 1]) === fn) score = 85;
          // First name only match
          else if (aiParts.some((p) => norm(p) === fn) && fn.length >= 3) score = 50;
          // Partial contains
          else if (full.includes(aiNorm) || aiNorm.includes(full)) score = 40;
          if (score > bestScore) {
            bestScore = score;
            best = { ...s, className: rc.className, rosterId: rc.id };
          }
        }
      }
      return bestScore >= 40 ? best : null;
    }

    async function publishResultToPortal({ payload, meta }) {
      if (!resultsCreateUrl) throw new Error("Missing NEXT_PUBLIC_BACKEND_URL (results endpoint).");

      const res = await fetch(resultsCreateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload, // we'll store a string so /results can show it nicely
          meta: meta || null,
          sessionId: getSessionId(),
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status} from results endpoint`);
      if (!j?.code) throw new Error("Results endpoint did not return a code.");
      return j; // { code, expiresAt }
    }

    const normalized = useMemo(() => {
      // First: try normal JSON parse of the whole response
      const parsed = safeJsonParse(serverText);
      if (parsed) return normalizeFromAny(parsed);

      // If wrapper JSON is invalid, try extracting the "raw" field manually
      const raw = extractJsonStringValue(serverText, "raw") || extractJsonStringValue(serverText, "result");
      const err = extractJsonStringValue(serverText, "error") || extractJsonStringValue(serverText, "details") || "";

      if (raw) {
        // raw is the *contents* of the JSON string, with escapes preserved
        const salvaged = parseEscapedJsonString(raw);
        if (salvaged) return normalizeFromAny(salvaged);

        // fallback: at least surface wrapper error & raw text
        return { assessment: null, wrapperError: err, rawTextUsed: raw };
      }

      // nothing salvageable
      return normalizeFromAny(serverText);
    }, [serverText]);

    const assessment = normalized.assessment;

    // Phase 1: show tap-to-copy tip on first visit (once result appears)
    useEffect(() => {
      if (tourPhase1Fired.current) return;
      if (!assessment) return;
      if (readStrLS(TOUR_SEEN_KEY, "0") === "1") return;
      tourPhase1Fired.current = true;
      setTimeout(() => startTour(1), 600);
    }, [assessment]);

    // Phase 2: sharing tools after 2nd grading
    useEffect(() => {
      if (tourPhase2Fired.current) return;
      if (sessionItems.length < 2) return;
      if (readStrLS(TOUR_PHASE2_SEEN_KEY, "0") === "1") return;
      if (readStrLS(TOUR_SEEN_KEY, "0") !== "1") return;
      tourPhase2Fired.current = true;
      setTimeout(() => startTour(2), 600);
    }, [sessionItems.length]);

    // Phase 3: fine-tuning features after 5th grading
    useEffect(() => {
      if (tourPhase3Fired.current) return;
      if (gradingUses < 5) return;
      if (readStrLS(TOUR_PHASE3_SEEN_KEY, "0") === "1") return;
      if (readStrLS(TOUR_PHASE2_SEEN_KEY, "0") !== "1") return;
      if (!assessment) return;
      tourPhase3Fired.current = true;
      setTimeout(() => startTour(3), 600);
    }, [gradingUses, assessment]);

    // Phase 4: pro workflow after 10th grading
    useEffect(() => {
      if (tourPhase4Fired.current) return;
      if (gradingUses < 10) return;
      if (readStrLS(TOUR_PHASE4_SEEN_KEY, "0") === "1") return;
      if (readStrLS(TOUR_PHASE3_SEEN_KEY, "0") !== "1") return;
      if (!assessment) return;
      tourPhase4Fired.current = true;
      setTimeout(() => startTour(4), 600);
    }, [gradingUses, assessment]);

    const formattedTeacherText = useMemo(() => {
      return assessment ? buildFullTeacherPayloadText(assessment, refCode, gradeBand, rubricOverride) : "";
    }, [assessment, refCode, rubricOverride]);

    function triggerFlash() {
      setFlash(true);
      if (navigator.vibrate) navigator.vibrate(25);
      window.setTimeout(() => setFlash(false), 120);
    }

    async function stopCamera() {
      setCameraReady(false);
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    useEffect(() => {
      if (inputMode !== "photo") {
        stopCamera();
        return;
      }
      startCamera({ front: usingFrontCamera });

      return () => {
        stopCamera(); // don't return the promise
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inputMode, usingFrontCamera]);

    async function startCamera({ front = false } = {}) {
      setCameraError("");
      setCameraReady(false);

      await stopCamera();

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera not supported in this browser.");
        }

        const constraints = {
          video: {
            facingMode: front ? "user" : "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.playsInline = true;
          await videoRef.current.play();
        }

        setCameraReady(true);
      } catch (err) {
        console.error("Camera start error:", err);
        setCameraError(err?.message || "Could not start camera.");
      }
    }

    // for double-tap capture to capture and submit
    const lastCaptureTapRef = useRef(0);
    const captureTapTimerRef = useRef(null);
    const [detectedStudentName, setDetectedStudentName] = useState("");
    const [studentNameEdited, setStudentNameEdited] = useState(false);
    const [matchedRosterStudent, setMatchedRosterStudent] = useState(null); // { firstName, lastName, studentId, edsbyId, className }
    const [selectedClassName, setSelectedClassName] = useState(""); // manually chosen class

    useEffect(() => {
      return () => {
        if (captureTapTimerRef.current) clearTimeout(captureTapTimerRef.current);
      };
    }, []);

    useEffect(() => {
      const aiName = String(assessment?.student_name || "").trim();
      if (!studentNameEdited && aiName) {
        setDetectedStudentName(aiName);
        // Auto-match against roster (respect selected class if set)
        const match = matchStudentToRoster(aiName, selectedClassName);
        if (match) {
          setMatchedRosterStudent(match);
          if (!selectedClassName) setSelectedClassName(match.className || "");
        } else {
          setMatchedRosterStudent(null);
        }
      }
      if (!studentNameEdited && !aiName) {
        setDetectedStudentName("");
        setMatchedRosterStudent(null);
      }
    }, [assessment?.student_name, studentNameEdited, rosterClasses, selectedClassName]);

    // Update published result when teacher changes student/class assignment
    useEffect(() => {
      if (!refCode || !resultsCreateUrl) return;
      const sid = matchedRosterStudent?.studentId || matchedRosterStudent?.edsbyId || null;
      const sName = matchedRosterStudent
        ? `${matchedRosterStudent.firstName} ${matchedRosterStudent.lastName}`.trim()
        : (detectedStudentName || "").trim() || null;
      const cls = selectedClassName || matchedRosterStudent?.className || null;
      if (!sid && !sName) return;
      // Fire-and-forget PATCH to update meta
      fetch(`${resultsCreateUrl}/${refCode}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: sid,
          studentName: sName,
          className: cls,
          teacherEmail: teacherEmail || undefined,
        }),
      }).catch(() => {});
    }, [matchedRosterStudent, selectedClassName, refCode]);

    async function compressPhotosForSubmission(photosToUse, profile) {
      const { maxWidth, quality } = profile;

      return Promise.all(
        photosToUse.map((p) => {
          const src = p.rawDataUrl || p.dataUrl; // ✅ prefer original
          return compressDataUrlToJpeg(src, maxWidth, quality);
        })
      );
    }

    async function capturePhoto() {
      if (!cameraReady || !videoRef.current || !canvasRef.current) return null;
      if (busyCapture) return null;

      setBusyCapture(true);
      setSubmitError("");
      
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;

        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;

        const ctx = canvas.getContext("2d", { alpha: false });

        // Capture the full camera frame — no cropping — so what you see is what you get
        canvas.width = vw;
        canvas.height = vh;

        ctx.drawImage(video, 0, 0, vw, vh);

        const tightened = tightenCropToContent(canvas, { pad: 18, threshold: 245 });
        const rawDataUrl = tightened.toDataURL("image/jpeg", 0.9);

        triggerFlash();

        const compressed = await compressDataUrlToJpeg(rawDataUrl, DEFAULT_MAX_W, DEFAULT_QUALITY);

        const id =
          (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
          String(Date.now()) + "_" + Math.random().toString(16).slice(2);

        const photoObj = {
          id,
          rawDataUrl,
          dataUrl: compressed,
          createdAt: Date.now(),
        };

        setPhotos((prev) => [...prev, photoObj]);

        return photoObj;
      } catch (err) {
        console.error("Capture error:", err);
        setSubmitError(err?.message || "Failed to capture photo.");
        return null;
      } finally {
        setBusyCapture(false);
      }
    }

    /** Handle file upload from <input type="file"> — converts to same photo format as camera captures */
    async function handleFileUpload(e) {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      setBusyUpload(true);
      setSubmitError("");

      try {
        for (const file of files) {
          if (!file.type.startsWith("image/")) continue;

          const rawDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const compressed = await compressDataUrlToJpeg(rawDataUrl, DEFAULT_MAX_W, DEFAULT_QUALITY);

          const id =
            (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
            String(Date.now()) + "_" + Math.random().toString(16).slice(2);

          setPhotos((prev) => [
            ...prev,
            { id, rawDataUrl, dataUrl: compressed, createdAt: Date.now(), source: "upload" },
          ]);
        }
      } catch (err) {
        console.error("File upload error:", err);
        setSubmitError(err?.message || "Failed to process uploaded image.");
      } finally {
        setBusyUpload(false);
        // Reset input so the same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }

    /** Handle image URL — fetches the image via canvas proxy to get a data URL */
    async function handleImageUrl(url) {
      setBusyUpload(true);
      setSubmitError("");

      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;

        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error("Could not load image from URL. Make sure the link points directly to an image."));
        });

        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.drawImage(img, 0, 0);

        const rawDataUrl = canvas.toDataURL("image/jpeg", 0.95);
        const compressed = await compressDataUrlToJpeg(rawDataUrl, DEFAULT_MAX_W, DEFAULT_QUALITY);

        const id =
          (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
          String(Date.now()) + "_" + Math.random().toString(16).slice(2);

        setPhotos((prev) => [
          ...prev,
          { id, rawDataUrl, dataUrl: compressed, createdAt: Date.now(), source: "url" },
        ]);

        return true;
      } catch (err) {
        console.error("Image URL error:", err);
        setSubmitError(err?.message || "Failed to load image from URL.");
        return false;
      } finally {
        setBusyUpload(false);
      }
    }

    async function sendUserFeedback() {
      const msg = (feedbackText || "").trim();
      
      if (!msg) return;

      setFeedbackSending(true);
      try {
        const url = "/api/feedback"; // or `${backendBase}/api/feedback` if needed
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anonId: getAnonId(),
            sessionId: getSessionId(),
            message: msg,
            uses: readIntLS(FEEDBACK_USES_KEY, 0),
            meta: {
              source: "grading-feedback-prompt",
              gradeBand,
              inputMode,
              voice,
              name: (feedbackName || "").trim(),
              city: (feedbackCity || "").trim(),
              okToQuote: !!okToQuote,
            },
          }),
        });
        
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t || `HTTP ${res.status}`);
        }

        // success UX:
        setShowFeedbackPrompt(false);
        setFeedbackText("");
        if (feedbackTrigger) markSubmittedForTrigger(feedbackTrigger);

        writeStrLS(FEEDBACK_SUBMITTED_KEY, "1");
        writeIntLS(FEEDBACK_SUBMITTED_AT_KEY, readIntLS(FEEDBACK_USES_KEY, 0));
        setFeedbackSent(true);
      } catch (e) {
        console.error("Feedback failed:", e);
        // show toast / inline error if you have it
      } finally {
        setFeedbackSending(false);
      }
    }

    function dismissFeedbackPrompt() {
      writeStrLS(FEEDBACK_DISMISSED_UNTIL_KEY, daysFromNow(FEEDBACK_SNOOZE_DAYS));
      setShowFeedbackPrompt(false);
      setFeedbackText("");
    }

    function openFeedbackPrompt(trigger) {
      setFeedbackTrigger(trigger || null);
      setFeedbackText("");
      setFeedbackName("");
      setFeedbackCity("");
      setOkToQuote(false);
      setFeedbackSent(false);
      setShowFeedbackPrompt(true);
    }

    // ─── Referral prompt helpers ───
    function shouldShowReferralPrompt(nextUses) {
      if (typeof window === "undefined") return false;
      if (!REFERRAL_TRIGGER || nextUses < REFERRAL_TRIGGER) return false;
      if (readStrLS(REFERRAL_SUBMITTED_KEY, "") === "1") return false;
      if (readStrLS(REFERRAL_DISMISSED_KEY, "") === "1") return false;
      return true;
    }

    function dismissReferralPrompt() {
      writeStrLS(REFERRAL_DISMISSED_KEY, "1");
      setShowReferralPrompt(false);
      setReferralName("");
      setReferralEmail("");
      setReferralError("");
    }

    function shouldShowParentNote(nextUses) {
      if (typeof window === "undefined") return false;
      if (!PARENT_NOTE_TRIGGER || nextUses < PARENT_NOTE_TRIGGER) return false;
      // Check snooze
      const dismissedUntil = Number(readStrLS(PARENT_NOTE_DISMISSED_UNTIL_KEY, "0"));
      if (dismissedUntil && Date.now() < dismissedUntil) return false;
      // Show at trigger, then every REPEAT interval after
      const past = nextUses - PARENT_NOTE_TRIGGER;
      if (past === 0) return true;
      if (PARENT_NOTE_REPEAT_EVERY && past > 0 && past % PARENT_NOTE_REPEAT_EVERY === 0) return true;
      return false;
    }

    function dismissParentNote() {
      writeStrLS(PARENT_NOTE_DISMISSED_UNTIL_KEY, daysFromNow(PARENT_NOTE_SNOOZE_DAYS));
      setShowParentNote(false);
    }

    async function submitReferralApplication() {
      const name = (referralName || "").trim();
      const email = (referralEmail || "").trim();
      if (!name || !email) return;

      setReferralSending(true);
      setReferralError("");
      try {
        const res = await fetch("/api/admin/referral-applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, organization: "", message: "Applied via grading tool referral prompt" }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 409) {
          // already applied
          writeStrLS(REFERRAL_SUBMITTED_KEY, "1");
          setReferralDone("already");
        } else if (res.ok) {
          writeStrLS(REFERRAL_SUBMITTED_KEY, "1");
          setReferralDone("applied");
        } else {
          setReferralError(data?.error || "Something went wrong. Try again.");
        }
      } catch (e) {
        console.error("Referral submit error:", e);
        setReferralError("Network error. Try again.");
      } finally {
        setReferralSending(false);
      }
    }

    function shouldShowFeedbackPrompt(nextUses) {
      if (typeof window === "undefined") return false;

      const n = Number(nextUses) || 0;
      if (n <= 0) return false;

      // Triggers we care about (e.g., 10 and 30)
      const triggers = [FEEDBACK_TRIGGER_1, FEEDBACK_TRIGGER_2]
        .filter((t) => Number.isFinite(Number(t)) && Number(t) > 0)
        .map((t) => Number(t))
        .sort((a, b) => a - b);

      if (!triggers.length) return false;

      // Respect snooze ("Not now")
      const dismissedUntil = Number(readStrLS(FEEDBACK_DISMISSED_UNTIL_KEY, "0")) || 0;
      if (dismissedUntil && Date.now() < dismissedUntil) return false;

      // Respect cooldown (don't show more than once per week)
      const lastShownAt = Number(readStrLS(FEEDBACK_LAST_SHOWN_AT_KEY, "0")) || 0;
      const cooldownDays = Number(FEEDBACK_COOLDOWN_DAYS) || 7;
      const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
      if (lastShownAt && Date.now() - lastShownAt < cooldownMs) return false;

      // Find the earliest trigger that has been reached but not yet "submitted for"
      const pendingTrigger = triggers.find((t) => n >= t && !hasSubmittedForTrigger(t));
      if (!pendingTrigger) return false;

      // Persistent mode:
      // Once they've crossed the pending trigger, keep prompting occasionally
      // (cooldown + snooze already prevent annoyance).
      return true;
    }

    function getAssignmentImagesFromAssessment(a) {
      return Array.isArray(a?.assignment_images) ? a.assignment_images : [];
    }

    function handleCaptureTap() {
      if (!cameraReady || submitting || busyCapture) return;

      const now = Date.now();
      const DOUBLE_TAP_MS = 320;

      // Double tap => capture once + submit
      if (now - lastCaptureTapRef.current < DOUBLE_TAP_MS) {
        lastCaptureTapRef.current = 0;

        if (captureTapTimerRef.current) {
          clearTimeout(captureTapTimerRef.current);
          captureTapTimerRef.current = null;
        }

        (async () => {
          const newPhoto = await capturePhoto();
          if (!newPhoto) return;

          const merged = [...photosRef.current, newPhoto];
          await submitForGrading(merged);

        })();

        return;
      }

      // Single tap => wait briefly to see if it becomes a double tap
      lastCaptureTapRef.current = now;
      captureTapTimerRef.current = setTimeout(() => {
        lastCaptureTapRef.current = 0;
        captureTapTimerRef.current = null;
        capturePhoto();
      }, DOUBLE_TAP_MS);
    }

    function removePhoto(id) {
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      setPhotoTags((prev) => { const n = new Map(prev); n.delete(id); return n; });
    }

    // Three-state cycle on thumbnail tap:
    // (none) -> "key" -> "rubric" -> (none)
    function cyclePhotoTag(id) {
      setPhotoTags((prev) => {
        const n = new Map(prev);
        const current = n.get(id);
        if (!current) n.set(id, "key");
        else if (current === "key") n.set(id, "rubric");
        else n.delete(id); // "rubric" -> clear
        return n;
      });
      setShowAnswerKeyTagHint(false);
    }
    // Keep legacy name as an alias so we don't have to touch every call site in this pass.
    const toggleAnswerKey = cyclePhotoTag;

    function clearAll() {
      setPhotos([]);
      photosRef.current = [];
      setPhotoTags(new Map());
      setShowAnswerKeyTagHint(false);
      setSubmitError("");
      setServerText("");
      setCopied(false);
      setRefCode("");
      setWorkInput("");
      setDetectedStudentName("");
      setStudentNameEdited(false);
      // Keep matchedRosterStudent and selectedClassName — teacher likely
      // wants to grade another assignment from the same student. They can
      // change via dropdown if needed.

      if (voice === "iep_supportive") {
        const restore = prevVoiceBeforeIepRef.current || loadLS(VOICE_KEY, "warm");
        setVoice(restore);
        prevVoiceBeforeIepRef.current = null;
      }

      // reset submission lock state
      setCopyEnabled(false);
    }

    function getCompressionProfile(attempt) {
      if (attempt <= 1) return { maxWidth: 1800, quality: 0.85, label: "Standard" };
      if (attempt === 2) return { maxWidth: 2200, quality: 0.92, label: "Higher" };
      return { maxWidth: 2600, quality: 0.97, label: "Max" };
    }

    async function submitForGrading(photosOverride = null, { biasOverride } = {}) {
      setSubmitError("");
      setServerText("");
      setCopied(false);
      setCopyEnabled(false); // lock during submission
      // Keep refCode across resubmits — we'll update the same result entry
      
      if (!gradingUrl) {
        setSubmitError("Missing NEXT_PUBLIC_BACKEND_URL. Set it in Vercel and redeploy.");
        return;
      }

      const photosToUse = Array.isArray(photosOverride) ? photosOverride : photos;

      // Validate input first
      if (inputMode === "photo") {
        if (!photosToUse.length) {
          setSubmitError("Capture or upload at least one photo before submitting.");
          return;
        }
      } else {
        const w = (workInput || "").trim();
        if (!w && !photosToUse.length) {
          setSubmitError("Paste text, add a link, or upload an image before submitting.");
          return;
        }
      }

      // Compute rubric lengths early (needed for submitKey)
      const manualRubric = (rubricOverride || "").trim();
      const stickyRubric = (stickyRubricText || "").trim();
      const trimmedWork = (workInput || "").trim();

      // ✅ 1) Build submitKey BEFORE using it
      const voiceEffective = voiceOverrideOn ? voiceOverride : voice;

      const rubricFingerprint = manualRubric.slice(0, 50) || stickyRubric.slice(0, 50) || "";
      const akFingerprint = (stickyAnswerKeyText || "").slice(0, 50);
      // Fingerprint of tagged photos: id:tag pairs, stable order
      const akPhotoIds = [...photoTags.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, tag]) => `${id}:${tag}`)
        .join(",");
      const effectiveBiasForKey = biasOverride != null ? biasOverride : strictnessBias;

      // Work key: identifies the student work itself (photos or paste text)
      // Used to decide whether to reuse the ref code on resubmit
      const workKey =
        inputMode === "photo"
          ? `photo:${photosToUse.map((p) => p.id).join(",")}|ak:${akFingerprint}|akp:${akPhotoIds}`
          : `paste:${trimmedWork.slice(0, 200)}|len:${trimmedWork.length}|ak:${akFingerprint}|akp:${akPhotoIds}`;

      // Submit key: includes all settings — used for compression escalation only
      const submitKey =
        inputMode === "photo"
          ? `photo:${photosToUse.map((p) => p.id).join(",")}|gb:${gradeBand}|v:${voiceEffective}|r:${rubricFingerprint}|ak:${akFingerprint}|akp:${akPhotoIds}|st:${standards}|sb:${effectiveBiasForKey}|sa:${subjectArea}`
          : `paste:${trimmedWork.slice(0, 200)}|len:${trimmedWork.length}|gb:${gradeBand}|v:${voiceEffective}|r:${rubricFingerprint}|ak:${akFingerprint}|akp:${akPhotoIds}|st:${standards}|sb:${effectiveBiasForKey}|sa:${subjectArea}`;

      // New student work → clear ref code so a new one is generated
      const isNewWork = workKey !== lastWorkKeyRef.current;
      if (isNewWork) {
        setRefCode("");
        lastWorkKeyRef.current = workKey;
      }

      // ✅ 2) Compute the attempt + compression profile LOCALLY (don't rely on state timing)
      // Only escalate compression when EVERYTHING is identical (true retry)
      const isRetry = submitKey === lastSubmitKeyRef.current;
      const nextAttempt = isRetry ? Math.min(3, (submissionAttempt || 1) + 1) : 1;
      const profileToUse = getCompressionProfile(nextAttempt);
      setLastUsedCompression(profileToUse);

      // Update UX state
      if (isRetry) {
        setSubmissionAttempt(nextAttempt);
        setRetryNotice(
          `Retry detected — using ${profileToUse.label} image quality for better accuracy.`
        );
      } else {
        lastSubmitKeyRef.current = submitKey;
        setSubmissionAttempt(1);
        setRetryNotice("");
      }

      setSubmitting(true);

      try {
        // Priority: manual override > sticky captured > default
        const effectiveRubric = manualRubric.length
          ? manualRubric
          : (stickyRubric.length ? stickyRubric : "");

        let images = null;
        let answerKeyImages = null;
        let rubricImages = null;

        // Split photos into three buckets based on photoTags:
        //   tagged "key"    -> answer key / solution sheet (two-pass extraction)
        //   tagged "rubric" -> rubric / marking scheme (two-pass extraction -> rubricOverride)
        //   untagged        -> student work (graded)
        if (photosToUse.length) {
          const studentPhotos = photosToUse.filter((p) => !photoTags.has(p.id));
          const keyPhotos = photosToUse.filter((p) => photoTags.get(p.id) === "key");
          const rubricPhotos = photosToUse.filter((p) => photoTags.get(p.id) === "rubric");
          if (studentPhotos.length) {
            images = await compressPhotosForSubmission(studentPhotos, profileToUse);
          }
          if (keyPhotos.length) {
            answerKeyImages = await compressPhotosForSubmission(keyPhotos, profileToUse);
          }
          if (rubricPhotos.length) {
            rubricImages = await compressPhotosForSubmission(rubricPhotos, profileToUse);
          }
        }

        const anonId = getAnonId();

        // Two-pass answer key extraction: if teacher tagged photos as key, run extraction first
        let effectiveAnswerKey = (stickyAnswerKeyText || "").trim();

        if (answerKeyImages && answerKeyImages.length > 0 && !effectiveAnswerKey.length) {
          try {
            console.log("[submit] Running answer key extraction pass...");
            const extractUrl = `${backendBase.replace(/\/$/, "")}/grading/extract-answer-key`;
            const extractRes = await fetch(extractUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ answerKeyImages, standards, gradeBand }),
            });
            if (extractRes.ok) {
              const extractData = await extractRes.json();
              if (extractData.answerKeyText) {
                effectiveAnswerKey = extractData.answerKeyText;
                // Persist as sticky so subsequent papers skip extraction
                setStickyAnswerKeyText(effectiveAnswerKey);
                setStickyAnswerKeyCapturedAt(String(Date.now()));
                setShowRubricTip(false);
                saveLS(RUBRIC_TIP_DISMISSED_KEY, "1");
                console.log("[submit] Answer key extracted:", effectiveAnswerKey.slice(0, 200));
              }
            } else {
              console.warn("[submit] Answer key extraction failed, continuing with images only");
            }
          } catch (e) {
            console.warn("[submit] Answer key extraction error:", e);
          }
        }

        // Two-pass rubric extraction: if teacher tagged photos as rubric, run extraction
        // and feed result into rubricOverride (unless teacher typed/captured one already).
        let effectiveRubricFromImages = "";
        if (rubricImages && rubricImages.length > 0 && !manualRubric.length && !stickyRubric.length) {
          try {
            console.log("[submit] Running rubric extraction pass...");
            const extractRubricUrl = `${backendBase.replace(/\/$/, "")}/grading/extract-rubric`;
            const extractRubricRes = await fetch(extractRubricUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rubricImages, standards, gradeBand }),
            });
            if (extractRubricRes.ok) {
              const extractRubricData = await extractRubricRes.json();
              if (extractRubricData.rubricText) {
                effectiveRubricFromImages = extractRubricData.rubricText;
                // Persist as sticky so subsequent papers reuse it
                setStickyRubricText(effectiveRubricFromImages);
                setStickyRubricSource("captured-photo");
                setStickyRubricCapturedAt(String(Date.now()));
                setShowRubricTip(false);
                saveLS(RUBRIC_TIP_DISMISSED_KEY, "1");
                console.log("[submit] Rubric extracted:", effectiveRubricFromImages.slice(0, 200));
              }
            } else {
              console.warn("[submit] Rubric extraction failed, continuing with images only");
            }
          } catch (e) {
            console.warn("[submit] Rubric extraction error:", e);
          }
        }

        // Priority for rubric sent to grading:
        //   manual typed > sticky captured > rubric extracted from tagged photos
        const rubricForSubmission = manualRubric.length
          ? manualRubric
          : (stickyRubric.length ? stickyRubric : effectiveRubricFromImages);

        const payload = {
          anonId,
          images: images || undefined,
          // Skip sending raw answer key images if extraction already produced text —
          // avoids redundant image processing on the grading call
          answerKeyImages: (effectiveAnswerKey.length ? undefined : answerKeyImages) || undefined,
          // Skip sending raw rubric images if extraction already produced text
          rubricImages: (effectiveRubricFromImages.length ? undefined : rubricImages) || undefined,
          workInput: inputMode === "paste" && trimmedWork ? trimmedWork : undefined,
          rubricOverride: (rubricForSubmission && rubricForSubmission.length) ? rubricForSubmission : null,
          answerKeyOverride: effectiveAnswerKey.length ? effectiveAnswerKey : null,
          gradeBand,
          standards,
          subjectArea: subjectArea || undefined,
          strictnessBias: (biasOverride != null ? biasOverride : strictnessBias) || undefined,

          meta: {
            sessionId: getSessionId(),
            source: "web-grading-page",
            capturedCount: photosToUse.length,
            capturedAt: Date.now(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",

            studentName: (detectedStudentName || "").trim() || null,

            feedbackVoiceMode: voiceOverrideOn ? "override" : "default",
            feedbackVoice: voiceOverrideOn ? voiceOverride : voice,
            rubricMode: manualRubric.length ? "manual" : (stickyRubric.length ? "sticky" : "default"),
            wantsRubricCapture: !manualRubric.length && !stickyRubric.length && inputMode === "photo",
            inputMode,
            subjectArea: subjectArea || undefined,
          },
        };

        console.log("SUBMIT DEBUG", {
          inputMode,
          photosToUseLen: photosToUse.length,
          workLen: trimmedWork.length,
          compression: profileToUse,
          submitKey,
          isRetry,
          nextAttempt,
        });

        const res = await fetch(gradingUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const text = await res.text();
        setServerText(text);
        setCopied(false);

        const parsed = safeJsonParse(text);
        const norm = parsed ? normalizeFromAny(parsed) : normalizeFromAny(text);

        // Sticky rubric capture (only if no manual/sticky already AND we didn't
        // just extract a structured rubric from tagged photos in this cycle).
        // Without this guard, the less-structured grading-pass rubric would
        // overwrite the clean per-criterion extraction from /grading/extract-rubric,
        // which breaks multi-section grading on subsequent papers.
        try {
          const found = extractDetectedRubric(parsed) || extractDetectedRubric(norm?.assessment);

          if (!manualRubric.length && !stickyRubric.length && !effectiveRubricFromImages.length) {
            if (found?.text && found.detected !== false) {
              const conf = Number(found.confidence || 0);
              const THRESH = 0.3;
              if (conf >= THRESH) {
                setStickyRubricText(found.text);
                setStickyRubricSource("captured");
                setStickyRubricCapturedAt(String(Date.now()));
                setShowRubricTip(false);
                saveLS(RUBRIC_TIP_DISMISSED_KEY, "1");
              }
            }
          }
        } catch (e) {
          console.warn("rubric capture parse failed", e);
        }

        // Sticky answer key capture (only if no sticky already)
        try {
          const foundKey = extractDetectedAnswerKey(parsed) || extractDetectedAnswerKey(norm?.assessment);

          if (!(stickyAnswerKeyText || "").trim().length) {
            if (foundKey?.text && foundKey.detected !== false) {
              const conf = Number(foundKey.confidence || 0);
              if (conf >= 0.3) {
                setStickyAnswerKeyText(foundKey.text);
                setStickyAnswerKeyCapturedAt(String(Date.now()));
                setShowRubricTip(false);
                saveLS(RUBRIC_TIP_DISMISSED_KEY, "1");

                // If the teacher didn't manually tag any photos,
                // suggest they do so for better KITA grouping on next submissions
                if (taggedPhotoCount === 0 && photos.length >= 2) {
                  setShowAnswerKeyTagHint(true);
                }
              }
            }
          }
        } catch (e) {
          console.warn("answer key capture parse failed", e);
        }

        if (norm.assessment) {
          setCopyEnabled(true);

          // Auto-publish result to portal (or update existing ref code on resubmit)
          // Use closure refCode only if same student work (not new work)
          const reuseCode = !isNewWork && refCode ? refCode : "";
          let activeCode = reuseCode; // tracks the code that ends up assigned
          try {
            const payloadText = buildFullTeacherPayloadText(norm.assessment, reuseCode, gradeBand, rubricOverride);
            if (reuseCode) {
              // Resubmit same work: update existing result
              await fetch(`${resultsCreateUrl}/${reuseCode}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payload: payloadText }),
              });
            } else {
              // New work or first submit: create new result
              const pub = await publishResultToPortal({
                payload: payloadText,
                meta: {
                  source: "grading-auto",
                  gradeBand,
                  capturedCount: photosRef.current?.length || undefined,
                  studentName: matchedRosterStudent
                    ? `${matchedRosterStudent.firstName} ${matchedRosterStudent.lastName}`.trim()
                    : (detectedStudentName || "").trim() || undefined,
                  studentId: matchedRosterStudent?.studentId || matchedRosterStudent?.edsbyId || undefined,
                  className: selectedClassName || matchedRosterStudent?.className || undefined,
                  teacherEmail: teacherEmail || undefined,
                  subject: norm.assessment?.subject || undefined,
                  assessmentType: norm.assessment?.inferred_assessment_type || norm.assessment?.assessmentType || undefined,
                },
              });
              const newCode = String(pub.code || "").toUpperCase();
              activeCode = newCode;
              setRefCode(newCode);
              // Update the stored payload to include the ref code link
              if (newCode) {
                try {
                  const updatedPayload = buildFullTeacherPayloadText(norm.assessment, newCode, gradeBand, rubricOverride);
                  await fetch(`${resultsCreateUrl}/${newCode}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ payload: updatedPayload }),
                  });
                } catch {}
              }
            }
          } catch (e) {
            console.warn("Auto-publish to /results failed:", e);
          }

          // Auto-add to session (with refCode + roster info so Email Reports
          // includes matched IDs and correct student name for progress).
          // If same refCode exists in session, replaces instead of appending.
          {
            const sessionPayload = buildFullTeacherPayloadText(norm.assessment, activeCode, gradeBand, rubricOverride);
            logCurrentToSessionLocal(sessionPayload, activeCode, matchedRosterStudent, norm.assessment);
          }

          // Auto-scroll to the response so teacher doesn't have to scroll manually
          setTimeout(() => {
            responseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 120);

          // --- GA milestone events ---
          trackEvent("grading_complete", {
            mode: "photo",
            subject: norm.assessment?.subject || "",
            grade_band: gradeBand,
          });

          try {
            const uses = readIntLS(FEEDBACK_USES_KEY, 0);
            const nextUses = uses + 1;
            writeIntLS(FEEDBACK_USES_KEY, nextUses);
            setGradingUses(nextUses);

            // Fire once when teacher crosses the "repeat grader" threshold
            if (nextUses === 3) trackEvent("repeat_grader", { lifetime_uses: 3 });
            if (nextUses === 10) trackEvent("power_grader", { lifetime_uses: 10 });

            if (!showFeedbackPrompt && shouldShowFeedbackPrompt(nextUses)) {
              const triggers = [FEEDBACK_TRIGGER_1, FEEDBACK_TRIGGER_2]
                .map((t) => Number(t))
                .filter((t) => Number.isFinite(t) && t > 0)
                .sort((a, b) => a - b);

              const pendingTrigger = triggers.find((t) => nextUses >= t && !hasSubmittedForTrigger(t));

              writeStrLS(FEEDBACK_LAST_SHOWN_AT_KEY, String(Date.now()));
              openFeedbackPrompt(pendingTrigger);
            }
            // Referral prompt: show after REFERRAL_TRIGGER uses if feedback isn't showing
            else if (!showFeedbackPrompt && !showReferralPrompt && shouldShowReferralPrompt(nextUses)) {
              setReferralName("");
              setReferralEmail("");
              setReferralDone(false);
              setReferralError("");
              setShowReferralPrompt(true);
            }
            // Parent note: periodic reminder to share results info with parents
            else if (!showFeedbackPrompt && !showReferralPrompt && !showParentNote && shouldShowParentNote(nextUses)) {
              setShowParentNote(true);
            }
          } catch {}
        } else {
          setCopyEnabled(false);
        }

        // one-time override
        if (voiceOverrideOn) setVoiceOverrideOn(false);

        if (!res.ok) {
          // Freemium gate: 403 with upgrade info
          if (res.status === 403 && parsed?.error === "monthly_limit_reached") {
            setSubmitError(parsed.message || "Monthly limit reached. Upgrade to continue.");
            setFreemiumLimitHit(true);
            return;
          }
          if (res.status === 403 && parsed?.error === "feature_locked") {
            setSubmitError(parsed.message || "This feature requires a Plus subscription.");
            return;
          }
          if (norm.assessment) {
            setSubmitError("");
            return;
          }
          const msg = parsed?.details || parsed?.error || `HTTP ${res.status} from grading endpoint`;
          throw new Error(msg);
        }
      } catch (err) {
        setCopyEnabled(false);
        console.error("Submit error:", err);
        const msg = err?.message || "";
        const isFetchFail =
          msg.toLowerCase().includes("failed to fetch") ||
          msg.toLowerCase().includes("networkerror") ||
          msg.toLowerCase().includes("load failed");
        setSubmitError(
          isFetchFail
            ? "Internet hiccup — please wait a moment and try again."
            : msg || "Something went wrong. Please try again."
        );
      } finally {
        setSubmitting(false);
      }
    }

    function adjustStrictnessAndRegrade(delta) {
      const next = Math.max(-3, Math.min(3, strictnessBias + delta));
      setStrictnessBias(next);
      submitForGrading(null, { biasOverride: next });
    }

    function toggleCamera() {
      setUsingFrontCamera((v) => !v);
    }

    function useDefaultRubric() {
      setRubricOverride("");
    }

    function logCurrentToSessionLocal(formattedText, codeOverride, rosterStudent, assessmentOverride) {
      const effectiveAssessment = assessmentOverride || assessment;
      if (!effectiveAssessment) return;

      const entry = {
        id:
          (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
          String(Date.now()) + "_" + Math.random().toString(16).slice(2),
        createdAt: Date.now(),
        assessment: effectiveAssessment,
        formattedText: String(formattedText || "").trim(),
        refCode: codeOverride || refCode || "",
        // Roster-matched student info (from dropdown selection) so session
        // email PDFs show the correct name and carry IDs for progress.
        rosterStudent: rosterStudent
          ? {
              firstName: rosterStudent.firstName || "",
              lastName: rosterStudent.lastName || "",
              studentId: rosterStudent.studentId || "",
              edsbyId: rosterStudent.edsbyId || "",
              className: rosterStudent.className || "",
            }
          : null,
      };

      setSessionItems((prev) => {
        // If same ref code already in session, replace it (resubmit overwrites)
        if (entry.refCode) {
          const idx = prev.findIndex((it) => it.refCode === entry.refCode);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...entry, id: prev[idx].id }; // keep original id
            return next;
          }
        }
        // Fallback dedup: identical text within 2s
        const last = prev[prev.length - 1];
        if (last && last.formattedText === entry.formattedText && Date.now() - last.createdAt < 2000) {
          return prev;
        }
        return [...prev, entry];
      });
    }

    function getSessionLabelLocal(a, idx1) {
      const nm = String(a?.student_name || "").trim();
      return nm ? nm : `Submission ${idx1}`;
    }

    function buildSessionEvidence(items) {
      // Keep it compact to control cost/latency
      return items.slice(-40).map((it, idx) => {
        const a = it.assessment || {};
        const label = getSessionLabelLocal(a, idx + 1);

        const sections = Array.isArray(a.sections) ? a.sections : [];
        const sectionEvidence = sections.slice(0, 8).map((sec) => {
          const incorrect = Array.isArray(sec.incorrect_items) ? sec.incorrect_items : [];
          return {
            name: String(sec.name || "").slice(0, 80),
            score: sec.score,
            out_of: sec.out_of,
            teacher_comment: String(sec.teacher_comment || "").slice(0, 220),
            incorrect_items: incorrect.slice(0, 12).map((x) => ({
              prompt: String(x?.prompt || "").slice(0, 120),
              student_answer: String(x?.student_answer || "").slice(0, 80),
              correct_answer: String(x?.correct_answer || "").slice(0, 80),
            })),
          };
        });

        return {
          label,
          score_line: getPrimaryScoreLine(a),
          strengths: toArrayStrings(a.strengths).slice(0, 6),
          improvements: toArrayStrings(a.improvements).slice(0, 6),
          teacher_comment: String(a.teacher_comment || "").slice(0, 260),
          sections: sectionEvidence,
        };
      });
    }

    function localHeuristicSessionSummary(items) {
      const miss = new Map();   // prompt -> count
      const need = new Map();   // improvement -> count
      const good = new Map();   // strength -> count

      const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

      for (const it of items) {
        const a = it?.assessment || {};

        // incorrect prompts
        for (const sec of (Array.isArray(a.sections) ? a.sections : [])) {
          for (const inc of (Array.isArray(sec?.incorrect_items) ? sec.incorrect_items : [])) {
            const p = String(inc?.prompt || "").trim();
            if (p) bump(miss, p);
          }
        }

        // improvements/strengths verbatim
        for (const s of toArrayStrings(a.improvements)) {
          const t = String(s).trim();
          if (t) bump(need, t);
        }
        for (const s of toArrayStrings(a.strengths)) {
          const t = String(s).trim();
          if (t) bump(good, t);
        }
      }

      const top = (m, n) => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,c]) => `${k} (${c})`);

      const A = top(miss, 10);
      const B = top(good, 8);

      const C = [];
      if (A.length || need.size) {
        const focus = [...new Set([
          ...A.slice(0,3).map(x => x.replace(/\s*\(\d+\)\s*$/, "")),
          ...top(need, 2).map(x => x.replace(/\s*\(\d+\)\s*$/, "")),
        ])].slice(0,3);

        if (focus.length) C.push(`Mini-lesson focus: ${focus.join(" | ")}`);
        C.push("Students correct mistakes: write the correct answer + 1 sentence why.");
        C.push("3-question re-check targeting the same skill.");
      } else {
        C.push("No consistent weak pattern detected; do a short review + one extension question.");
      }

      return {
        concepts_not_understood: A,
        concepts_understood_well: B,
        recommendations: C,
        source: "heuristic",
      };
    }

    function formatSessionAnalysisBlock(summary) {
      if (!summary) return "";

      const A = Array.isArray(summary.concepts_not_understood) ? summary.concepts_not_understood : [];
      const B = Array.isArray(summary.concepts_understood_well) ? summary.concepts_understood_well : [];
      const C = Array.isArray(summary.recommendations) ? summary.recommendations : [];

      const lines = [];
      lines.push("=== Session Analysis ===");
      lines.push("");

      lines.push("A) Concepts students did not seem to understand:");
      lines.push(A.length ? A.map(x => `- ${x}`).join("\n") : "- (none detected)");
      lines.push("");

      lines.push("B) Concepts students understand well:");
      lines.push(B.length ? B.map(x => `- ${x}`).join("\n") : "- (none detected)");
      lines.push("");

      lines.push("C) Recommendations:");
      lines.push(C.length ? C.map(x => `- ${x}`).join("\n") : "- (none provided)");
      lines.push("");

      return lines.join("\n");
    }

    async function fetchAiSessionSummary(items) {
      if (!backendBase) throw new Error("Missing backend base URL");

      const url = `${backendBase.replace(/\/$/, "")}/grading/session-summary`;
      const evidence = buildSessionEvidence(items);

      const manual = (rubricOverride || "").trim();
      const sticky = (stickyRubricText || "").trim();
      const effectiveRubric = manual.length ? manual : (sticky.length ? sticky : "");

      const payload = {
        gradeBand,
        standards,
        rubricOverride: effectiveRubric.length ? effectiveRubric : null,
        evidence,
        meta: {
          feedbackVoiceMode: voiceOverrideOn ? "override" : "default",
          feedbackVoice: voiceOverrideOn ? voiceOverride : voice,
        },
      };

      const anonId = getAnonId();

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          anonId, // fine to include, but don't count it as a "submission" server-side
        }),
      });

      const text = await res.text();

      if (!res.ok) {
        const parsed = safeJsonParse(text);
        const msg =
          parsed?.details ||
          parsed?.error ||
          `HTTP ${res.status} from grading/session-summary`;
        throw new Error(msg);
      }

      const paragraph = String(text || "").trim();
      if (!paragraph) throw new Error("Session summary returned empty text");

      return paragraph;
    }

    async function emailReports() {
      if (!sessionItems.length) return;
      // Start loading PDF libs in background while summary generates
      preloadPdfLibs();
      // Step 1: generate session summary (AI or heuristic)
      setSessionSummaryError("");
      setSummarizingSession(true);

      try {
        let paragraph = "";

        try {
          paragraph = await fetchAiSessionSummary(sessionItems);
        } catch (e) {
          console.warn("AI session summary failed; using fallback:", e?.message || e);
          setSessionSummaryError(e?.message || "AI summary failed; used fallback.");
          paragraph = "";
        }

        if (!paragraph) {
          const fb = localHeuristicSessionSummary(sessionItems);
          const weak = (fb.concepts_not_understood || []).slice(0, 2).map(x => x.replace(/\s*\(\d+\)\s*$/, ""));
          const strong = (fb.concepts_understood_well || []).slice(0, 2).map(x => x.replace(/\s*\(\d+\)\s*$/, ""));
          paragraph =
            (weak.length ? `Most students struggled most with ${weak.join(" and ")}. ` : "") +
            (strong.length ? `Overall, students did well with ${strong.join(" and ")}.` : "Overall, performance was mixed with no single dominant pattern.");
        }

        setSessionSummary(paragraph);
        // Show email prompt after summary is ready
        setShowSessionEmailPrompt(true);
      } catch (e) {
        console.error("email reports failed", e);
        setSessionSummaryError("Failed to generate session summary.");
      } finally {
        setSummarizingSession(false);
      }
    }

    async function sendSessionEmail() {
      const to = sessionEmailTo.trim();
      if (!to || !to.includes("@")) return;

      setSessionEmailSending(true);
      try {
        // Build results array for PDF generation
        const results = sessionItems.map((it, idx) => sessionItemToResult(it, idx + 1));

        // Build email subject
        const voiceEffective = voiceOverrideOn ? voiceOverride : voice;
        const first = sessionItems[0]?.assessment || {};
        const subjectParts = ["Grading:"];
        if (first.subject) subjectParts.push(first.subject);
        const aType = voiceEffective === "journal_response" ? "Journal" : (first.inferred_assessment_type || "");
        if (aType) subjectParts.push(aType);
        if (subjectParts.length === 1) subjectParts.push("Session Results");
        const emailSubject = subjectParts.join(" ");

        // Build HTML body from session summary
        const summaryHtml = `
          <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
            <h2 style="color:#1e293b;margin-bottom:8px;">Session Summary</h2>
            <p style="color:#334155;line-height:1.6;">${(sessionSummary || "").replace(/\n/g, "<br>")}</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">
            <p style="color:#64748b;font-size:13px;">${sessionItems.length} submission${sessionItems.length === 1 ? "" : "s"} graded this session. Full reports and cut strips are attached as PDFs.</p>
          </div>
        `;

        // Generate both PDFs in parallel
        let pdfBase64 = null;
        let stripsBase64 = null;
        try {
          [pdfBase64, stripsBase64] = await Promise.all([
            buildResultsPdf(results),
            buildStripsPdf(results),
          ]);
        } catch (pdfErr) {
          console.error("[session] PDF generation failed:", pdfErr?.message || pdfErr, pdfErr?.stack);
          const sendAnyway = window.confirm(
            `PDF report generation failed: ${pdfErr?.message || "unknown error"}. Send email without PDF attachments?`
          );
          if (!sendAnyway) {
            setSessionEmailSending(false);
            return;
          }
        }

        const sendUrl = gradingUrl.replace(/\/grading$/, "/grading/send-email");
        const payload = { to, subject: emailSubject, html: summaryHtml, pdfAttachments: [], csvAttachments: [] };
        if (pdfBase64) {
          payload.pdfAttachments.push({ data: pdfBase64, filename: "session-reports.pdf" });
        }
        if (stripsBase64) {
          payload.pdfAttachments.push({ data: stripsBase64, filename: "session-strips.pdf" });
        }

        // Attach Edsby CSV if any session results have roster-matched student IDs
        // Pass rosterClasses for last-chance name matching at export time
        const csvText = buildSessionEdsbyCsv(results, undefined, rosterClasses);
        if (csvText) {
          const csvBase64 = typeof btoa === "function"
            ? btoa(unescape(encodeURIComponent(csvText)))
            : Buffer.from(csvText, "utf-8").toString("base64");
          payload.csvAttachments.push({ data: csvBase64, filename: "session-results.csv" });
        }

        const res = await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          trackEvent("session_email_sent", { count: sessionItems.length });
          setSessionEmailSent(true);
          setShowSessionEmailPrompt(false);
          setShowSessionClearPrompt(true);
          setTimeout(() => setSessionEmailSent(false), 4000);
        } else {
          const err = await res.json().catch(() => ({}));
          console.warn("[session] send email failed:", err);
          alert(err.error || "Failed to send email. Please try again.");
        }
      } catch (e) {
        console.warn("[session] send email error:", e);
        alert("Failed to send email. Please try again.");
      }
      setSessionEmailSending(false);
    }

    async function copyFormatted() {
      if (!assessment || !copyEnabled) return;

      setCopyEnabled(false);

      // Result is already published on submission — just use the existing ref code
      const codeLocal = refCode;

      const plainText = buildFullTeacherPayloadText(assessment, codeLocal, gradeBand, rubricOverride);
      const htmlAssignmentLinks = getAssignmentLinksFromAssessment(assessment);
      const submittedText = String(assessment?.submitted_text || "").trim();

      const htmlParts = [];
      
      if (htmlAssignmentLinks.length || submittedText) {
        htmlParts.push(`
          <div style="margin-top:10px; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Links / evidence</b>
            <ul style="margin:6px 0 0 18px; padding:0;">
              ${htmlAssignmentLinks.map(l => `
                <li>
                  ${escapeHtml(l?.label || "Evidence")}${
                    l?.url ? `: <a href="${escapeHtml(l.url)}" target="_blank" rel="noreferrer">${escapeHtml(l.url)}</a>` : ""
                  }
                </li>
              `).join("")}
            </ul>
            ${submittedText ? `
              <div style="margin-top:8px; font-size:12px; opacity:0.9; white-space:pre-wrap;">
                ${escapeHtml(submittedText)}
              </div>
            ` : ""}
          </div>
        `);
      }

      const g = getDisplayScore(assessment);
      // isTutorMode is computed above in the component body
      const refUrl = codeLocal ? `https://www.curriculate.net/results/${encodeURIComponent(codeLocal)}` : "";

      htmlParts.push(
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
          <div>
            ${isTutorMode ? "<b>Tutor Feedback</b>" : `<b>Grade:</b> ${escapeHtml(getDisplayScore(assessment).score)} / ${escapeHtml(getDisplayScore(assessment).outOf)}`}
            ${
              codeLocal
                ? ` <span style="opacity:0.85; margin-left:10px;">
                      <b>Ref:</b>
                      <a href="${escapeHtml(refUrl)}" target="_blank" rel="noreferrer" style="text-decoration:underline;">
                        ${escapeHtml(codeLocal)}
                      </a>
                    </span>`
                : ""
            }
          </div>
        </div>`
      );

      if (codeLocal) {
        htmlParts.push(
          `<div style="margin-top:6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; opacity:0.9;">
            View feedback online: <a href="${escapeHtml(refUrl)}" target="_blank" rel="noreferrer" style="color:#2563eb; text-decoration:underline;">
              ${escapeHtml(refUrl)}
            </a>
          </div>`
        );
      }

      // Optional: include sections in HTML too (recommended)
      if (Array.isArray(assessment.sections) && assessment.sections.length) {
        htmlParts.push(
          `<div style="margin-top:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Sections:</b>
            <ul style="margin:6px 0 0 18px; padding:0;">
              ${assessment.sections.map((sec) => {
                const comment = String(sec.teacher_comment || "").trim();
                const incorrect = Array.isArray(sec.incorrect_items) ? sec.incorrect_items : [];
                const showSecScore = Number(sec.score) > 0 || Number(sec.out_of) > 0;
                return `<li style="margin:6px 0;">
                  <div><b>${escapeHtml(sec.name)}:</b>${showSecScore ? ` ${escapeHtml(sec.score)}/${escapeHtml(sec.out_of)}` : ""}${comment ? `${showSecScore ? " — " : " "}${escapeHtml(comment)}` : ""}</div>
                  ${incorrect.length ? `<div style="margin-top:6px; font-size:12px; opacity:0.9;">
                    <b>Incorrect:</b>
                    <ul style="margin:6px 0 0 18px; padding:0;">
                      ${incorrect.slice(0,20).map((it, idx) => formatIncorrectItemHtml(it, idx, escapeHtml)).join("")}
                      ${incorrect.length > 20 ? `<li style="opacity:0.75;">(+ ${incorrect.length - 20} more…)</li>` : ""}
                    </ul>
                  </div>` : ""}
                </li>`;
              }).join("")}
            </ul>
          </div>`
        );
      }

      // ✅ Add clickable photo links to HTML clipboard
      const htmlLinks = getAssignmentImagesFromAssessment(assessment);
      if (htmlLinks.length) {
        htmlParts.push(`
          <div style="margin-top:10px; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Saved captures</b>
            <div style="font-size:12px; opacity:0.85; margin-bottom:6px;">
              These links work for ~30 days.
            </div>
            <ul style="margin:0 0 0 18px; padding:0;">
              ${htmlLinks.map(img => `
                <li>
                  <a href="${escapeHtml(img.url)}" target="_blank" rel="noreferrer">
                    View photo ${escapeHtml(img.index)}
                  </a>
                </li>
              `).join("")}
            </ul>
          </div>
        `);
      }

      const htmlText = htmlParts.join("");

      try {
        // IMPORTANT: This is what makes "Photo 1" clickable without showing URL
        if (navigator.clipboard?.write && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": new Blob([plainText], { type: "text/plain" }),
              "text/html": new Blob([htmlText], { type: "text/html" }),
            }),
          ]);
        } else {
          // Fallback: plain text only (no embedded links possible)
          await navigator.clipboard.writeText(plainText);
        }

        setCopied(true);
        setCopiedFlash(true);
        window.setTimeout(() => setCopiedFlash(false), 1200);
        logCurrentToSessionLocal(plainText, undefined, matchedRosterStudent);
      } catch (e) {
        // ✅ if copy failed, allow retry for this submission
        setCopyEnabled(true);
        setSubmitError("Copy failed—your browser may block clipboard access.");
      }
    }

    function escapeHtml(s) {
      return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    const disableUseDefault =
      !(rubricOverride || "").trim().length &&
      !(stickyRubricText || "").trim().length;

    const disableClearCaptured =
      !(stickyRubricText || "").trim().length ||
      stickyRubricSource !== "captured";

    // SSR: render nothing until client mounts (avoids localStorage hydration mismatch)
    if (!mounted) return null;

    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/images/pulse/pulse-icon.png" alt="Pulse" style={{ height: 32, width: "auto" }} />
            <h1 style={styles.h1}>Pulse Grading</h1>
            {!tipsHidden && (
              <a
                href="/pulse"
                style={{
                  fontSize: 12, fontWeight: 600, color: "#2563eb",
                  textDecoration: "none", opacity: 0.8,
                  border: "1px solid #bfdbfe", borderRadius: 12,
                  padding: "3px 10px", background: "#eff6ff",
                  whiteSpace: "nowrap",
                }}
              >
                New here? See what this tool can do →
              </a>
            )}
          </div>
          {!tipsHidden && (
            <div style={styles.sub}>Grade anything: snap a photo, paste text, batch-upload a stack, record video, or upload audio. Works for essays, math, art, speeches, music performances, skits, and more. Use the built-in rubric or upload your own.</div>
          )}
        </div>

        <div style={styles.controlsRow}>
        <label style={styles.controlLabel}>
          Grade Band
          <select
            value={gradeBand}
            onChange={(e) => setGradeBand(e.target.value)}
            style={styles.select}
          >
            {GRADE_BANDS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>

        {/* Subject area — shown for grade 9+ */}
        {(gradeBand === "9-10" || gradeBand === "11+") && (
          <label style={styles.controlLabel}>
            Subject Area
            <select
              value={subjectArea}
              onChange={(e) => setSubjectArea(e.target.value)}
              style={styles.select}
            >
              {SUBJECT_AREAS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Standards + Note to Parents: hidden after 10 uses to reduce clutter */}
        {!tipsHidden && (
          <label style={styles.controlLabel}>
            Standards
            <select
              value={standards}
              onChange={(e) => setStandards(e.target.value)}
              style={styles.select}
            >
              {STANDARDS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {!tipsHidden && (
          <button
            type="button"
            onClick={() => {
              const note = `Dear Parents,\n\nI'm excited to share that we've started using Curriculate.net's grading tool to support our students. This tool helps me provide better, more consistent feedback on every assignment — highlighting each student's strengths, identifying what can be improved, and arriving at a fair grade.\n\nOne of the best parts for families: each graded assignment comes with a short reference code. To view your child's results, simply visit:\n\nwww.curriculate.net/results\n\nEnter the code and you'll see the detailed feedback, the rubric, and photos of the actual submitted work — all in one place.\n\nI use this as a tool to help me help your students. The feedback is always reviewed by me, and my goal is to make sure every student gets the thoughtful, specific guidance they deserve.\n\nI'd love to hear your thoughts — if you have any feedback on how the reports look or ways we can make them more helpful for your family, please don't hesitate to let me know.\n\nWarm regards`;
              navigator.clipboard.writeText(note).then(() => {
                const btn = document.getElementById("note-to-parents-btn");
                if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Note to Parents"; }, 2000); }
              }).catch(() => {});
            }}
            id="note-to-parents-btn"
            ref={tourTargetParentNoteRef}
            style={{
              padding: "7px 14px",
              fontSize: "0.8rem",
              fontWeight: 700,
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
              whiteSpace: "nowrap",
              alignSelf: "flex-end",
              marginBottom: 2,
            }}
            title="Copy an introductory note for parents about Curriculate grading"
          >
            Note to Parents
          </button>
        )}

        <label ref={tourTargetVoiceRef} style={styles.controlLabel}>
          Feedback Voice

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <select
              value={voice}
              onChange={(e) => {
                const next = e.target.value;

                // If switching INTO IEP, remember what the user had selected before.
                if (next === "iep_supportive" && voice !== "iep_supportive") {
                  prevVoiceBeforeIepRef.current = voice;
                }

                setVoice(next);
              }}
              style={{
                ...styles.select,
                border: voice === "iep_supportive"
                  ? "1px solid rgba(0,0,0,.45)"
                  : styles.select?.border || "1px solid rgba(0,0,0,.2)",
                boxShadow: voice === "iep_supportive"
                  ? "0 0 0 2px rgba(0,0,0,.05)"
                  : styles.select?.boxShadow,
              }}
              title="Sets the default tone of feedback"
            >
              {VOICE_OPTIONS.map((v) => {
                const gated = FREEMIUM_GATED_VOICES.includes(v.value);
                const padlock = gated ? getPadlockForFeature() : null;
                const isLocked = padlock === "locked";
                return (
                  <option key={v.value} value={v.value} disabled={isLocked}>
                    {v.label}{padlock === "unlocked" ? " \u{1F513}" : padlock === "locked" ? " \u{1F510}" : ""}
                  </option>
                );
              })}
            </select>

            <VoiceBadge feedbackVoice={voice} />
          </div>
        </label>

        {/* ── Teacher email (beside Feedback Voice) — hidden until 5 uses unless already set ── */}
        {(gradingUses >= 5 || teacherEmail) && (
          <label style={{ ...styles.controlLabel, flex: "1 1 220px", minWidth: 200 }}>
            Email
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="email"
                placeholder="Optional — links rosters"
                value={teacherEmail}
                onChange={(e) => setTeacherEmail(e.target.value)}
                style={{
                  flex: 1, padding: "5px 10px", borderRadius: 8,
                  border: "1px solid #cbd5e1", fontSize: 13,
                  background: "#fff", minWidth: 120,
                }}
              />
              {rosterLoading && <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>Loading...</span>}
              {!rosterLoading && rosterClasses.length > 0 && (
                <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {rosterClasses.length} class{rosterClasses.length !== 1 ? "es" : ""} linked
                </span>
              )}
            </div>
          </label>
        )}

        {/* <label style={{ ...styles.controlLabel, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 }}>
          <input
            type="checkbox"
            checked={voiceOverrideOn}
            onChange={(e) => setVoiceOverrideOn(e.target.checked)}
            style={{ transform: "scale(1.1)" }}
          />
          <span style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>Override for this assessment</span>
        </label>*/}

        {voiceOverrideOn && (
          <label style={styles.controlLabel}>
            Override Voice
            <select
              value={voiceOverride}
              onChange={(e) => setVoiceOverride(e.target.value)}
              style={styles.select}
              title="Overrides the voice for the next submission only"
            >
              {VOICE_OPTIONS.map((v) => {
                const gated = FREEMIUM_GATED_VOICES.includes(v.value);
                const padlock = gated ? getPadlockForFeature() : null;
                const isLocked = padlock === "locked";
                return (
                  <option key={v.value} value={v.value} disabled={isLocked}>
                    {v.label}{padlock === "unlocked" ? " \u{1F513}" : padlock === "locked" ? " \u{1F510}" : ""}
                  </option>
                );
              })}
            </select>
          </label>
        )}
      </div>

        <style>{`
          @media (min-width: 820px) {
            .grading-grid {
              grid-template-columns: 1fr 1fr !important;
            }
            .grading-grid > .grading-submit-card {
              position: sticky;
              top: 12px;
              align-self: start;
            }
          }
        `}</style>

        <div className="grading-grid" style={styles.grid}>
          {/* CAMERA CARD */}
          <div style={styles.card}>
            <div style={styles.cardTitleRow}>
              <div style={styles.cardTitle}>Input mode</div>

              <div style={{ display: "flex", gap: 10 }}>
                {/* ── Mode buttons with freemium padlocks ── */}
                {[
                  { mode: "photo", label: photos.length > 0 ? `Photo (${photos.length})` : "Photo",
                    onClick: () => {
                      const now = Date.now();
                      const delta = now - lastPhotoTapRef.current;
                      if (delta < 300) { toggleCamera(); }
                      else { setInputMode("photo"); }
                      lastPhotoTapRef.current = now;
                    },
                    title: "Double-tap to flip camera",
                  },
                  { mode: "paste", label: "Paste", onClick: () => setInputMode("paste") },
                  { mode: "batch", label: "Batch", onClick: () => setInputMode("batch"), ref: tourTargetBatchRef },
                  { mode: "video", label: "Video", onClick: () => setInputMode("video") },
                  { mode: "audio", label: "Audio", onClick: () => setInputMode("audio") },
                ].map(({ mode, label, onClick, title, ref: btnRef }) => {
                  const gated = FREEMIUM_GATED_MODES.includes(mode);
                  const padlock = gated ? getPadlockForFeature() : null;
                  const isLocked = padlock === "locked";
                  return (
                    <button
                      key={mode}
                      ref={btnRef || undefined}
                      type="button"
                      onClick={isLocked ? undefined : onClick}
                      style={{
                        ...styles.modeBtn,
                        ...(inputMode === mode ? styles.modeBtnActive : null),
                        ...(isLocked ? { opacity: 0.55, cursor: "not-allowed" } : null),
                        display: "flex", alignItems: "center", gap: 4,
                      }}
                      disabled={submitting || isLocked}
                      title={isLocked ? `Requires Plus (${FREEMIUM_PLUS_PRICE})` : (title || undefined)}
                    >
                      {label}
                      {padlock && <PadlockIcon locked={isLocked} size={12} />}
                    </button>
                  );
                })}
              </div>
            </div>

          {/* Audio mode: full-card takeover */}
          {inputMode === "audio" ? (
            <AudioGrading
              gradingUrl={gradingUrl}
              gradeBand={gradeBand}
              standards={standards}
              feedbackVoice={voiceOverrideOn ? voiceOverride : voice}
              rubricOverride={
                (rubricOverride || "").trim() ||
                (stickyRubricText || "").trim() ||
                ""
              }
              subjectArea={subjectArea}
              strictnessBias={strictnessBias}
              onStrictnessChange={setStrictnessBias}
              onClose={() => setInputMode("photo")}
            />
          ) : inputMode === "video" ? (
            <VideoGrading
              gradingUrl={gradingUrl}
              gradeBand={gradeBand}
              standards={standards}
              feedbackVoice={voiceOverrideOn ? voiceOverride : voice}
              rubricOverride={
                (rubricOverride || "").trim() ||
                (stickyRubricText || "").trim() ||
                ""
              }
              subjectArea={subjectArea}
              strictnessBias={strictnessBias}
              onStrictnessChange={setStrictnessBias}
              onClose={() => setInputMode("photo")}
            />
          ) : inputMode === "batch" ? (
            <BatchGrading
              gradingUrl={gradingUrl}
              resultsUrl={resultsCreateUrl}
              gradeBand={gradeBand}
              standards={standards}
              feedbackVoice={voiceOverrideOn ? voiceOverride : voice}
              voiceMode={voiceOverrideOn ? "override" : "default"}
              rubricOverride={
                (rubricOverride || "").trim() ||
                (stickyRubricText || "").trim() ||
                ""
              }
              answerKeyOverride={(stickyAnswerKeyText || "").trim() || ""}
              teacherEmail={teacherEmail}
              setTeacherEmail={setTeacherEmail}
              rosterClasses={rosterClasses}
              setRosterClasses={setRosterClasses}
              onClose={() => setInputMode("photo")}
            />
          ) : (
          <>
          {/* Hidden file input for uploads — shared between both modes */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />

          {inputMode === "photo" ? (
            <>
              <div style={styles.cameraWrap}>
                <video ref={videoRef} style={styles.video} muted playsInline autoPlay />
                {flash && <div style={styles.flash} />}
                {!cameraReady && (
                  <div style={styles.cameraOverlay}>
                    {cameraError ? (
                      <>
                        <div style={styles.overlayTitle}>Camera Error</div>
                        <div style={styles.overlayText}>{cameraError}</div>
                        <button
                          onClick={() => startCamera({ front: usingFrontCamera })}
                          style={styles.primaryBtn}
                          type="button"
                        >
                          Retry Camera
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={styles.overlayTitle}>Starting camera…</div>
                        <div style={styles.overlayText}>Allow camera permissions.</div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <canvas ref={canvasRef} style={{ display: "none" }} />

              <div style={styles.btnRow}>
                <button
                  onClick={handleCaptureTap}
                  style={{
                    ...styles.primaryBtn,
                    // When a submission is in flight, visually confirm it here
                    // so a teacher who double-tapped-to-submit doesn't have to
                    // scroll down to see the "Submitting…" state.
                    ...(submitting ? {
                      background: "#93c5fd",
                      color: "#1e3a8a",
                    } : {}),
                  }}
                  disabled={!cameraReady || submitting || busyCapture}
                  type="button"
                >
                  {submitting ? "Submitting…" : busyCapture ? "Capturing…" : "Capture Photo"}
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.secondaryBtn}
                  disabled={submitting || busyCapture || busyUpload}
                  type="button"
                  title="Upload image files from your device"
                >
                  {busyUpload ? "Processing…" : "Upload"}
                </button>

                <button
                  onClick={clearAll}
                  onDoubleClick={() => {
                    clearAll();
                    setStickyRubricText("");
                    setStickyRubricSource("");
                    setStickyRubricCapturedAt("");
                    setStickyAnswerKeyText("");
                    setStickyAnswerKeyCapturedAt("");
                    setRubricOverride("");
                  }}
                  style={{
                    ...styles.secondaryBtn,
                    ...((stickyRubricText || stickyAnswerKeyText || rubricOverride || serverText) ? {
                      background: "#dbeafe", borderColor: "#93c5fd", color: "#1d4ed8",
                    } : {}),
                  }}
                  disabled={submitting || busyCapture || busyUpload || (!photos.length && !serverText && !stickyRubricText && !stickyAnswerKeyText && !rubricOverride)}
                  type="button"
                  title="Click to clear photos & work. Double-click to also clear captured rubric, answer key & override input."
                >
                  Clear
                </button>
              </div>

              {/* Only render the meta row when it has something to show. Once a teacher has
                  done >10 gradings, we assume they know the workflow and drop the tip line.
                  The "Photos: N" label is redundant (count is on the Photo toggle button above),
                  so we keep only the key/rubric chips on the status line. */}
              {(keyPhotoCount > 0 || rubricPhotoCount > 0 || !tipsHidden) && (
                <div style={styles.photoMeta}>
                  {(keyPhotoCount > 0 || rubricPhotoCount > 0) && (
                    <div>
                      {keyPhotoCount > 0 && (
                        <span style={{ color: "#059669", fontWeight: 700, fontSize: 12 }}>
                          {keyPhotoCount} key
                        </span>
                      )}
                      {keyPhotoCount > 0 && rubricPhotoCount > 0 && (
                        <span style={{ marginLeft: 8, opacity: 0.4 }}>·</span>
                      )}
                      {rubricPhotoCount > 0 && (
                        <span style={{ marginLeft: keyPhotoCount > 0 ? 8 : 0, color: "#b45309", fontWeight: 700, fontSize: 12 }}>
                          {rubricPhotoCount} rubric
                        </span>
                      )}
                    </div>
                  )}
                  {!tipsHidden && (
                    <div style={{ opacity: 0.8 }}>
                      {photos.length >= 2
                        ? "Tip: Tap a thumbnail — once for Key, again for Rubric, again to clear."
                        : "Tip: Capture with camera, or upload files from your device. Double tap for capture + submit."}
                    </div>
                  )}
                </div>
              )}

              {showAnswerKeyTagHint && photos.length >= 2 && (
                <div style={{
                  marginTop: 10, padding: "10px 14px", borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(5,150,105,0.08), rgba(37,99,235,0.06))",
                  border: "1px solid rgba(5,150,105,0.2)",
                  fontSize: 13, lineHeight: 1.4,
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                }}>
                  <span>
                    <b style={{ color: "#059669" }}>Reference sheet detected!</b> Tap its thumbnail — once marks it as the Answer Key, again as the Rubric. This improves grading for the rest of the stack.
                  </span>
                  <button
                    onClick={() => setShowAnswerKeyTagHint(false)}
                    style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 16, opacity: 0.6, padding: "2px 6px" }}
                    type="button" title="Dismiss"
                  >✕</button>
                </div>
              )}

              {photos.length > 0 && (
                <div style={styles.thumbGrid}>
                  {photos.map((p, idx) => {
                    const tag = photoTags.get(p.id) || null; // "key" | "rubric" | null
                    const isKey = tag === "key";
                    const isRubric = tag === "rubric";
                    // Color tokens: green for key, amber for rubric
                    const keyColor = "#059669";
                    const rubricColor = "#b45309";
                    const accent = isKey ? keyColor : isRubric ? rubricColor : null;
                    const tapTitle = !tag
                      ? "Tap to mark as Answer Key. Tap again for Rubric. Tap again to clear."
                      : isKey
                        ? "Tagged as Answer Key. Tap for Rubric. Tap again to clear."
                        : "Tagged as Rubric. Tap again to clear.";
                    return (
                    <div key={p.id} style={{
                      ...styles.thumb,
                      ...(accent ? { border: `2.5px solid ${accent}`, boxShadow: `0 0 8px ${accent}55` } : {}),
                    }}>
                      <div style={{ position: "relative", cursor: "pointer" }} onClick={() => !submitting && cyclePhotoTag(p.id)} title={tapTitle}>
                        <img src={p.dataUrl} alt={`Captured ${idx + 1}`} style={styles.thumbImg} />
                        {tag && (
                          <div style={{
                            position: "absolute", top: 6, left: 6, background: accent, color: "white",
                            fontSize: 10, fontWeight: 900, borderRadius: 6, padding: "2px 7px",
                            letterSpacing: 0.5,
                          }}>{isKey ? "KEY" : "RUBRIC"}</div>
                        )}
                      </div>
                      <div style={styles.thumbBar}>
                        <div style={{ ...styles.thumbLabel, ...(accent ? { color: accent } : {}) }}>
                          {isKey ? "Answer Key" : isRubric ? "Rubric" : `#${idx + 1}`}
                        </div>
                        <button
                          onClick={() => removePhoto(p.id)}
                          style={styles.thumbRemove}
                          disabled={submitting}
                          title="Remove"
                          type="button"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Paste mode */}
              <label style={{ ...styles.controlLabel, marginTop: 10 }}>
                  Paste student work, a link, or an image URL
                  <textarea
                    value={workInput}
                    onChange={(e) => setWorkInput(e.target.value)}
                    placeholder={"Paste the student's writing/answers here...\nOR paste a link starting with https://\nOR paste a direct image URL (.jpg, .png, .jpeg)"}
                    rows={10}
                    style={styles.textarea}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </label>

              {/* Image URL detected — offer to load it */}
              {(() => {
                const trimmed = (workInput || "").trim();
                const isImgUrl = /^https?:\/\/.+\.(jpe?g|png|gif|webp|heic)(\?.*)?$/i.test(trimmed);
                if (!isImgUrl) return null;
                return (
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={async () => {
                        const ok = await handleImageUrl(trimmed);
                        if (ok) {
                          setWorkInput("");
                          setInputMode("photo");
                        }
                      }}
                      style={styles.primaryBtn}
                      disabled={busyUpload || submitting}
                      type="button"
                    >
                      {busyUpload ? "Loading image..." : "Load as Photo"}
                    </button>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      Image URL detected - load it as a photo for grading
                    </span>
                  </div>
                );
              })()}

              <div style={styles.btnRow}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.secondaryBtn}
                  disabled={submitting || busyUpload}
                  type="button"
                >
                  {busyUpload ? "Processing..." : "Upload Image"}
                </button>

                <button
                  onClick={clearAll}
                  style={styles.secondaryBtn}
                  disabled={
                    submitting || busyUpload ||
                    (
                      (!photos || photos.length === 0) &&
                      !(workInput || "").trim()
                    )
                  }
                  type="button"
                >
                  Clear
                </button>
              </div>

              {/* Show uploaded photo thumbnails in paste mode too */}
              {photos.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    Uploaded images ({photos.length}):
                  </div>
                  <div style={styles.thumbGrid}>
                    {photos.map((p, idx) => {
                      const tag = photoTags.get(p.id) || null;
                      const isKey = tag === "key";
                      const isRubric = tag === "rubric";
                      const keyColor = "#059669";
                      const rubricColor = "#b45309";
                      const accent = isKey ? keyColor : isRubric ? rubricColor : null;
                      const tapTitle = !tag
                        ? "Tap to mark as Answer Key. Tap again for Rubric. Tap again to clear."
                        : isKey
                          ? "Tagged as Answer Key. Tap for Rubric. Tap again to clear."
                          : "Tagged as Rubric. Tap again to clear.";
                      return (
                      <div key={p.id} style={{
                        ...styles.thumb,
                        ...(accent ? { border: `2.5px solid ${accent}`, boxShadow: `0 0 8px ${accent}55` } : {}),
                      }}>
                        <div style={{ position: "relative", cursor: "pointer" }} onClick={() => !submitting && cyclePhotoTag(p.id)} title={tapTitle}>
                          <img src={p.dataUrl} alt={`Upload ${idx + 1}`} style={styles.thumbImg} />
                          {tag && (
                            <div style={{
                              position: "absolute", top: 6, left: 6, background: accent, color: "white",
                              fontSize: 10, fontWeight: 900, borderRadius: 6, padding: "2px 7px",
                              letterSpacing: 0.5,
                            }}>{isKey ? "KEY" : "RUBRIC"}</div>
                          )}
                        </div>
                        <div style={styles.thumbBar}>
                          <div style={{ ...styles.thumbLabel, ...(accent ? { color: accent } : {}) }}>
                            {isKey ? "Answer Key" : isRubric ? "Rubric" : `#${idx + 1}`}
                          </div>
                          <button
                            onClick={() => removePhoto(p.id)}
                            style={styles.thumbRemove}
                            disabled={submitting}
                            title="Remove"
                            type="button"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8, lineHeight: 1.35 }}>
                Tip: Upload photos of assignments, paste text, or paste a link. If a link is private, paste the text instead.
              </div>
            </>
          )}
          </>
          )}
          </div>

          {/* Rubric Options — visible in ALL modes (shared across photo, paste, batch, video) */}
          <div style={styles.card}>
            {/* First-use tip: rubric + answer key */}
            {showRubricTip && (
              <div style={{
                marginTop: 12,
                borderRadius: 12,
                border: "1px solid rgba(37,99,235,0.25)",
                background: "linear-gradient(135deg, rgba(37,99,235,0.06) 0%, rgba(16,185,129,0.06) 100%)",
                padding: "12px 14px",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}>
                <div style={{ fontSize: 20, lineHeight: 1 }}>💡</div>
                <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>Tip: Include a rubric or answer key</div>
                  <div style={{ opacity: 0.85 }}>
                    Snap a photo of your rubric, marking guide, or solution sheet alongside the student work.
                    It will be auto-detected and used to grade the whole stack.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowRubricTip(false);
                    saveLS(RUBRIC_TIP_DISMISSED_KEY, "1");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 16,
                    opacity: 0.5,
                    padding: "0 2px",
                    lineHeight: 1,
                  }}
                  aria-label="Dismiss tip"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Rubric (collapsible) */}
            <div style={{
              ...styles.rubricCard,
              ...((stickyRubricText || "").trim() || (stickyAnswerKeyText || "").trim()
                ? { border: "1px solid rgba(37,99,235,0.35)", boxShadow: "0 0 8px rgba(37,99,235,0.15)" }
                : {}),
            }}>
              {/* Collapsed/expanded header bar */}
              <button
                type="button"
                onClick={() => setShowRubric(v => !v)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setRubricOverride("");
                  setStickyRubricText("");
                  setStickyRubricSource("");
                  setStickyRubricCapturedAt("");
                  setStickyAnswerKeyText("");
                  setStickyAnswerKeyCapturedAt("");
                  setShowRubric(false);
                }}
                style={{
                  ...styles.rubricBar,
                  ...(showRubric ? styles.rubricBarOpen : null),
                  ...((rubricOverride || "").trim() || (stickyRubricText || "").trim() || (stickyAnswerKeyText || "").trim() ? styles.rubricBarActive : null),
                }}
                aria-expanded={showRubric}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                  <div style={{ fontWeight: 900 }}>Rubric Options</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {(() => {
                      const manual = (rubricOverride || "").trim();
                      const sticky = (stickyRubricText || "").trim();
                      const ak = (stickyAnswerKeyText || "").trim();
                      const parts = [];
                      if (manual.length) parts.push("Using pasted rubric override.");
                      else if (sticky.length && stickyRubricSource === "captured") parts.push("Captured rubric (sticky).");
                      else if (sticky.length && stickyRubricSource === "manual") parts.push("Saved rubric (sticky).");
                      if (ak.length) parts.push("Answer key captured (sticky).");
                      return parts.join(" ") || null;
                    })()}
                  </div>
                </div>

                <div style={styles.chev}>{showRubric ? "▴" : "▾"}</div>
              </button>

              {/* Expanded content */}
              {showRubric && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={useDefaultRubric}
                      disabled={disableUseDefault}
                      style={{
                        ...styles.secondaryBtn,
                        opacity: disableUseDefault ? 0.5 : 1,
                        cursor: disableUseDefault ? "not-allowed" : "pointer",
                      }}
                      type="button"
                    >
                      Use Default
                    </button>

                    <button
                      onClick={() => {
                        setStickyRubricText("");
                        setStickyRubricSource("");
                        setStickyRubricCapturedAt("");
                        setStickyAnswerKeyText("");
                        setStickyAnswerKeyCapturedAt("");
                      }}
                      disabled={disableClearCaptured && !(stickyAnswerKeyText || "").trim().length}
                      style={{
                        ...styles.secondaryBtn,
                        opacity: (disableClearCaptured && !(stickyAnswerKeyText || "").trim().length) ? 0.5 : 1,
                        cursor: (disableClearCaptured && !(stickyAnswerKeyText || "").trim().length) ? "not-allowed" : "pointer",
                      }}
                      type="button"
                      title="Clear captured rubric and answer key for this session"
                    >
                      Clear Captured
                    </button>

                    <input
                      ref={rubricFileRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.txt,.rtf,image/*"
                      style={{ display: "none" }}
                      onChange={handleRubricFileUpload}
                    />
                    <button
                      onClick={() => rubricFileRef.current?.click()}
                      style={styles.secondaryBtn}
                      type="button"
                      disabled={uploadingRubricFile}
                    >
                      {uploadingRubricFile ? "Reading…" : "Upload Rubric"}
                    </button>
                  </div>

                  {!(rubricOverride || "").trim().length && (stickyRubricText || "").trim().length ? (
                    <div
                      style={{
                        marginTop: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(37,99,235,0.2)",
                        padding: 10,
                        background: "rgba(37,99,235,0.03)",
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.35,
                        opacity: 0.9,
                      }}
                    >
                      <div style={{ fontWeight: 900, marginBottom: 6, color: "#2563eb" }}>Captured rubric (sticky)</div>
                      {stickyRubricText}
                    </div>
                  ) : null}

                  {(stickyAnswerKeyText || "").trim().length ? (
                    <div
                      style={{
                        marginTop: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(16,185,129,0.25)",
                        padding: 10,
                        background: "rgba(16,185,129,0.04)",
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.35,
                        opacity: 0.9,
                      }}
                    >
                      <div style={{ fontWeight: 900, marginBottom: 6, color: "#059669" }}>Answer key captured (sticky)</div>
                      {stickyAnswerKeyText}
                    </div>
                  ) : null}

                  {/* Saved rubrics dropdown + save */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <select
                      value=""
                      onChange={(e) => {
                        const idx = Number(e.target.value);
                        if (!isNaN(idx) && savedRubrics[idx]) {
                          setRubricOverride(savedRubrics[idx].text);
                        }
                      }}
                      style={{ ...styles.select, flex: 1, fontSize: 13 }}
                    >
                      <option value="">
                        {savedRubrics.length ? `Saved rubrics (${savedRubrics.length})` : "No saved rubrics"}
                      </option>
                      {savedRubrics.map((sr, i) => (
                        <option key={i} value={i}>{sr.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!(rubricOverride || "").trim()}
                      style={{
                        ...styles.secondaryBtn,
                        fontSize: 12, padding: "5px 10px", whiteSpace: "nowrap",
                        opacity: (rubricOverride || "").trim() ? 1 : 0.4,
                      }}
                      onClick={() => {
                        const text = (rubricOverride || "").trim();
                        if (!text) return;
                        const name = prompt("Name this rubric:");
                        if (!name || !name.trim()) return;
                        setSavedRubrics((prev) => {
                          const existing = prev.findIndex((r) => r.name === name.trim());
                          if (existing >= 0) {
                            const updated = [...prev];
                            updated[existing] = { name: name.trim(), text };
                            return updated;
                          }
                          return [...prev, { name: name.trim(), text }];
                        });
                      }}
                    >
                      Save
                    </button>
                    {savedRubrics.length > 0 && (
                      <button
                        type="button"
                        style={{ ...styles.secondaryBtn, fontSize: 12, padding: "5px 10px", color: "#dc2626" }}
                        onClick={() => {
                          const name = (rubricOverride || "").trim();
                          const match = savedRubrics.find((r) => r.text === name || r.text === rubricOverride);
                          if (match) {
                            setSavedRubrics((prev) => prev.filter((r) => r.name !== match.name));
                          } else {
                            // Show list to pick which to delete
                            const names = savedRubrics.map((r, i) => `${i + 1}. ${r.name}`).join("\n");
                            const pick = prompt(`Delete which rubric?\n${names}\n\nEnter the number:`);
                            if (pick) {
                              const idx = Number(pick) - 1;
                              if (idx >= 0 && idx < savedRubrics.length) {
                                setSavedRubrics((prev) => prev.filter((_, i) => i !== idx));
                              }
                            }
                          }
                        }}
                      >
                        Del
                      </button>
                    )}
                  </div>

                  <textarea
                    value={rubricOverride}
                    onChange={(e) => setRubricOverride(e.target.value)}
                    placeholder={`Paste a teacher rubric here (optional)...\n\nExamples:\n- Mark out of 10\n- Focus on understanding, relevance, completion\n- Mechanics secondary\n- Deduct 1 total if any formatting missing\n\nTip: include a photo of your answer key or rubric with the student work — tap the thumbnail to tag it (Key or Rubric) for best grading.\n`}
                    rows={9}
                    style={styles.rubricTextarea}
                  />

                  <div style={styles.rubricSummaryBox}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Default rubric (summary)</div>
                    <ul style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.4, fontSize: 12, opacity: 0.9 }}>
                      <li>Completeness</li>
                      <li>Accuracy</li>
                      <li>Clarity</li>
                      <li>Effort</li>
                      <li>Optional: up to −1 for missing basic formatting (if applicable)</li>
                    </ul>
                  </div>
                  <div style={styles.rubricTip}>
                    Tip: keep rubrics short (a few bullets). Long rubrics increase cost and latency.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SUBMIT + RESPONSE CARD — hidden in batch/video/audio mode */}
          <div className="grading-submit-card" style={{ ...styles.card, ...((inputMode === "batch" || inputMode === "video" || inputMode === "audio") ? { display: "none" } : {}) }}>
            <div style={styles.cardTitle}>Submit</div>

            <div style={styles.btnRow}>
              <button
                onClick={() => submitForGrading()}
                style={styles.primaryBtn}
                disabled={
                  submitting || busyUpload ||
                  (inputMode === "photo"
                    ? !photos.length
                    : (!(workInput || "").trim() && !photos.length)
                  )
                }
              >
                {submitting ? "Submitting…" : assessment ? "Resubmit" : "Submit"}
              </button>
              <button ref={tourTargetCopySessionRef} onClick={emailReports} disabled={!sessionItems.length || summarizingSession} style={styles.secondaryBtn}>
                {summarizingSession ? `Analyzing… (${sessionItems.length})` : sessionEmailSent ? `Sent! (${sessionItems.length})` : `Email Reports (${sessionItems.length})`}
              </button>
              <button
                onClick={() => {
                  setSessionItems([]);
                  setStickyRubricText("");
                  setStickyRubricSource("");
                  setStickyRubricCapturedAt("");
                  setStickyAnswerKeyText("");
                  setStickyAnswerKeyCapturedAt("");
                  setRubricOverride("");
                }}
                disabled={!sessionItems.length && !(stickyRubricText || "").trim().length && !(rubricOverride || "").trim().length && !(stickyAnswerKeyText || "").trim().length}
                style={styles.ghostBtn}
              >
                Clear
              </button>

            </div>

            {/* Email Reports prompt */}
            {showSessionEmailPrompt && (
              <div style={{
                marginTop: 10, padding: "12px 14px", borderRadius: 12,
                background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.18)",
              }}>
                <div style={{ fontSize: 13, color: "#334155", marginBottom: 8 }}>
                  Email session reports (half-page &amp; strips PDFs attached):
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="email"
                    placeholder="recipient@example.com"
                    value={sessionEmailTo}
                    onChange={(e) => setSessionEmailTo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendSessionEmail(); }}
                    style={{
                      flex: 1, padding: "7px 10px", borderRadius: 8,
                      border: "1px solid rgba(0,0,0,.15)", fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={sendSessionEmail}
                    disabled={sessionEmailSending || !sessionEmailTo.includes("@")}
                    style={{
                      ...styles.primaryBtn,
                      padding: "7px 18px", fontSize: 13,
                      opacity: sessionEmailSending || !sessionEmailTo.includes("@") ? 0.5 : 1,
                    }}
                  >
                    {sessionEmailSending ? "Sending…" : "Send"}
                  </button>
                  <button
                    onClick={() => setShowSessionEmailPrompt(false)}
                    style={{ ...styles.ghostBtn, padding: "7px 12px", fontSize: 13 }}
                  >
                    Cancel
                  </button>
                </div>
                {sessionSummary && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                    <strong>Summary preview:</strong> {sessionSummary.slice(0, 200)}{sessionSummary.length > 200 ? "…" : ""}
                  </div>
                )}
              </div>
            )}

            {/* Post-send clear prompt */}
            {showSessionClearPrompt && !showSessionEmailPrompt && (
              <div style={{
                marginTop: 10, padding: "10px 14px", borderRadius: 12,
                background: "rgba(22,163,74,0.07)", border: "1px solid rgba(22,163,74,0.2)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 13, color: "#15803d", flex: 1 }}>
                  Session emailed. Clear session?
                </span>
                <button
                  onClick={() => {
                    setSessionItems([]);
                    setStickyRubricText("");
                    setStickyRubricSource("");
                    setStickyRubricCapturedAt("");
                    setStickyAnswerKeyText("");
                    setStickyAnswerKeyCapturedAt("");
                    setRubricOverride("");
                    setShowSessionClearPrompt(false);
                  }}
                  style={{ ...styles.primaryBtn, padding: "5px 14px", fontSize: 12, background: "#16a34a" }}
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowSessionClearPrompt(false)}
                  style={{ ...styles.ghostBtn, padding: "5px 10px", fontSize: 12 }}
                >
                  Keep
                </button>
              </div>
            )}

            {retryNotice ? (
              <div
                style={{
                  marginTop: 10,
                  borderRadius: 12,
                  padding: "10px 12px",
                  background: "rgba(37,99,235,0.08)",
                  border: "1px solid rgba(37,99,235,0.18)",
                  color: "rgba(15,23,42,0.92)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <b>Retry detected.</b> Using higher image quality to improve accuracy.
                  <span style={{ opacity: 0.75 }}> {lastUsedCompression ? `(${lastUsedCompression.maxWidth}px, q=${lastUsedCompression.quality})` : null}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRetryNotice("")}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontWeight: 900,
                    opacity: 0.7,
                  }}
                  aria-label="Dismiss retry notice"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            ) : null}

            {submitError && (
              <div style={styles.errorBox}>
                <b>Error:</b> {submitError}
                {freemiumLimitHit && (
                  <div style={{ marginTop: 8 }}>
                    <a
                      href={FREEMIUM_UPGRADE_URL}
                      style={{
                        display: "inline-block",
                        padding: "8px 16px",
                        borderRadius: 999,
                        background: "#2563eb",
                        color: "#fff",
                        fontWeight: 800,
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      Upgrade to Plus — {FREEMIUM_PLUS_PRICE}
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* removed Student Name field to simplify UI and because it was not being used in the assessment or copied text. Can be re-added if needed in the future.
            <label style={{ ...styles.controlLabel, marginBottom: 8 }}>
              Student Name (optional - for tracking and feedback)
              <input
                value={detectedStudentName}
                onChange={(e) => {
                  setDetectedStudentName(e.target.value);
                  setStudentNameEdited(true);
                }}
                onClick={() => {
                  const now = Date.now();
                  const delta = now - lastNameTapRef.current;

                  if (delta < 300) {
                    // Double tap → clear name
                    setDetectedStudentName("");
                    setStudentNameEdited(false);
                  }

                  lastNameTapRef.current = now;
                }}
                placeholder="(auto-detected if visible)"
                style={styles.input}
                title="Double-tap to clear"
              />
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                Tip: Can be "First L" or "First Last".
              </div>
            </label> */}

            <div ref={responseRef} style={styles.responseTitleRow}>
              <div style={styles.cardTitle}>Response</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {formattedTeacherText && (
                  <button
                    onClick={assessment && copyEnabled ? copyFormatted : undefined}

                    style={styles.secondaryBtn}
                    disabled={!copyEnabled || submitting}

                    title={copyEnabled ? "Copy comment" : "Already copied for this result"}
                  >
                    {copied ? "Copied ✓" : "Copy Comment"}
                  </button>
                )}
              </div>
            </div>

            {/* ── Student name + class (roster linking) ── */}
            {assessment && rosterClasses.length > 0 && (
              <div style={{
                display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center",
                maxWidth: "100%",
              }}>
                {/* Student name — dropdown from roster or free text */}
                <div style={{ flex: 1, minWidth: 120, maxWidth: rosterClasses.length > 1 ? "60%" : "100%" }}>
                  <select
                    value={matchedRosterStudent ? `${matchedRosterStudent.firstName}|${matchedRosterStudent.lastName}|${matchedRosterStudent.studentId || matchedRosterStudent.edsbyId || ""}` : "__custom"}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__custom" || val === "__none") {
                        setMatchedRosterStudent(null);
                        if (val === "__none") { setDetectedStudentName(""); setStudentNameEdited(false); }
                        return;
                      }
                      const [fn, ln, sid] = val.split("|");
                      // Find matching roster student
                      for (const rc of rosterClasses) {
                        if (selectedClassName && rc.className !== selectedClassName) continue;
                        const found = (rc.students || []).find((s) =>
                          s.firstName === fn && s.lastName === ln && (s.studentId || s.edsbyId || "") === sid
                        );
                        if (found) {
                          setMatchedRosterStudent({ ...found, className: rc.className, rosterId: rc.id });
                          setDetectedStudentName(`${fn} ${ln}`.trim());
                          setStudentNameEdited(true);
                          setSelectedClassName(rc.className);
                          break;
                        }
                      }
                    }}
                    style={{
                      width: "100%", padding: "6px 10px", borderRadius: 8,
                      border: "1px solid #cbd5e1", fontSize: 13, background: "#fff",
                    }}
                  >
                    <option value="__none">— Select student —</option>
                    {(() => {
                      // Filter roster students by selected class, deduplicate across classes
                      const students = [];
                      const seen = new Set();
                      for (const rc of rosterClasses) {
                        if (selectedClassName && rc.className !== selectedClassName) continue;
                        for (const s of (rc.students || [])) {
                          const key = `${(s.firstName || "").toLowerCase()}|${(s.lastName || "").toLowerCase()}|${s.studentId || s.edsbyId || ""}`;
                          if (seen.has(key)) continue;
                          seen.add(key);
                          students.push({ ...s, className: rc.className });
                        }
                      }
                      students.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
                      return students.map((s) => (
                        <option key={`${s.firstName}|${s.lastName}|${s.studentId || s.edsbyId || ""}`}
                          value={`${s.firstName}|${s.lastName}|${s.studentId || s.edsbyId || ""}`}>
                          {s.firstName} {s.lastName}
                        </option>
                      ));
                    })()}
                    {detectedStudentName && !matchedRosterStudent && (() => {
                      // Only show "(not matched)" if detected name doesn't match any roster student
                      const dn = detectedStudentName.toLowerCase().trim();
                      const alreadyInRoster = rosterClasses.some((rc) =>
                        (rc.students || []).some((s) => {
                          const full = `${s.firstName} ${s.lastName}`.toLowerCase().trim();
                          return full === dn || s.firstName?.toLowerCase() === dn || s.lastName?.toLowerCase() === dn;
                        })
                      );
                      if (alreadyInRoster) return null;
                      return <option value="__custom">{detectedStudentName} (not matched)</option>;
                    })()}
                  </select>
                </div>

                {/* Class dropdown */}
                {rosterClasses.length > 1 && (
                  <div style={{ minWidth: 100, maxWidth: "38%" }}>
                    <select
                      value={selectedClassName}
                      onChange={(e) => {
                        const cls = e.target.value;
                        setSelectedClassName(cls);
                        // Re-run auto-match with the new class filter
                        const aiName = detectedStudentName || String(assessment?.student_name || "").trim();
                        if (aiName) {
                          const match = matchStudentToRoster(aiName, cls);
                          setMatchedRosterStudent(match || null);
                        } else {
                          setMatchedRosterStudent(null);
                        }
                      }}
                      style={{
                        width: "100%", padding: "6px 10px", borderRadius: 8,
                        border: "1px solid #cbd5e1", fontSize: 13, background: "#fff",
                      }}
                    >
                      <option value="">All classes</option>
                      {[...rosterClasses].sort((a, b) => a.className.localeCompare(b.className)).map((rc) => (
                        <option key={rc.id} value={rc.className}>{rc.className}</option>
                      ))}
                    </select>
                  </div>
                )}

                {matchedRosterStudent && (
                  <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600, whiteSpace: "nowrap" }}>
                    ✓ Linked
                  </span>
                )}
              </div>
            )}

            {voice === "iep_supportive" && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  background: "rgba(0,0,0,.035)",
                  border: "1px solid rgba(0,0,0,.14)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: "rgba(0,0,0,.35)" }} />
                IEP-supportive voice is active. Marking is partial-credit friendly.
              </div>
            )}

            {/* FORMATTED RENDER (tap-to-copy) */}
            <div
              ref={tourTargetResultRef}
              style={{
                ...styles.responseBox,
                ...(assessment && copyEnabled ? styles.responseBoxClickable : null),
              }}
              onClick={assessment && copyEnabled ? copyFormatted : undefined}
              role={assessment && copyEnabled ? "button" : undefined}
              title={assessment ? (!copyEnabled ? "Already copied for this result" : "Tap to copy formatted comment") : ""}
            >
              {assessment ? (
                <div style={styles.gradingCard}>
                  <div style={styles.gradingTopRow}>
                    <div style={styles.gradingTitle}>
                      {(() => {
                        const g = getDisplayScore(assessment);
                        const biasLabel = strictnessBias > 0
                          ? (strictnessBias === 1 ? "strict" : strictnessBias === 2 ? "stricter" : "strictest")
                          : strictnessBias < 0
                            ? (strictnessBias === -1 ? "lenient" : strictnessBias === -2 ? "more lenient" : "most lenient")
                            : "";
                        return (
                          <>
                            {isTutorMode ? "Tutor Feedback" : (
                              <span ref={tourTargetChevronsRef} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
                                Grade:{" "}
                                {!submitting && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); adjustStrictnessAndRegrade(1); }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    disabled={submitting || strictnessBias >= 3}
                                    title="Re-grade more strictly (lower score)"
                                    style={{
                                      border: "none", background: "transparent", cursor: strictnessBias >= 3 ? "default" : "pointer",
                                      padding: "0 3px", fontSize: 18, fontWeight: 700, lineHeight: 1,
                                      color: strictnessBias >= 3 ? "#cbd5e1" : "#64748b",
                                      opacity: strictnessBias >= 3 ? 0.4 : 0.7,
                                    }}
                                    aria-label="More strict"
                                  >&#8249;</button>
                                )}
                                <span style={{ minWidth: 40, textAlign: "center" }}>
                                  {g.score !== "" ? g.score : "(not provided)"} / {g.outOf}
                                </span>
                                {!submitting && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); adjustStrictnessAndRegrade(-1); }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    disabled={submitting || strictnessBias <= -3}
                                    title="Re-grade more leniently (higher score)"
                                    style={{
                                      border: "none", background: "transparent", cursor: strictnessBias <= -3 ? "default" : "pointer",
                                      padding: "0 3px", fontSize: 18, fontWeight: 700, lineHeight: 1,
                                      color: strictnessBias <= -3 ? "#cbd5e1" : "#64748b",
                                      opacity: strictnessBias <= -3 ? 0.4 : 0.7,
                                    }}
                                    aria-label="More lenient"
                                  >&#8250;</button>
                                )}
                                {biasLabel && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 600, marginLeft: 4,
                                    color: strictnessBias > 0 ? "#dc2626" : "#2563eb",
                                    textTransform: "uppercase", letterSpacing: "0.03em",
                                  }}>{biasLabel}</span>
                                )}
                              </span>
                            )}

                            {refCode ? (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();

                                  // Copy clickable link (HTML + plain) using your helper
                                  const ok = await copyRefCodeLinkOnly(refCode);

                                  if (ok) {
                                    setCopiedRef(true);
                                    window.setTimeout(() => setCopiedRef(false), 900);
                                  }
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  marginLeft: 10,
                                  cursor: "pointer",
                                }}
                                title="Tap to copy results link"
                              >
                                <span
                                  style={{
                                    opacity: 0.9,
                                    color: "#2563eb",
                                    textDecoration: "underline",
                                    fontWeight: 900,
                                  }}
                                >
                                  {copiedRef ? "Link copied ✓" : `Ref: ${refCode}`}
                                </span>
                              </button>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                    <div style={styles.copyPillInline}>
                      {assessment ? (
                        copyEnabled ? (
                          copied ? "Copied ✓" : "Tap to copy"
                        ) : (
                          "Copied ✓"
                        )
                      ) : null}
                    </div>
                  </div>

                  {(() => {
                    const kita = detectKita(assessment);
                    if (kita) {
                      const weights = getKitaWeights(gradeBand, kita);
                      const weightedPct = computeKitaWeightedPercent(kita, weights);
                      return (
                        <>
                          <div style={styles.gradingSectionTitle}>Achievement Categories (KITA)</div>
                          <div style={{
                            border: "1px solid rgba(37,99,235,0.2)",
                            borderRadius: 12,
                            overflow: "hidden",
                            background: "rgba(37,99,235,0.03)",
                          }}>
                            {kita.map((cat, i) => (
                              <div
                                key={cat.short}
                                style={{
                                  padding: "10px 12px",
                                  borderTop: i === 0 ? "none" : "1px solid rgba(37,99,235,0.12)",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                  <div style={{ fontWeight: 800 }}>
                                    <span style={{
                                      display: "inline-block",
                                      width: 22,
                                      height: 22,
                                      borderRadius: 6,
                                      background: "rgba(37,99,235,0.12)",
                                      textAlign: "center",
                                      lineHeight: "22px",
                                      fontSize: 12,
                                      fontWeight: 900,
                                      marginRight: 8,
                                      color: "#2563eb",
                                    }}>{cat.short}</span>
                                    {cat.name}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 11, opacity: 0.6 }}>{weights[i]}%</span>
                                    <span style={{ fontWeight: 900, minWidth: 36, textAlign: "right" }}>{cat.score}/{cat.outOf}</span>
                                  </div>
                                </div>
                                {cat.comment ? (
                                  <div style={{ marginTop: 5, opacity: 0.85, lineHeight: 1.35, paddingLeft: 30 }}>
                                    {cat.comment}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                            <div style={{
                              padding: "8px 12px",
                              borderTop: "1px solid rgba(37,99,235,0.18)",
                              background: "rgba(37,99,235,0.06)",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontWeight: 900,
                            }}>
                              <span>Weighted Total</span>
                              <span style={{ color: "#2563eb" }}>{weightedPct}%</span>
                            </div>
                          </div>
                        </>
                      );
                    }

                    // Non-KITA sections (tests, quizzes, etc.)
                    if (!Array.isArray(assessment.sections) || !assessment.sections.length) return null;
                    return (
                      <>
                        <div style={styles.gradingSectionTitle}>Sections</div>
                        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, overflow: "hidden" }}>
                          {assessment.sections.map((sec, i) => (
                            <div
                              key={`${sec.name}-${i}`}
                              style={{
                                padding: 10,
                                borderTop: i === 0 ? "none" : "1px solid rgba(0,0,0,0.10)",
                                background: "rgba(0,0,0,0.01)",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ fontWeight: 800 }}>{sec.name}</div>
                                {!isTutorMode && (Number(sec.score) > 0 || Number(sec.out_of) > 0) ? (
                                  <div style={{ fontWeight: 900 }}>
                                    {sec.score}/{sec.out_of}
                                  </div>
                                ) : null}
                              </div>
                              {String(sec.teacher_comment || "").trim() ? (
                                <div style={{ marginTop: 6, opacity: 0.85, lineHeight: 1.35 }}>
                                  {String(sec.teacher_comment).trim()}
                                </div>
                              ) : null}

                              {Array.isArray(sec.incorrect_items) && sec.incorrect_items.length ? (
                                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
                                  <div style={{ fontWeight: 800, marginBottom: 4 }}>Incorrect</div>
                                  <ul style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.35 }}>
                                    {sec.incorrect_items.map((it, idx) => (
                                      <li key={idx}>
                                        <span style={{ fontWeight: 700 }}>{String(it.prompt || `Item ${idx + 1}`)}</span>
                                        {` \u2014 you: ${String(it.student_answer || "\u2014")}; correct: ${String(it.correct_answer || "\u2014")}`}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}

                  {Array.isArray(assessment.deductions) && assessment.deductions.length ? (
                    <>
                      <div style={styles.gradingSectionTitle}>Deduction</div>
                      <div style={styles.gradingDeduction}>
                        {(assessment.deductions[0]?.reason || "").trim()}{" "}
                        <span style={{ opacity: 0.8 }}>
                          {formatPoints(assessment.deductions[0]?.points)}
                        </span>
                      </div>
                    </>
                  ) : null}

                  {toArrayStrings(assessment.strengths).length ? (
                    <>
                      <div style={styles.gradingSectionTitle}>Strengths</div>
                      <ul style={styles.gradingUl}>
                        {toArrayStrings(assessment.strengths).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {toArrayStrings(assessment.improvements).length ? (
                    <>
                      <div style={styles.gradingSectionTitle}>Next Steps</div>
                      <ul style={styles.gradingUl}>
                        {toArrayStrings(assessment.improvements).map((it, i) => (
                          <li key={i}>{it}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  {Array.isArray(assessment.achievement_summary) && assessment.achievement_summary.length > 0 ? (
                    <>
                      <div style={styles.gradingSectionTitle}>Achievement Categories</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                        {assessment.achievement_summary.map((k, i) => {
                          const levelColors = {
                            strong: { bg: "rgba(5,150,105,0.1)", border: "rgba(5,150,105,0.3)", text: "#059669" },
                            adequate: { bg: "rgba(37,99,235,0.08)", border: "rgba(37,99,235,0.25)", text: "#2563eb" },
                            developing: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", text: "#d97706" },
                            limited: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)", text: "#dc2626" },
                          };
                          const c = levelColors[k.level] || levelColors.adequate;
                          const knownShort = {
                            "Knowledge & Understanding": "K", "Thinking": "T", "Communication": "C", "Application": "A",
                            "Knowledge & Recall (AO1)": "AO1", "Analysis & Application (AO2)": "AO2",
                            "Evaluation & Context (AO3)": "AO3", "Technical Accuracy (AO4)": "AO4",
                            "Content Knowledge": "CK", "Critical Thinking": "CT",
                            "Subject Knowledge": "SK", "Analytical Thinking": "AT", "Applied Learning": "AL",
                          };
                          const shortName = knownShort[k.category] || k.category.split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase();
                          return (
                            <div key={i} style={{
                              flex: "1 1 calc(50% - 8px)", minWidth: 140,
                              borderRadius: 10, border: `1px solid ${c.border}`,
                              background: c.bg, padding: "8px 10px",
                            }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{
                                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                                    width: 22, height: 22, borderRadius: 6, background: c.text, color: "white",
                                    fontSize: 11, fontWeight: 900,
                                  }}>{shortName}</span>
                                  <span style={{ fontSize: 12, fontWeight: 800, color: c.text }}>
                                    {k.category}
                                  </span>
                                </div>
                                {typeof k.score === "number" && typeof k.out_of === "number" && !isTutorMode ? (
                                  <span style={{ fontSize: 13, fontWeight: 900, color: c.text }}>
                                    {k.score.toFixed(2)}/{k.out_of.toFixed(2)}
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: c.text, textTransform: "capitalize", marginBottom: 2 }}>
                                {k.level}
                              </div>
                              <div style={{ fontSize: 12, lineHeight: 1.35, opacity: 0.85 }}>
                                {k.comment}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {(() => {
                        // isTutorMode is computed above in the component body
                        const items = assessment.achievement_summary.filter(k => typeof k.score === "number" && typeof k.out_of === "number");
                        if (!items.length) return null;
                        const totalScore = items.reduce((s, k) => s + k.score, 0);
                        const totalOutOf = items.reduce((s, k) => s + k.out_of, 0);
                        const pct = totalOutOf > 0 ? Math.min(100, Math.max(0, (totalScore / totalOutOf) * 100)) : 0;

                        // Regional average benchmarks by grade band + standards
                        const benchmarks = {
                          "canada":  { "3-5": 73, "6-8": 70, "9-10": 68, "11+": 72 },
                          "us":      { "3-5": 72, "6-8": 69, "9-10": 67, "11+": 70 },
                          "uk":      { "3-5": 71, "6-8": 68, "9-10": 66, "11+": 69 },
                          "eu":      { "3-5": 72, "6-8": 69, "9-10": 67, "11+": 70 },
                        };
                        const avgPct = benchmarks[standards]?.[gradeBand] || 70;

                        // Quality zone labels
                        const qualityLabel = pct >= 90 ? "Exceptional"
                          : pct >= 80 ? "Excellent"
                          : pct >= 70 ? "Proficient"
                          : pct >= 60 ? "Developing"
                          : pct >= 50 ? "Approaching"
                          : "Needs Support";
                        const qualityColor = pct >= 80 ? "#059669"
                          : pct >= 70 ? "#22c55e"
                          : pct >= 60 ? "#eab308"
                          : pct >= 50 ? "#f59e0b"
                          : "#ef4444";

                        return (
                          <div style={{ padding: "8px 10px", marginTop: -4, marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: qualityColor }}>{qualityLabel}</div>
                              {!isTutorMode ? (
                                <div style={{ fontSize: 13, fontWeight: 900, color: "#1e293b" }}>
                                  <span style={{ opacity: 0.6, fontWeight: 600, marginRight: 6 }}>Total</span>
                                  {totalScore.toFixed(2)}/{totalOutOf.toFixed(2)}
                                </div>
                              ) : (
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                                  Where this assignment is right now
                                </div>
                              )}
                            </div>
                            {/* Quality index gauge */}
                            <div style={{ position: "relative", height: 16, borderRadius: 8, overflow: "visible", background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
                              {/* Gradient background — full scale */}
                              <div style={{
                                position: "absolute", top: 0, left: 0, bottom: 0, width: "100%", borderRadius: 8,
                                background: "linear-gradient(90deg, #fecaca 0%, #fde68a 30%, #d9f99d 55%, #bbf7d0 75%, #6ee7b7 100%)",
                              }} />
                              {/* Regional average marker */}
                              <div style={{
                                position: "absolute", top: -4, bottom: -4,
                                left: `${avgPct}%`, transform: "translateX(-50%)",
                                width: 2, background: "#94a3b8",
                                borderRadius: 1, zIndex: 2,
                              }} />
                              <div style={{
                                position: "absolute", top: -16,
                                left: `${avgPct}%`, transform: "translateX(-50%)",
                                fontSize: 9, fontWeight: 700, color: "#64748b",
                                whiteSpace: "nowrap",
                              }}>
                                Avg
                              </div>
                              {/* Student score indicator (red needle) */}
                              <div style={{
                                position: "absolute", top: -5, bottom: -5,
                                left: `${pct}%`, transform: "translateX(-50%)",
                                width: 4, borderRadius: 2, zIndex: 3,
                                background: "#dc2626",
                                boxShadow: "0 0 6px rgba(220,38,38,0.5)",
                              }} />
                            </div>
                            {/* Zone labels */}
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, fontWeight: 600, color: "#94a3b8" }}>
                              <span>Needs Support</span>
                              <span>Developing</span>
                              <span>Proficient</span>
                              <span>Excellent</span>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  ) : null}

                  {(assessment.teacher_comment || "").trim() ? (
                    <>
                      <div style={styles.gradingSectionTitle}>Overall Comment</div>
                      <div style={styles.gradingComment}>
                        {(assessment.teacher_comment || "").trim()}
                      </div>
                    </>
                  ) : null}

                  {(getAssignmentLinksFromAssessment(assessment).length > 0 ||
                    String(assessment?.submitted_text || "").trim()) ? (
                    <>
                      <div style={styles.gradingSectionTitle}>Evidence</div>

                      {getAssignmentLinksFromAssessment(assessment).length > 0 ? (
                        <ul style={styles.gradingUl}>
                          {getAssignmentLinksFromAssessment(assessment).map((l, i) => (
                            <li key={i}>
                              {l?.label ? <b>{l.label}:</b> : <b>Link:</b>}{" "}
                              {l?.url ? (
                                <a
                                  href={l.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {l.url}
                                </a>
                              ) : (
                                <span style={{ opacity: 0.75 }}>(no url)</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div style={{ fontSize: 13, opacity: 0.85 }}>
                          No links (submitted as text).
                        </div>
                      )}

                      {String(assessment?.submitted_text || "").trim() ? (
                        <pre style={{ ...styles.pre, marginTop: 8 }}>
                          {String(assessment.submitted_text).trim()}
                        </pre>
                      ) : null}
                    </>
                  ) : null}

                  {getAssignmentImagesFromAssessment(assessment).length > 0 ? (
                    <>
                      <div style={styles.gradingSectionTitle}>Saved captures</div>
                      <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>
                        These links work for ~30 days.
                      </div>
                      <ul style={styles.gradingUl}>
                        {getAssignmentImagesFromAssessment(assessment).map((img) => (
                          <li key={img.url}>
                            <a
                              href={img.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View photo {img.index}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  <div style={styles.gradingHint}>Tap anywhere to copy</div>
                </div>
              ) : serverText ? (
                <pre style={styles.pre}>{serverText}</pre>
              ) : (
                <div style={{ opacity: 0.75, lineHeight: 1.5 }}>
                  Results will appear here after submission.
                  <br />
                  Write the grade and reference code (e.g., AA123) on the student's paper.
                  <br />
                  Students and parents can view full feedback at{" "}
                  <a
                    href="https://www.curriculate.net/results"
                    target="_blank"
                    rel="noreferrer"
                  >
                    www.curriculate.net/results
                  </a>.
                </div>
              )}
            </div>

            {/* Calm retry note if wrapper error but no assessment */}
            {!assessment && normalized.wrapperError && (
              <div style={styles.softWarn}>
                {normalized.rawTextUsed?.trim()
                  ? "We received a response but couldn't parse it. Try again."
                  : "Grading didn't complete this time. Try again."}
              </div>
            )}

            <div style={styles.footerHint}>Free to try until subscription plan is enforced.</div>
          </div>
        </div>
        
        {showFeedbackPrompt && (
          <div style={feedbackStyles.overlay} role="dialog" aria-modal="true">
            <div style={feedbackStyles.modal}>
              <div style={feedbackStyles.title}>Quick question</div>
              <div style={feedbackStyles.subtitle}>
                What do you most like about Curriculate grading so far?
              </div>

              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={4}
                placeholder="One sentence is great. (Example: The test mistakes list saves me so much time.)"
                style={feedbackStyles.textarea}
                autoFocus
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                <input
                  value={feedbackName}
                  onChange={(e) => setFeedbackName(e.target.value)}
                  placeholder="Name (optional)"
                  style={feedbackStyles.input}
                  autoComplete="name"
                />
                <input
                  value={feedbackCity}
                  onChange={(e) => setFeedbackCity(e.target.value)}
                  placeholder="City (optional)"
                  style={feedbackStyles.input}
                  autoComplete="address-level2"
                />
              </div>

              <label style={feedbackStyles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={okToQuote}
                  onChange={(e) => setOkToQuote(e.target.checked)}
                  style={feedbackStyles.checkbox}
                />
                <span style={feedbackStyles.checkboxText}>
                  OK to quote this feedback publicly (without my name)
                </span>
              </label>
              <div style={feedbackStyles.row}>
                <button
                  type="button"
                  onClick={dismissFeedbackPrompt}
                  style={feedbackStyles.secondary}
                  disabled={feedbackSending}
                >
                  Not now
                </button>

                <button
                  type="button"
                  onClick={sendUserFeedback}
                  style={{
                    ...feedbackStyles.primary,
                    opacity: (feedbackText || "").trim() ? 1 : 0.5,
                    cursor: (feedbackText || "").trim() ? "pointer" : "not-allowed",
                  }}
                  disabled={feedbackSending || !(feedbackText || "").trim()}
                >
                  {feedbackSending ? "Sending…" : "Send"}
                </button>
              </div>

              <div style={feedbackStyles.finePrint}>
                This takes 10 seconds and helps me improve the tool for teachers.
              </div>
            </div>
          </div>
        )}

        {/* ── Parent note modal ── */}
        {showParentNote && (
          <div style={referralStyles.overlay} role="dialog" aria-modal="true">
            <div style={{ ...referralStyles.modal, maxWidth: 480 }}>
              <div style={referralStyles.icon}>&#128227;</div>
              <div style={referralStyles.title}>Share results with parents</div>
              <div style={{ fontSize: 14, lineHeight: 1.55, color: "#334155", marginBottom: 12, textAlign: "left" }}>
                <p style={{ margin: "0 0 10px" }}>
                  Parents and students can view detailed feedback for any graded assignment by visiting:
                </p>
                <div style={{
                  background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8,
                  padding: "10px 14px", fontWeight: 700, fontSize: 15, textAlign: "center",
                  marginBottom: 10, color: "#0369a1",
                }}>
                  www.curriculate.net/results
                </div>
                <p style={{ margin: "0 0 10px" }}>
                  They just enter the <b>reference code</b> written on the paper. The results page shows the grade, detailed feedback, rubric, and photos of the submitted work.
                </p>
                <p style={{ margin: 0, opacity: 0.85 }}>
                  Feel free to copy the message below to share with parents — or just let them know the URL and code.
                </p>
              </div>
              <textarea
                readOnly
                value={`Dear Parents,\n\nYour child's graded work includes a short reference code (e.g. AT534). To view the detailed feedback, grade, and photos of the submitted work, visit:\n\nwww.curriculate.net/results\n\nEnter the code and you'll see everything in one place. If you have any questions or feedback, please don't hesitate to reach out.`}
                style={{
                  width: "100%", minHeight: 130, border: "1px solid #cbd5e1", borderRadius: 8,
                  padding: 10, fontSize: 13, lineHeight: 1.5, resize: "vertical",
                  fontFamily: "inherit", color: "#334155", background: "#f8fafc",
                }}
                onClick={(e) => e.target.select()}
              />
              <div style={{ ...referralStyles.row, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={dismissParentNote}
                  style={referralStyles.secondary}
                >
                  Got it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(
                      `Dear Parents,\n\nYour child's graded work includes a short reference code (e.g. AT534). To view the detailed feedback, grade, and photos of the submitted work, visit:\n\nwww.curriculate.net/results\n\nEnter the code and you'll see everything in one place. If you have any questions or feedback, please don't hesitate to reach out.`
                    );
                    dismissParentNote();
                  }}
                  style={referralStyles.primary}
                >
                  Copy &amp; close
                </button>
              </div>
              <div style={referralStyles.finePrint}>
                This reminder appears periodically. Dismiss to snooze for 30 days.
              </div>
            </div>
          </div>
        )}

        {/* ── Referral prompt modal ── */}
        {showReferralPrompt && (
          <div style={referralStyles.overlay} role="dialog" aria-modal="true">
            <div style={referralStyles.modal}>
              {referralDone ? (
                <>
                  <div style={referralStyles.icon}>&#127881;</div>
                  <div style={referralStyles.title}>
                    {referralDone === "already" ? "You're already on the list!" : "You're in!"}
                  </div>
                  <div style={referralStyles.subtitle}>
                    {referralDone === "already"
                      ? "We have your application. You'll hear from us soon."
                      : "We'll review your application and email you a personal referral code within a few days."}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowReferralPrompt(false); setReferralDone(false); }}
                    style={referralStyles.primary}
                  >
                    Got it
                  </button>
                </>
              ) : (
                <>
                  <div style={referralStyles.icon}>&#128640;</div>
                  <div style={referralStyles.title}>Love this tool? Share it.</div>
                  <div style={referralStyles.subtitle}>
                    Know teachers at other schools? Become a referral agent — earn commission every time someone you refer subscribes. Just your name and email to get started.
                  </div>

                  <input
                    value={referralName}
                    onChange={(e) => setReferralName(e.target.value)}
                    placeholder="Your name"
                    style={referralStyles.input}
                    autoComplete="name"
                    autoFocus
                  />
                  <input
                    value={referralEmail}
                    onChange={(e) => setReferralEmail(e.target.value)}
                    placeholder="Your email"
                    style={{ ...referralStyles.input, marginTop: 8 }}
                    autoComplete="email"
                    type="email"
                  />

                  {referralError && (
                    <div style={referralStyles.error}>{referralError}</div>
                  )}

                  <div style={referralStyles.row}>
                    <button
                      type="button"
                      onClick={dismissReferralPrompt}
                      style={referralStyles.secondary}
                      disabled={referralSending}
                    >
                      Not now
                    </button>
                    <button
                      type="button"
                      onClick={submitReferralApplication}
                      style={{
                        ...referralStyles.primary,
                        opacity: (referralName || "").trim() && (referralEmail || "").trim() ? 1 : 0.5,
                        cursor: (referralName || "").trim() && (referralEmail || "").trim() ? "pointer" : "not-allowed",
                      }}
                      disabled={referralSending || !(referralName || "").trim() || !(referralEmail || "").trim()}
                    >
                      {referralSending ? "Sending..." : "Sign me up"}
                    </button>
                  </div>

                  <div style={referralStyles.alreadyAgent}>
                    Already a referral agent?{" "}
                    <a href="/referrals" style={referralStyles.agentLink}>
                      View your referral page
                    </a>
                  </div>

                  <div style={referralStyles.finePrint}>
                    No obligation. We'll email you a personal referral code and details.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Feature tour floating tooltip ── */}
        {tourStep >= 0 && (() => {
          const steps = TOUR_STEPS.filter((s) => s.phase <= tourPhase);
          const step = steps[tourStep];
          if (!step) return null;
          const targetRef = tourRefs[step.target];
          const el = targetRef?.current;

          // Calculate position relative to viewport
          const rect = el?.getBoundingClientRect?.();
          const hasRect = rect && rect.width > 0;

          return (
            <>
              {/* Dimming overlay — click to dismiss */}
              <div
                onClick={dismissTour}
                style={{
                  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                  background: hasRect ? "transparent" : "rgba(0,0,0,0.35)",
                  zIndex: 99998,
                }}
              />
              {/* Highlight ring around target (box-shadow creates the dimming) */}
              {hasRect && (
                <div
                  onClick={dismissTour}
                  style={{
                    position: "fixed",
                    top: rect.top - 6, left: rect.left - 6,
                    width: rect.width + 12, height: rect.height + 12,
                    border: "3px solid #3b82f6",
                    borderRadius: 12,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
                    zIndex: 99999,
                    background: "transparent",
                  }}
                />
              )}
              {/* Tooltip bubble */}
              <div style={{
                position: "fixed",
                top: hasRect ? Math.min(rect.bottom + 12, window.innerHeight - 220) : "50%",
                left: hasRect ? Math.max(12, Math.min(rect.left, window.innerWidth - 320)) : "50%",
                transform: hasRect ? "none" : "translate(-50%, -50%)",
                width: 300, maxWidth: "calc(100vw - 24px)",
                background: "white", borderRadius: 14,
                boxShadow: "0 8px 32px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.08)",
                padding: "16px 18px", zIndex: 100000,
              }}>
                {/* Step counter */}
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>
                  {tourStep + 1} of {steps.length}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>
                  {step.title}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "#475569", marginBottom: 14 }}>
                  {step.body}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={dismissTour}
                    style={{
                      background: "none", border: "none", padding: 0,
                      fontSize: 13, color: "#94a3b8", cursor: "pointer", fontWeight: 600,
                    }}
                  >
                    Skip tour
                  </button>
                  <button
                    type="button"
                    onClick={advanceTour}
                    style={{
                      background: "#3b82f6", color: "white", border: "none",
                      borderRadius: 8, padding: "8px 18px",
                      fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {tourStep + 1 >= steps.length ? "Got it!" : "Next"}
                  </button>
                </div>
              </div>
            </>
          );
        })()}

        {/* ── Help / replay tour button ── */}
        <button
          type="button"
          onClick={() => startTour(2)}
          title="Feature tour"
          style={{
            position: "fixed", bottom: 16, right: 16,
            width: 36, height: 36, borderRadius: "50%",
            background: "#e2e8f0", border: "1px solid #cbd5e1",
            color: "#475569", fontSize: 16, fontWeight: 900,
            cursor: "pointer", zIndex: 9990,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          ?
        </button>
      </div>
    );
  }

const styles = {
  page: {
    padding: "16px 18px 40px",
    maxWidth: 1200,
    margin: "0 auto",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#0b1220",
  },
  header: { marginBottom: 10 },
  h1: { margin: 0, fontSize: 24, letterSpacing: -0.3 },
  sub: { marginTop: 4, opacity: 0.78, fontSize: 13 },

  grid: { display: "grid", gridTemplateColumns: "1fr", gap: 14 },

  card: {
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 8px 20px rgba(2, 6, 23, 0.06)",
    background: "white",
  },

  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  responseTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 14,
    marginBottom: 8,
  },
  cardTitle: { fontWeight: 700 },

  cameraWrap: {
    position: "relative",
    borderRadius: 14,
    overflow: "hidden",
    background: "#0b1220",
    maxWidth: 280,
    aspectRatio: "8.5 / 11", /* letter-sized paper */
  },
  video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  cameraOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    gap: 10,
    color: "white",
    background: "linear-gradient(180deg, rgba(2,6,23,0.2), rgba(2,6,23,0.85))",
    textAlign: "center",
  },
  overlayTitle: { fontWeight: 800, fontSize: 18 },
  overlayText: { opacity: 0.9, maxWidth: 420 },

  modeRow: {
    display: "flex",
    gap: 10,
    marginTop: 10,
  },

  modeBtn: {
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.04)",
    whiteSpace: "nowrap",
  },

  modeBtnActive: {
    background: "#2563eb",
    color: "white",
    border: "1px solid rgba(37,99,235,0.35)",
  },

  input: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.18)",
    background: "white",
    fontSize: 14,
    fontWeight: 700,
    minWidth: 240,
  },

  textarea: {
    width: "100%",
    marginTop: 0,
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: 10,
    fontSize: 13,
    lineHeight: 1.35,
    outline: "none",
    background: "white",
    resize: "vertical",
  },

  flash: {
    position: "absolute",
    inset: 0,
    background: "#fff",
    opacity: 0.9,
    pointerEvents: "none",
    animation: "flashAnim 120ms ease-out forwards",
  },

  btnRow: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },

  primaryBtn: {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryBtn: {
    background: "rgba(15,23,42,0.06)",
    color: "#0b1220",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },

  photoMeta: {
    marginTop: 12,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },

  ghostBtn: {
    background: "transparent",
    color: "#0b1220",
    border: "1px dashed rgba(15,23,42,0.22)",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
    opacity: 0.9,
  },

  thumbGrid: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
    gap: 10,
  },
  thumb: {
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid rgba(15,23,42,0.12)",
    background: "white",
  },
  thumbImg: { width: "100%", height: 130, objectFit: "cover", display: "block" },
  thumbBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
  },
  thumbLabel: { fontWeight: 800, fontSize: 12, opacity: 0.75 },
  thumbRemove: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    padding: "4px 6px",
    borderRadius: 10,
  },

  note: { marginTop: 10, fontSize: 13, opacity: 0.9 },
  warn: {
    marginTop: 8,
    fontSize: 12,
    color: "#7c2d12",
    background: "rgba(234,88,12,0.10)",
    border: "1px solid rgba(234,88,12,0.18)",
    padding: 10,
    borderRadius: 12,
  },

  controlsRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  },

  controlLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    fontWeight: 800,
  },
  select: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.18)",
    background: "white",
    fontSize: 14,
    fontWeight: 700,
    minWidth: 240,
  },

  rubricCard: {
    marginTop: 12,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: 12,
    background: "rgba(15,23,42,0.02)",
  },
  rubricHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  rubricTextarea: {
    width: "100%",
    marginTop: 10,
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: 10,
    fontSize: 13,
    lineHeight: 1.35,
    outline: "none",
    background: "white",
  },
  rubricDetails: {
    marginTop: 10,
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: 10,
    background: "rgba(15,23,42,0.02)",
  },
  rubricSummary: { cursor: "pointer", fontWeight: 800, fontSize: 13, opacity: 0.9 },
  rubricPre: {
    margin: "10px 0 0",
    fontSize: 12,
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    opacity: 0.9,
  },
  rubricTip: { marginTop: 8, fontSize: 12, opacity: 0.75 },

  errorBox: {
    marginTop: 12,
    borderRadius: 14,
    padding: 12,
    background: "rgba(220,38,38,0.08)",
    border: "1px solid rgba(220,38,38,0.18)",
    color: "#7f1d1d",
    fontSize: 13,
  },

  responseBox: {
    marginTop: 10,
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.02)",
    padding: 12,
    minHeight: 220,
  },
  responseBoxClickable: {
    cursor: "pointer",
    background: "#f8f9fc",
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    fontSize: 12,
    lineHeight: 1.45,
    opacity: 0.9,
  },

  rubricBar: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
  },

  rubricBarOpen: {
    background: "#fff",
  },

  rubricBarActive: {
    border: "1px solid rgba(217,119,6,0.4)",
    background: "linear-gradient(135deg, rgba(254,233,160,0.6), rgba(254,243,199,0.6))",
  },

  chev: {
    fontSize: 16,
    fontWeight: 900,
    opacity: 0.75,
    lineHeight: 1,
    padding: "2px 6px",
  },

  rubricSummaryBox: {
    marginTop: 10,
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: 10,
    background: "rgba(255,255,255,0.75)",
  },

  gradingCard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  gradingTopRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  gradingTitle: { fontWeight: 900, fontSize: 16 },
  copyPillInline: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.12)",
    opacity: 0.85,
  },
  gradingSectionTitle: { fontWeight: 900, marginTop: 4 },
  gradingDeduction: { fontSize: 13 },
  gradingUl: { margin: "0 0 0 18px", padding: 0, lineHeight: 1.45 },
  gradingHint: { fontSize: 12, opacity: 0.7, marginTop: 4 },
  gradingComment: { fontSize: 13, lineHeight: 1.45 },

  softWarn: {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.75,
  },

  footerHint: { marginTop: 12, fontSize: 12, opacity: 0.7 },
};

const feedbackStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 9999,
  },
  modal: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    background: "white",
    border: "1px solid rgba(15,23,42,0.14)",
    boxShadow: "0 18px 40px rgba(2,6,23,0.25)",
    padding: 16,
  },
  title: { fontWeight: 900, fontSize: 18 },
  subtitle: { marginTop: 6, opacity: 0.8, lineHeight: 1.35 },
  textarea: {
    width: "100%",
    marginTop: 12,
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    padding: 10,
    fontSize: 13,
    lineHeight: 1.35,
    outline: "none",
    resize: "vertical",
  },
  row: { display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 },
  primary: {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 900,
  },
  secondary: {
    background: "rgba(15,23,42,0.06)",
    color: "#0b1220",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 900,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "white",
    color: "#0b1220",
    outline: "none",
    fontSize: 14,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    userSelect: "none",
    color: "#0b1220",
    fontSize: 13,
    opacity: 0.85,
  },
  checkbox: { width: 16, height: 16 },
  checkboxText: { lineHeight: 1.3 },
  finePrint: { marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.35 },
};

const referralStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 9999,
  },
  modal: {
    width: "100%",
    maxWidth: 440,
    borderRadius: 18,
    background: "white",
    border: "1px solid rgba(15,23,42,0.14)",
    boxShadow: "0 18px 40px rgba(2,6,23,0.25)",
    padding: 24,
    textAlign: "center",
  },
  icon: { fontSize: 36, marginBottom: 8 },
  title: { fontWeight: 900, fontSize: 20, color: "#0b1220" },
  subtitle: { marginTop: 8, fontSize: 14, opacity: 0.8, lineHeight: 1.45, textAlign: "center" },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "white",
    color: "#0b1220",
    outline: "none",
    fontSize: 14,
    marginTop: 14,
  },
  row: { display: "flex", justifyContent: "center", gap: 10, marginTop: 16 },
  primary: {
    background: "#059669",
    color: "white",
    border: "none",
    borderRadius: 12,
    padding: "10px 20px",
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
  },
  secondary: {
    background: "rgba(15,23,42,0.06)",
    color: "#0b1220",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 12,
    padding: "10px 20px",
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
  },
  error: { marginTop: 8, fontSize: 13, color: "#dc2626", fontWeight: 600 },
  alreadyAgent: { marginTop: 14, fontSize: 13, opacity: 0.7, lineHeight: 1.35 },
  agentLink: { color: "#059669", fontWeight: 700, textDecoration: "underline" },
  finePrint: { marginTop: 8, fontSize: 12, opacity: 0.6, lineHeight: 1.35 },
};
