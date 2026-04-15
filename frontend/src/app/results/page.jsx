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
    evidenceLinks: [],     // ✅ NEW
    evidenceText: "",      // ✅ NEW
    savedCaptures: [],
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

  const headingSet = new Set([
    "Links / evidence:",
    "Submitted text (evidence):",
    "Deduction:",
    "Strengths:",
    "Next Steps:",
    "Overall Comment:",
    "Sections:",
    "Saved captures (30-day links):",
  ]);

  const bucket = {
    "Links / evidence:": "evidenceLinks",
    "Submitted text (evidence):": "evidenceText",
    "Deduction:": "deduction",
    "Strengths:": "strengths",
    "Next Steps:": "nextSteps",
    "Overall Comment:": "overallComment",
    "Sections:": "sections",
    "Saved captures (30-day links):": "savedCaptures",
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

    // Links / evidence: and Saved captures: are list-ish
    if (current === "Links / evidence:" || current === "Saved captures (30-day links):") {
      const t = ln.trim();
      if (!t) continue;
      out[bucket[current]].push(t);
      continue;
    }

    if (current === "Sections:") {
      const raw = ln;              // keep raw line
      const trimmed = raw.trim();

      // Start a new section ONLY for bullets that look like section headers.
      // e.g. "- Part A — Matching: 10/10 — ..."
      if (raw.startsWith("- ")) {
        const afterDash = raw.slice(2).trim();

        const isSectionHeader =
          /^Part\s+[A-Z0-9]+\b/i.test(afterDash) ||          // Part A, Part 1, etc
          /^Section\b/i.test(afterDash);                     // Section ...

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
    out.evidenceLinks.length ||        // ✅ NEW
    out.evidenceText.trim() ||         // ✅ NEW
    out.savedCaptures.length;

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

              {parsed.overallComment ? (
                <Card title="Overall comment">
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                    {linkifyTextToReactNodes(parsed.overallComment)}
                  </div>
                </Card>
              ) : null}

              {parsed.sections.length ? (
                <Card title="Sections">
                  <div style={{ display: "grid", gap: 10 }}>
                    {parsed.sections.map((sec, i) => (
                      <div
                        key={i}
                        style={{
                          border: "1px solid rgba(0,0,0,.08)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(15,23,42,.02)",
                        }}
                      >
                        <div>
                          {renderSectionTitle(sec.title)}
                        </div>

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
                    ))}
                  </div>
                </Card>
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

              {parsed.savedCaptures.length ? (
                <Card title="Saved captures (30-day links)">
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                    {parsed.savedCaptures.map((x, i) => (
                      <li key={i}>{linkifyTextToReactNodes(x)}</li>
                    ))}
                  </ul>
                </Card>
              ) : null}

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
