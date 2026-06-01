// teacher-app/src/pages/MyPlan.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { PageShell, PageHeader } from "../components/ui";

import { API_BASE_URL } from "../config";
const API_BASE = API_BASE_URL;

const PLAN_LABELS = {
  FREE: "Free",
  TEACHER_PLUS: "Teacher Plus",
  TEACHER_PRO: "Teacher Pro",
  SCHOOL_PLUS: "School Plus",
  SCHOOL_PRO: "School Pro",
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
        const res = await axios.get(`${API_BASE}/api/subscription/me`, {
          withCredentials: true,
        });

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

  const tier = sub?.tier || "FREE";
  const planLabel = formatPlanLabel(tier);
  const used = sub?.aiTasksetsUsedThisMonth ?? 0;

  const AI_LIMITS = {
    FREE: 25,
    TEACHER_PLUS: 250,
    TEACHER_PRO: 2000,
    SCHOOL_PLUS: 20000,
    SCHOOL_PRO: 100000,
  };
  const maxAi = AI_LIMITS[tier] ?? AI_LIMITS.FREE;

  const isPaid = tier !== "FREE";

  return (
    <PageShell maxWidth={900}>
      <PageHeader
        title="My Plan"
        subtitle="See what's included in your current plan and what unlocks at the next levels."
      />

      {error && (
        <p style={{ color: "#b91c1c", fontSize: "0.85rem", marginTop: 8 }}>
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
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-block",
                padding: "4px 10px",
                borderRadius: 999,
                border: isPaid ? "1px solid #0ea5e9" : "1px solid #d1d5db",
                fontSize: "0.8rem",
                background: isPaid ? "#f0f9ff" : "#ffffff",
                color: isPaid ? "#0369a1" : undefined,
                fontWeight: 700,
              }}
            >
              Current plan: {planLabel}
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

          {/* Upgrade CTA */}
          {tier === "FREE" && (
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: "0.8rem", color: "#4b5563", margin: 0 }}>
                Ready to unlock more?
              </p>
              <p style={{ fontSize: "0.8rem", color: "#4b5563", margin: "4px 0 0" }}>
                Teacher Plus adds student-level reporting, PDF exports, AI-themed selfies, and more AI generation.
              </p>
              <a
                href="https://www.curriculate.net/pricing"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: 8,
                  padding: "6px 14px",
                  borderRadius: 999,
                  background: "#0ea5e9",
                  color: "#fff",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                View plans &amp; pricing
              </a>
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
              You've generated <strong>{used}</strong> AI task set
              {used === 1 ? "" : "s"} this month.
              {maxAi != null && (
                <>
                  {" "}
                  Your {planLabel} plan includes up to{" "}
                  <strong>{maxAi.toLocaleString()}</strong> per month.
                </>
              )}
            </p>
          )}
        </div>
      </section>

      {/* Plan comparison */}
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
                <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>
                  Feature
                </th>
                <th style={thStyle}>Free</th>
                <th style={thStyle}>Teacher Plus</th>
                <th style={thStyle}>Teacher Pro</th>
                <th style={thStyle}>School</th>
              </tr>
            </thead>
            <tbody>
              <FeatureRow
                label="Live sessions with CurricQR stations"
                free="✓"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="Fixed-station display assignment"
                free="✓"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="Multi-room scavenger hunts"
                free="—"
                plus="—"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="Team selfie"
                free="First 2 sessions"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="AI-themed selfie images"
                free="—"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="Basic session summary"
                free="✓"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="Student-level reporting &amp; grades"
                free="—"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="Email PDF transcripts"
                free="Limited"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="Student email reports"
                free="—"
                plus="✓"
                pro="✓"
                school="✓"
              />
              <FeatureRow
                label="AI task sets per month"
                free="25"
                plus="250"
                pro="2,000"
                school="20,000+"
              />
              <FeatureRow
                label="Advanced reporting &amp; exports"
                free="—"
                plus="Some"
                pro="✓"
                school="Full staff / school view"
              />
              <FeatureRow
                label="Priority support"
                free="—"
                plus="—"
                pro="✓"
                school="✓"
              />
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}

const thStyle = {
  textAlign: "center",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  minWidth: 80,
};

function FeatureRow({ label, free, plus, pro, school }) {
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
      <td style={tdCenterStyle}>{pro}</td>
      <td style={tdCenterStyle}>{school}</td>
    </tr>
  );
}

const tdCenterStyle = {
  textAlign: "center",
  padding: "6px 10px",
  borderTop: "1px solid #f3f4f6",
};
