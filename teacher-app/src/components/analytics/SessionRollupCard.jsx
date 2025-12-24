// teacher-app/src/components/analytics/SessionRollupCard.jsx
import React from "react";

export default function SessionRollupCard({ rollups, teacherCategories }) {
  if (!rollups) return null;

  const max = Number(rollups.sessionPointsMax || 1000);
  const pts = Number(rollups.sessionScorePoints || 0);
  const pct = Math.round((Number(rollups.sessionScoreNormalized || 0) * 100));

  const cats = rollups.categoryScores && typeof rollups.categoryScores === "object" ? rollups.categoryScores : {};
  const orderedKeys = Array.isArray(teacherCategories)
    ? teacherCategories.map((c) => String(c.key || c.id || c.label || "")).filter(Boolean)
    : Object.keys(cats);

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(14,116,144,0.25)",
        background:
          "linear-gradient(180deg, rgba(224,242,254,0.65), rgba(255,255,255,0.95))",
        padding: 14,
        boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              background: "rgba(14,116,144,0.12)",
              border: "1px solid rgba(14,116,144,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.1rem",
            }}
          >
            🏁
          </div>
          <div>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>Session Score</div>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
              Condensed achievement across all tasks
            </div>
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#0f172a" }}>
            {pts} / {max}
          </div>
          <div style={{ fontSize: "0.8rem", fontWeight: 800, color: "#075985" }}>{pct}%</div>
        </div>
      </div>

      <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: "rgba(15,23,42,0.06)" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, pct))}%`,
            borderRadius: 999,
            background: "linear-gradient(90deg, #22c55e, #0ea5e9)",
          }}
        />
      </div>

      {orderedKeys.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>
            Teacher Categories
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {orderedKeys.map((k) => {
              const v = cats[k];
              if (v == null) return null;
              const p = Math.round(Number(v) * 100);
              return (
                <div
                  key={k}
                  style={{
                    padding: 10,
                    borderRadius: 14,
                    border: "1px solid rgba(226,232,240,0.9)",
                    background: "rgba(255,255,255,0.85)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 900, color: "#0f172a", fontSize: "0.85rem" }}>{k}</div>
                    <div style={{ fontWeight: 900, color: "#0f172a", fontSize: "0.85rem" }}>{p}%</div>
                  </div>
                  <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: "rgba(15,23,42,0.06)" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, Math.max(0, p))}%`,
                        borderRadius: 999,
                        background: "linear-gradient(90deg, #a78bfa, #0ea5e9)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
