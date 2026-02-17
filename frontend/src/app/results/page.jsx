"use client";

import React, { useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

function normalizeCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function linkifyTextToReactNodes(text) {
  const s = String(text || "");

  // Match:
  // - https://...
  // - http://...
  // - www....
  const urlRe = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

  const parts = s.split(urlRe);

  return parts.map((part, i) => {
    if (!part) return null;

    const isUrl = urlRe.test(part);
    // Reset regex state (because we used .test with /g)
    urlRe.lastIndex = 0;

    if (!isUrl) return part;

    const href = part.startsWith("www.") ? `https://${part}` : part;

    return (
      <a
        key={`u-${i}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: "underline" }}
      >
        {part}
      </a>
    );
  });
}

export default function ResultsPage() {
  const [codeInput, setCodeInput] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | error | ok
  const [data, setData] = useState(null);

  const code = useMemo(() => normalizeCode(codeInput), [codeInput]);

  async function onSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setData(null);

    try {
      const r = await fetch(`${API_BASE}/results/${code}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Code not found.");

      setData(j);
      setStatus("ok");
    } catch (err) {
      setStatus("error");
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 16px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>View Feedback</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Enter the reference code written on the paper (expires after 30 days).
      </p>

      <form onSubmit={onSubmit} style={{ display: "flex", gap: 10, marginTop: 16 }}>
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
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,.2)",
          }}
        />
        <button
          type="submit"
          disabled={code.length !== 5 || status === "loading"}
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,.2)",
            cursor: "pointer",
          }}
        >
          {status === "loading" ? "Loading…" : "View"}
        </button>
      </form>

      {status === "error" && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: "1px solid rgba(0,0,0,.15)" }}>
          Code not found.
        </div>
      )}

      {status === "ok" && data && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 12, border: "1px solid rgba(0,0,0,.15)" }}>
          {/* Render nicely if payload is structured JSON; otherwise show as text */}
          {typeof data.payload === "string" ? (
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {linkifyTextToReactNodes(data.payload)}
            </pre>

          ) : (
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {JSON.stringify(data.payload, null, 2)}
            </pre>
          )}

          <div style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>
            Expires: {data.expiresAt ? new Date(data.expiresAt).toLocaleString() : "—"}
          </div>
        </div>
      )}
    </div>
  );
}
