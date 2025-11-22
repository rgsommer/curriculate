// teacher-app/src/pages/MyPlan.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "https://api.curriculate.net";

const PLAN_LABELS = {
  FREE: "Free",
  TEACHER_PLUS: "Teacher Plus",
  SCHOOL: "School / Campus",
};

function formatPlanLabel(planName) {
  if (!planName) return "Free";
  return PLAN_LABELS[planName] || planName;
}

export default function MyPlanPage() {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError("");
      setLoading(true);
      try {
        const res = await axios.get(`${API_BASE}/api/subscription/me`);
        if (!cancelled) {
          setSub(res.data || {});
        }
      } catch (err) {
        console.error("MyPlan / subscription error", err);
        if (!cancelled) {
          setError(
            "Could not load plan details right now. Basic features will still work."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const planName = sub?.planName || "FREE";
  const features = sub?.features || {};
  const used = sub?.aiGenerationsUsedThisPeriod ?? 0;
  const maxAi = features.maxAiGenerationsPerMonth ?? null;

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, 'Segoe UI'",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginTop: 0, marginBottom: 4 }}>My Plan</h1>
      <p style={{ fontSize: "0.85rem", color: "#555", marginTop: 0 }}>
        See what’s included in your current plan and what unlocks at the next
        levels.
      </p>

      {error && (
        <p style={{ color: "red", fontSize: "0.85rem", marginTop: 8 }}>
          {error}
        </p>
      )}

      {/* Current plan card */}
      <section
        style={{
          marginTop: 16,
          marginBottom: 16,
          padding: 16,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                display: "inline-block",
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                fontSize: "0.8rem",
                background: "#ffffff",
              }}
            >
              Current plan: <strong>{formatPlanLabel(planName)}</strong>
            </div>
            {sub?.currentPeriodStart && sub?.currentPeriodEnd && (
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#6b7280",
                  marginTop: 6,
                  marginBottom: 0,
                }}
              >
                Billing period:{" "}
                {new Date(sub.currentPeriodStart).toLocaleDateString()} –{" "}
                {new Date(sub.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Upgrade CTA – just messaging for now */}
          {planName === "FREE" && (
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: "0.8rem", color: "#4b5563", margin: 0 }}>
                Ready to unlock more analytics and reports?
              </p>
              <p style={{ fontSize: "0.8rem", color: "#4b5563", margin: 0 }}>
                Teacher Plus adds richer reporting, individual student
                snapshots, and more AI generation room.
              </p>
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#6b7280",
                  marginTop: 4,
                  marginBottom: 0,
                }}
              >
                For now, upgrading is handled manually. Get in touch to upgrade
                your account.
              </p>
            </div>
          )}
        </div>

        {/* AI usage */}
        <div style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: "0.9rem", margin: 0 }}>AI task sets</h3>
          {loading ? (
            <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>
              Checking usage…
            </p>
          ) : (
            <p style={{ fontSize: "0.8rem", color: "#4b5563", marginTop: 4 }}>
              You’ve generated{" "}
              <strong>{used}</strong>{" "}
              AI task set{used === 1 ? "" : "s"} this month.
              {maxAi != null && (
                <>
                  {" "}
                  Your plan includes{" "}
                  <strong>{maxAi}</strong> per month.
                </>
              )}
            </p>
          )}
        </div>
      </section>

      {/* Plan comparison – static marketing view */}
      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>
          What each plan unlocks
        </h2>
        <div
          style={{
            overflowX: "auto",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.8rem",
            }}
          >
            <thead style={{ background: "#f3f4f6" }}>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  Feature
                </th>
                <th style={thStyle}>Free</th>
                <th style={thStyle}>Teacher Plus</th>
                <th style={thStyle}>School</th>
              </tr>
            </thead>
            <tbody>
              <FeatureRow
                label="Run live sessions with stations"
                free="✓"
                plus="✓"
                school="✓"
              />
              <FeatureRow
                label="Basic session summary"
                free="✓"
                plus="✓"
                school="✓"
              />
              <FeatureRow
                label="Individual student snapshot pages"
                free="—"
                plus="✓"
                school="✓"
              />
              <FeatureRow
                label="Richer analytics dashboard"
                free="—"
                plus="✓"
                school="✓"
              />
              <FeatureRow
                label="Email PDF transcripts"
                free="Limited"
                plus="✓"
                school="✓"
              />
              <FeatureRow
                label="AI task sets per month"
                free="Low"
                plus="More"
                school="Most / unlimited (admin-defined)"
              />
              <FeatureRow
                label="Advanced reporting & exports"
                free="—"
                plus="Some"
                school="Full staff / school view"
              />
            </tbody>
          </table>
        </div>

        <p
          style={{
            fontSize: "0.75rem",
            color: "#6b7280",
            marginTop: 8,
          }}
        >
          Exact limits (AI calls, exports, etc.) can be tuned as we go, but
          this gives you and future users a clear sense of the tiers.
        </p>
      </section>
    </div>
  );
}

const thStyle = {
  textAlign: "center",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  minWidth: 80,
};

function FeatureRow({ label, free, plus, school }) {
  return (
    <tr>
      <td
        style={{
          padding: "6px 10px",
          borderTop: "1px solid #f3f4f6",
        }}
      >
        {label}
      </td>
      <td style={tdCenterStyle}>{free}</td>
      <td style={tdCenterStyle}>{plus}</td>
      <td style={tdCenterStyle}>{school}</td>
    </tr>
  );
}

const tdCenterStyle = {
  textAlign: "center",
  padding: "6px 10px",
  borderTop: "1px solid #f3f4f6",
};
