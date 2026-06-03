// /teebee-console/chat — grounded Q&A for the Principal. Pick a client, ask
// anything about their audit / tax / loan / payroll work; answers come only
// from that client's records. Reuses TeebeePay auth.
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Loader2, MessageSquare, Building2 } from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  navy: "#0f2c52", gold: "#c9a227", goldSoft: "#fef6d8", line: "#e5e7eb", red: "#b9302a",
};
const TOKEN_KEY = "teebeepay.authToken";

async function api(path, opts = {}) {
  const tok = (typeof window !== "undefined") ? localStorage.getItem(TOKEN_KEY) : null;
  if (!tok) throw new Error("Not signed in — open /audit/app or /teebeepay/app first.");
  const headers = { ...(opts.headers || {}), "Content-Type": "application/json", "Authorization": "Bearer " + tok };
  const r = await fetch(path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

const SUGGESTIONS = [
  "What's still outstanding on the audit?",
  "Summarise the key findings.",
  "What's the tax position for the latest return?",
  "Is this client loan-ready, and what are the gaps?",
];

export default function ConsoleChatPage() {
  const [company, setCompany] = useState("");
  const [companies, setCompanies] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  // Build a datalist of known client names from the activity rollup.
  useEffect(() => {
    (async () => {
      try {
        const j = await api("/api/teebee/activity");
        const names = new Set();
        (j.apps || []).forEach((a) => (a.entities || []).forEach((e) => e.name && names.add(e.name)));
        setCompanies(Array.from(names).sort());
      } catch { /* non-fatal */ }
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = useCallback(async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setError(""); setInput("");
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const j = await api("/api/teebee/ask", { method: "POST", body: JSON.stringify({ company, question: q, history }) });
      setMessages((m) => [...m, { role: "assistant", content: j.answer || "(no answer)", sources: j.sources }]);
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: "assistant", content: "I couldn't answer that just now. " + e.message, isError: true }]);
    } finally { setBusy(false); }
  }, [input, busy, messages, company]);

  return (
    <main style={{ minHeight: "100vh", background: "#f7f8fa", color: C.ink, display: "flex", flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "14px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/teebee-console" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#cbd5e1", textDecoration: "none", fontSize: 13 }}>
          <ArrowLeft size={14} /> Console
        </Link>
        <div style={{ width: 1, height: 22, background: "#3a526b" }} />
        <MessageSquare size={16} color={C.gold} />
        <strong style={{ fontSize: 16 }}>Ask</strong>
        <span style={{ fontSize: 12, color: "#9fb3cc" }}>questions about a client's audit, tax, loan & payroll</span>
      </header>

      {/* Company picker */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${C.line}`, padding: "12px 24px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Building2 size={15} color={C.muted} />
        <input list="tb-companies" value={company} onChange={(e) => setCompany(e.target.value)}
          placeholder="Client / company name (e.g. Infinite Wood Builders Limited 2025)"
          style={{ flex: 1, minWidth: 260, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, outline: "none" }} />
        <datalist id="tb-companies">{companies.map((n) => <option key={n} value={n} />)}</datalist>
        {!company && <span style={{ fontSize: 12, color: C.muted }}>Pick a client to ground the answers in their records.</span>}
      </div>

      {/* Thread */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", color: C.muted, padding: "40px 0" }}>
              <MessageSquare size={28} color={C.gold} />
              <p style={{ fontSize: 15, marginTop: 12 }}>Ask anything about a client's engagement.</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} style={{ fontSize: 12.5, padding: "7px 12px", borderRadius: 999,
                    border: `1px solid ${C.line}`, background: "#fff", color: C.navy, cursor: "pointer" }}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
              <div style={{ maxWidth: "80%", padding: "11px 14px", borderRadius: 12, fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap",
                background: m.role === "user" ? C.navy : (m.isError ? "#fef2f2" : "#fff"),
                color: m.role === "user" ? "#fff" : (m.isError ? C.red : C.ink),
                border: m.role === "user" ? "none" : `1px solid ${C.line}` }}>
                {m.content}
                {m.role === "assistant" && !m.isError && m.sources === 0 && (
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>No records matched that client name — check the spelling or pick from the list.</div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
              <div style={{ padding: "11px 14px", borderRadius: 12, background: "#fff", border: `1px solid ${C.line}`, color: C.muted, fontSize: 13 }}>
                <Loader2 size={14} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} /> Thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${C.line}`, background: "#fff", padding: "12px 24px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask a question…  (Enter to send, Shift+Enter for a new line)"
            rows={1} style={{ flex: 1, padding: "11px 13px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14,
              resize: "none", maxHeight: 140, fontFamily: "inherit", outline: "none" }} />
          <button onClick={() => send()} disabled={busy || !input.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 6,
            padding: "11px 18px", borderRadius: 10, border: "none", background: C.navy, color: "#fff", fontWeight: 600, fontSize: 14,
            cursor: busy || !input.trim() ? "default" : "pointer", opacity: busy || !input.trim() ? 0.6 : 1 }}>
            <Send size={15} /> Send
          </button>
        </div>
        {error && <div style={{ maxWidth: 820, margin: "8px auto 0", color: C.red, fontSize: 12.5 }}>{error}</div>}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .spin { animation: spin .9s linear infinite; }`}</style>
    </main>
  );
}
