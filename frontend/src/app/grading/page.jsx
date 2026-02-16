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

const DEFAULT_MAX_W = 1800;
const DEFAULT_QUALITY = 0.85;

const DEFAULT_RUBRIC_INSTRUCTIONS = `
You are a teacher grading student assignments from photos.
Grade for: completeness, accuracy, clarity, and effort.

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
  { value: "witty_light", label: "Witty (light)" },
  { value: "standards", label: "Standards-based (rubric language)" },
  { value: "student_friendly", label: "Student-friendly (simple wording)" },
];

const VOICE_KEY = "curriculate_grading_voice_v1";
const VOICE_OVERRIDE_KEY = "curriculate_grading_voice_override_v1";
const VOICE_OVERRIDE_VALUE_KEY = "curriculate_grading_voice_override_value_v1";
const SESSION_ID_KEY = "curriculate_session_id_v1";

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

function formatTeacherBlock(a, ref) {
  const deductions = Array.isArray(a?.deductions) ? a.deductions : [];
  const strengths = toArrayStrings(a?.strengths);
  const improvements = toArrayStrings(a?.improvements);
  const teacherComment = (a?.teacher_comment || "").trim();

  const lines = [];
  const g = getDisplayScore(a);
  lines.push(
    `Grade: ${g.score !== "" ? g.score : "(not provided)"} / ${g.outOf}${ref ? `  Ref: ${ref}` : ""}`
  );

  if (deductions.length) {
    lines.push("");
    lines.push("Deduction:");
    // “deduct once” => show first reason (or combine if you prefer)
    const d0 = deductions[0];
    const reason = (d0?.reason || "").trim();
    lines.push(`- ${reason} ${formatPoints(d0?.points)}`.trim());
  }

  if (strengths.length) {
    lines.push("");
    lines.push("Strengths:");
    for (const s of strengths) lines.push(`- ${s}`);
  }

  if (improvements.length) {
    lines.push("");
    lines.push("Next Steps:");
    for (const i of improvements) lines.push(`- ${i}`);
  }

  if (teacherComment) {
    lines.push("");
    lines.push("Overall Comment:");
    lines.push(teacherComment);
  }

  return lines.join("\n");
}

  const SESSION_KEY = "curriculate_grading_session_v1";

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
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

  export default function GradingPage() {
    const [sessionItems, setSessionItems] = useState(() => {
      if (typeof window === "undefined") return [];
      return loadSession();
    });
    const [copyEnabled, setCopyEnabled] = useState(false);

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

    // Persist
    useEffect(() => saveLS(VOICE_KEY, voice), [voice]);
    useEffect(() => saveLS(VOICE_OVERRIDE_KEY, voiceOverrideOn ? "1" : "0"), [voiceOverrideOn]);
    useEffect(() => saveLS(VOICE_OVERRIDE_VALUE_KEY, voiceOverride), [voiceOverride]);

    // Learning Recommendations
    const [sessionSummary, setSessionSummary] = useState(""); // was null object
    const [sessionSummaryError, setSessionSummaryError] = useState("");
    const [summarizingSession, setSummarizingSession] = useState(false);
    
    // Copy UX
    const [copied, setCopied] = useState(false);
    const [copiedFlash, setCopiedFlash] = useState(false); 
    // 3-digit reference code per result (shown + copied)
    const [refCode, setRefCode] = useState("");

    function genRef3() {
      // 100–999 (always 3 digits)
      return String(Math.floor(100 + Math.random() * 900));
    }

    const backendBase = useMemo(
      () => stripTrailingSlash(process.env.NEXT_PUBLIC_BACKEND_URL),
      []
    );

    const gradingUrl = useMemo(() => {
      if (!backendBase) return "";
      return `${backendBase.replace(/\/$/, "")}/grading`;
    }, [backendBase]);

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
      return assessment ? formatTeacherBlock(assessment, refCode) : "";
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

    useEffect(() => {
      startCamera({ front: false });
      return () => stopCamera();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // for double-tap capture to capture and submit
    const lastCaptureTapRef = useRef(0);
    const captureTapTimerRef = useRef(null);

    useEffect(() => {
      return () => {
        if (captureTapTimerRef.current) clearTimeout(captureTapTimerRef.current);
      };
    }, []);

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

        const compressed = await compressDataUrlToJpeg(
          rawDataUrl,
          DEFAULT_MAX_W,
          DEFAULT_QUALITY
        );

        const id =
          (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
          String(Date.now()) + "_" + Math.random().toString(16).slice(2);

        const photoObj = { id, dataUrl: compressed, createdAt: Date.now() };

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
      setRefCode(""); // ✅ reset ref

      // ✅ reset submission lock state
      setCopyEnabled(false);
    }

    async function submitForGrading(photosOverride = null) {
      setSubmitError("");
      setServerText("");
      setCopied(false);
      setCopyEnabled(false); // lock during submission
      setRefCode(""); // ✅ new submission => new ref (generated when assessment arrives)

      if (!gradingUrl) {
        setSubmitError("Missing NEXT_PUBLIC_BACKEND_URL. Set it in Vercel and redeploy.");
        return;
      }

      const photosToUse = Array.isArray(photosOverride) ? photosOverride : photos;

      if (!photosToUse.length) {
        setSubmitError("Capture at least one photo before submitting.");
        return;
      }

      setSubmitting(true);
      try {
        const ro = (rubricOverride || "").trim();
        const images = await Promise.all(
          photosToUse.map(async (p) => compressDataUrlToJpeg(p.dataUrl))
        );

        const payload = {
          images,
          rubricOverride: ro.length ? ro : null,
          gradeBand,
          meta: {
            sessionId: getSessionId(),
            source: "web-grading-page",
            capturedCount: photosToUse.length,
            capturedAt: Date.now(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",

            // NEW: feedback voice controls
            feedbackVoiceMode: voiceOverrideOn ? "override" : "default",
            feedbackVoice: voiceOverrideOn ? voiceOverride : voice,
          },
        };

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
        
        if (norm.assessment) {
          // ✅ generate ref immediately (not in useEffect)
          setRefCode((prev) => prev || genRef3());
          setCopyEnabled(true);
        } else {
          setCopyEnabled(false);
        }

        // Optional: treat override as one-time
        if (voiceOverrideOn) setVoiceOverrideOn(false);

        if (!res.ok) {
          if (norm.assessment) {
            setSubmitError("");
            return;
          }

          const msg =
            parsed?.details ||
            parsed?.error ||
            `HTTP ${res.status} from grading endpoint`;
          throw new Error(msg);
        }

      } 
        catch (err) {
        setCopyEnabled(false);
        console.error("Submit error:", err);
        setSubmitError(err?.message || "Network error submitting for grading.");
      } finally {
        setSubmitting(false);
      }
    }

    async function toggleCamera() {
      const next = !usingFrontCamera; 
      setUsingFrontCamera(next);
      await startCamera({ front: next });
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

      const payload = {
        gradeBand,
        rubricOverride: (rubricOverride || "").trim() || null,
        evidence,
        meta: {
          feedbackVoiceMode: voiceOverrideOn ? "override" : "default",
          feedbackVoice: voiceOverrideOn ? voiceOverride : voice,
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();

      if (!res.ok) {
        const parsed = safeJsonParse(text); // might be JSON error payload
        const msg = parsed?.details || parsed?.error || `HTTP ${res.status} from session-summary`;
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
        setSubmitError("Copy session failed—your browser may block clipboard access.");
      } finally {
        setSummarizingSession(false);
      }
    }

    async function copyFormatted() {
      if (!assessment || !copyEnabled) return;
      
      setCopyEnabled(false);
      
      const links = getAssignmentImagesFromAssessment(assessment);

    // ---------- Plain text (fallback) ----------
      const lines = [];
      const g = getDisplayScore(assessment);
        if (g.score !== "") {
          lines.push(`Grade: ${g.score} / ${g.outOf}${refCode ? `  Ref: ${refCode}` : ""}`);
          lines.push("");
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

      if ((assessment.teacher_comment || "").trim()) {
        lines.push("Overall Comment:");
        lines.push(String(assessment.teacher_comment).trim());
        lines.push("");
      }

      if (links.length) {
        lines.push("Saved captures (30-day links):");
        links.forEach((img) => lines.push(`Photo ${img.index}: ${img.url}`));
        lines.push("");
      }
      
      const htmlParts = [];

      // ---------- HTML (pretty clickable links) ----------
      htmlParts.push(
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
          ${(() => {
            const g = getDisplayScore(assessment);
            return `<div><b>Grade:</b> ${escapeHtml(g.score)} / ${escapeHtml(g.outOf)}${refCode ? ` <span style="opacity:0.8; margin-left:10px;"><b>Ref:</b> ${escapeHtml(refCode)}</span>` : ""}</div>`;
          })()}
        </div>`
      );
      
      if (Array.isArray(assessment.sections) && assessment.sections.length) {
        htmlParts.push(
          `<div style="margin-top:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Sections:</b>
            <ul style="margin:6px 0 0 18px; padding:0;">
              ${assessment.sections.map((sec) => {
                const secHeader = `
                  <div>
                    <b>${escapeHtml(sec.name)}:</b>
                    ${escapeHtml(sec.score)}/${escapeHtml(sec.out_of)}
                    ${String(sec.teacher_comment || "").trim()
                      ? ` — ${escapeHtml(String(sec.teacher_comment).trim())}`
                      : ""}
                  </div>
                `;

                const incorrect =
                  Array.isArray(sec.incorrect_items) && sec.incorrect_items.length
                    ? `<div style="margin-top:6px; font-size:12px; opacity:0.9;">
                        <b>Incorrect items:</b>
                        <ul style="margin:6px 0 0 18px; padding:0;">
                          ${sec.incorrect_items
                            .slice(0, 20)
                            .map((it, idx) => formatIncorrectItemHtml(it, idx, escapeHtml))
                            .join("")}
                          ${sec.incorrect_items.length > 20
                            ? `<li style="opacity:0.75;">(+ ${sec.incorrect_items.length - 20} more…)</li>`
                            : ""}
                        </ul>
                      </div>`
                    : "";

                return `<li style="margin:6px 0;">${secHeader}${incorrect}</li>`;
              }).join("")}
            </ul>
          </div>`
        );
      }

      if (Array.isArray(assessment.sections) && assessment.sections.length) {
        lines.push("Sections:");
        assessment.sections.forEach((sec) => {
          lines.push(`- ${sec.name}: ${sec.score}/${sec.out_of}${sec.teacher_comment ? ` — ${String(sec.teacher_comment).trim()}` : ""}`);

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

      const plainText = lines.join("\n").trim();

      if (assessment.strengths?.length) {
        htmlParts.push(
          `<div style="margin-top:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Strengths:</b>
            <ul>${assessment.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
          </div>`
        );
      }

      if (assessment.improvements?.length) {
        htmlParts.push(
          `<div style="margin-top:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Next Steps:</b>
            <ul>${assessment.improvements.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
          </div>`
        );
      }

      if ((assessment.teacher_comment || "").trim()) {
        htmlParts.push(
          `<div style="margin-top:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Overall Comment:</b>
            <div>${escapeHtml(String(assessment.teacher_comment).trim())}</div>
          </div>`
        );
      }

      if (links.length) {
        htmlParts.push(
          `<div style="margin-top:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
            <b>Saved captures (30-day links):</b>
            <ul>
              ${links
                .map(
                  (img) =>
                    `<li><a href="${img.url}" target="_blank" rel="noreferrer">Photo ${img.index}</a></li>`
                )
                .join("")}
            </ul>
          </div>`
        );
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

    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.h1}>Grading</h1>
          <div style={styles.sub}>Capture tests, quizzes, essays, posters, math sheets, even art, then submit for an assessment using the built-in rubric or your own.</div>
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
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            style={styles.select}
            title="Sets the default tone of feedback"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ ...styles.controlLabel, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 }}>
          <input
            type="checkbox"
            checked={voiceOverrideOn}
            onChange={(e) => setVoiceOverrideOn(e.target.checked)}
            style={{ transform: "scale(1.1)" }}
          />
          <span style={{ fontWeight: 900, fontSize: 12, opacity: 0.9 }}>Override for this assessment</span>
        </label>

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
              <div style={styles.cardTitle}>Camera</div>
              <button
                onClick={toggleCamera}
                style={styles.secondaryBtn}
                disabled={submitting}
                title="Switch camera"
              >
                Switch
              </button>
            </div>

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
              >
                {busyCapture ? "Capturing…" : "Capture Photo"}
              </button>
              <button
                onClick={clearAll}
                style={styles.secondaryBtn}
                disabled={submitting || busyCapture || (!photos.length && !serverText)}
              >
                Clear
              </button>
            </div>

            <div style={styles.photoMeta}>
              <div>
                <b>Photos:</b> {photos.length}
              </div>
              <div style={{ opacity: 0.8 }}>
                Tip: Keep pages flat, fill the frame, avoid glare. Single tap = capture. Double tap = capture + submit.
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
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SUBMIT + RESPONSE CARD */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>Submit</div>

            <div style={styles.note}>
              <div>
                <b>Endpoint:</b> {gradingUrl || "(not set)"}
              </div>
              {!backendBase && (
                <div style={styles.warn}>
                  Missing <code>NEXT_PUBLIC_BACKEND_URL</code> — set it in Vercel and redeploy.
                </div>
              )}
            </div>

            {/* Rubric override card */}
            <div style={styles.rubricCard}>
              <div style={styles.rubricHeader}>
                <div>
                  <div style={{ fontWeight: 800 }}>Rubric (optional)</div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                    Leave blank to use the default rubric.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => setShowRubric((v) => !v)}
                    style={styles.secondaryBtn}
                    type="button"
                  >
                    {showRubric ? "Hide" : "Show"}
                  </button>
                  <button
                    onClick={useDefaultRubric}
                    style={styles.secondaryBtn}
                    disabled={!rubricOverride.trim().length}
                    type="button"
                    title="Clear override"
                  >
                    Use Default
                  </button>
                </div>
              </div>

              {showRubric && (
                <>
                  <textarea
                    value={rubricOverride}
                    onChange={(e) => setRubricOverride(e.target.value)}
                    placeholder={`Paste a teacher rubric here (optional)...\n\nExamples:\n- Mark out of 10\n- Focus on understanding, relevance, completion\n- Mechanics secondary\n- Deduct 1 total if any formatting missing\n- 2–3 sentence teacher comment\n`}
                    rows={9}
                    style={styles.rubricTextarea}
                  />
                  <details style={styles.rubricDetails}>
                    <summary style={styles.rubricSummary}>View default rubric</summary>
                    <pre style={styles.rubricPre}>{DEFAULT_RUBRIC_INSTRUCTIONS}</pre>
                  </details>
                  <div style={styles.rubricTip}>
                    Tip: keep rubrics short (a few bullets). Long rubrics increase cost and latency.
                  </div>
                </>
              )}
            </div>

            <div style={styles.btnRow}>
              <button
                onClick={submitForGrading}
                style={styles.primaryBtn}
                disabled={submitting || !photos.length || !gradingUrl}
              >
                {submitting ? "Submitting…" : "Submit for Grading"}
              </button>
              <button onClick={copySession} disabled={!sessionItems.length || summarizingSession} style={styles.secondaryBtn}>
                {summarizingSession ? `Analyzing… (${sessionItems.length})` : `Copy Session (${sessionItems.length})`}
              </button>
              <button
                onClick={() => setSessionItems([])}
                disabled={!sessionItems.length}
                style={styles.ghostBtn}
              >
                Clear Session
              </button>

            </div>

            {submitError && (
              <div style={styles.errorBox}>
                <b>Error:</b> {submitError}
              </div>
            )}

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
                {assessment && (
                  <button
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(assessment, null, 2))}
                    style={styles.secondaryBtn}
                  >
                    Copy JSON
                  </button>
                )}
              </div>
            </div>

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
                            {refCode ? <span style={{ opacity: 0.8, marginLeft: 10 }}>Ref: {refCode}</span> : null}
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
                <div style={{ opacity: 0.75 }}>Results will appear here after submission.</div>
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
  gradingComment: { fontSize: 13, lineHeight: 1.45 },
  gradingHint: { fontSize: 12, opacity: 0.7, marginTop: 4 },

  softWarn: {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.75,
  },

  footerHint: { marginTop: 12, fontSize: 12, opacity: 0.7 },
};
