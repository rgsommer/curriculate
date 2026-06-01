// /teebee-console — cross-app activity dashboard for the TeeBee suite.
// Superuser (clearance 4) sees every product and company; Principal (clearance
// 3) sees the firm's client work plus their own company's accounting. Same
// page, the API scopes the data. Reuses TeebeePay auth (sign into /audit/app
// or /teebeepay/app first).
"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2, AlertCircle, RefreshCw, ArrowLeft, Send, CheckCircle2, Clock,
  ClipboardCheck, Calculator, Landmark, FileText, X,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", cream: "#fffaf0",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8", red: "#b9302a", green: "#16a34a",
};
const TOKEN_KEY = "teebeepay.authToken";
const APP_ICON = { audit: ClipboardCheck, tax: Calculator, loans: Landmark, payroll: FileText };

async function api(path, opts = {}) {
  const tok = (typeof window !== "undefined") ? localStorage.getItem(TOKEN_KEY) : null;
  if (!tok) throw new Error("Not signed in — open /audit/app or /teebeepay/app first.");
  const headers = { ...(opts.headers || {}), "Content-Type": "application/json", "Authorization": "Bearer " + tok };
  const r = await fetch(path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

function relTime(d) {
  if (!d) return "—";
  const t = new Date(d).getTime();
  if (isNaN(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString();
}

export default function TeeBeeConsole() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [reqFor, setReqFor] = useState(null);   // entity for request-info modal

  const refresh = useCallback(async () => {
    setError("");
    try { setData(await api("/api/teebee/activity")); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <main style={{ minHeight: "100vh", background: "#f7f8fa", color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "16px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/audit/admin" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#cbd5e1", textDecoration: "none", fontSize: 13 }}>
          <ArrowLeft size={14} /> Audit queue
        </Link>
        <div style={{ width: 1, height: 22, background: "#3a526b" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: C.gold, color: C.navy,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>TB</div>
          <strong style={{ fontSize: 16 }}>TeeBee Console</strong>
        </div>
        {data?.scope && (
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.05,
            padding: "3px 9px", borderRadius: 99, background: data.scope === "all" ? C.gold : "#3a526b",
            color: data.scope === "all" ? C.navy : "#cbd5e1" }}>
            {data.scope === "all" ? "Superuser — all activity" : "Principal"}
          </span>
        )}
        <button onClick={refresh} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", background: "transparent", color: "#cbd5e1", border: "1px solid #3a526b",
          borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </header>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px" }}>
        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fecaca", color: "#7f1d1d",
            padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {info && (
          <div style={{ background: "#dcfce7", border: "1px solid #bbf7d0", color: "#14532d",
            padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{info}</div>
        )}

        {!data && !error && (
          <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
            <Loader2 size={20} className="spin" style={{ verticalAlign: -4, marginRight: 6 }} /> Loading activity…
          </div>
        )}

        {data?.apps?.map((app) => (
          <AppSection key={app.key} app={app} onRequestInfo={setReqFor} />
        ))}
      </div>

      {reqFor && (
        <RequestInfoModal entity={reqFor} onClose={() => setReqFor(null)}
          onDone={(msg) => { setReqFor(null); setInfo(msg); refresh(); }} />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .spin { animation: spin .9s linear infinite; }`}</style>
    </main>
  );
}

function AppSection({ app, onRequestInfo }) {
  const Icon = APP_ICON[app.key] || FileText;
  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, marginBottom: 20, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid #f1f3f5" }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: C.goldSoft, color: C.navy,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={17} />
        </div>
        <div style={{ flex: 1 }}>
          <strong style={{ fontSize: 15 }}>{app.label}</strong>
          <div style={{ fontSize: 12, color: C.muted }}>
            {app.active} active · {app.total} total
          </div>
        </div>
      </div>
      {app.entities.length === 0 ? (
        <div style={{ padding: "22px 18px", color: C.muted, fontSize: 13 }}>No {app.unit}s yet.</div>
      ) : (
        <div>
          {app.entities.map((e) => (
            <EntityRow key={e.id} entity={e} stepLabels={app.stepLabels} onRequestInfo={onRequestInfo} />
          ))}
        </div>
      )}
    </section>
  );
}

function EntityRow({ entity, stepLabels, onRequestInfo }) {
  const need = entity.outstanding?.need || [];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", borderTop: "1px solid #f6f7f9", flexWrap: "wrap" }}>
      <div style={{ minWidth: 220, flex: "1 1 240px" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{entity.name}</div>
        {entity.subtitle && <div style={{ fontSize: 12, color: C.muted }}>{entity.subtitle}</div>}
      </div>

      <div style={{ flex: "2 1 320px", minWidth: 260 }}>
        <Stepper steps={entity.steps} />
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5 }}>
          {entity.stageLabel} · step {entity.stageIndex}/{entity.total}
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 5, minWidth: 84 }}>
        <Clock size={12} /> {relTime(entity.lastActivity)}
      </div>

      <div style={{ minWidth: 150, textAlign: "right" }}>
        {entity.canRequestInfo ? (
          need.length > 0 ? (
            <button onClick={() => onRequestInfo(entity)} style={reqBtn}>
              <Send size={12} /> Request {need.length} doc{need.length === 1 ? "" : "s"}
            </button>
          ) : (
            <button onClick={() => onRequestInfo(entity)} style={{ ...reqBtn, background: "#fff", color: C.navy }}>
              <CheckCircle2 size={12} color={C.green} /> All in · update
            </button>
          )
        ) : (
          <span style={{ fontSize: 11.5, color: C.muted, textTransform: "capitalize" }}>{entity.status}</span>
        )}
      </div>
    </div>
  );
}

function Stepper({ steps }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {steps.map((s, i) => (
        <div key={i} title={s.label} style={{ flex: 1, height: 7, borderRadius: 99,
          background: s.done ? C.gold : "#e5e7eb" }} />
      ))}
    </div>
  );
}

function RequestInfoModal({ entity, onClose, onDone }) {
  const [have, setHave] = useState((entity.outstanding?.have || []).join("\n"));
  const [need, setNeed] = useState((entity.outstanding?.need || []).join("\n"));
  const [note, setNote] = useState(entity.outstanding?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(email) {
    setBusy(true); setError("");
    try {
      const body = {
        have: have.split("\n").map((s) => s.trim()).filter(Boolean),
        need: need.split("\n").map((s) => s.trim()).filter(Boolean),
        note, email,
      };
      const j = await api(`/api/audit/engagements/${entity.id}/request-info`, { method: "POST", body: JSON.stringify(body) });
      onDone(email
        ? (j.email_sent ? `Outstanding list emailed to the client for ${entity.name}.` : `Recorded for ${entity.name} (no email — client has no contact address on file).`)
        : `Recorded outstanding items for ${entity.name}.`);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", background: "#fff", borderRadius: 14,
        maxWidth: 560, width: "100%", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 12, right: 12, width: 28, height: 28,
          borderRadius: 7, border: "none", background: "#f1f3f5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={15} color={C.muted} />
        </button>
        <div style={{ background: "linear-gradient(135deg, #fffaf0 0%, #fef6d8 100%)", padding: "18px 22px", borderBottom: "1px solid #fde68a" }}>
          <div style={{ fontSize: 11, color: "#9c6c00", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.06 }}>Outstanding documents</div>
          <h3 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800, color: C.ink }}>{entity.name}</h3>
        </div>
        <div style={{ padding: "20px 22px" }}>
          {error && <div style={{ background: "#fee2e2", border: "1px solid #fecaca", color: "#7f1d1d", padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}
          <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px" }}>
            Prefilled from the checklist (received vs missing). Edit freely — one item per line.
          </p>
          <Field label="Received (one per line)">
            <textarea style={ta} value={have} onChange={(e) => setHave(e.target.value)} placeholder="Trial balance&#10;General ledger" />
          </Field>
          <Field label="Still needed (one per line)">
            <textarea style={ta} value={need} onChange={(e) => setNeed(e.target.value)} placeholder="Bank statements&#10;Prior-year financials" />
          </Field>
          <Field label="Note to the client (optional)">
            <textarea style={{ ...ta, minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "14px 22px", borderTop: "1px solid #f1f5f9", flexWrap: "wrap" }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={() => submit(false)} disabled={busy} style={btnGhost}>Record only</button>
          <button onClick={() => submit(true)} disabled={busy} style={btnPrimary}>
            {busy ? <><Loader2 size={14} className="spin" style={{ marginRight: 6 }} /> Working…</> : <><Send size={14} style={{ marginRight: 6 }} /> Record &amp; email client</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.04 }}>{label}</span>
      {children}
    </label>
  );
}

const ta = { display: "block", width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #d1d5db",
  fontSize: 14, background: "#fff", color: C.ink, outline: "none", minHeight: 84, resize: "vertical", fontFamily: "inherit" };
const reqBtn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 7,
  fontSize: 12, fontWeight: 700, background: C.navy, color: "#fff", border: "1px solid " + C.navy, cursor: "pointer" };
const btnGhost = { display: "inline-flex", alignItems: "center", padding: "9px 16px", borderRadius: 8,
  background: "#fff", color: C.ink, fontWeight: 600, fontSize: 14, border: "1px solid #d1d5db", cursor: "pointer" };
const btnPrimary = { display: "inline-flex", alignItems: "center", padding: "9px 16px", borderRadius: 8,
  background: C.navy, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer" };
