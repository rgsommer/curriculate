"use client";

import React, { useEffect, useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

function normalizeCode(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

/**
 * Linkify: makes urls clickable, trims trailing punctuation like "." or ")"
 */
function linkifyTextToReactNodes(text) {
  const s = String(text || "");
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi; // note: i flag
  const parts = s.split(re);

  return parts.map((part, i) => {
    if (part == null || part === "") return null;

    // Keep the original exactly (so spacing stays correct)
    const original = String(part);

    // Trim whitespace for testing only (don't lose it in output)
    const test = original.trim();

    // If the split token has leading punctuation like "(" or "[" it won't match,
    // but sometimes it sneaks in via copy/paste. Strip leading punct for detection.
    const mLeadTrail = test.match(/^([(\[{<"'""'']*)(.*?)([)\]}>"'""''.,;:!?]+)?$/);
    const leading = mLeadTrail?.[1] || "";
    const core = mLeadTrail?.[2] || test;
    const trailing = mLeadTrail?.[3] || "";

    const lower = core.toLowerCase();
    const isUrl = lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("www.");
    if (!isUrl) return <React.Fragment key={i}>{original}</React.Fragment>;

    const href = lower.startsWith("http") ? core : `https://${core}`;

    return (
      <React.Fragment key={i}>
        {/* preserve any leading punctuation that was attached */}
        {leading}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#2563eb", textDecoration: "underline" }}
        >
          {core}
        </a>
        {/* preserve trailing punctuation like "." or ")" */}
        {trailing}
      </React.Fragment>
    );
  });
}

/**
 * Parses your saved teacher block into sections.
 * Works with blocks like:
 * Grade: 7.5 / 10  Ref: AT534
 * View feedback online: www.curriculate.net/results (code: AT534)
 *
 * Deduction:
 * - Formatting requirements missing (–1)
 *
 * Strengths:
 * - ...
 *
 * Next Steps:
 * - ...
 *
 * Overall Comment:
 * ...
 *
 * Sections:
 * - Name: 3/4 — comment
 *   Incorrect:
 *   - ...
 */
function parseTeacherBlock(payloadText) {
  const text = String(payloadText || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  
  const out = {
    gradeLine: "",
    viewLine: "",
    deduction: [],
    strengths: [],
    nextSteps: [],
    overallComment: "",
    sections: [],
    isKita: false,
    achievementSummary: [],       // soft advisory achievement category breakdown
    evidenceLinks: [],
    evidenceText: "",
    savedCaptures: [],
    transcript: "",
    videoUrl: "",
    raw: text,
  };

  // Grab first "Grade:" line if present
  for (const ln of lines) {
    if (ln.trim().startsWith("Grade:")) {
      out.gradeLine = ln.trim();
      break;
    }
  }

  // Grab "View feedback" line if present
  for (const ln of lines) {
    if (ln.toLowerCase().includes("view feedback")) {
      out.viewLine = ln.trim();
      break;
    }
  }

  // Grab video URL if present (line like "Video: https://...")
  for (const ln of lines) {
    const m = ln.match(/^Video:\s*(https?:\/\/\S+)/);
    if (m) { out.videoUrl = m[1]; break; }
  }

  const headingSet = new Set([
    "Links / evidence:",
    "Submitted text (evidence):",
    "Deduction:",
    "Strengths:",
    "Next Steps:",
    "Overall Comment:",
    "Sections:",
    "Achievement Categories (KITA):",
    "Achievement Categories:",
    "Saved captures (30-day links):",
    "Transcript:",
  ]);

  const bucket = {
    "Links / evidence:": "evidenceLinks",
    "Submitted text (evidence):": "evidenceText",
    "Deduction:": "deduction",
    "Strengths:": "strengths",
    "Next Steps:": "nextSteps",
    "Overall Comment:": "overallComment",
    "Sections:": "sections",
    "Achievement Categories (KITA):": "sections",
    "Achievement Categories:": "achievementSummary",
    "Saved captures (30-day links):": "savedCaptures",
    "Transcript:": "transcript",
  };

  let current = null;
  let overallLines = [];
  let currentSection = null;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    if (headingSet.has(ln.trim())) {
      const h = ln.trim();

      // ✅ if we are leaving Overall Comment, save it now
      if (current === "Overall Comment:" && overallLines.length) {
        out.overallComment = overallLines.join("\n").trim();
        overallLines = [];
      }

      current = h;

      if (current === "Achievement Categories (KITA):") {
        out.isKita = true;
      }

      // start fresh for new overall comment block
      if (current === "Overall Comment:") {
        overallLines = [];
      }

      continue;
    }

    if (!current) continue;

    // Overall Comment can be multi-line
    if (current === "Overall Comment:") {
      if (ln.trim() === "" && overallLines.length) continue;
      overallLines.push(ln);
      continue;
    }

    // Submitted text (evidence) can be multi-line like Overall Comment
    if (current === "Submitted text (evidence):") {
      // keep blank lines, but avoid leading empties
      if (!out.evidenceText && ln.trim() === "") continue;
      out.evidenceText += (out.evidenceText ? "\n" : "") + ln;
      continue;
    }

    // Transcript is multi-line
    if (current === "Transcript:") {
      if (!out.transcript && ln.trim() === "") continue;
      out.transcript += (out.transcript ? "\n" : "") + ln;
      continue;
    }

    // Links / evidence: and Saved captures: are list-ish
    if (current === "Links / evidence:" || current === "Saved captures (30-day links):") {
      const t = ln.trim();
      if (!t) continue;
      out[bucket[current]].push(t);
      continue;
    }

    if (current === "Sections:" || current === "Achievement Categories (KITA):") {
      const raw = ln;              // keep raw line
      const trimmed = raw.trim();

      // Start a new section for bullets that look like section headers.
      // e.g. "- Part A — Matching: 10/10 — ..."
      // or  "- K Knowledge & Understanding: 3.5/5 (25%) — comment"
      // or  "- Category Name: 4/5 — comment"
      if (raw.startsWith("- ")) {
        const afterDash = raw.slice(2).trim();

        // A section header if it matches Part/Section, or contains a score pattern like "3/5" or "10/20"
        const isSectionHeader =
          /^Part\s+[A-Z0-9]+\b/i.test(afterDash) ||          // Part A, Part 1, etc
          /^Section\b/i.test(afterDash) ||                    // Section ...
          /\d+\.?\d*\s*\/\s*\d+/.test(afterDash);            // any "score/outOf" pattern (e.g. 3.5/5, 10/20)

        // Also: if it's a numbered question bullet like "- 2. ...", treat as detail
        const isNumberedItem = /^\d+\./.test(afterDash);

        if (isSectionHeader && !isNumberedItem) {
          if (currentSection) out.sections.push(currentSection);
          currentSection = { title: afterDash, lines: [] };
          continue;
        }

        // otherwise, it's a detail line inside current section
        if (currentSection) currentSection.lines.push(afterDash);
        continue;
      }

      // "Weighted Total: 78%" line — store as a special summary line
      if (trimmed.startsWith("Weighted Total:")) {
        if (currentSection) out.sections.push(currentSection);
        currentSection = null;
        out.sections.push({ title: trimmed, lines: [] });
        continue;
      }

      // Indented or non-bullet detail lines (e.g. "Incorrect:")
      if (currentSection && trimmed) {
        currentSection.lines.push(trimmed);
      }
      continue;
    }

    const target = bucket[current];
    if (!target) continue;

    const t = ln.trim();
    if (!t) continue;

    // Parse achievement summary lines:
    // With score: "- K Knowledge & Understanding 3.50/5.00 [strong]: comment"
    // Without:    "- K Knowledge & Understanding [strong]: comment"
    if (target === "achievementSummary") {
      const mScore = t.match(/^-?\s*\S+\s+(.+?)\s+([\d.]+)\/([\d.]+)\s*\[(\w+)\]:\s*(.+)$/);
      if (mScore) {
        out.achievementSummary.push({
          category: mScore[1].trim(), score: parseFloat(mScore[2]), out_of: parseFloat(mScore[3]),
          level: mScore[4].trim().toLowerCase(), comment: mScore[5].trim(),
        });
        continue;
      }
      const m = t.match(/^-?\s*\S+\s+(.+?)\s*\[(\w+)\]:\s*(.+)$/);
      if (m) {
        out.achievementSummary.push({ category: m[1].trim(), level: m[2].trim().toLowerCase(), comment: m[3].trim() });
      }
      continue;
    }

    // Keep list items, but also allow plain lines
    out[target].push(t);
  }

  if (overallLines.length) {
    out.overallComment = overallLines.join("\n").trim();
  }
  if (currentSection) out.sections.push(currentSection);

  // If we didn't find any structure, return null (so we can fallback)
  const hasAny =
    out.gradeLine ||
    out.viewLine ||
    out.deduction.length ||
    out.strengths.length ||
    out.nextSteps.length ||
    out.overallComment ||
    out.sections.length ||
    out.achievementSummary.length ||
    out.evidenceLinks.length ||
    out.evidenceText.trim() ||
    out.savedCaptures.length ||
    out.transcript.trim() ||
    out.videoUrl;

  return hasAny ? out : null;
}

function Card({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,.10)",
        borderRadius: 14,
        padding: 16,
        background: "white",
        boxShadow: "0 8px 18px rgba(2,6,23,.05)",
      }}
    >
      {title ? (
        <div style={{ fontWeight: 900, marginBottom: 10, fontSize: 14 }}>
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Pill({ children }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,.10)",
        background: "rgba(15,23,42,.03)",
        fontSize: 12,
        fontWeight: 800,
        color: "rgba(15,23,42,.85)",
      }}
    >
      {children}
    </span>
  );
}

function renderSectionTitle(title) {
  const t = String(title || "");
  const idx = t.indexOf(":");
  if (idx === -1) {
    return <span style={{ fontWeight: 900 }}>{linkifyTextToReactNodes(t)}</span>;
  }
  const left = t.slice(0, idx + 1);   // include colon
  const right = t.slice(idx + 1);     // remainder
  return (
    <span>
      <span style={{ fontWeight: 900 }}>{linkifyTextToReactNodes(left)}</span>
      <span>{linkifyTextToReactNodes(right)}</span>
    </span>
  );
}

async function copyCodeLink(refCode) {
  const code = normalizeCode(refCode);
  if (code.length !== 5) return false;

  const url = `https://www.curriculate.net/results/${code}`;

  // Plain text fallback
  const plain = `View feedback: ${url}`;

  // HTML version makes it clickable in Gmail/Docs/Word (when supported)
  const html = `Ref: <a href="${url}">${code}</a>`;

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

export default function ResultsPage({ initialCode = "", autoLookup = false }) {
  const [codeInput, setCodeInput] = useState(initialCode);
  const [status, setStatus] = useState("idle"); // idle | loading | error | ok
  const [data, setData] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Results-page feedback
  const [fbRole, setFbRole] = useState(""); // "student" | "parent" | ""
  const [fbText, setFbText] = useState("");
  const [fbSending, setFbSending] = useState(false);
  const [fbDone, setFbDone] = useState(false);

  // Grade review request
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewEmail, setReviewEmail] = useState("");
  const [reviewStudentName, setReviewStudentName] = useState("");
  const [reviewSchool, setReviewSchool] = useState("");
  const [reviewClass, setReviewClass] = useState("");
  const [reviewTeacherName, setReviewTeacherName] = useState("");
  const [reviewEmailError, setReviewEmailError] = useState("");
  const [reviewSending, setReviewSending] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [clipboardCopied, setClipboardCopied] = useState(false);

  const code = useMemo(() => normalizeCode(codeInput), [codeInput]);
  useEffect(() => {
    if (!autoLookup) return;
    if (code.length !== 5) return;
    if (status === "loading") return;
    if (status === "ok") return; // prevent re-fetch loops

    // trigger same logic as submit, but without needing an event
    (async () => {
      setStatus("loading");
      setData(null);
      setErrMsg("");

      try {
        const r = await fetch(`${API_BASE}/results/${code}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || "Code not found.");

        setData(j);
        setStatus("ok");
      } catch (err) {
        setStatus("error");
        setErrMsg(err?.message || "Code not found.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLookup, code]);

  async function onSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setData(null);
    setErrMsg("");

    try {
      const r = await fetch(`${API_BASE}/results/${code}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Code not found.");

      setData(j);
      setStatus("ok");
    } catch (err) {
      setStatus("error");
      setErrMsg(err?.message || "Code not found.");
    }
  }

  async function submitResultsFeedback() {
    const msg = (fbText || "").trim();
    if (!msg || !fbRole) return;
    setFbSending(true);
    try {
      const res = await fetch(`${API_BASE}/results/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: fbRole, message: msg, refCode: code }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFbDone(true);
    } catch (e) {
      console.error("Results feedback error:", e);
    } finally {
      setFbSending(false);
    }
  }

  async function submitGradeReview() {
    const msg = (reviewText || "").trim();
    const email = (reviewEmail || "").trim().toLowerCase();
    const studentName = (reviewStudentName || "").trim();
    const school = (reviewSchool || "").trim();
    const className = (reviewClass || "").trim();
    const teacherName = (reviewTeacherName || "").trim();

    if (!studentName) { setReviewEmailError("Please enter your name."); return; }
    if (!teacherName) { setReviewEmailError("Please enter your teacher's name."); return; }
    if (!email || !email.includes("@") || !email.includes(".")) {
      setReviewEmailError("Please enter your teacher's email address.");
      return;
    }
    if (!msg) { setReviewEmailError("Please explain why the grade should be reviewed."); return; }
    setReviewEmailError("");
    setReviewSending(true);
    try {
      const res = await fetch(`${API_BASE}/results/grade-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: fbRole || "student",
          reason: msg,
          refCode: code,
          teacherEmail: email,
          studentName,
          school,
          className,
          teacherName,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setReviewDone(true);
    } catch (e) {
      console.error("Grade review request error:", e);
      setReviewEmailError(e.message || "Failed to send. Please try again.");
    } finally {
      setReviewSending(false);
    }
  }

  const parsed = useMemo(() => {
    if (!data?.payload) return null;
    if (typeof data.payload === "string") return parseTeacherBlock(data.payload);
    return null;
  }, [data]);

  return (
    <div
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "28px 16px",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
        color: "#0b1220",
      }}
    >
      <div className="no-print">
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>View Feedback</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Enter the reference code written on the paper (expires after 30 days).
        </p>
      </div>
      <style>{`
        @page { margin: 12mm; }

        @media print {
          /* Hide everything */
          body * { visibility: hidden !important; }

          /* Show only the print area */
          #print-area, #print-area * { visibility: visible !important; }

          /* Print area positioning */
          #print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
          }

          /* Remove "app UI" styling for print */
          #print-area * {
            box-shadow: none !important;
          }

          /* If your Cards use white backgrounds, keep them,
            but remove any tinted backgrounds inside sections */
          #print-area [data-print-plain="true"] {
            background: transparent !important;
            border-color: rgba(0,0,0,.15) !important;
          }

          /* Clean doc look */
          a { color: #000 !important; text-decoration: underline; }
        }
      `}</style>

      <Card title={null}>
        <form
          onSubmit={onSubmit}
          style={{ display: "flex", gap: 10, alignItems: "center" }}
          className="no-print"
        >
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="AA123"
            inputMode="text"
            autoCapitalize="characters"
            style={{
              flex: 1,
              fontSize: 18,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,.18)",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={code.length !== 5 || status === "loading"}
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,.18)",
              background: code.length === 5 ? "#2563eb" : "rgba(0,0,0,.06)",
              color: code.length === 5 ? "white" : "rgba(0,0,0,.6)",
              fontWeight: 900,
              cursor: code.length === 5 ? "pointer" : "not-allowed",
            }}
          >
            {status === "loading" ? "Loading…" : "View"}
          </button>
        </form>

        {status === "ok" && data?.payload && (
          <div className="no-print" style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                const text =
                  typeof data.payload === "string"
                    ? data.payload
                    : JSON.stringify(data.payload, null, 2);

                navigator.clipboard?.writeText(text);
                setCopiedFeedback(true);
                setTimeout(() => setCopiedFeedback(false), 1200);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,.2)",
                background: "rgba(0,0,0,.04)",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              {copiedFeedback ? "Copied ✓" : "Copy Feedback"}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,.2)",
                background: "transparent",
                cursor: "pointer",
                fontSize: 14,
                opacity: 0.8,
              }}
              title="Opens print dialog (choose Save as PDF)"
            >
              Download as PDF
            </button>
          </div>
        )}
      </Card>

      {status === "error" && (
        <div style={{ marginTop: 14 }}>
          <Card title="Not found">
            <div style={{ opacity: 0.85 }}>{errMsg || "Code not found."}</div>
          </Card>
        </div>
      )}

      {status === "ok" && data && (
        <div id="print-area" style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {/* Header */}
          <Card title={null}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "baseline",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 1000 }}>
                {parsed?.gradeLine ? (
                  <span>{linkifyTextToReactNodes(parsed.gradeLine)}</span>
                ) : (
                  <span>Feedback</span>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(code);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 1200);
                  }}
                  style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                  title="Copy code"
                >
                  <Pill>Code: {code}</Pill>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyCodeLink(code);
                    if (ok) {
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 1200);
                    }
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  title="Copies the ref code + a clickable link"
                >
                  <Pill>{copiedCode ? "Copied ✓" : "Copy code + link"}</Pill>
                </button>

                <Pill>
                  Expires:{" "}
                  {data.expiresAt ? new Date(data.expiresAt).toLocaleString() : "—"}
                </Pill>
              </div>
            </div>

            {parsed?.viewLine ? (
              <div style={{ marginTop: 10, opacity: 0.85 }}>
                {linkifyTextToReactNodes(parsed.viewLine)}
              </div>
            ) : null}
          </Card>

          {/* Structured payload */}
          {parsed ? (
            <>
              {parsed.deduction.length ? (
                <Card title="Deduction">
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                    {parsed.deduction.map((x, i) => (
                      <li key={i}>{linkifyTextToReactNodes(x)}</li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {parsed.strengths.length ? (
                <Card title="Strengths">
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                    {parsed.strengths.map((x, i) => (
                      <li key={i}>{linkifyTextToReactNodes(x)}</li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {parsed.nextSteps.length ? (
                <Card title="Next steps">
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                    {parsed.nextSteps.map((x, i) => (
                      <li key={i}>{linkifyTextToReactNodes(x)}</li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {parsed.achievementSummary.length > 0 ? (
                <Card title="Achievement Categories">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {parsed.achievementSummary.map((k, i) => {
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
                        "Understanding": "U", "Problem Solving": "PS", "Effort & Growth": "EG",
                        "Skills & Application": "SA", "Progress & Effort": "PE",
                        "Thinking & Problem Solving": "TPS",
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
                            {typeof k.score === "number" && typeof k.out_of === "number" ? (
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
                    const items = parsed.achievementSummary.filter(k => typeof k.score === "number" && typeof k.out_of === "number");
                    if (!items.length) return null;
                    const totalScore = items.reduce((s, k) => s + k.score, 0);
                    const totalOutOf = items.reduce((s, k) => s + k.out_of, 0);
                    const pct = totalOutOf > 0 ? Math.min(100, Math.max(0, (totalScore / totalOutOf) * 100)) : 0;

                    // Regional average benchmark (use meta if available, default 70)
                    const avgPct = data?.meta?.regionalAvg || 70;

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
                      <div style={{ padding: "8px 10px", marginTop: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: qualityColor }}>{qualityLabel}</div>
                          <div style={{ fontSize: 13, fontWeight: 900, color: "#1e293b" }}>
                            <span style={{ opacity: 0.6, fontWeight: 600, marginRight: 6 }}>Total</span>
                            {totalScore.toFixed(2)}/{totalOutOf.toFixed(2)}
                          </div>
                        </div>
                        <div style={{ position: "relative", height: 16, borderRadius: 8, overflow: "visible", background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
                          <div style={{
                            position: "absolute", top: 0, left: 0, bottom: 0, width: "100%", borderRadius: 8,
                            background: "linear-gradient(90deg, #fecaca 0%, #fde68a 30%, #d9f99d 55%, #bbf7d0 75%, #6ee7b7 100%)",
                          }} />
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
                          <div style={{
                            position: "absolute", top: -5, bottom: -5,
                            left: `${pct}%`, transform: "translateX(-50%)",
                            width: 4, borderRadius: 2, zIndex: 3,
                            background: "#dc2626",
                            boxShadow: "0 0 6px rgba(220,38,38,0.5)",
                          }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, fontWeight: 600, color: "#94a3b8" }}>
                          <span>Needs Support</span>
                          <span>Developing</span>
                          <span>Proficient</span>
                          <span>Excellent</span>
                        </div>
                      </div>
                    );
                  })()}
                </Card>
              ) : null}

              {parsed.overallComment ? (
                <Card title="Overall comment">
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                    {linkifyTextToReactNodes(parsed.overallComment)}
                  </div>
                </Card>
              ) : null}

              {parsed.sections.length ? (
                parsed.isKita ? (
                  <Card title="Achievement Categories (KITA)">
                    <div style={{
                      border: "1px solid rgba(37,99,235,0.2)",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "rgba(37,99,235,0.03)",
                    }}>
                      {parsed.sections.map((sec, i) => {
                        // Parse KITA line: "K Knowledge & Understanding: 3.5/5 (25%) — comment"
                        const kitaMatch = sec.title.match(/^([KTCA])\s+(.+?):\s*([\d.]+)\s*\/\s*([\d.]+)\s*\((\d+)%\)(?:\s*—\s*(.*))?$/);
                        // Parse weighted total: "Weighted Total: 78%"
                        const totalMatch = sec.title.match(/^Weighted Total:\s*(\d+)%$/);

                        if (totalMatch) {
                          return (
                            <div key={i} style={{
                              padding: "8px 12px",
                              borderTop: "1px solid rgba(37,99,235,0.18)",
                              background: "rgba(37,99,235,0.06)",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontWeight: 900,
                            }}>
                              <span>Weighted Total</span>
                              <span style={{ fontSize: 18 }}>{totalMatch[1]}%</span>
                            </div>
                          );
                        }

                        if (kitaMatch) {
                          const [, short, name, score, outOf, weight, comment] = kitaMatch;
                          return (
                            <div key={i} style={{
                              padding: "10px 12px",
                              borderTop: i === 0 ? "none" : "1px solid rgba(37,99,235,0.12)",
                            }}>
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
                                  }}>{short}</span>
                                  {name}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 11, opacity: 0.6 }}>{weight}%</span>
                                  <span style={{ fontWeight: 900, minWidth: 36, textAlign: "right" }}>{score}/{outOf}</span>
                                </div>
                              </div>
                              {comment ? (
                                <div style={{ marginTop: 5, opacity: 0.85, lineHeight: 1.35, paddingLeft: 30 }}>
                                  {linkifyTextToReactNodes(comment)}
                                </div>
                              ) : null}
                            </div>
                          );
                        }

                        // Fallback for unrecognized lines
                        return (
                          <div key={i} style={{ padding: "8px 12px", borderTop: i === 0 ? "none" : "1px solid rgba(37,99,235,0.12)" }}>
                            {renderSectionTitle(sec.title)}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                ) : (
                  <Card title="Sections">
                    <div style={{ display: "grid", gap: 10 }}>
                      {parsed.sections.map((sec, i) => {
                        // Parse "Name: score/outOf — comment" for rich display
                        const secMatch = sec.title.match(/^(.+?):\s*([\d.]+)\s*\/\s*([\d.]+)(?:\s*—\s*(.*))?$/);

                        return (
                          <div
                            key={i}
                            style={{
                              border: "1px solid rgba(0,0,0,.08)",
                              borderRadius: 12,
                              padding: 12,
                              background: "rgba(15,23,42,.02)",
                            }}
                          >
                            {secMatch ? (
                              <>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontWeight: 900 }}>{secMatch[1]}</span>
                                  <span style={{ fontWeight: 900 }}>{secMatch[2]}/{secMatch[3]}</span>
                                </div>
                                {secMatch[4] ? (
                                  <div style={{ marginTop: 6, opacity: 0.85, lineHeight: 1.45 }}>
                                    {linkifyTextToReactNodes(secMatch[4])}
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <div>{renderSectionTitle(sec.title)}</div>
                            )}

                            {sec.lines?.length ? (
                              <div
                                style={{
                                  marginTop: 8,
                                  opacity: 0.9,
                                  lineHeight: 1.55,
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {sec.lines.map((ln, idx) => (
                                  <div key={idx}>{linkifyTextToReactNodes(ln)}</div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )
              ) : null}

              {(parsed.evidenceLinks.length || parsed.evidenceText.trim()) ? (
                <Card title="Evidence">
                  {parsed.evidenceLinks.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                      {parsed.evidenceLinks.map((x, i) => (
                        <li key={i}>{linkifyTextToReactNodes(x)}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ opacity: 0.85 }}>No links (submitted as text).</div>
                  )}

                  {parsed.evidenceText.trim() ? (
                    <div style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                      {linkifyTextToReactNodes(parsed.evidenceText.trim())}
                    </div>
                  ) : null}
                </Card>
              ) : null}

              {(() => {
                // Separate video captures from photo captures
                const videoCapture = parsed.savedCaptures.find(x => /\/video\.\w+/i.test(x));
                const videoUrl = videoCapture ? (videoCapture.match(/https?:\/\/\S+/) || [])[0] : parsed.videoUrl;
                const photoCaptures = parsed.savedCaptures.filter(x => !/\/video\.\w+/i.test(x));

                return (
                  <>
                    {/* Photo captures (same as before) */}
                    {photoCaptures.length ? (
                      <Card title="Saved captures (30-day links)">
                        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                          {photoCaptures.map((x, i) => (
                            <li key={i}>{linkifyTextToReactNodes(x)}</li>
                          ))}
                        </ul>
                      </Card>
                    ) : null}

                    {/* Video + Transcript (video grading) */}
                    {(videoUrl || parsed.transcript.trim()) ? (
                      <Card title="Video Performance">
                        {videoUrl ? (
                          <div style={{ marginBottom: parsed.transcript.trim() ? 12 : 0 }}>
                            <video
                              src={videoUrl}
                              controls
                              playsInline
                              style={{ width: "100%", maxHeight: 360, borderRadius: 8, background: "#000" }}
                            />
                            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                              <a href={videoUrl} target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
                                Open video in new tab
                              </a>
                            </div>
                          </div>
                        ) : null}
                        {parsed.transcript.trim() ? (
                          <details>
                            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13, color: "#334155", marginTop: 4 }}>
                              View full transcript
                            </summary>
                            <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 13, color: "#475569", background: "#f8fafc", padding: 12, borderRadius: 8 }}>
                              {parsed.transcript.trim()}
                            </div>
                          </details>
                        ) : null}
                      </Card>
                    ) : null}
                  </>
                );
              })()}

              {/* ── Feedback widget ── */}
              <div className="no-print" style={{
                marginTop: 24, padding: 16, background: "#f8fafc",
                borderRadius: 12, border: "1px solid #e2e8f0",
              }}>
                {(fbDone && reviewDone) || (fbDone && !reviewMode) ? (
                  <div style={{ textAlign: "center", padding: "8px 0" }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>&#10003;</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Thanks for your feedback!</div>
                    <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>This helps us improve.</div>
                  </div>
                ) : reviewDone ? (
                  <div style={{ padding: "8px 0" }}>
                    <div style={{ textAlign: "center", marginBottom: 14 }}>
                      <div style={{ fontSize: 20, marginBottom: 6 }}>&#10003;</div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Review request sent!</div>
                      <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                        We emailed {reviewTeacherName ? <strong>{reviewTeacherName}</strong> : "your teacher"} at <strong>{reviewEmail}</strong>.
                      </div>
                    </div>

                    <div style={{
                      background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10,
                      padding: 14, fontSize: 13, color: "#92400e", lineHeight: 1.5, marginBottom: 12,
                    }}>
                      <strong>What happens next?</strong> Your teacher will review your result and get back to you directly.
                      Curriculate does not change grades — only your teacher can do that.
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const url = `https://www.curriculate.net/results/${code}`;
                        const name = (reviewStudentName || "").trim();
                        const tch = (reviewTeacherName || "").trim();
                        const sch = (reviewSchool || "").trim();
                        const cls = (reviewClass || "").trim();
                        const reason = (reviewText || "").trim();
                        const lines = [
                          tch ? `Dear ${tch},` : "Dear Teacher,",
                          "",
                          `My name is ${name || "a student"}${sch ? ` from ${sch}` : ""}${cls ? ` in ${cls}` : ""}. I recently completed an activity on Curriculate and received a grade for result code ${code}.`,
                          "",
                          "I would like to respectfully request a review of my grade. Here is my reason:",
                          "",
                          reason,
                          "",
                          `You can view my full result here: ${url}`,
                          "",
                          "Thank you for taking the time to look at this. I really appreciate it!",
                          "",
                          `${name || "Your student"}`,
                          "",
                          "---",
                          "Sent via Curriculate — curriculate.net",
                        ];
                        const text = lines.join("\n");

                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          navigator.clipboard.writeText(text).then(() => {
                            setClipboardCopied(true);
                            setTimeout(() => setClipboardCopied(false), 3000);
                          }).catch(() => {
                            // Fallback
                            window.prompt("Copy this message:", text);
                          });
                        } else {
                          window.prompt("Copy this message:", text);
                        }
                      }}
                      style={{
                        width: "100%", padding: "10px 14px", borderRadius: 10,
                        fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center",
                        border: clipboardCopied ? "1px solid #22c55e" : "1px solid #2563eb",
                        background: clipboardCopied ? "#dcfce7" : "#eff6ff",
                        color: clipboardCopied ? "#15803d" : "#1d4ed8",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {clipboardCopied ? "Copied! Paste it in Google Classroom, Remind, email, etc." : "Copy message for your teacher"}
                    </button>
                    <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 6 }}>
                      Paste into Google Classroom, Remind, email, or any messaging app
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                      How was this experience?
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 10 }}>
                      I am a…
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      {[
                        { key: "student", label: "Student", emoji: "\uD83C\uDF93" },
                        { key: "parent", label: "Parent / Guardian", emoji: "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67" },
                      ].map((r) => (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => { setFbRole(r.key); setReviewMode(false); }}
                          style={{
                            flex: 1, padding: "8px 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                            border: fbRole === r.key && !reviewMode ? "2px solid #2563eb" : "1px solid #cbd5e1",
                            background: fbRole === r.key && !reviewMode ? "#eff6ff" : "white",
                            color: fbRole === r.key && !reviewMode ? "#1d4ed8" : "#334155",
                            cursor: "pointer",
                          }}
                        >
                          {r.emoji} {r.label}
                        </button>
                      ))}
                    </div>

                    {/* Grade review request button */}
                    {!reviewMode && (
                      <button
                        type="button"
                        onClick={() => { setReviewMode(true); if (!fbRole) setFbRole("student"); }}
                        style={{
                          width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                          border: "1px solid #fbbf24", background: "#fffbeb", color: "#92400e",
                          cursor: "pointer", marginBottom: 10, textAlign: "center",
                        }}
                      >
                        Please review my grade
                      </button>
                    )}

                    {/* Grade review expansion */}
                    {reviewMode && (
                      <div style={{
                        padding: 14, borderRadius: 10, background: "#fffbeb",
                        border: "1px solid #fbbf24", marginBottom: 10,
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#92400e", marginBottom: 6 }}>
                          Request a grade review
                        </div>
                        <div style={{ fontSize: 12, color: "#78716c", marginBottom: 10, lineHeight: 1.4 }}>
                          We'll send your teacher a polite message with your request and a link to this result.
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                          <label style={{ display: "block" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 3 }}>Your name *</div>
                            <input
                              value={reviewStudentName}
                              onChange={(e) => { setReviewStudentName(e.target.value); setReviewEmailError(""); }}
                              placeholder="First and last name"
                              style={{
                                width: "100%", padding: "7px 10px", border: "1px solid #fbbf24",
                                borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "#334155", background: "white",
                              }}
                            />
                          </label>
                          <label style={{ display: "block" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 3 }}>School</div>
                            <input
                              value={reviewSchool}
                              onChange={(e) => setReviewSchool(e.target.value)}
                              placeholder="School name"
                              style={{
                                width: "100%", padding: "7px 10px", border: "1px solid #fbbf24",
                                borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "#334155", background: "white",
                              }}
                            />
                          </label>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                          <label style={{ display: "block" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 3 }}>Class / Subject</div>
                            <input
                              value={reviewClass}
                              onChange={(e) => setReviewClass(e.target.value)}
                              placeholder="e.g. Grade 7 Math"
                              style={{
                                width: "100%", padding: "7px 10px", border: "1px solid #fbbf24",
                                borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "#334155", background: "white",
                              }}
                            />
                          </label>
                          <label style={{ display: "block" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 3 }}>Teacher's name *</div>
                            <input
                              value={reviewTeacherName}
                              onChange={(e) => { setReviewTeacherName(e.target.value); setReviewEmailError(""); }}
                              placeholder="Mr./Ms./Mrs. …"
                              style={{
                                width: "100%", padding: "7px 10px", border: "1px solid #fbbf24",
                                borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "#334155", background: "white",
                              }}
                            />
                          </label>
                        </div>

                        <label style={{ display: "block", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 3 }}>Teacher's email *</div>
                          <input
                            type="email"
                            value={reviewEmail}
                            onChange={(e) => { setReviewEmail(e.target.value); setReviewEmailError(""); }}
                            placeholder="teacher@school.edu"
                            style={{
                              width: "100%", padding: "7px 10px", border: "1px solid #fbbf24",
                              borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "#334155", background: "white",
                            }}
                          />
                        </label>

                        <label style={{ display: "block", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 3 }}>Why should this grade be reviewed? *</div>
                          <textarea
                            value={reviewText}
                            onChange={(e) => { setReviewText(e.target.value); setReviewEmailError(""); }}
                            placeholder="e.g. I think Q3 should be marked correct because…"
                            style={{
                              width: "100%", minHeight: 80, border: "1px solid #fbbf24", borderRadius: 8,
                              padding: 10, fontSize: 13, lineHeight: 1.5, resize: "vertical",
                              fontFamily: "inherit", color: "#334155", background: "white",
                            }}
                          />
                        </label>

                        {reviewEmailError && (
                          <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>{reviewEmailError}</div>
                        )}

                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => { setReviewMode(false); setReviewEmailError(""); }}
                            style={{
                              padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                              border: "1px solid #cbd5e1", background: "white", color: "#64748b",
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={submitGradeReview}
                            disabled={reviewSending}
                            style={{
                              padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                              border: "none", background: "#f59e0b", color: "white", cursor: "pointer",
                              opacity: reviewSending ? 0.6 : 1,
                            }}
                          >
                            {reviewSending ? "Sending…" : "Submit review request"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Regular feedback textarea */}
                    {fbRole && !reviewMode && (
                      <>
                        <textarea
                          value={fbText}
                          onChange={(e) => setFbText(e.target.value)}
                          placeholder={
                            fbRole === "student"
                              ? "Was the feedback helpful? Anything confusing?"
                              : "Is this report clear and useful? Any suggestions?"
                          }
                          style={{
                            width: "100%", minHeight: 70, border: "1px solid #cbd5e1", borderRadius: 8,
                            padding: 10, fontSize: 13, lineHeight: 1.5, resize: "vertical",
                            fontFamily: "inherit", color: "#334155",
                          }}
                          autoFocus
                        />
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                          <button
                            type="button"
                            onClick={submitResultsFeedback}
                            disabled={fbSending || !(fbText || "").trim()}
                            style={{
                              padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                              border: "none", background: "#2563eb", color: "white", cursor: "pointer",
                              opacity: (fbText || "").trim() ? 1 : 0.5,
                            }}
                          >
                            {fbSending ? "Sending…" : "Send feedback"}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

            </>
          ) : (
            // Fallback: show payload as-is
            <Card title="Feedback">
              {typeof data.payload === "string" ? (
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                  {linkifyTextToReactNodes(data.payload)}
                </div>
              ) : (
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {JSON.stringify(data.payload, null, 2)}
                </pre>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
