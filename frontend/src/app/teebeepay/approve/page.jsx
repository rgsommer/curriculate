// frontend/src/app/teebeepay/approve/page.jsx
//
// Public "Approve via email" page. No login required — auth is the signed
// token in the URL. Fetched + posted server-side via /api/teebeepay/approve-via-email.
"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Loader2, CheckCircle2, AlertCircle, Send, ArrowLeft, ShieldCheck,
} from "lucide-react";

const C = {
  red: "#b9302a", redDeep: "#8a1f1a", gold: "#f4b400",
  ink: "#0f172a", inkSoft: "#334155", muted: "#64748b",
  cream: "#fffaf0",
};

export default function ApprovePageWrapper() {
  return (
    <Suspense fallback={<Centered><Loader2 className="tbp-spin" size={28} color={C.red} /></Centered>}>
      <ApprovePage />
    </Suspense>
  );
}

function ApprovePage() {
  const sp = useSearchParams();
  const token = sp.get("t") || "";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    if (!token) { setError("Missing or invalid link."); return; }
    setError("");
    try {
      const res = await fetch(`/api/teebeepay/approve-via-email?t=${encodeURIComponent(token)}`);
      const j = await res.json();
      if (!res.ok) { setError(j.error || `HTTP ${res.status}`); return; }
      setData(j);
    } catch (e) { setError(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function decide(action) {
    if (action === "reject" && !confirm("Send this payroll back as a draft so the office can revise it?")) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/teebeepay/approve-via-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || `HTTP ${res.status}`); return; }
      setDone({ action, ...j });
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#f6f7f9", color: C.ink,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
      padding: 30,
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <header style={{ marginBottom: 26, display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill={C.red} />
            <path d="M9 9h14M11 9v14M21 9v6c0 2-1.5 3-3.5 3H11"
              stroke={C.gold} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>TeebeePay</div>
            <div style={{ fontSize: 12, color: C.muted }}>Approve payroll</div>
          </div>
        </header>

        {error && (
          <Card>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <AlertCircle size={24} color={C.red} style={{ flexShrink: 0 }} />
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Can't open this approval link</h2>
                <p style={{ color: C.inkSoft, fontSize: 14, margin: "6px 0 0" }}>{error}</p>
                <p style={{ color: C.muted, fontSize: 13, margin: "12px 0 0" }}>
                  If you signed in to TeebeePay, you can approve from
                  {" "}<Link href="/teebeepay/app" style={{ color: C.red, fontWeight: 600 }}>your dashboard</Link>.
                </p>
              </div>
            </div>
          </Card>
        )}

        {!error && !data && <Centered><Loader2 className="tbp-spin" size={28} color={C.red} /></Centered>}

        {data && !done && (
          <>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <ShieldCheck size={20} color={C.red} />
                <strong style={{ fontSize: 14, color: C.muted }}>Awaiting your approval</strong>
              </div>
              <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800 }}>{data.company.name}</h1>
              <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px" }}>
                Period <strong style={{ color: C.ink }}>{data.period.period_start}</strong> to
                {" "}<strong style={{ color: C.ink }}>{data.period.period_end}</strong>
                {" "}· Pay date <strong style={{ color: C.ink }}>{data.period.pay_date}</strong>
                {" "}· <strong style={{ color: C.ink }}>{data.n_entries}</strong> employees
              </p>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <tbody>
                  <SummaryRow label="Total gross"   value={`${data.company.currency} ${data.totals.gross.toFixed(2)}`} />
                  <SummaryRow label="Total tax"     value={`${data.company.currency} ${data.totals.tax.toFixed(2)}`} />
                  <SummaryRow label="Total Nasfund" value={`${data.company.currency} ${data.totals.nasfund.toFixed(2)}`} />
                  <SummaryRow label="Total net" highlight
                              value={`${data.company.currency} ${data.totals.net.toFixed(2)}`} />
                </tbody>
              </table>

              {data.period.status === "approved" ? (
                <FlashBox type="info" icon={<CheckCircle2 size={18} />}>
                  This pay period was already approved on {data.period.approved_at && new Date(data.period.approved_at).toISOString().slice(0, 10)}.
                </FlashBox>
              ) : (
                <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
                  <button onClick={() => decide("approve")} disabled={submitting} style={btnPrimary}>
                    {submitting
                      ? <><Loader2 className="tbp-spin" size={16} style={{ marginRight: 6 }} /> Approving…</>
                      : <><CheckCircle2 size={17} style={{ marginRight: 6 }} /> Approve &amp; email pay stubs</>}
                  </button>
                  <button onClick={() => decide("reject")} disabled={submitting} style={btnGhost}>
                    Send back as draft
                  </button>
                </div>
              )}

              <p style={{ fontSize: 12, color: C.muted, marginTop: 22, lineHeight: 1.5 }}>
                Approving on behalf of: <strong>{data.approver_email}</strong>.
                Once approved, pay stubs go out to every employee with an email on file, and the BSP batch + NASFund return are queued for download.
              </p>
            </Card>
          </>
        )}

        {done && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: "#dcfce7", color: "#166534",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CheckCircle2 size={32} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
                  {done.action === "reject" ? "Sent back as draft" : (done.already ? "Already approved" : "Approved")}
                </h2>
                <p style={{ color: C.muted, fontSize: 14, margin: "4px 0 0" }}>
                  {done.action === "reject"
                    ? "The office will revise and resubmit."
                    : (done.stubsSent != null
                      ? `${done.stubsSent} pay stub${done.stubsSent === 1 ? "" : "s"} emailed.${done.stubsFailed ? ` ${done.stubsFailed} failed.` : ""}`
                      : "Done.")}
                </p>
              </div>
            </div>
            {done.serviceFees && done.serviceFees.length > 0 && (
              <p style={{ fontSize: 13, color: C.inkSoft, margin: "14px 0 0" }}>
                Service-fee disbursements added to the BSP batch: {done.serviceFees.map(f => `${f.name} K${f.amount.toFixed(2)}`).join(", ")}.
              </p>
            )}
            <p style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>
              You can safely close this page. Full details are in <Link href="/teebeepay/app" style={{ color: C.red }}>TeebeePay</Link>.
            </p>
          </Card>
        )}
      </div>

      <style>{`@keyframes tbp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } } .tbp-spin { animation: tbp-spin .9s linear infinite; }`}</style>
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 28,
      boxShadow: "0 12px 36px rgba(15,23,42,.06)",
    }}>{children}</div>
  );
}
function Centered({ children }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>{children}</div>;
}
function SummaryRow({ label, value, highlight }) {
  return (
    <tr style={{
      borderTop: "1px solid #f1f5f9",
      background: highlight ? "#fff7e0" : undefined,
      fontWeight: highlight ? 700 : 400,
    }}>
      <td style={{ padding: "10px 0", color: highlight ? C.ink : C.muted }}>{label}</td>
      <td style={{ padding: "10px 0", textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.ink }}>{value}</td>
    </tr>
  );
}
function FlashBox({ type, icon, children }) {
  const color = type === "error" ? "#991b1b" : "#1e40af";
  const bg = type === "error" ? "#fee2e2" : "#dbeafe";
  return (
    <div style={{ background: bg, color, padding: "10px 14px", borderRadius: 8, fontSize: 13,
      marginTop: 16, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span><span>{children}</span>
    </div>
  );
}
const btnPrimary = {
  display: "inline-flex", alignItems: "center", padding: "13px 20px", borderRadius: 10,
  background: C.red, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 15,
};
const btnGhost = {
  display: "inline-flex", alignItems: "center", padding: "13px 20px", borderRadius: 10,
  background: "#fff", color: C.inkSoft, border: "1px solid #e5e7eb", cursor: "pointer", fontWeight: 600, fontSize: 14,
};
