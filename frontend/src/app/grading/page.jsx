"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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
- proper descriptive title (not just “check-in”; do not apply to art work)
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
];

const VOICE_KEY = "curriculate_grading_voice_v1";
const VOICE_OVERRIDE_KEY = "curriculate_grading_voice_override_v1";
const VOICE_OVERRIDE_VALUE_KEY = "curriculate_grading_voice_override_value_v1";
const SESSION_ID_KEY = "curriculate_session_id_v1";
const ANON_ID_KEY = "curriculate_anon_id_v1";

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

function submittedKeyForTrigger(t) {
  return `curriculate_feedback_submitted_for_${t}_v1`;
}

function hasSubmittedForTrigger(t) {
  return readStrLS(submittedKeyForTrigger(t), "0") === "1";
}

function markSubmittedForTrigger(t) {
  writeStrLS(submittedKeyForTrigger(t), "1");
}

function readIntLS(key, fallback = 0) {
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

  // 3) handle “escaped JSON looking” payloads like: { \"overall_score\": 18, ... }
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
  return `(\u2013${Math.abs(n)})`; // always show as “–1”
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

  // If we found nothing, don’t change
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

function buildFullTeacherPayloadText(assessment, codeLocal = "") {
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

  if (String(assessment.teacher_comment || "").trim()) {
    lines.push("Overall Comment:");
    lines.push(String(assessment.teacher_comment).trim());
    lines.push("");
  }

  // ✅ Sections + incorrect items
  if (Array.isArray(assessment.sections) && assessment.sections.length) {
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

  function loadSession() {
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

  // Prefer the actual improvement bullet text as the “concept”
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
    const [submissionAttempt, setSubmissionAttempt] = useState(0);
    const [retryNotice, setRetryNotice] = useState(""); // UX text
    const [feedbackTrigger, setFeedbackTrigger] = useState(null);
   
    useEffect(() => {
      saveSession(sessionItems);
    }, [sessionItems]);

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const canvasRef = useRef(null);

    const isMobile = useMemo(() => {
      if (typeof navigator === "undefined") return false;
      return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    }, []);

    const [cameraReady, setCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState("");
    const [usingFrontCamera, setUsingFrontCamera] = useState(false);
    const lastPhotoTapRef = useRef(0);
    const [lastUsedCompression, setLastUsedCompression] = useState(null);

    const [flash, setFlash] = useState(false);
    const [photos, setPhotos] = useState([]); // { id, dataUrl, createdAt }
    const [busyCapture, setBusyCapture] = useState(false);
    const photosRef = useRef([]);
    
    useEffect(() => { photosRef.current = photos; }, [photos]);
    
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");

    // ✅ One raw response string (always)
    const [serverText, setServerText] = useState("");

    // Optional rubric override UI
    const [showRubric, setShowRubric] = useState(false);
    const [rubricOverride, setRubricOverride] = useState("");
    const [gradeBand, setGradeBand] = useState("6-8");

    // Input mode: photo vs paste
    const [inputMode, setInputMode] = useState("photo"); // "photo" | "paste"
    
    const [workInput, setWorkInput] = useState("");
    useEffect(() => {
          lastSubmitKeyRef.current = "";
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
    const prevVoiceBeforeIepRef = useRef(null);

    // Persist
    useEffect(() => {
      // Don't overwrite saved default with the temporary IEP voice
      if (voice !== "iep_supportive") saveLS(VOICE_KEY, voice);
    }, [voice]);
    useEffect(() => saveLS(VOICE_OVERRIDE_KEY, voiceOverrideOn ? "1" : "0"), [voiceOverrideOn]);
    useEffect(() => saveLS(VOICE_OVERRIDE_VALUE_KEY, voiceOverride), [voiceOverride]);

    // Learning Recommendations
    const [sessionSummary, setSessionSummary] = useState(""); // was null object
    const [sessionSummaryError, setSessionSummaryError] = useState("");
    const [summarizingSession, setSummarizingSession] = useState(false);
    
    // Copy UX
    const [copied, setCopied] = useState(false);
    const [copiedFlash, setCopiedFlash] = useState(false); 
    // AA123 reference code per result (shown + copied)
    const [refCode, setRefCode] = useState("");

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
       
    const gradingUrl = useMemo(() => {
      if (!backendBase) return "";
      return `${backendBase.replace(/\/$/, "")}/grading`;
    }, [backendBase]);

    const resultsCreateUrl = useMemo(() => {
      if (!backendBase) return "";
      return `${backendBase.replace(/\/$/, "")}/results`;
    }, [backendBase]);

    async function publishResultToPortal({ payload, meta }) {
      if (!resultsCreateUrl) throw new Error("Missing NEXT_PUBLIC_BACKEND_URL (results endpoint).");

      const res = await fetch(resultsCreateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload, // we’ll store a string so /results can show it nicely
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

    const formattedTeacherText = useMemo(() => {
      return assessment ? buildFullTeacherPayloadText(assessment, refCode) : "";
    }, [assessment, refCode]);

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
      if (inputMode === "paste") {
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

    useEffect(() => {
      return () => {
        if (captureTapTimerRef.current) clearTimeout(captureTapTimerRef.current);
      };
    }, []);

    useEffect(() => {
      const aiName = String(assessment?.student_name || "").trim();
      if (!studentNameEdited && aiName) {
        setDetectedStudentName(aiName);
      }
      // If you want it blank when none detected:
      if (!studentNameEdited && !aiName) {
        setDetectedStudentName("");
      }
    }, [assessment?.student_name, studentNameEdited]);

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

        const targetAspect = isMobile ? 3 / 4 : 16 / 9;

        let cropW = vw;
        let cropH = Math.round(vw / targetAspect);

        if (cropH > vh) {
          cropH = vh;
          cropW = Math.round(vh * targetAspect);
        }

        const sx = Math.round((vw - cropW) / 2);
        const sy = Math.round((vh - cropH) / 2);

        canvas.width = cropW;
        canvas.height = cropH;

        ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

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

      // Respect cooldown (don’t show more than once per week)
      const lastShownAt = Number(readStrLS(FEEDBACK_LAST_SHOWN_AT_KEY, "0")) || 0;
      const cooldownDays = Number(FEEDBACK_COOLDOWN_DAYS) || 7;
      const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
      if (lastShownAt && Date.now() - lastShownAt < cooldownMs) return false;

      // Find the earliest trigger that has been reached but not yet "submitted for"
      const pendingTrigger = triggers.find((t) => n >= t && !hasSubmittedForTrigger(t));
      if (!pendingTrigger) return false;

      // Persistent mode:
      // Once they’ve crossed the pending trigger, keep prompting occasionally
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
    }

    function clearAll() {
      setPhotos([]);
      photosRef.current = [];
      setSubmitError("");
      setServerText("");
      setCopied(false);
      setRefCode("");
      setWorkInput("");
      setDetectedStudentName("");
      setStudentNameEdited(false);

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

    async function submitForGrading(photosOverride = null) {
      setSubmitError("");
      setServerText("");
      setCopied(false);
      setCopyEnabled(false); // lock during submission
      setRefCode(""); // new submission => new ref
      
      if (!gradingUrl) {
        setSubmitError("Missing NEXT_PUBLIC_BACKEND_URL. Set it in Vercel and redeploy.");
        return;
      }

      const photosToUse = Array.isArray(photosOverride) ? photosOverride : photos;

      // Validate input first
      if (inputMode === "photo") {
        if (!photosToUse.length) {
          setSubmitError("Capture at least one photo before submitting.");
          return;
        }
      } else {
        const w = (workInput || "").trim();
        if (!w) {
          setSubmitError("Paste text or add a public link before submitting.");
          return;
        }
      }

      // Compute rubric lengths early (needed for submitKey)
      const manualRubric = (rubricOverride || "").trim();
      const stickyRubric = (stickyRubricText || "").trim();
      const trimmedWork = (workInput || "").trim();

      // ✅ 1) Build submitKey BEFORE using it
      const voiceEffective = voiceOverrideOn ? voiceOverride : voice;

      const submitKey =
        inputMode === "photo"
          ? `photo:${photosToUse.map((p) => p.id).join(",")}|gb:${gradeBand}|v:${voiceEffective}`
          : `paste:${trimmedWork.slice(0, 200)}|len:${trimmedWork.length}|gb:${gradeBand}|v:${voiceEffective}`;
          
      // ✅ 2) Compute the attempt + compression profile LOCALLY (don’t rely on state timing)
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

        if (inputMode === "photo") {
          // ✅ Use the locally computed profile immediately
          images = await compressPhotosForSubmission(photosToUse, profileToUse);
        }

        const anonId = getAnonId();

        const payload = {
          anonId,
          images: inputMode === "photo" ? images : undefined,
          workInput: inputMode === "paste" ? trimmedWork : undefined,
          rubricOverride: effectiveRubric.length ? effectiveRubric : null,
          gradeBand,

          meta: {
            sessionId: getSessionId(),
            source: "web-grading-page",
            capturedCount: inputMode === "photo" ? photosToUse.length : 0,
            capturedAt: Date.now(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",

            studentName: (detectedStudentName || "").trim() || null,

            feedbackVoiceMode: voiceOverrideOn ? "override" : "default",
            feedbackVoice: voiceOverrideOn ? voiceOverride : voice,
            rubricMode: manualRubric.length ? "manual" : (stickyRubric.length ? "sticky" : "default"),
            wantsRubricCapture: !manualRubric.length && !stickyRubric.length && inputMode === "photo",
            inputMode,
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

        // Sticky rubric capture (only if no manual/sticky already)
        try {
          const found = extractDetectedRubric(parsed) || extractDetectedRubric(norm?.assessment);

          if (!manualRubric.length && !stickyRubric.length) {
            if (found?.text && found.detected !== false) {
              const conf = Number(found.confidence || 0);
              const THRESH = 0.75;
              if (conf >= THRESH || conf === 0) {
                setStickyRubricText(found.text);
                setStickyRubricSource("captured");
                setStickyRubricCapturedAt(String(Date.now()));
              }
            }
          }
        } catch (e) {
          console.warn("rubric capture parse failed", e);
        }

        if (norm.assessment) {
          setCopyEnabled(true);

          try {
            const uses = readIntLS(FEEDBACK_USES_KEY, 0);
            const nextUses = uses + 1;
            writeIntLS(FEEDBACK_USES_KEY, nextUses);

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
          } catch {}
        } else {
          setCopyEnabled(false);
        }

        // one-time override
        if (voiceOverrideOn) setVoiceOverrideOn(false);

        if (!res.ok) {
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

    function toggleCamera() {
      setUsingFrontCamera((v) => !v);
    }

    function useDefaultRubric() {
      setRubricOverride("");
    }

    function logCurrentToSessionLocal(formattedText) {
      if (!assessment) return;

      const entry = {
        id:
          (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
          String(Date.now()) + "_" + Math.random().toString(16).slice(2),
        createdAt: Date.now(),
        assessment,
        formattedText: String(formattedText || "").trim(),
      };

      setSessionItems((prev) => {
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
          anonId, // fine to include, but don’t count it as a “submission” server-side
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

    async function copySession() {
      if (!sessionItems.length) return;

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
          // fallback: turn your heuristic object into a short paragraph
          const fb = localHeuristicSessionSummary(sessionItems);
          const weak = (fb.concepts_not_understood || []).slice(0, 2).map(x => x.replace(/\s*\(\d+\)\s*$/, ""));
          const strong = (fb.concepts_understood_well || []).slice(0, 2).map(x => x.replace(/\s*\(\d+\)\s*$/, ""));
          paragraph =
            (weak.length ? `Most students struggled most with ${weak.join(" and ")}. ` : "") +
            (strong.length ? `Overall, students did well with ${strong.join(" and ")}.` : "Overall, performance was mixed with no single dominant pattern.");
        }

        setSessionSummary(paragraph);

        const plain = [
          `Session Summary: ${paragraph}`,
          "",
          ...sessionItems.map((it, idx) => {
            const label = getSessionLabelLocal(it.assessment, idx + 1);
            const body = String(it.formattedText || "").trim();
            return `=== ${label} ===\n${body}\n`;
          }),
        ].join("\n").trim();

        await navigator.clipboard?.writeText(plain);
        setCopied(true);
        setCopiedFlash(true);
        window.setTimeout(() => setCopiedFlash(false), 1200);
      } catch (e) {
        console.error("copy session failed", e);
        setSessionSummaryError("Copy session failed—your browser may block clipboard access.");
      } finally {
        setSummarizingSession(false);
      }
    }

    async function copyFormatted() {
      if (!assessment || !copyEnabled) return;
      
      setCopyEnabled(false);

      // Ensure this result is published when teacher copies.
      // We want AA123 returned from backend and included in the copied text.
      let codeLocal = refCode;

      if (!codeLocal) {
        try {
          const payloadText = buildFullTeacherPayloadText(assessment, "");
          const pub = await publishResultToPortal({
            payload: payloadText,
            meta: {
              source: "grading-copy",
              gradeBand,
              capturedCount: photosRef.current?.length || undefined,
            },
          });

          codeLocal = String(pub.code || "").toUpperCase();
          setRefCode(codeLocal);
        } catch (e) {
          console.warn("publish to /results failed:", e);
          setSubmitError(`Portal publish failed (still copying): ${e?.message || "Unknown error"}`);
          setCopyEnabled(true);
        }
      }
      
      const plainText = buildFullTeacherPayloadText(assessment, codeLocal);
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
      const refUrl = codeLocal ? `https://www.curriculate.net/results/${encodeURIComponent(codeLocal)}` : "";

      htmlParts.push(
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
          <div>
            <b>Grade:</b> ${escapeHtml(getDisplayScore(assessment).score)} / ${escapeHtml(getDisplayScore(assessment).outOf)}
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
                return `<li style="margin:6px 0;">
                  <div><b>${escapeHtml(sec.name)}:</b> ${escapeHtml(sec.score)}/${escapeHtml(sec.out_of)}${comment ? ` — ${escapeHtml(comment)}` : ""}</div>
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
        // IMPORTANT: This is what makes “Photo 1” clickable without showing URL
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
        logCurrentToSessionLocal(plainText);
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

    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.h1}>Grading</h1>
          <div style={styles.sub}>Capture tests, quizzes, essays, posters, math sheets, even art, then submit for an assessment using the built-in rubric or your own. Include a rubric with your first images to use it for the session.</div>
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

        <label style={styles.controlLabel}>
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
              {VOICE_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>

            <VoiceBadge feedbackVoice={voice} />
          </div>
        </label>

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
              {VOICE_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

        <div style={styles.grid}>
          {/* CAMERA CARD */}
          <div style={styles.card}>
            <div style={styles.cardTitleRow}>
              <div style={styles.cardTitle}>Input mode</div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  // title="Double-tap to flip"
                  onClick={() => {
                    const now = Date.now();
                    const delta = now - lastPhotoTapRef.current;

                    if (delta < 300) {
                      // Double tap → flip camera
                      toggleCamera();
                    } else {
                      // Single tap → switch to photo mode
                      setInputMode("photo");
                    }

                    lastPhotoTapRef.current = now;
                  }}
                  style={{
                    ...styles.modeBtn,
                    ...(inputMode === "photo" ? styles.modeBtnActive : null),
                  }}
                  disabled={submitting}
                  title="Double-tap to flip camera"
                >
                  Photo
                </button>

                <button
                  type="button"
                  onClick={() => setInputMode("paste")}
                  style={{
                    ...styles.modeBtn,
                    ...(inputMode === "paste" ? styles.modeBtnActive : null),
                  }}
                  disabled={submitting}
                >
                  Paste
                </button>
              </div>
            </div>
            
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
                  style={styles.primaryBtn}
                  disabled={!cameraReady || submitting || busyCapture}
                  type="button"
                >
                  {busyCapture ? "Capturing…" : "Capture Photo"}
                </button>

                <button
                  onClick={clearAll}
                  style={styles.secondaryBtn}
                  disabled={submitting || busyCapture || (!photos.length && !serverText)}
                  type="button"
                >
                  Clear
                </button>
              </div>

              <div style={styles.photoMeta}>
                <div>
                  <b>Photos:</b> {photos.length}
                </div>
                <div style={{ opacity: 0.8 }}>
                  Tip: Keep pages flat, fill the frame, avoid glare. Double tap for capture + submit.
                </div>
              </div>

              {photos.length > 0 && (
                <div style={styles.thumbGrid}>
                  {photos.map((p, idx) => (
                    <div key={p.id} style={styles.thumb}>
                      <img src={p.dataUrl} alt={`Captured ${idx + 1}`} style={styles.thumbImg} />
                      <div style={styles.thumbBar}>
                        <div style={styles.thumbLabel}>#{idx + 1}</div>
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
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Paste mode */}
              <label style={{ ...styles.controlLabel, marginTop: 10 }}>
                  Paste student work OR paste a link
                  <textarea
                    value={workInput}
                    onChange={(e) => setWorkInput(e.target.value)}
                    placeholder="Paste the student’s writing/answers here… OR paste a link starting with https://"
                    rows={10}
                    style={styles.textarea}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </label>

              <div style={styles.btnRow}>
                <button
                  onClick={clearAll}
                  style={styles.secondaryBtn}
                  disabled={
                    submitting ||
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

              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8, lineHeight: 1.35 }}>
                Tip: If a link is private, paste the text instead.
              </div>
            </>
          )}
          </div>

          {/* SUBMIT + RESPONSE CARD */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>Submit</div>

            {/* Rubric (collapsible) */}
            <div style={styles.rubricCard}>
              {/* Collapsed/expanded header bar */}
              <button
                type="button"
                onClick={() => setShowRubric(v => !v)}
                style={{
                  ...styles.rubricBar,
                  ...(showRubric ? styles.rubricBarOpen : null),
                }}
                aria-expanded={showRubric}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                  <div style={{ fontWeight: 900 }}>Rubric Options</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {(() => {
                      const manual = (rubricOverride || "").trim();
                      const sticky = (stickyRubricText || "").trim();
                      if (manual.length) return "Using pasted rubric override (this submission).";
                      if (sticky.length && stickyRubricSource === "captured") return "Using captured rubric (sticky for this session).";
                      if (sticky.length && stickyRubricSource === "manual") return "Using saved rubric (sticky for this session).";
                      return;
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
                      }}
                      disabled={disableClearCaptured}
                      style={{
                        ...styles.secondaryBtn,
                        opacity: disableClearCaptured ? 0.5 : 1,
                        cursor: disableClearCaptured ? "not-allowed" : "pointer",
                      }}
                      type="button"
                      title="Clear the captured rubric for this session"
                    >
                      Clear Captured
                    </button>
                  </div>

                  {!(rubricOverride || "").trim().length && (stickyRubricText || "").trim().length ? (
                    <div
                      style={{
                        marginTop: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(15,23,42,0.12)",
                        padding: 10,
                        background: "rgba(255,255,255,0.9)",
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.35,
                        opacity: 0.9,
                      }}
                    >
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>Captured rubric (sticky)</div>
                      {stickyRubricText}
                    </div>
                  ) : null}

                  <textarea
                    value={rubricOverride}
                    onChange={(e) => setRubricOverride(e.target.value)}
                    placeholder={`Paste a teacher rubric here (optional)...\n\nExamples:\n- Mark out of 10\n- Focus on understanding, relevance, completion\n- Mechanics secondary\n- Deduct 1 total if any formatting missing\n- 2–3 sentence teacher comment\n`}
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

            <div style={styles.btnRow}>
              <button
                onClick={submitForGrading}
                style={styles.primaryBtn}
                disabled={
                  submitting ||
                  (inputMode === "photo"
                    ? !photos.length
                    : !(workInput || "").trim()
                  )
                }
              >
                {submitting ? "Submitting…" : "Submit for Grading"}
              </button>
              <button onClick={copySession} disabled={!sessionItems.length || summarizingSession} style={styles.secondaryBtn}>
                {summarizingSession ? `Analyzing… (${sessionItems.length})` : `Copy Session (${sessionItems.length})`}
              </button>
              <button
                onClick={() => {
                  setSessionItems([]);
                  setStickyRubricText("");
                  setStickyRubricSource("");
                  setStickyRubricCapturedAt("");
                  setRubricOverride("");
                }}
                disabled={!sessionItems.length && !(stickyRubricText || "").trim().length && !(rubricOverride || "").trim().length}
                style={styles.ghostBtn}
              >
                Clear
              </button> 

            </div>

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
                Tip: Can be “First L” or “First Last”.
              </div>
            </label> */}

            <div style={styles.responseTitleRow}>
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
                        return (
                          <>
                            Grade: {g.score !== "" ? g.score : "(not provided)"} / {g.outOf}

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

                  {Array.isArray(assessment.sections) && assessment.sections.length ? (
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
                              <div style={{ fontWeight: 900 }}>
                                {sec.score}/{sec.out_of}
                              </div>
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
                                      {` — you: ${String(it.student_answer || "—")}; correct: ${String(it.correct_answer || "—")}`}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}

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
                  Write the grade and reference code (e.g., AA123) on the student’s paper.
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
                  ? "We received a response but couldn’t parse it. Try again."
                  : "Grading didn’t complete this time. Try again."}
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
      </div>
    );
  }

const styles = {
  page: {
    padding: "24px 18px 40px",
    maxWidth: 1200,
    margin: "0 auto",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    color: "#0b1220",
  },
  header: { marginBottom: 16 },
  h1: { margin: 0, fontSize: 28, letterSpacing: -0.3 },
  sub: { marginTop: 6, opacity: 0.78 },

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
    aspectRatio: "16 / 9",
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
    marginBottom: 12,
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
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(255,255,255,0.9)",
    cursor: "pointer",
  },

  rubricBarOpen: {
    background: "rgba(255,255,255,1)",
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
