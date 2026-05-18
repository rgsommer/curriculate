// frontend/src/app/teebeepay/app/diag/page.jsx
//
// Sign-in-required diagnostic page. Calls /api/teebeepay/diag with the
// stored auth token and renders the JSON response. Useful for verifying
// which Mongo cluster + database the live Vercel function is connecting to.
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

const TOKEN_KEY = "teebeepay.authToken";
const C = {
  red: "#b9302a", gold: "#f4b400", ink: "#0f172a",
  inkSoft: "#334155", muted: "#64748b",
};

export default function DiagPage() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    (async () => {
      try {
        const tok = localStorage.getItem(TOKEN_KEY);
        if (!tok) { setState({ error: "Not signed in. Visit /teebeepay/app first." }); return; }
        const res = await fetch("/api/teebeepay/diag", {
          headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
        });
        const j = await res.json();
        if (!res.ok) { setState({ error: j.error || `HTTP ${res.status}` }); return; }
        setState({ data: j });
      } catch (e) { setState({ error: String(e?.message || e) }); }
    })();
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: "#f6f7f9", color: C.ink, padding: 28,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link href="/teebeepay/app" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: C.muted, fontSize: 13, fontWeight: 500, textDecoration: "none", marginBottom: 16,
        }}>
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
        <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800 }}>Diagnostics</h1>
        <p style={{ color: C.muted, fontSize: 14, margin: "0 0 22px" }}>
          Which Atlas cluster + database is the live Vercel function connected to, and what's in it.
        </p>

        {state.loading && <Loader2 className="tbp-spin" size={24} color={C.red} />}

        {state.error && (
          <div style={{
            background: "#fee2e2", color: "#991b1b", padding: "12px 16px", borderRadius: 8,
            fontSize: 14, display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span><strong>Diagnostic failed.</strong> {state.error}</span>
          </div>
        )}

        {state.data && (
          <>
            <DataCard title="Cluster" mono>{state.data.cluster}</DataCard>
            <DataCard title="Database name">
              <strong style={{ fontSize: 18 }}>{state.data.dbName}</strong>{" "}
              <span style={{ color: C.muted, fontSize: 13 }}>
                {state.data.dbName === "pngpay"
                  ? <CheckCircle2 size={14} style={{ display: "inline", verticalAlign: "middle", color: "#16a34a" }} />
                  : <span style={{ color: "#b91c1c" }}>← expected "pngpay"</span>}
              </span>
            </DataCard>
            <DataCard title="Databases on this cluster">
              {state.data.databases_on_cluster.map(d => (
                <span key={d} style={{
                  display: "inline-block", padding: "3px 10px", marginRight: 6, marginBottom: 4,
                  background: d === state.data.dbName ? "#fff7e0" : "#f1f5f9",
                  color: d === state.data.dbName ? "#9c6c00" : C.muted,
                  borderRadius: 999, fontSize: 12, fontWeight: 600,
                }}>{d}</span>
              ))}
            </DataCard>
            <DataCard title="Collection counts in the connected DB">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <tbody>
                  {Object.entries(state.data.counts).map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 0", color: C.inkSoft }}>{k}</td>
                      <td style={{ padding: "8px 0", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataCard>
            <details style={{ marginTop: 18 }}>
              <summary style={{ cursor: "pointer", color: C.muted, fontSize: 13 }}>Raw JSON</summary>
              <pre style={{ background: "#0f172a", color: "#cbd5e1", padding: 14, borderRadius: 8,
                fontSize: 12, overflow: "auto", marginTop: 8 }}>
                {JSON.stringify(state.data, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
      <style>{`@keyframes tbp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .tbp-spin { animation: tbp-spin .9s linear infinite; }`}</style>
    </div>
  );
}

function DataCard({ title, mono, children }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18, marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.08, marginBottom: 8 }}>{title}</div>
      <div style={{ fontFamily: mono ? "ui-monospace, Menlo, Consolas, monospace" : undefined, wordBreak: "break-all", fontSize: 14, color: "#0f172a" }}>
        {children}
      </div>
    </div>
  );
}
