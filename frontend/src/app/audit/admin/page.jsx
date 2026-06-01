// /audit/admin — Theresia's review queue. Reuses TeebeePay auth — sign into
// /teebeepay/app first (Principal+), then visit this URL.
"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, AlertCircle, CheckCircle2, Mail, Phone, Building2,
  Edit2, RefreshCw, Filter, Search, Send, FileText, Sparkles, Database, Trash2, Download,
  HelpCircle, ChevronDown, ChevronRight, UserPlus, LayoutDashboard,
} from "lucide-react";

const GUIDE_KEY = "teebee.audit.admin.guide";

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

/* ───────────── How-to guide (collapsible, for the auditor) ──────────── */
function AuditHowToPanel({ open, onToggle }) {
  const steps = [
    { n: "1", t: "Open the engagement",
      d: "Click the engagement's row below. Set Status to Engaged or Active, enter the agreed fee, and Save." },
    { n: "2", t: "Get the documents in",
      d: 'Click "Invite client to upload" to email the client a sign-in link and a tailored checklist — or upload their files yourself in the engagement\'s Document checklist. For a readiness review you mainly need the trial balance and general ledger.' },
    { n: "3", t: "Plan the audit",
      d: "Open the engagement and use the firm-internal Audit planning panel: set Materiality (base it on total expenditure for a not-for-profit), build the Risk register, and track Working papers." },
    { n: "4", t: "Run the checks",
      d: 'Hit "Run software analysis". The platform runs reconciliations, anomaly and compliance scans and lists findings by severity — your starting point, not the conclusion.' },
    { n: "5", t: "Review & finalise",
      d: "Work through each finding (confirm, annotate or dismiss) — nothing is final until you've reviewed it. Then move Status to Review → Delivered and issue your opinion." },
  ];
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 22, overflow: "hidden" }}>
      <button onClick={onToggle} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
        background: open ? C.cream : "#fff", border: "none", cursor: "pointer", textAlign: "left",
      }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: C.gold, color: C.navy,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <HelpCircle size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <strong style={{ fontSize: 14 }}>How to run an audit</strong>
          <div style={{ fontSize: 12, color: C.muted }}>A 5-step walkthrough of an engagement, start to finish.</div>
        </div>
        {open ? <ChevronDown size={18} color={C.muted} /> : <ChevronRight size={18} color={C.muted} />}
      </button>
      {open && (
        <div style={{ padding: "4px 18px 18px", borderTop: "1px solid #f1f3f5" }}>
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            {steps.map((s) => (
              <div key={s.n} style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 99, background: C.navy, color: "#fff",
                  fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {s.n}
                </div>
                <div>
                  <strong style={{ fontSize: 13.5 }}>{s.t}</strong>
                  <div style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.55, marginTop: 2 }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: C.muted }}>
            Tip: use “Seed test data” (top right) to create a sample engagement and practise the whole flow first.
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditAdminPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // Open the how-to guide by default the first time; remember the choice after.
  useEffect(() => {
    try {
      const v = localStorage.getItem(GUIDE_KEY);
      setGuideOpen(v === null ? true : v === "1");
    } catch {}
  }, []);
  function toggleGuide() {
    setGuideOpen((o) => {
      const next = !o;
      try { localStorage.setItem(GUIDE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

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
          <strong style={{ fontSize: 16 }}>TeeBee Audit — Admin queue</strong>
        </div>
        <Link href="/teebee-console" style={{ marginLeft: 12, display: "inline-flex", alignItems: "center", gap: 6,
          color: "#cbd5e1", textDecoration: "none", fontSize: 13, padding: "5px 10px",
          border: "1px solid #3a526b", borderRadius: 8 }}>
          <LayoutDashboard size={13} /> Console
        </Link>
        <button onClick={() => setCreating(true)} style={{
          marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", background: C.gold, color: C.navy,
          border: "1px solid " + C.gold, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>
          <UserPlus size={14} /> New client
        </button>
        <button onClick={async () => {
          try {
            const r = await api("/api/audit/seed-test-data", { method: "POST" });
            alert(`Seeded ${r.inserted} test engagement(s) (${r.skipped} skipped).`);
            refresh();
          } catch (e) { alert(e.message); }
        }} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", background: "transparent", color: "#cbd5e1",
          border: "1px solid #3a526b", borderRadius: 8, fontSize: 13, cursor: "pointer",
        }}>
          <Database size={13} /> Seed test data
        </button>
        <button onClick={refresh} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
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

        {/* How to run an audit */}
        <AuditHowToPanel open={guideOpen} onToggle={toggleGuide} />

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

      {creating && <NewEngagementDialog
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); refresh(); }} />}

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
  const [info, setInfo] = useState("");
  const [files, setFiles] = useState([]);
  const [findings, setFindings] = useState([]);
  const [inviting, setInviting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const refreshAttachments = async () => {
    try {
      const [fileList, findList] = await Promise.all([
        api(`/api/audit/engagements/${engagement.id}/files`),
        api(`/api/audit/engagements/${engagement.id}/findings`),
      ]);
      setFiles(fileList.files || []);
      setFindings(findList.findings || []);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { refreshAttachments(); }, [engagement.id]);

  async function inviteClient() {
    if (!confirm(`Send ${engagement.contact_email} a sign-in link to upload audit files?`)) return;
    setInviting(true); setError(""); setInfo("");
    try {
      const j = await api(`/api/audit/engagements/${engagement.id}/invite-client`, { method: "POST" });
      setInfo(j.email_sent
        ? `Invitation sent to ${engagement.contact_email}.`
        : "Client added but email failed to send — check Resend config.");
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setInviting(false); }
  }
  async function runAnalysis() {
    setAnalyzing(true); setError(""); setInfo("");
    try {
      const j = await api(`/api/audit/engagements/${engagement.id}/analyze`, { method: "POST" });
      setInfo(`Analysis complete — ${j.findings_count} finding${j.findings_count === 1 ? "" : "s"}.`);
      refreshAttachments();
    } catch (e) { setError(e.message); }
    finally { setAnalyzing(false); }
  }
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

          {info && (
            <div style={{
              background: "#dcfce7", border: "1px solid #bbf7d0", color: "#14532d",
              padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13,
            }}>{info}</div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <button onClick={inviteClient} disabled={inviting} style={btnGhostLg}>
              {inviting
                ? <><Loader2 size={12} className="spin" /> Sending…</>
                : <><Send size={12} /> Invite client to upload</>}
            </button>
            <button onClick={runAnalysis} disabled={analyzing || files.length === 0} style={{
              ...btnPrimary, padding: "9px 16px", opacity: (analyzing || files.length === 0) ? 0.6 : 1,
            }}>
              {analyzing
                ? <><Loader2 size={12} className="spin" /> Analyzing…</>
                : <><Sparkles size={12} /> Run analysis ({files.length} file{files.length === 1 ? "" : "s"})</>}
            </button>
          </div>

          {/* Files uploaded */}
          {files.length > 0 && (
            <div style={{ background: "#fafbfc", border: "1px solid #e5e7eb",
                          borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <strong style={{ fontSize: 12, color: C.muted, textTransform: "uppercase",
                                letterSpacing: 0.04 }}>Uploaded files ({files.length})</strong>
              <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12 }}>
                {files.map((f) => (
                  <div key={f.id} style={{ display: "flex", justifyContent: "space-between",
                                            alignItems: "center", padding: "5px 0" }}>
                    <span>
                      <FileText size={11} color={C.muted} style={{ verticalAlign: -1, marginRight: 6 }} />
                      <a href={`/api/audit/engagements/${engagement.id}/files/${f.id}`}
                         target="_blank" rel="noreferrer" style={{ color: C.navy, textDecoration: "none" }}>
                        {f.filename}
                      </a>
                      <span style={{ color: C.muted, marginLeft: 6 }}>· {f.slot} · {(f.size / 1024).toFixed(0)} KB</span>
                    </span>
                    <span style={{ color: C.muted, fontSize: 11 }}>{f.uploaded_by}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Findings */}
          {findings.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: 12, color: C.muted, textTransform: "uppercase",
                                letterSpacing: 0.04 }}>Findings ({findings.length})</strong>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {findings.map((fnd) => {
                  const palette = fnd.severity === "high"   ? { bg: "#fee2e2", bd: "#fecaca", ink: "#7f1d1d" } :
                                  fnd.severity === "medium" ? { bg: "#fef3c7", bd: "#fde68a", ink: "#7c2d12" } :
                                                              { bg: "#dcfce7", bd: "#bbf7d0", ink: "#14532d" };
                  return (
                    <div key={fnd.id} style={{
                      padding: 10, borderRadius: 8, fontSize: 12,
                      border: `1px solid ${palette.bd}`, background: palette.bg,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <strong style={{ color: palette.ink, fontSize: 12 }}>{fnd.title}</strong>
                        <span style={{ fontSize: 9, fontWeight: 800, color: palette.ink,
                                        textTransform: "uppercase", letterSpacing: 0.04 }}>{fnd.severity}</span>
                      </div>
                      <div style={{ color: C.inkSoft, fontSize: 11 }}>{fnd.detail}</div>
                      {fnd.source_file && (
                        <div style={{ marginTop: 3, fontSize: 10, color: C.muted }}>Source: {fnd.source_file}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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

/* ───────────── Create a new engagement (auditor-initiated) ──────────── */
function NewEngagementDialog({ onClose, onCreated }) {
  const [f, setF] = useState({
    company_name: "", audit_type: "readiness", fy_end: "",
    contact_name: "", contact_email: "", contact_phone: "",
    agreed_fee: "", status: "engaged", notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function create() {
    if (!f.company_name.trim()) { setError("Client / company name is required."); return; }
    setSubmitting(true); setError("");
    try {
      const j = await api("/api/audit/engagements", { method: "POST", body: JSON.stringify(f) });
      onCreated(j.id);
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
        maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        <div style={{ background: "linear-gradient(135deg, #fffaf0 0%, #fef6d8 100%)",
                       padding: "18px 22px", borderBottom: "1px solid #fde68a" }}>
          <div style={{ fontSize: 11, color: "#9c6c00", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.06 }}>
            New audit engagement
          </div>
          <h3 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800, color: C.ink }}>Add a client</h3>
        </div>
        <div style={{ padding: "20px 22px" }}>
          {error && (
            <div style={{ background: "#fee2e2", border: "1px solid #fecaca", color: "#7f1d1d",
                           padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>
          )}
          <Field label="Client / company name">
            <input style={input} value={f.company_name} onChange={(e) => set("company_name", e.target.value)}
              placeholder="e.g. Infinite Wood Builders Limited 2025" autoFocus />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Audit type">
              <select style={input} value={f.audit_type} onChange={(e) => set("audit_type", e.target.value)}>
                {Object.entries(AUDIT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Financial year end">
              <input style={input} value={f.fy_end} onChange={(e) => set("fy_end", e.target.value)}
                placeholder="e.g. 31 Dec 2025" />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Status">
              <select style={input} value={f.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.filter((s) => s.v !== "lost").map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
              </select>
            </Field>
            <Field label="Agreed fee (PGK) — optional">
              <input style={input} type="number" step="100" min="0" value={f.agreed_fee}
                onChange={(e) => set("agreed_fee", e.target.value)} placeholder="leave blank for now" />
            </Field>
          </div>
          <div style={{ fontSize: 12, color: C.muted, margin: "2px 0 12px" }}>
            Client contact is optional — only needed if you'll use “Invite client to upload”.
            Leave blank to upload the files yourself.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Contact name (optional)">
              <input style={input} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </Field>
            <Field label="Contact email (optional)">
              <input style={input} type="email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (internal) — optional">
            <textarea style={{ ...input, minHeight: 70 }} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <div style={{ fontSize: 12, color: C.muted }}>
            Once created, open the engagement in <strong>/audit/app</strong> to upload the trial balance,
            financials and bank recs, then run the analysis.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end",
                       padding: "14px 22px", borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} style={btnGhostLg}>Cancel</button>
          <button onClick={create} disabled={submitting} style={btnPrimary}>
            {submitting
              ? <><Loader2 size={14} className="spin" style={{ marginRight: 6 }} /> Creating…</>
              : <><UserPlus size={14} style={{ marginRight: 6 }} /> Create engagement</>}
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
