// /audit/admin — Theresia's review queue. Reuses TeebeePay auth — sign into
// /teebeepay/app first (Principal+), then visit this URL.
"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, Mail, Phone, Building2,
  Edit2, RefreshCw, Filter, Search,
} from "lucide-react";

const C = {
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  paper: "#ffffff", cream: "#fffaf0",
  navy: "#0f2c52", navyDeep: "#081d3a",
  gold: "#c9a227", goldSoft: "#fef6d8",
  red: "#b9302a",
};

const TOKEN_KEY = "teebeepay.authToken";
const STATUSES = [
  { v: "inquiry",   l: "Inquiry",   color: "#9c6c00", bg: "#fef3c7" },
  { v: "engaged",   l: "Engaged",   color: "#1d4ed8", bg: "#dbeafe" },
  { v: "active",    l: "Active",    color: "#7c2d12", bg: "#fed7aa" },
  { v: "review",    l: "Review",    color: "#5b21b6", bg: "#ede9fe" },
  { v: "delivered", l: "Delivered", color: "#14532d", bg: "#dcfce7" },
  { v: "lost",      l: "Lost",      color: "#7f1d1d", bg: "#fee2e2" },
];

const AUDIT_TYPE_LABELS = {
  statutory: "Statutory audit", readiness: "Audit-readiness review",
  tax: "Tax / IRC due diligence", compliance: "Compliance audit",
  donor_fund: "Donor-funded / SPV", landowner: "Landowner company",
  other: "Other",
};

async function api(path, opts = {}) {
  const tok = (typeof window !== "undefined") ? localStorage.getItem(TOKEN_KEY) : null;
  if (!tok) throw new Error("Not signed in — open /teebeepay/app first as Principal+");
  const headers = { ...(opts.headers || {}), "Content-Type": "application/json", "Authorization": "Bearer " + tok };
  const r = await fetch(path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

export default function AuditAdminPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const j = await api("/api/audit/engagements");
      setRows(j.engagements || []);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const filtered = (rows || []).filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (q) {
      const hay = `${r.company_name} ${r.contact_name} ${r.contact_email}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const counts = STATUSES.reduce((m, s) => {
    m[s.v] = (rows || []).filter((r) => r.status === s.v).length;
    return m;
  }, {});

  return (
    <main style={{
      minHeight: "100vh", background: "#f7f8fa", color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <header style={{
        background: C.navy, color: "#fff", padding: "16px 24px",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <Link href="/teebeepay/app" style={{ display: "inline-flex", alignItems: "center", gap: 6,
                                              color: "#cbd5e1", textDecoration: "none", fontSize: 13 }}>
          <ArrowLeft size={14} /> TeebeePay
        </Link>
        <div style={{ width: 1, height: 22, background: "#3a526b" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: C.gold, color: C.navy,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800,
          }}>TBA</div>
          <strong style={{ fontSize: 16 }}>Tee Bee Audit — Admin queue</strong>
        </div>
        <button onClick={refresh} style={{
          marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", background: "transparent", color: "#cbd5e1",
          border: "1px solid #3a526b", borderRadius: 8, fontSize: 13, cursor: "pointer",
        }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </header>

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 24px" }}>
        {error && (
          <div style={{
            background: "#fee2e2", border: "1px solid #fecaca", color: "#7f1d1d",
            padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 14,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Status tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                       gap: 12, marginBottom: 22 }}>
          <Tile label="Total" value={(rows || []).length} active={filter === "all"}
            onClick={() => setFilter("all")} />
          {STATUSES.map((s) => (
            <Tile key={s.v} label={s.l} value={counts[s.v] || 0}
              color={s.color} bg={s.bg} active={filter === s.v}
              onClick={() => setFilter(filter === s.v ? "all" : s.v)} />
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", top: 11, left: 10, color: C.muted }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, contact, email…"
              style={{ ...input, paddingLeft: 32, width: 320 }} />
          </div>
          <span style={{ color: C.muted, fontSize: 13 }}>
            <Filter size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            {filter === "all" ? "All statuses" : `Filtered: ${STATUSES.find((s) => s.v === filter)?.l}`}
            {" · "}{filtered.length} of {(rows || []).length}
          </span>
        </div>

        {/* Table */}
        {rows == null ? (
          <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
            <Loader2 size={20} className="spin" style={{ verticalAlign: -4, marginRight: 6 }} /> Loading inquiries…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", background: "#fff",
                         border: "1px solid #e5e7eb", borderRadius: 10, color: C.muted }}>
            {(rows || []).length === 0
              ? "No audit inquiries yet. Share the /audit landing page to get the first one."
              : "No engagements match your filter."}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#fafbfc", textAlign: "left",
                              fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.06 }}>
                  <th style={th}>Company / contact</th>
                  <th style={th}>Audit type</th>
                  <th style={th}>FY end</th>
                  <th style={{ ...th, textAlign: "right" }}>Indic. fee (PGK)</th>
                  <th style={th}>Status</th>
                  <th style={th}>Received</th>
                  <th style={{ ...th, width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const st = STATUSES.find((s) => s.v === r.status) || STATUSES[0];
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.company_name}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                          {r.contact_name}{r.contact_role ? ` · ${r.contact_role}` : ""}
                          <br />
                          <a href={`mailto:${r.contact_email}`} style={{ color: C.navy }}>{r.contact_email}</a>
                          {r.contact_phone && <> · {r.contact_phone}</>}
                        </div>
                      </td>
                      <td style={{ ...td, color: C.inkSoft }}>{AUDIT_TYPE_LABELS[r.audit_type] || r.audit_type}</td>
                      <td style={{ ...td, color: C.muted }}>{r.fy_end || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {r.agreed_fee != null ? (
                          <strong>{Number(r.agreed_fee).toLocaleString()}</strong>
                        ) : (
                          <span style={{ color: C.muted }}>
                            {r.indicative_fee_low?.toLocaleString()}–{r.indicative_fee_high?.toLocaleString()}
                          </span>
                        )}
                      </td>
                      <td style={td}>
                        <span style={{
                          padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                          textTransform: "uppercase", letterSpacing: 0.05,
                          color: st.color, background: st.bg,
                        }}>{st.l}</span>
                      </td>
                      <td style={{ ...td, fontSize: 12, color: C.muted }}>
                        {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button onClick={() => setEditing(r)} style={btnGhost}>
                          <Edit2 size={12} /> Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <EngagementDialog engagement={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); }} />}

      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .spin { animation: spin .9s linear infinite; }`}</style>
    </main>
  );
}

function Tile({ label, value, color, bg, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "12px 16px", borderRadius: 10,
      background: active ? (bg || "#0f2c52") : "#fff",
      border: `1px solid ${active ? (color || "#0f2c52") : "#e5e7eb"}`,
      color: active ? (color || "#fff") : C.ink,
      textAlign: "left", cursor: "pointer", fontFamily: "inherit",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.04 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </button>
  );
}

function EngagementDialog({ engagement, onClose, onSaved }) {
  const [f, setF] = useState({
    status: engagement.status || "inquiry",
    agreed_fee: engagement.agreed_fee ?? "",
    admin_notes: engagement.admin_notes || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setSubmitting(true); setError("");
    try {
      await api(`/api/audit/engagements/${engagement.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: f.status,
          agreed_fee: f.agreed_fee === "" ? null : Number(f.agreed_fee),
          admin_notes: f.admin_notes,
        }),
      });
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, maxWidth: 640, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden",
      }}>
        <div style={{ background: "linear-gradient(135deg, #fffaf0 0%, #fef6d8 100%)",
                       padding: "18px 22px", borderBottom: "1px solid #fde68a" }}>
          <div style={{ fontSize: 11, color: "#9c6c00", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.06 }}>
            Audit engagement
          </div>
          <h3 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800, color: C.ink }}>
            {engagement.company_name}
          </h3>
        </div>
        <div style={{ padding: "20px 22px" }}>
          {error && (
            <div style={{
              background: "#fee2e2", border: "1px solid #fecaca", color: "#7f1d1d",
              padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13,
            }}>{error}</div>
          )}
          <div style={{ background: "#fafbfc", border: "1px solid #e5e7eb", borderRadius: 8,
                         padding: 12, marginBottom: 16, fontSize: 13, color: C.inkSoft }}>
            <div><strong>Contact:</strong> {engagement.contact_name} {engagement.contact_role ? `· ${engagement.contact_role}` : ""}</div>
            <div style={{ marginTop: 2 }}><Mail size={12} style={{ verticalAlign: -2 }} /> <a href={`mailto:${engagement.contact_email}`} style={{ color: C.navy }}>{engagement.contact_email}</a></div>
            {engagement.contact_phone && <div style={{ marginTop: 2 }}><Phone size={12} style={{ verticalAlign: -2 }} /> {engagement.contact_phone}</div>}
            <div style={{ marginTop: 6 }}>
              <strong>{AUDIT_TYPE_LABELS[engagement.audit_type] || engagement.audit_type}</strong>
              {engagement.fy_end && <> · FY end {engagement.fy_end}</>}
              {engagement.employee_count != null && <> · {engagement.employee_count} employees</>}
            </div>
            <div style={{ marginTop: 4, color: C.muted, fontSize: 12 }}>
              Indicative: PGK {engagement.indicative_fee_low?.toLocaleString()}–{engagement.indicative_fee_high?.toLocaleString()}
            </div>
            {engagement.notes && (
              <div style={{ marginTop: 10, padding: 10, background: "#fff",
                             border: "1px solid #f1f5f9", borderRadius: 6, whiteSpace: "pre-wrap" }}>
                <strong style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.04 }}>Client notes</strong>
                <div style={{ marginTop: 6 }}>{engagement.notes}</div>
              </div>
            )}
          </div>

          <Field label="Status">
            <select style={input} value={f.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Field>
          <Field label="Agreed fee (PGK) — overrides the indicative range">
            <input style={input} type="number" step="100" min="0" value={f.agreed_fee}
              onChange={(e) => set("agreed_fee", e.target.value)}
              placeholder="leave blank until engagement letter signed" />
          </Field>
          <Field label="Admin notes (internal — never shown to client)">
            <textarea style={{ ...input, minHeight: 90 }} value={f.admin_notes}
              onChange={(e) => set("admin_notes", e.target.value)} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end",
                       padding: "14px 22px", borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} style={btnGhostLg}>Cancel</button>
          <button onClick={save} disabled={submitting} style={btnPrimary}>
            {submitting
              ? <><Loader2 size={14} className="spin" style={{ marginRight: 6 }} /> Saving…</>
              : <><CheckCircle2 size={14} style={{ marginRight: 6 }} /> Save</>}
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

const th = { padding: "10px 14px", fontWeight: 700 };
const td = { padding: "10px 14px", verticalAlign: "top" };
const input = {
  display: "block", width: "100%", padding: "9px 11px", borderRadius: 8,
  border: "1px solid #d1d5db", fontSize: 14, background: "#fff", color: C.ink, outline: "none",
};
const btnGhost = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
  background: "#fff", color: C.ink, border: "1px solid #d1d5db", cursor: "pointer",
};
const btnGhostLg = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 16px", borderRadius: 8, fontSize: 14, fontWeight: 600,
  background: "#fff", color: C.ink, border: "1px solid #d1d5db", cursor: "pointer",
};
const btnPrimary = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 16px", borderRadius: 8, fontSize: 14, fontWeight: 600,
  background: C.navy, color: "#fff", border: "none", cursor: "pointer",
};
