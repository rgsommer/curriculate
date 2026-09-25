"use client";

/**
 * HomeworkCheck — "who actually did the homework?" mode.
 *
 * Different problem from rubric grading. The student works in a printed
 * workbook (or a notebook): the questions are printed, only the answers are
 * handwritten. The teacher shoots the room continuously on the phone's native
 * camera and uploads the batch afterwards. There is no in-app capture here by
 * design — interacting with the app between photos is what makes the lap slow.
 *
 * Flow:
 *   0. Assignment page   1-3 photos of the textbook page → questions + labels the batch
 *      Subset            All / Odds / Evens / custom — the app can't infer what was set
 *      Coverage          "key covers 6 of your 12" BEFORE the teacher shoots anything
 *   1. Upload            EXIF-ordered, downscaled, resumable, per-photo progress
 *   2. Contact sheet     name-delimited groups; drag to fix before anything is graded
 *   3. Results           completeness /10 and correctness /10, never merged
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPdf, pdfToDataUrls } from "./pdfToImages";
import HomeworkCapture from "./HomeworkCapture";

// Build the student groups straight from in-app capture, where every photo was
// attributed the moment it was taken. Keyed by student rather than by runs of
// consecutive photos, so going back to a student you'd moved past adds to their
// group instead of creating a second one for the same person.
function groupsFromCapture(attrib) {
  const byStudent = new Map();
  attrib.forEach((stu, idx) => {
    const key = stu?.edsbyId || stu?.studentId
      || `${stu?.firstName || ""}|${stu?.lastName || ""}`.toLowerCase();
    if (!byStudent.has(key)) {
      byStudent.set(key, {
        studentName: `${stu?.firstName || ""} ${stu?.lastName || ""}`.trim(),
        studentId: stu?.studentId || "",
        edsbyId: stu?.edsbyId || "",
        nameAsWritten: "",   // nothing was read off the page — the teacher said who this is
        matched: true,
        matchConfidence: 1,
        superseded: false,
        photoIndexes: [],
      });
    }
    byStudent.get(key).photoIndexes.push(idx);
  });
  return [...byStudent.values()];
}

// Turn a mixed pick of photos and PDFs into page images. A PDF becomes one
// image per page, so a key or a textbook page that already exists as a PDF
// doesn't have to be exported to images by hand first.
async function filesToPageImages(files, { maxEdge = 2000, maxPages = 40, downscale, onNote } = {}) {
  const images = [];
  for (const f of files) {
    if (isPdf(f)) {
      const { dataUrls, skipped } = await pdfToDataUrls(f, { maxEdge, maxPages });
      images.push(...dataUrls);
      if (skipped) onNote?.(`${f.name}: only the first ${maxPages} pages were used (${skipped} skipped).`);
    } else {
      const { dataUrl } = await downscale(f, maxEdge);
      images.push(dataUrl);
    }
  }
  return images;
}

// Long edge, in px, that photos are downscaled to before upload. A textbook
// page at 1600px still reads handwriting clearly; the originals are 3-4k and a
// 50-photo lap at full resolution will not survive school wifi.
const TARGET_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const MAX_PHOTOS = 200;
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_RETRIES = 3;

const SUBSET_MODES = [
  { value: "all", label: "All" },
  { value: "odds", label: "Odds" },
  { value: "evens", label: "Evens" },
  { value: "custom", label: "Custom" },
];

/* ------------------------------------------------------------------ */
/*  EXIF — capture time                                               */
/* ------------------------------------------------------------------ */

/**
 * Pull DateTimeOriginal out of a JPEG's EXIF block.
 *
 * Photo pickers hand files over sorted by NAME, and iPhone filenames
 * (IMG_0412, IMG_0413…) do not reliably reflect shooting order once you've
 * deleted and reshot a few. Ordering is load-bearing here: the whole grouping
 * model assumes photos are in the order they were taken.
 *
 * Deliberately hand-rolled rather than pulling in a dependency — we need
 * exactly one tag. Returns ms since epoch, or null.
 */
async function readExifCaptureTime(file) {
  try {
    // EXIF lives near the front; 256 KB is far more than enough.
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(head);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      if (marker === 0xe1) {
        // APP1 — check for the "Exif\0\0" signature
        const sigStart = offset + 4;
        if (view.getUint32(sigStart) !== 0x45786966) return null;
        const tiff = sigStart + 6;
        const little = view.getUint16(tiff) === 0x4949;
        const get16 = (p) => view.getUint16(p, little);
        const get32 = (p) => view.getUint32(p, little);
        if (get16(tiff + 2) !== 0x002a) return null;

        const ifd0 = tiff + get32(tiff + 4);
        const readAscii = (p, len) => {
          let s = "";
          for (let i = 0; i < len - 1; i++) s += String.fromCharCode(view.getUint8(p + i));
          return s;
        };

        // Walk IFD0 looking for the ExifIFD pointer (0x8769), then walk that
        // for DateTimeOriginal (0x9003). Fall back to IFD0's DateTime (0x0132).
        const scanIfd = (ifdStart, wanted) => {
          const count = get16(ifdStart);
          for (let i = 0; i < count; i++) {
            const entry = ifdStart + 2 + i * 12;
            if (entry + 12 > view.byteLength) break;
            const tag = get16(entry);
            if (tag !== wanted) continue;
            const type = get16(entry + 2);
            const num = get32(entry + 4);
            const valOff = num > 4 ? tiff + get32(entry + 8) : entry + 8;
            if (type === 2 && valOff + num <= view.byteLength) return readAscii(valOff, num);
            if (type === 4) return get32(entry + 8);
          }
          return null;
        };

        let dateStr = null;
        const exifPtr = scanIfd(ifd0, 0x8769);
        if (typeof exifPtr === "number") {
          dateStr = scanIfd(tiff + exifPtr, 0x9003);
        }
        if (!dateStr) dateStr = scanIfd(ifd0, 0x0132);
        if (typeof dateStr !== "string") return null;

        // EXIF format: "YYYY:MM:DD HH:MM:SS"
        const m = dateStr.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
      }
      if (marker === 0xda) break; // start of scan — EXIF is behind us
      offset += 2 + size;
    }
  } catch {
    // Any parse failure just means we fall back to lastModified.
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Downscale                                                          */
/* ------------------------------------------------------------------ */

/**
 * Decode + downscale a photo to a JPEG data URL.
 *
 * HEIC is the iPhone default. Safari and Chrome-on-macOS decode it natively in
 * an <img>, which is the common case here (teacher on an iPhone or a Mac).
 * Where the browser can't decode it we say so per-file rather than silently
 * uploading something that won't grade.
 */
async function downscaleToDataUrl(file, longEdge = TARGET_LONG_EDGE) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("decode_failed"));
      im.src = url;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("decode_failed");

    const scale = Math.min(1, longEdge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cw, ch);
    return { dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), width: cw, height: ch };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ */
/*  Photo quality heuristics                                           */
/* ------------------------------------------------------------------ */

/**
 * Cheap blur/darkness check on the already-downscaled image, so the teacher
 * hears about a bad shot while still standing in the room.
 *
 * Blur = variance of a Laplacian over a grayscale downsample. Darkness = mean
 * luminance. Both are heuristics with honest thresholds; they flag for a look,
 * they don't reject.
 */
function assessQuality(dataUrl) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      try {
        const S = 160;
        const c = document.createElement("canvas");
        c.width = S;
        c.height = S;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(im, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);

        const gray = new Float32Array(S * S);
        let sum = 0;
        for (let i = 0; i < S * S; i++) {
          const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
          gray[i] = g;
          sum += g;
        }
        const mean = sum / (S * S);

        // 3x3 Laplacian, variance of the response
        let lSum = 0;
        let lSq = 0;
        let n = 0;
        for (let y = 1; y < S - 1; y++) {
          for (let x = 1; x < S - 1; x++) {
            const i = y * S + x;
            const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - S] - gray[i + S];
            lSum += v;
            lSq += v * v;
            n++;
          }
        }
        const lMean = lSum / n;
        const variance = lSq / n - lMean * lMean;

        const issues = [];
        if (variance < 60) issues.push("looks blurry");
        if (mean < 55) issues.push("looks too dark");
        if (mean > 225) issues.push("looks blown out");
        resolve({ variance, mean, issues });
      } catch {
        resolve({ variance: null, mean: null, issues: [] });
      }
    };
    im.onerror = () => resolve({ variance: null, mean: null, issues: [] });
    im.src = dataUrl;
  });
}

/* ------------------------------------------------------------------ */
/*  CSV helpers                                                        */
/* ------------------------------------------------------------------ */

// Neutralises spreadsheet formula injection, same guard the other exports use.
function escCsv(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function downloadText(text, filename, mime = "text/csv") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function HomeworkCheck({
  gradingUrl,
  teacherEmail: parentTeacherEmail,
  rosterClasses: parentRosterClasses,
  onClose,
}) {
  const backendBase = useMemo(
    () => (gradingUrl || "").replace(/\/grading$/, ""),
    [gradingUrl]
  );
  const hwUrl = (path) => `${backendBase}/homework${path}`;

  const [teacherEmail, setTeacherEmail] = useState(parentTeacherEmail || "");
  useEffect(() => {
    if (parentTeacherEmail) setTeacherEmail(parentTeacherEmail);
    else {
      try {
        const v = localStorage.getItem("curriculate_report_email") || "";
        if (v) setTeacherEmail(v);
      } catch {}
    }
  }, [parentTeacherEmail]);

  // ---- roster ----
  const [rosterClasses, setRosterClasses] = useState(parentRosterClasses || []);
  useEffect(() => {
    if (parentRosterClasses?.length) { setRosterClasses(parentRosterClasses); return; }
    if (!teacherEmail || !backendBase) return;
    let cancelled = false;
    fetch(`${backendBase}/class-roster/list?teacherEmail=${encodeURIComponent(teacherEmail)}`)
      .then((r) => (r.ok ? r.json() : { rosters: [] }))
      .then((d) => { if (!cancelled) setRosterClasses(d.rosters || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [teacherEmail, backendBase, parentRosterClasses]);

  const [className, setClassName] = useState("");
  useEffect(() => {
    // Remember the last class used for Homework Check.
    try {
      const v = localStorage.getItem("curriculate_hw_class_v1");
      if (v) setClassName(v);
    } catch {}
  }, []);
  useEffect(() => {
    if (className) { try { localStorage.setItem("curriculate_hw_class_v1", className); } catch {} }
  }, [className]);

  const roster = useMemo(() => {
    const rc = rosterClasses.find((r) => r.className === className);
    return rc?.students || [];
  }, [rosterClasses, className]);

  // Optional free-text label. The lesson code alone is enough to identify a
  // batch; this is for when a code isn't what you'd recognise it by later.
  const [assignmentName, setAssignmentName] = useState("");
  const [bookName, setBookName] = useState("");
  useEffect(() => {
    try { const v = localStorage.getItem("curriculate_hw_book_v1"); if (v) setBookName(v); } catch {}
  }, []);
  useEffect(() => {
    if (bookName) { try { localStorage.setItem("curriculate_hw_book_v1", bookName); } catch {} }
  }, [bookName]);

  // ---- phase 0: assignment page ----
  const [assignment, setAssignment] = useState(null); // {lessonCode,pageLabel,questions,workType,...}
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [lessonCode, setLessonCode] = useState("");
  const assignmentInputRef = useRef(null);

  const [subsetMode, setSubsetMode] = useState("all");
  const [customSubset, setCustomSubset] = useState("");
  const [workSurface, setWorkSurface] = useState("workbook");

  const assignedQuestions = useMemo(() => {
    if (!assignment?.questions?.length) return [];
    const all = [];
    for (const q of assignment.questions) {
      if (q.parts?.length) for (const p of q.parts) all.push(`${q.number}${p}`);
      else all.push(String(q.number));
    }
    if (subsetMode === "custom") {
      // Mirror the server's parser closely enough for a live preview.
      const out = [];
      let text = customSubset.trim();
      if (text.includes(":")) text = text.slice(text.lastIndexOf(":") + 1);
      text = text.replace(/\((\s*[a-z]\s*)\)/gi, (_m, g) => g.trim());
      for (const tok of text.split(/[,;]+|\s+/).map((t) => t.trim()).filter(Boolean)) {
        const t = tok.replace(/\./g, "").replace(/[–—]/g, "-").toLowerCase();
        let m = t.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
          const a = +m[1]; const b = +m[2];
          if (b >= a && b - a <= 60) for (let i = a; i <= b; i++) out.push(String(i));
          continue;
        }
        m = t.match(/^(\d+)([a-z]+)$/);
        if (m) { for (const L of m[2].split("")) out.push(`${m[1]}${L}`); continue; }
        m = t.match(/^(\d+)$/);
        if (m) out.push(m[1]);
      }
      return [...new Set(out)];
    }
    const numOf = (l) => parseInt(String(l).match(/^(\d+)/)?.[1] ?? "", 10);
    if (subsetMode === "odds") return all.filter((l) => numOf(l) % 2 === 1);
    if (subsetMode === "evens") return all.filter((l) => numOf(l) % 2 === 0);
    return all;
  }, [assignment, subsetMode, customSubset]);

  // On printed pages the questions are in the students' own photos, so a list
  // is a refinement rather than a requirement — the model reads the questions
  // off the page. On loose paper they are nowhere in the images, so without a
  // list there is genuinely nothing to report against.
  const canRunCheck = assignedQuestions.length > 0 || workSurface !== "loose";

  // ---- key coverage ----
  const [coverage, setCoverage] = useState(null);
  // Which key this check marks against, chosen rather than inferred.
  const [answerKeyId, setAnswerKeyId] = useState("");
  const [coverageBusy, setCoverageBusy] = useState(false);
  useEffect(() => {
    if (!assignedQuestions.length || !backendBase) { setCoverage(null); return; }
    let cancelled = false;
    setCoverageBusy(true);
    fetch(hwUrl("/coverage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacherEmail, bookName,
        lessonCode: lessonCode || assignment?.lessonCode || "",
        assignedQuestions, answerKeyId,
        workType: assignment?.workType || "unknown",
      }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCoverage(d?.ok ? d : null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCoverageBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedQuestions, lessonCode, bookName, teacherEmail, backendBase, assignment?.workType, answerKeyId]);

  async function readAssignmentPage(files) {
    const list = Array.from(files || []).slice(0, 3);
    if (!list.length) return;
    setAssignmentBusy(true);
    setAssignmentError("");
    try {
      // A bit sharper than the photo path — we're reading printed text. A PDF
      // is capped at 3 pages here because /assignment accepts at most 3.
      const images = (await filesToPageImages(list, {
        maxEdge: 2000, maxPages: 3, downscale: downscaleToDataUrl,
      })).slice(0, 3);
      if (!images.length) throw new Error("Nothing readable in that file.");
      const res = await fetch(hwUrl("/assignment"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setAssignment(data);
      if (data.lessonCode) setLessonCode(data.lessonCode);
    } catch (err) {
      setAssignmentError(err?.message || "Could not read the assignment page.");
    } finally {
      setAssignmentBusy(false);
    }
  }

  // ---- answer key ----
  const [keys, setKeys] = useState([]);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [keyDeleting, setKeyDeleting] = useState("");
  const keyInputRef = useRef(null);

  const refreshKeys = useCallback(() => {
    if (!teacherEmail || !backendBase) return;
    fetch(hwUrl(`/answer-key/list?teacherEmail=${encodeURIComponent(teacherEmail)}`))
      .then((r) => r.json())
      .then((d) => setKeys(d?.keys || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherEmail, backendBase]);
  useEffect(() => { refreshKeys(); }, [refreshKeys]);

  // One key on file is not a choice — select it. And a selection that has been
  // deleted must not linger, or the check would silently mark against nothing.
  useEffect(() => {
    if (keys.length === 1 && !answerKeyId) { setAnswerKeyId(keys[0].id); return; }
    if (answerKeyId && !keys.some((k) => k.id === answerKeyId)) setAnswerKeyId("");
  }, [keys, answerKeyId]);

  async function deleteAnswerKey(k) {
    const id = k?._id || k?.id;
    if (!id || !teacherEmail) return;
    const label = k.lessonCode || "this key";
    if (!confirm(`Remove the answer key for ${label}? Grading already done is unaffected.`)) return;
    setKeyDeleting(id);
    setKeyMsg("");
    try {
      const res = await fetch(
        hwUrl(`/answer-key/${encodeURIComponent(id)}?teacherEmail=${encodeURIComponent(teacherEmail)}`),
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setKeyMsg(data.deleted ? `Removed the key for ${label}.` : "That key was already gone.");
      refreshKeys();
    } catch (err) {
      setKeyMsg(err?.message || "Could not remove that key.");
    } finally {
      setKeyDeleting("");
    }
  }

  async function uploadAnswerKey(files) {
    const list = Array.from(files || []).slice(0, 40);
    if (!list.length) return;
    if (!teacherEmail) { setKeyMsg("Add your email above first — keys are stored per teacher."); return; }
    setKeyBusy(true);
    setKeyMsg("");
    try {
      let note = "";
      const images = await filesToPageImages(list, {
        maxEdge: 2000, maxPages: 40,
        downscale: downscaleToDataUrl,
        onNote: (m) => { note = m; },
      });
      if (!images.length) throw new Error("Nothing readable in that file.");
      const res = await fetch(hwUrl("/answer-key"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherEmail, bookName, images }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setKeyMsg(
        `Saved ${data.lessons.length} lesson(s): ${data.lessons.map((l) => l.lessonCode).join(", ")}`
        + (note ? ` — ${note}` : "")
      );
      refreshKeys();
    } catch (err) {
      setKeyMsg(err?.message || "Answer-key upload failed.");
    } finally {
      setKeyBusy(false);
    }
  }

  // ---- phase 1: upload ----
  const [photos, setPhotos] = useState([]); // [{ name, dataUrl, capturedAt, issues, status }]
  const [uploadId, setUploadId] = useState("");
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [prepMsg, setPrepMsg] = useState("");
  const batchInputRef = useRef(null);
  const cancelUploadRef = useRef(false);
  // In-app capture: the roster screen is open, and (once shot) who each photo
  // belongs to, parallel to `photos`. Null means these photos came from files
  // and still need the name-reading grouping pass.
  const [showCapture, setShowCapture] = useState(false);
  const [captureAttrib, setCaptureAttrib] = useState(null);

  function acceptCapture(shots) {
    setShowCapture(false);
    if (!shots?.length) return;
    setPhotos(shots.map((s, i) => ({
      name: `capture-${String(i + 1).padStart(2, "0")}.jpg`,
      dataUrl: s.dataUrl,
      capturedAt: s.capturedAt,
      issues: [],
      status: "pending",
    })));
    setCaptureAttrib(shots.map((s) => s.student));
    // A fresh set of photos invalidates any previous upload and grouping.
    setUploadId("");
    setGroups(null);
    setGroupMeta(null);
    setUploadError("");
  }

  async function prepareFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (list.length > MAX_PHOTOS) {
      setUploadError(`That's ${list.length} photos — the cap is ${MAX_PHOTOS} in one batch.`);
      return;
    }
    setUploadError("");
    // These came from files, so they carry no attribution — grouping has to
    // read the names off the pages as before.
    setCaptureAttrib(null);
    setPrepMsg(`Reading ${list.length} photos…`);

    // 1) Capture time from EXIF, so we sort by when it was shot, not by filename.
    const withTimes = [];
    for (const f of list) {
      const exif = await readExifCaptureTime(f);
      withTimes.push({ file: f, capturedAt: exif ?? f.lastModified ?? 0, hadExif: exif != null });
    }
    withTimes.sort((a, b) => a.capturedAt - b.capturedAt);
    const noExifCount = withTimes.filter((w) => !w.hadExif).length;

    // 2) Downscale + quality check.
    const out = [];
    const failed = [];
    for (let i = 0; i < withTimes.length; i++) {
      const w = withTimes[i];
      setPrepMsg(`Preparing photo ${i + 1} of ${withTimes.length}…`);
      try {
        const { dataUrl } = await downscaleToDataUrl(w.file);
        const q = await assessQuality(dataUrl);
        out.push({
          name: w.file.name,
          dataUrl,
          capturedAt: w.capturedAt,
          issues: q.issues,
          status: "pending",
        });
      } catch {
        failed.push(w.file.name);
      }
    }

    setPhotos(out);
    setPrepMsg("");
    const notes = [];
    if (noExifCount) {
      notes.push(
        `${noExifCount} photo(s) had no capture time in their EXIF — those fell back to file date, so double-check their order on the contact sheet.`
      );
    }
    if (failed.length) {
      notes.push(
        `${failed.length} file(s) couldn't be decoded by this browser (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}). If they're HEIC, open this page in Safari or export them as JPEG.`
      );
    }
    if (notes.length) setUploadError(notes.join(" "));
  }

  async function startUpload(resume = false) {
    if (!photos.length) return;
    setUploading(true);
    setUploadError("");
    cancelUploadRef.current = false;

    try {
      let id = uploadId;
      if (!resume || !id) {
        const res = await fetch(hwUrl("/upload/init"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teacherEmail, expected: photos.length }),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not start the upload.");
        id = data.uploadId;
        setUploadId(id);
        setPhotos((prev) => prev.map((p) => ({ ...p, status: "pending" })));
      }

      // Which indexes still need sending (resume-aware).
      const todo = [];
      photos.forEach((p, i) => { if (p.status !== "sent") todo.push(i); });
      setUploadProgress({ done: photos.length - todo.length, total: photos.length });

      let cursor = 0;
      let done = photos.length - todo.length;

      const sendOne = async (idx) => {
        const p = photos[idx];
        for (let attempt = 0; attempt < UPLOAD_RETRIES; attempt++) {
          if (cancelUploadRef.current) return false;
          try {
            const res = await fetch(hwUrl("/upload/photo"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                uploadId: id, index: idx, dataUrl: p.dataUrl, capturedAt: p.capturedAt,
              }),
            });
            if (res.ok) {
              setPhotos((prev) => prev.map((q, i) => (i === idx ? { ...q, status: "sent" } : q)));
              done += 1;
              setUploadProgress({ done, total: photos.length });
              return true;
            }
            // 404 means the session expired — no point retrying this photo.
            if (res.status === 404) throw new Error("expired");
          } catch (err) {
            if (String(err?.message) === "expired") throw err;
          }
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
        setPhotos((prev) => prev.map((q, i) => (i === idx ? { ...q, status: "failed" } : q)));
        return false;
      };

      const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, todo.length) }, async () => {
        while (cursor < todo.length) {
          if (cancelUploadRef.current) return;
          await sendOne(todo[cursor++]);
        }
      });
      await Promise.all(workers);

      if (cancelUploadRef.current) { setUploadError("Upload stopped. Tap Resume to carry on."); return; }

      const stillPending = photos.filter((_, i) => {
        const p = photos[i];
        return p.status !== "sent";
      });
      // Re-read state via a functional update to get the true post-upload view.
      setPhotos((prev) => {
        const bad = prev.filter((p) => p.status !== "sent").length;
        if (bad) {
          setUploadError(`${bad} photo(s) didn't upload. Tap Resume — only the missing ones are re-sent.`);
        }
        return prev;
      });
      void stillPending;
    } catch (err) {
      if (String(err?.message) === "expired") {
        setUploadId("");
        setUploadError("The upload session expired. Tap Upload to start it again.");
      } else {
        setUploadError(err?.message || "Upload failed.");
      }
    } finally {
      setUploading(false);
    }
  }

  const allUploaded = photos.length > 0 && photos.every((p) => p.status === "sent");

  // ---- phase 2: grouping ----
  const [groups, setGroups] = useState(null);
  const [groupMeta, setGroupMeta] = useState(null); // { warnings, missingStudents, modalPageCount, scans }
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState("");

  // Photos shot in the app are already attributed, so the grouping pass — which
  // exists to read a name off each page and guess the boundaries — has nothing
  // left to work out. Skip straight to the groups the teacher themselves gave.
  useEffect(() => {
    if (!captureAttrib || !allUploaded || groups) return;
    setGroups(groupsFromCapture(captureAttrib));
    setGroupMeta({ warnings: [], missingStudents: [], modalPageCount: null, scans: [], fromCapture: true });
  }, [captureAttrib, allUploaded, groups]);

  async function runGrouping() {
    if (!allUploaded) return;
    setGroupBusy(true);
    setGroupError("");
    try {
      const res = await fetch(hwUrl("/group"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, teacherEmail, className, roster }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setGroups(data.groups || []);
      setGroupMeta({
        warnings: data.warnings || [],
        missingStudents: data.missingStudents || [],
        modalPageCount: data.modalPageCount,
        scans: data.scans || [],
      });
    } catch (err) {
      setGroupError(err?.message || "Could not sort the batch.");
    } finally {
      setGroupBusy(false);
    }
  }

  // --- drag to fix grouping ---
  const dragRef = useRef(null); // { groupIndex, photoIndex }

  function movePhoto(fromGroup, photoIdx, toGroup) {
    if (fromGroup === toGroup) return;
    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, photoIndexes: [...g.photoIndexes] }));
      const from = next[fromGroup];
      const to = next[toGroup];
      if (!from || !to) return prev;
      const at = from.photoIndexes.indexOf(photoIdx);
      if (at < 0) return prev;
      from.photoIndexes.splice(at, 1);
      to.photoIndexes.push(photoIdx);
      to.photoIndexes.sort((a, b) => a - b);
      return next.filter((g) => g.photoIndexes.length);
    });
  }

  function splitAt(groupIndex, photoIdx) {
    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, photoIndexes: [...g.photoIndexes] }));
      const g = next[groupIndex];
      if (!g) return prev;
      const at = g.photoIndexes.indexOf(photoIdx);
      if (at <= 0) return prev; // already the first page of its group
      const moved = g.photoIndexes.splice(at);
      next.splice(groupIndex + 1, 0, {
        studentName: "", studentId: "", edsbyId: "", nameAsWritten: "",
        matched: false, matchConfidence: "none", superseded: false,
        photoIndexes: moved, notes: ["Split by hand"],
      });
      return next;
    });
  }

  function setGroupStudent(groupIndex, value) {
    // value is "firstName|lastName|studentId|edsbyId" or "" to clear
    setGroups((prev) => prev.map((g, i) => {
      if (i !== groupIndex) return g;
      if (!value) return { ...g, studentName: "", studentId: "", edsbyId: "", matched: false, matchConfidence: "none" };
      const [firstName, lastName, studentId, edsbyId] = value.split("|");
      return {
        ...g,
        studentName: `${firstName} ${lastName}`.trim(),
        studentId: studentId || "",
        edsbyId: edsbyId || "",
        matched: true,
        matchConfidence: "high",
      };
    }));
  }

  function toggleSuperseded(groupIndex) {
    setGroups((prev) => prev.map((g, i) => (i === groupIndex ? { ...g, superseded: !g.superseded } : g)));
  }

  // ---- phase 3: check ----
  const [job, setJob] = useState(null); // { status, progress, stage }
  const [result, setResult] = useState(null);
  const [checkError, setCheckError] = useState("");
  const pollRef = useRef(null);
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  async function runCheck() {
    if (!groups?.length) return;
    setCheckError("");
    setResult(null);
    setJob({ status: "processing", progress: 0, stage: "starting" });
    try {
      const res = await fetch(hwUrl("/check"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId, teacherEmail, className,
          lessonCode: lessonCode || assignment?.lessonCode || "",
          bookName,
          assignmentName,
          answerKeyId,
          assignedQuestions,
          subsetMode,
          workSurface,
          assignment: assignment
            ? {
                pageLabel: assignment.pageLabel,
                questions: assignment.questions,
                workType: assignment.workType,
                workTypeReason: assignment.workTypeReason,
                subjectGuess: assignment.subjectGuess,
              }
            : {},
          groups: groups.map((g) => ({
            studentName: g.studentName, studentId: g.studentId, edsbyId: g.edsbyId,
            nameAsWritten: g.nameAsWritten, matched: g.matched,
            matchConfidence: g.matchConfidence, superseded: g.superseded,
            photoIndexes: g.photoIndexes,
          })),
          roster,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      poll(data.jobId);
    } catch (err) {
      setJob(null);
      setCheckError(err?.message || "Could not start the check.");
    }
  }

  function poll(jobId) {
    const tick = async () => {
      try {
        const res = await fetch(hwUrl(`/check/job/${encodeURIComponent(jobId)}`));
        if (res.status === 404) throw new Error("The job expired. Please run the check again.");
        const data = await res.json();
        setJob({ status: data.status, progress: data.progress, stage: data.stage });
        if (data.status === "done") { setResult(data.result); setJob(null); return; }
        if (data.status === "error") { setCheckError(data.error || "Check failed."); setJob(null); return; }
        pollRef.current = setTimeout(tick, 2500);
      } catch (err) {
        setCheckError(err?.message || "Lost contact with the server.");
        setJob(null);
      }
    };
    pollRef.current = setTimeout(tick, 2000);
  }

  /* ---------------- exports ---------------- */

  function exportCsv() {
    if (!result?.results?.length) return;
    const header = [
      "Student", "Completeness /10", "Correctness /10", "Attempted", "Assigned",
      "Correct", "Checked against key", "Status", "Flags", "Per-question",
    ].map(escCsv).join(",");

    const rows = result.results.map((r) => {
      const perQ = (r.questions || [])
        .map((q) => `${q.q}:${q.work}${q.correct ? `/${q.correct}` : ""}`)
        .join(" ");
      const status = r.noPageFound ? "No page found"
        : r.superseded ? "Superseded retake"
        : r.unmatched ? "Unmatched"
        : "OK";
      return [
        r.studentName || r.nameAsWritten || "(unmatched)",
        r.completeness ?? "",
        r.correctness ?? "",
        r.attemptedCount ?? "",
        r.assignedCount ?? "",
        r.correctCount ?? "",
        r.keyedAttemptedCount ?? "",
        status,
        (r.flags || []).join("; "),
        perQ,
      ].map(escCsv).join(",");
    });

    const name = `homework-${result.lessonCode || "batch"}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadText([header, ...rows].join("\n"), name);
  }

  function exportEdsbyCsv() {
    if (!result?.results?.length) return;
    // Completeness is the mark that posts to the gradebook by default.
    const headers = ["Student ID", "First Name", "Last Name", "Assessment Name", "Date", "Grade", "Out Of", "Comment"];
    const today = new Date(result.batchDate || Date.now()).toISOString().slice(0, 10);
    const assessmentName = `Homework ${result.lessonCode || result.assignment?.pageLabel || ""}`.trim();

    const eligible = result.results.filter(
      (r) => !r.superseded && !r.noPageFound && (r.studentId || r.edsbyId) && r.completeness != null
    );
    if (!eligible.length) {
      alert("No rows have both a roster ID and a completeness mark, so there's nothing Edsby can import yet.");
      return;
    }

    const rows = eligible.map((r) => {
      const parts = (r.studentName || "").trim().split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ");
      const bits = [`Attempted ${r.attemptedCount} of ${r.assignedCount}.`];
      if (r.correctness != null) bits.push(`Correct on ${r.correctCount} of ${r.keyedAttemptedCount} checked.`);
      if ((r.flags || []).length) bits.push(r.flags.join(" "));
      return [
        r.studentId || r.edsbyId, firstName, lastName,
        assessmentName, today, r.completeness, 10, bits.join(" "),
      ].map(escCsv).join(",");
    });

    downloadText(
      [headers.map(escCsv).join(","), ...rows].join("\n"),
      `edsby-homework-${result.lessonCode || "batch"}-${today}.csv`
    );
  }

  /* ---------------- render helpers ---------------- */

  const photoByIndex = (i) => photos[i];

  const workTypeWarning = assignment && assignment.workType === "extended_writing";

  /* ---------------- render ---------------- */

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div>
          <div style={S.title}>Homework Check</div>
          <div style={S.subtitle}>
            Who did the work — completeness and (where a key exists) correctness.
          </div>
        </div>
        <button type="button" style={S.closeBtn} onClick={onClose}>Close</button>
      </div>

      {/* ---------- Setup ---------- */}
      <div style={S.section}>
        <div style={S.sectionTitle}>1 · Class &amp; book</div>
        <div style={S.row}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={S.label}>Class</label>
            <select style={S.select} value={className} onChange={(e) => setClassName(e.target.value)}>
              <option value="">Select a class…</option>
              {rosterClasses.map((rc) => (
                <option key={rc.id || rc.className} value={rc.className}>
                  {rc.className} ({rc.students?.length || 0})
                </option>
              ))}
            </select>
            {!rosterClasses.length && (
              <div style={S.hint}>
                No rosters yet. Upload one in Batch mode, or the check will run without name matching.
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={S.label}>Book (for the answer key)</label>
            <input
              style={S.input}
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              placeholder="JUMP Math AP Book 7.1"
            />
          </div>
        </div>

        {/* Lesson code labels the batch on its own. The name is only for when a
            code isn't what you'd recognise the homework by later. */}
        <div style={{ ...S.row, marginTop: 8 }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={S.label}>Lesson code</label>
            <input
              style={S.input}
              value={lessonCode}
              onChange={(e) => setLessonCode(e.target.value.toUpperCase())}
              placeholder="NS7-3"
            />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={S.label}>
              Assignment name <span style={S.optional}>optional</span>
            </label>
            <input
              style={S.input}
              value={assignmentName}
              onChange={(e) => setAssignmentName(e.target.value)}
              placeholder="Leave blank to use the lesson code"
            />
          </div>
        </div>
      </div>

      {/* ---------- Answer key ---------- */}
      <div style={S.section}>
        <div style={S.sectionTitle}>2 · Answer key <span style={S.optional}>upload once, pick per check</span></div>
        <div style={S.hint}>
          Photograph the answers section at the back of the book, or upload the PDF — its pages
          are read straight off it. Most books print odd answers only — that's fine, anything not
          in the key is marked “no key” and left out of the correctness score.
        </div>

        {/* Say which key this check marks against, rather than inferring it from
            a book name and lesson code. A teacher holding keys for several
            subjects shouldn't have to spell the label the same way twice to get
            the right answers used. */}
        {keys.length > 0 && (
          <label style={{ ...S.label, marginTop: 8, display: "block" }}>
            Mark this check against
            <select
              value={answerKeyId}
              onChange={(e) => setAnswerKeyId(e.target.value)}
              style={{ ...S.input, marginTop: 4, width: "100%" }}
            >
              <option value="">
                {keys.length === 1 ? "— choose a key —" : "— choose a key —"}
              </option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.lessonCode || "(no lesson code)"}
                  {k.bookName ? ` · ${k.bookName}` : ""}
                  {typeof k.questionCount === "number" ? ` · ${k.questionCount} answers` : ""}
                </option>
              ))}
            </select>
            {!answerKeyId && (
              <span style={S.hint}>
                No key chosen — this batch reports completeness only, with no correctness score.
              </span>
            )}
          </label>
        )}
        <div style={{ ...S.row, marginTop: 8 }}>
          <button
            type="button"
            style={S.secondaryBtn}
            disabled={keyBusy}
            onClick={() => keyInputRef.current?.click()}
          >
            {keyBusy ? "Reading key…" : "Upload answer-key pages"}
          </button>
          <input
            ref={keyInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { uploadAnswerKey(e.target.files); e.target.value = ""; }}
          />
          {keys.length > 0 && (
            <button
              type="button"
              onClick={() => setShowKeys((v) => !v)}
              style={{ ...S.keyBadge, cursor: "pointer", border: "1px solid rgba(37,99,235,0.35)" }}
              aria-expanded={showKeys}
              title="Show the keys on file, and remove any that are wrong"
            >
              {keys.length} lesson{keys.length === 1 ? "" : "s"} on file
              {bookName ? ` for ${bookName}` : ""} {showKeys ? "▲" : "▼"}
            </button>
          )}
        </div>

        {/* A key read off the wrong page is worse than no key — every question
            it covers is then marked against the wrong answers. There was no way
            to take one back, so an upload could only ever be added to. */}
        {showKeys && keys.length > 0 && (
          <div style={{ marginTop: 8, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
            {keys.map((k) => (
              <div
                key={k._id || k.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, padding: "6px 10px", fontSize: 12,
                  borderBottom: "1px solid #f1f5f9", background: "#fff",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <b>{k.lessonCode || "(no lesson code)"}</b>
                  {k.bookName ? <span style={{ color: "#64748b" }}> · {k.bookName}</span> : null}
                  {typeof k.questionCount === "number" && (
                    <span style={{ color: "#94a3b8" }}> · {k.questionCount} answer{k.questionCount === 1 ? "" : "s"}</span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={keyDeleting === (k._id || k.id)}
                  onClick={() => deleteAnswerKey(k)}
                  style={{
                    background: "none", border: "none", color: "#dc2626",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "2px 6px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {keyDeleting === (k._id || k.id) ? "Removing…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
        {keyMsg && <div style={S.hint}>{keyMsg}</div>}
      </div>

      {/* ---------- Assignment page ---------- */}
      <div style={S.section}>
        <div style={S.sectionTitle}>
          3 · The assignment <span style={S.optional}>optional</span>
        </div>
        <div style={S.hint}>
          Only needed when the questions <i>aren't</i> on the pages you're photographing — work
          done on loose paper or in a notebook, where nothing in the photo says what was asked.
          Add 1–3 photos (or a PDF) of the textbook page and it reads the question numbers and
          sets the subset.
          <br />
          If your students write on <b>printed pages</b>, skip this — the questions are already in
          their photos, and every question printed on the page will be reported.
        </div>
        <div style={{ ...S.row, marginTop: 8 }}>
          <button
            type="button"
            style={S.secondaryBtn}
            disabled={assignmentBusy}
            onClick={() => assignmentInputRef.current?.click()}
          >
            {assignmentBusy ? "Reading page…" : assignment ? "Re-shoot assignment page" : "Add assignment page"}
          </button>
          <input
            ref={assignmentInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { readAssignmentPage(e.target.files); e.target.value = ""; }}
          />
        </div>
        {assignmentError && <div style={S.error}>{assignmentError}</div>}

        {assignment && (
          <>
            <div style={S.assignmentSummary}>
              <b>{assignment.pageLabel || "Assignment page"}</b>
              {assignment.subjectGuess ? ` · ${assignment.subjectGuess}` : ""}
              {" · "}
              {assignment.questions.length} question{assignment.questions.length === 1 ? "" : "s"} read
            </div>

            {workTypeWarning && (
              <div style={S.warnBox}>
                <b>Completeness only for this one.</b>{" "}
                {assignment.workTypeReason ||
                  "This page looks like extended writing, so there are no discrete answers to compare against a key."}{" "}
                To mark the writing itself, close this and use the rubric grading mode.
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <label style={S.label}>Which questions did you set?</label>
              <div style={S.chipRow}>
                {SUBSET_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setSubsetMode(m.value)}
                    style={{ ...S.chip, ...(subsetMode === m.value ? S.chipActive : null) }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {subsetMode === "custom" && (
                <input
                  style={{ ...S.input, marginTop: 8 }}
                  value={customSubset}
                  onChange={(e) => setCustomSubset(e.target.value)}
                  placeholder="1ab, 3bc, 5-9, 12"
                />
              )}
              <div style={S.assignedPreview}>
                {assignedQuestions.length
                  ? <>Checking <b>{assignedQuestions.length}</b>: {assignedQuestions.slice(0, 24).join(", ")}{assignedQuestions.length > 24 ? "…" : ""}</>
                  : "No questions selected yet."}
              </div>
            </div>

            {/* Key coverage — shown before the teacher shoots anything */}
            {assignedQuestions.length > 0 && (
              <div style={coverage?.correctnessAvailable ? S.coverageOk : S.coverageWarn}>
                {coverageBusy ? "Checking answer-key coverage…" : (
                  coverage
                    ? <>
                        <b>
                          {coverage.hasAnswerKey
                            ? `Key covers ${coverage.covered} of your ${coverage.total} questions.`
                            : "No answer key on file for this lesson."}
                        </b>{" "}
                        {coverage.reason}
                      </>
                    : "Answer-key coverage unknown."
                )}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <label style={S.label}>Where did the students write?</label>
              <div style={S.chipRow}>
                <button
                  type="button"
                  onClick={() => setWorkSurface("workbook")}
                  style={{ ...S.chip, ...(workSurface === "workbook" ? S.chipActive : null) }}
                >
                  In the printed book
                </button>
                <button
                  type="button"
                  onClick={() => setWorkSurface("loose")}
                  style={{ ...S.chip, ...(workSurface === "loose" ? S.chipActive : null) }}
                >
                  Loose paper / notebook
                </button>
              </div>
              {workSurface === "loose" && (
                <div style={S.hint}>
                  Answers will be matched by the question number the student wrote beside each one.
                  Anything whose number can't be matched is listed for you rather than guessed at.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ---------- Capture lap upload ---------- */}
      <div style={S.section}>
        <div style={S.sectionTitle}>4 · The photos</div>
        <div style={S.hint}>
          <b>On a phone:</b> shoot here. Tap a student, take their pages — one, three, however
          many — then the next student. Each photo is filed as it's taken, so there's nothing to
          sort out afterwards.
          <br />
          <b>On a computer:</b> pick photos you've already taken. They're ordered by capture time,
          grouped by the name on each page, and you confirm the grouping in step 5.
        </div>

        {showCapture ? (
          <div style={{ marginTop: 10 }}>
            <HomeworkCapture
              students={roster}
              className={className}
              onDone={acceptCapture}
              onCancel={() => setShowCapture(false)}
            />
          </div>
        ) : null}

        <div style={{ ...S.row, marginTop: 8 }}>
          {!showCapture && (
            <button
              type="button"
              style={S.secondaryBtn}
              onClick={() => setShowCapture(true)}
              title={roster.length ? "" : "Pick a class with a roster first"}
              disabled={!roster.length}
            >
              📷 Shoot in app
            </button>
          )}
          <button type="button" style={S.secondaryBtn} onClick={() => batchInputRef.current?.click()}>
            {photos.length ? `Replace photos (${photos.length})` : "Choose photos"}
          </button>
          <input
            ref={batchInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { prepareFiles(e.target.files); e.target.value = ""; }}
          />
          {photos.length > 0 && !allUploaded && (
            <button
              type="button"
              style={S.primaryBtn}
              disabled={uploading}
              onClick={() => startUpload(!!uploadId)}
            >
              {uploading ? "Uploading…" : uploadId ? "Resume upload" : `Upload ${photos.length} photos`}
            </button>
          )}
          {uploading && (
            <button type="button" style={S.ghostBtn} onClick={() => { cancelUploadRef.current = true; }}>
              Stop
            </button>
          )}
          {allUploaded && <div style={S.okBadge}>All {photos.length} photos uploaded</div>}
        </div>

        {prepMsg && <div style={S.hint}>{prepMsg}</div>}
        {uploadError && <div style={S.warnBox}>{uploadError}</div>}

        {uploading && (
          <div style={{ marginTop: 10 }}>
            <div style={S.progressBar}>
              <div
                style={{
                  ...S.progressFill,
                  width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <div style={S.hint}>{uploadProgress.done} of {uploadProgress.total} sent</div>
          </div>
        )}

        {photos.some((p) => p.issues?.length) && (
          <div style={S.warnBox}>
            <b>Some photos may need reshooting:</b>{" "}
            {photos
              .map((p, i) => (p.issues?.length ? `#${i + 1} ${p.issues.join(" & ")}` : null))
              .filter(Boolean)
              .slice(0, 8)
              .join(", ")}
          </div>
        )}

        {allUploaded && !groups && (
          <button
            type="button"
            style={{ ...S.primaryBtn, marginTop: 10 }}
            disabled={groupBusy}
            onClick={runGrouping}
          >
            {groupBusy ? "Sorting into students…" : "Sort into students"}
          </button>
        )}
        {groupError && <div style={S.error}>{groupError}</div>}
      </div>

      {/* ---------- Contact sheet ---------- */}
      {groups && (
        <div style={S.section}>
          <div style={S.sectionTitle}>
            5 · Check the grouping <span style={S.optional}>drag a photo to move it</span>
          </div>

          {groupMeta?.warnings?.length > 0 && (
            <div style={S.warnBox}>
              {groupMeta.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}
          {groupMeta?.missingStudents?.length > 0 && (
            <div style={S.warnBox}>
              <b>No page found for:</b> {groupMeta.missingStudents.join(", ")}.
              They'll appear in the results as “no page found”.
            </div>
          )}

          <div style={S.sheet}>
            {groups.map((g, gi) => (
              <div
                key={gi}
                style={{ ...S.group, ...(g.superseded ? S.groupSuperseded : null) }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const d = dragRef.current;
                  if (d) movePhoto(d.groupIndex, d.photoIndex, gi);
                  dragRef.current = null;
                }}
              >
                <div style={S.groupHead}>
                  <select
                    style={S.groupSelect}
                    value={
                      g.studentId || g.edsbyId
                        ? roster
                            .filter((s) => (s.studentId || s.edsbyId) === (g.studentId || g.edsbyId))
                            .map((s) => `${s.firstName}|${s.lastName}|${s.studentId || ""}|${s.edsbyId || ""}`)[0] || ""
                        : ""
                    }
                    onChange={(e) => setGroupStudent(gi, e.target.value)}
                  >
                    <option value="">
                      {g.nameAsWritten ? `Unmatched: “${g.nameAsWritten}”` : "Choose student…"}
                    </option>
                    {roster.map((s) => (
                      <option
                        key={`${s.studentId || s.edsbyId}-${s.firstName}${s.lastName}`}
                        value={`${s.firstName}|${s.lastName}|${s.studentId || ""}|${s.edsbyId || ""}`}
                      >
                        {s.firstName} {s.lastName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={S.tinyBtn}
                    title="Superseded groups are kept but not graded"
                    onClick={() => toggleSuperseded(gi)}
                  >
                    {g.superseded ? "Include" : "Skip"}
                  </button>
                </div>

                {g.notes?.length > 0 && (
                  <div style={S.groupNote}>{g.notes.join(" ")}</div>
                )}

                <div style={S.thumbRow}>
                  {g.photoIndexes.map((pi) => {
                    const p = photoByIndex(pi);
                    return (
                      <div
                        key={pi}
                        draggable
                        onDragStart={() => { dragRef.current = { groupIndex: gi, photoIndex: pi }; }}
                        style={S.thumbWrap}
                        title={p?.name || `Photo ${pi + 1}`}
                      >
                        {p?.dataUrl
                          ? <img src={p.dataUrl} alt={`Photo ${pi + 1}`} style={S.thumb} />
                          : <div style={{ ...S.thumb, ...S.thumbMissing }}>?</div>}
                        <div style={S.thumbLabel}>#{pi + 1}</div>
                        {g.photoIndexes.indexOf(pi) > 0 && (
                          <button
                            type="button"
                            style={S.splitBtn}
                            title="Start a new student at this photo"
                            onClick={() => splitAt(gi, pi)}
                          >
                             split
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            style={{ ...S.primaryBtn, marginTop: 12 }}
            disabled={!!job || !canRunCheck}
            onClick={runCheck}
          >
            {job ? "Checking…" : `Check ${groups.filter((g) => !g.superseded).length} students`}
          </button>
          {!assignedQuestions.length && (
            <div style={S.hint}>
              {workSurface === "loose"
                ? "This work is on loose paper, so the questions aren't in the photos — add the assignment page above, or type the list, so there's something to check against."
                : "No assignment page: every question printed on the students' pages will be reported. Add one above if you'd rather check against a specific list."}
            </div>
          )}
          {checkError && <div style={S.error}>{checkError}</div>}
        </div>
      )}

      {/* ---------- Progress ---------- */}
      {job && (
        <div style={S.section}>
          <div style={S.progressBar}>
            <div style={{ ...S.progressFill, width: `${job.progress || 0}%` }} />
          </div>
          <div style={S.hint}>{job.stage || "working…"}</div>
        </div>
      )}

      {/* ---------- Results ---------- */}
      {result && (
        <ResultsTable
          result={result}
          onExportCsv={exportCsv}
          onExportEdsby={exportEdsbyCsv}
          hwUrl={hwUrl}
          teacherEmail={teacherEmail}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Results                                                            */
/* ------------------------------------------------------------------ */

function ResultsTable({ result, onExportCsv, onExportEdsby, hwUrl, teacherEmail }) {
  const [expanded, setExpanded] = useState(null);

  // Teacher release gate. Nothing reaches /progress until this is pressed —
  // the batch sits here for the flags to be checked and fixed first.
  const [released, setReleased] = useState(!!result.released);
  const [answersReleased, setAnswersReleased] = useState(!!result.answersReleased);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState("");
  const [portalMsg, setPortalMsg] = useState("");

  async function toggleRelease(next) {
    if (!result.batchId) {
      setReleaseError("This batch wasn't saved, so it can't be released. Re-run the check.");
      return;
    }
    setReleaseBusy(true);
    setReleaseError("");
    try {
      const res = await fetch(hwUrl(`/batches/${encodeURIComponent(result.batchId)}/release`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherEmail, released: next }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setReleased(!!data.released);
      if (data.portalError) {
        setReleaseError(data.portalError);
      } else if (data.portal) {
        const p = data.portal;
        setPortalMsg(
          next
            ? `${(p.created || 0) + (p.updated || 0)} of ${p.eligible ?? 0} students now have this on their progress page.`
            : `Removed ${p.removed || 0} entries from student progress pages.`
        );
      }
    } catch (err) {
      setReleaseError(err?.message || "Release failed.");
    } finally {
      setReleaseBusy(false);
    }
  }

  async function toggleAnswers(next) {
    if (!result.batchId) return;
    setReleaseBusy(true);
    setReleaseError("");
    try {
      const res = await fetch(hwUrl(`/batches/${encodeURIComponent(result.batchId)}/release-answers`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherEmail, answersReleased: next }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Server error ${res.status}`);
      setAnswersReleased(!!data.answersReleased);
    } catch (err) {
      setReleaseError(err?.message || "Toggle failed.");
    } finally {
      setReleaseBusy(false);
    }
  }

  const rows = result.results || [];
  const unmatched = rows.filter((r) => r.unmatched && !r.superseded && !r.noPageFound);
  const missing = rows.filter((r) => r.noPageFound);
  const unreadable = rows.filter((r) => (r.questions || []).some((q) => q.work === "unreadable"));
  const looseUnmatched = rows.filter((r) => (r.unmatchedAnswers || []).length);

  return (
    <div style={S.section}>
      <div style={{ ...S.row, justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.sectionTitle}>Results</div>
        <div style={S.row}>
          <button type="button" style={S.smallBtn} onClick={onExportCsv}>Export CSV</button>
          <button type="button" style={S.smallBtn} onClick={onExportEdsby}>Edsby CSV</button>
        </div>
      </div>

      {/* Release gate — nothing reaches the student portal until this is pressed */}
      <div style={released ? S.releaseOn : S.releaseOff}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 800 }}>
              {released ? "Released to students" : "Not released — students can't see this yet"}
            </div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.9 }}>
              {released
                ? "This is live on each student's progress page. Un-release to pull it back."
                : "Check the flags below and fix any mis-grouping first. Nothing reaches /progress until you release."}
            </div>
          </div>
          <button
            type="button"
            style={released ? S.smallBtn : S.primaryBtn}
            disabled={releaseBusy}
            onClick={() => toggleRelease(!released)}
          >
            {releaseBusy ? "Working…" : released ? "Un-release" : "Release to students"}
          </button>
        </div>

        {released && (
          <label style={S.answerToggle}>
            <input
              type="checkbox"
              checked={answersReleased}
              disabled={releaseBusy}
              onChange={(e) => toggleAnswers(e.target.checked)}
            />
            <span>
              <b>Show the correct answers too.</b> Off by default so the page is somewhere to try
              the question again rather than somewhere to copy the answer.
            </span>
          </label>
        )}
        {portalMsg && <div style={{ ...S.tdSub, marginTop: 8, fontWeight: 700 }}>{portalMsg}</div>}
        {releaseError && <div style={S.error}>{releaseError}</div>}
      </div>

      {/* Flag list, above the table — teacher-facing only */}
      <div style={S.flagStack}>
        {!result.correctnessAvailable && (
          <div style={S.flagInfo}>
            <b>Completeness only.</b> {result.correctnessSkippedReason || "No answer key available for this assignment."}
          </div>
        )}
        {result.correctnessAvailable && result.keyCoverage && result.keyCoverage.uncovered?.length > 0 && (
          <div style={S.flagInfo}>
            Key covered <b>{result.keyCoverage.covered}</b> of{" "}
            <b>{result.keyCoverage.total}</b> questions. Not checked:{" "}
            {result.keyCoverage.uncovered.join(", ")} — marked “no key”, not counted wrong.
          </div>
        )}
        {missing.length > 0 && (
          <div style={S.flagBad}>
            <b>No page found ({missing.length}):</b> {missing.map((r) => r.studentName).join(", ")}
          </div>
        )}
        {unmatched.length > 0 && (
          <div style={S.flagWarn}>
            <b>Unmatched photos ({unmatched.length}):</b>{" "}
            {unmatched.map((r) => r.nameAsWritten || `photos ${r.photoIndexes.map((i) => i + 1).join("/")}`).join(", ")}
          </div>
        )}
        {unreadable.length > 0 && (
          <div style={S.flagWarn}>
            <b>Check these yourself ({result.unreadableCount}):</b>{" "}
            {unreadable
              .map((r) => `${r.studentName || r.nameAsWritten || "?"} (${(r.questions || []).filter((q) => q.work === "unreadable").map((q) => q.q).join(", ")})`)
              .join("; ")}
          </div>
        )}
        {looseUnmatched.length > 0 && (
          <div style={S.flagWarn}>
            <b>Answers that couldn't be matched to a question:</b>{" "}
            {looseUnmatched
              .map((r) => `${r.studentName || "?"} (${r.unmatchedAnswers.map((u) => u.labelAsWritten || "?").join(", ")})`)
              .join("; ")}
          </div>
        )}
      </div>

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Student</th>
              <th style={S.th}>Completeness</th>
              <th style={S.th}>Correctness</th>
              <th style={S.th}>Detail</th>
              <th style={S.th}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isOpen = expanded === i;
              return (
                <React.Fragment key={i}>
                  <tr
                    style={{ ...S.tr, ...(r.superseded ? S.trMuted : null) }}
                    onClick={() => setExpanded(isOpen ? null : i)}
                  >
                    <td style={S.td}>
                      <div style={{ fontWeight: 700 }}>
                        {r.studentName || r.nameAsWritten || "(unmatched)"}
                      </div>
                      {r.noPageFound && <div style={S.tdSub}>no page in this batch</div>}
                      {r.superseded && <div style={S.tdSub}>superseded retake — not graded</div>}
                      {!r.matched && !r.noPageFound && !r.superseded && (
                        <div style={S.tdSub}>unmatched — assign by hand</div>
                      )}
                    </td>
                    <td style={S.td}>
                      {r.completeness == null
                        ? <span style={S.dash}>—</span>
                        : <><b style={{ fontSize: 16 }}>{r.completeness}</b> <span style={S.outOf}>/10</span>
                            <div style={S.tdSub}>{r.attemptedCount} of {r.assignedCount} attempted</div></>}
                    </td>
                    <td style={S.td}>
                      {r.correctness == null
                        ? <span style={S.dash}>—</span>
                        : <><b style={{ fontSize: 16 }}>{r.correctness}</b> <span style={S.outOf}>/10</span>
                            <div style={S.tdSub}>{r.correctCount} of {r.keyedAttemptedCount} checked</div></>}
                    </td>
                    <td style={S.td}>
                      <div style={S.qStrip}>
                        {(r.questions || []).slice(0, 14).map((q, k) => (
                          <span key={k} style={{ ...S.qPill, ...qStyle(q) }} title={`${q.q}: ${q.work}${q.correct ? ` / ${q.correct}` : ""}${q.note ? ` — ${q.note}` : ""}`}>
                            {q.q}
                          </span>
                        ))}
                        {(r.questions || []).length > 14 && <span style={S.tdSub}>+{r.questions.length - 14}</span>}
                      </div>
                    </td>
                    <td style={{ ...S.td, ...S.tdSub }}>{(r.flags || []).join("; ")}</td>
                  </tr>

                  {isOpen && (
                    <tr>
                      <td style={S.expandedTd} colSpan={5}>
                        {(r.questions || []).length > 0 ? (
                          <div style={S.qGrid}>
                            {r.questions.map((q, k) => (
                              <div key={k} style={{ ...S.qCard, ...qStyle(q) }}>
                                <div style={{ fontWeight: 800 }}>{q.q}</div>
                                <div style={{ fontSize: 12 }}>
                                  {q.work.replace("_", " ")}
                                  {q.correct ? ` · ${q.correct.replace("_", " ")}` : ""}
                                </div>
                                {q.note && <div style={S.qNote}>{q.note}</div>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={S.tdSub}>Nothing was graded for this student.</div>
                        )}

                        {(r.unmatchedAnswers || []).length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={S.label}>Answers that couldn't be matched to a question</div>
                            {r.unmatchedAnswers.map((u, k) => (
                              <div key={k} style={S.tdSub}>
                                “{u.labelAsWritten}” → {u.answerAsWritten} {u.note ? `(${u.note})` : ""}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Exactly what this student will read once released —
                            so the teacher can check the wording before it ships. */}
                        {(r.encouragement || (r.questions || []).some((q) => q.studentNote)) && (
                          <div style={S.studentBox}>
                            <div style={S.label}>What {r.studentName?.split(" ")[0] || "the student"} will see</div>
                            {r.encouragement && (
                              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                                {r.encouragement}
                              </div>
                            )}
                            {(r.questions || [])
                              .filter((q) => q.studentNote)
                              .map((q, k) => (
                                <div key={k} style={{ fontSize: 13, marginBottom: 3 }}>
                                  <b>{q.q}:</b> {q.studentNote}
                                </div>
                              ))}
                            <div style={{ ...S.tdSub, marginTop: 6 }}>
                              Unreadable answers and your flags are never shown to the student.
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function qStyle(q) {
  if (q.work === "not_attempted") return { background: "#fee2e2", color: "#991b1b", borderColor: "#fecaca" };
  if (q.work === "unreadable") return { background: "#fef3c7", color: "#92400e", borderColor: "#fde68a" };
  if (q.work === "sample") return { background: "#f1f5f9", color: "#64748b", borderColor: "#e2e8f0" };
  if (q.correct === "correct") return { background: "#dcfce7", color: "#166534", borderColor: "#bbf7d0" };
  if (q.correct === "incorrect") return { background: "#ffedd5", color: "#9a3412", borderColor: "#fed7aa" };
  return { background: "#e0f2fe", color: "#075985", borderColor: "#bae6fd" };
}

/* ------------------------------------------------------------------ */
/*  Styles (inline objects, matching the other grading sub-components)  */
/* ------------------------------------------------------------------ */

const S = {
  container: { display: "flex", flexDirection: "column", gap: 12 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { fontSize: 20, fontWeight: 900, color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b", fontWeight: 600 },
  closeBtn: {
    padding: "6px 12px", borderRadius: 10, border: "1px solid #cbd5e1",
    background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontSize: 13,
  },

  section: {
    border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, background: "#fff",
  },
  sectionTitle: { fontWeight: 800, fontSize: 14, color: "#0f172a", marginBottom: 6 },
  optional: { fontWeight: 600, fontSize: 12, color: "#94a3b8", marginLeft: 6 },

  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" },
  label: {
    display: "block", fontSize: 11, fontWeight: 800, color: "#64748b",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
  },
  input: {
    width: "100%", padding: "8px 12px", borderRadius: 10,
    border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box",
  },
  select: {
    width: "100%", padding: "8px 12px", borderRadius: 10,
    border: "1px solid #cbd5e1", fontSize: 14, boxSizing: "border-box", background: "#fff",
  },
  hint: { fontSize: 12, color: "#64748b", marginTop: 6, lineHeight: 1.5 },
  error: {
    marginTop: 8, padding: "8px 12px", borderRadius: 10,
    background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13,
  },
  warnBox: {
    marginTop: 8, padding: "8px 12px", borderRadius: 10,
    background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13, lineHeight: 1.5,
  },

  primaryBtn: {
    padding: "10px 18px", borderRadius: 10, border: "none",
    background: "#2563eb", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: 14,
  },
  secondaryBtn: {
    padding: "10px 16px", borderRadius: 10, border: "1px solid #cbd5e1",
    background: "#fff", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontSize: 14,
  },
  ghostBtn: {
    padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0",
    background: "#f8fafc", color: "#475569", fontWeight: 700, cursor: "pointer", fontSize: 13,
  },
  smallBtn: {
    padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1",
    background: "#fff", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontSize: 12,
  },
  tinyBtn: {
    padding: "3px 8px", borderRadius: 6, border: "1px solid #cbd5e1",
    background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontSize: 11,
  },

  keyBadge: {
    padding: "6px 10px", borderRadius: 999, background: "#eff6ff",
    border: "1px solid #bfdbfe", color: "#1e40af", fontSize: 12, fontWeight: 700,
  },
  okBadge: {
    padding: "6px 10px", borderRadius: 999, background: "#dcfce7",
    border: "1px solid #bbf7d0", color: "#166534", fontSize: 12, fontWeight: 700,
  },

  assignmentSummary: {
    marginTop: 8, padding: "8px 12px", borderRadius: 10,
    background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 13, color: "#0f172a",
  },
  assignedPreview: { fontSize: 12, color: "#475569", marginTop: 6, lineHeight: 1.5 },
  coverageOk: {
    marginTop: 10, padding: "8px 12px", borderRadius: 10,
    background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", fontSize: 13, lineHeight: 1.5,
  },
  coverageWarn: {
    marginTop: 10, padding: "8px 12px", borderRadius: 10,
    background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13, lineHeight: 1.5,
  },

  chipRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  chip: {
    padding: "6px 14px", borderRadius: 999, border: "1px solid #cbd5e1",
    background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontSize: 13,
  },
  chipActive: { background: "#2563eb", borderColor: "#2563eb", color: "#fff" },

  progressBar: {
    width: "100%", height: 8, borderRadius: 4, background: "#e2e8f0", overflow: "hidden",
  },
  progressFill: {
    height: "100%", borderRadius: 4, background: "linear-gradient(90deg,#3b82f6,#2563eb)",
    transition: "width .3s ease",
  },

  sheet: { display: "flex", flexDirection: "column", gap: 10, marginTop: 10 },
  group: {
    border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: "#f8fafc",
  },
  groupSuperseded: { opacity: 0.55, background: "#f1f5f9" },
  groupHead: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 },
  groupSelect: {
    flex: 1, padding: "6px 10px", borderRadius: 8,
    border: "1px solid #cbd5e1", fontSize: 13, background: "#fff",
  },
  groupNote: { fontSize: 11, color: "#92400e", marginBottom: 6 },
  thumbRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  thumbWrap: { position: "relative", cursor: "grab" },
  thumb: {
    width: 84, height: 108, objectFit: "cover", borderRadius: 8,
    border: "1px solid #cbd5e1", background: "#fff", display: "block",
  },
  thumbMissing: {
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#94a3b8", fontWeight: 800,
  },
  thumbLabel: {
    position: "absolute", top: 4, left: 4, padding: "1px 5px", borderRadius: 5,
    background: "rgba(15,23,42,0.75)", color: "#fff", fontSize: 10, fontWeight: 800,
  },
  splitBtn: {
    position: "absolute", bottom: 4, left: 4, padding: "1px 6px", borderRadius: 5,
    background: "rgba(255,255,255,0.95)", border: "1px solid #cbd5e1",
    color: "#475569", fontSize: 10, fontWeight: 800, cursor: "pointer",
  },

  releaseOn: {
    margin: "10px 0", padding: "10px 14px", borderRadius: 12,
    background: "#f0fdf4", border: "1px solid #86efac", color: "#166534",
  },
  releaseOff: {
    margin: "10px 0", padding: "10px 14px", borderRadius: 12,
    background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e",
  },
  answerToggle: {
    display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10,
    fontSize: 12, lineHeight: 1.5, cursor: "pointer",
  },
  studentBox: {
    marginTop: 10, padding: 10, borderRadius: 10,
    background: "#eff6ff", border: "1px solid #bfdbfe",
  },

  flagStack: { display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" },
  flagInfo: {
    padding: "8px 12px", borderRadius: 10, background: "#eff6ff",
    border: "1px solid #bfdbfe", color: "#1e40af", fontSize: 13, lineHeight: 1.5,
  },
  flagWarn: {
    padding: "8px 12px", borderRadius: 10, background: "#fffbeb",
    border: "1px solid #fde68a", color: "#92400e", fontSize: 13, lineHeight: 1.5,
  },
  flagBad: {
    padding: "8px 12px", borderRadius: 10, background: "#fef2f2",
    border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13, lineHeight: 1.5,
  },

  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left", padding: "10px 12px", background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0", fontSize: 11, fontWeight: 800,
    color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid #f1f5f9", cursor: "pointer" },
  trMuted: { opacity: 0.55 },
  td: { padding: "10px 12px", verticalAlign: "top" },
  tdSub: { fontSize: 11, color: "#64748b", marginTop: 2 },
  dash: { color: "#cbd5e1", fontWeight: 800 },
  outOf: { color: "#94a3b8", fontSize: 11, fontWeight: 700 },

  qStrip: { display: "flex", gap: 3, flexWrap: "wrap", maxWidth: 320 },
  qPill: {
    padding: "1px 6px", borderRadius: 5, fontSize: 10, fontWeight: 800,
    border: "1px solid transparent",
  },
  expandedTd: { padding: 14, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" },
  qGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 6,
  },
  qCard: { padding: 8, borderRadius: 8, border: "1px solid transparent" },
  qNote: { fontSize: 11, marginTop: 3, opacity: 0.85 },
};
