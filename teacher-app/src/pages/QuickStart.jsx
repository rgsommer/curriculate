// teacher-app/src/pages/QuickStart.jsx
//
// Anti-friction onboarding entry point. Replaces the intimidating
// "type a topic / pick a difficulty / wait for AI to generate" flow
// for new teachers: pick a grade band → pick a topic card → click Launch.
// 8 hand-curated tasks load instantly and the host view jumps to the
// live monitor.

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";
import { API_BASE_URL } from "../config";
import { PageHeader, Button } from "../components/ui";

const GRADE_BAND_ORDER = ["K-2", "3-5", "6-8", "9-12"];
const GRADE_BAND_LABELS = {
  "K-2":  { label: "K – 2",        sub: "Early elementary" },
  "3-5":  { label: "Grades 3 – 5", sub: "Upper elementary" },
  "6-8":  { label: "Grades 6 – 8", sub: "Middle school" },
  "9-12": { label: "Grades 9 – 12", sub: "High school" },
};

export default function QuickStart({ roomCode, onLaunched }) {
  const navigate = useNavigate();
  const [byBand, setByBand] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selectedBand, setSelectedBand] = useState(null);
  const [launchingKey, setLaunchingKey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/quickstart`);
        const data = await resp.json();
        if (cancelled) return;
        if (!data?.ok) throw new Error(data?.error || "Failed to load presets");
        setByBand(data.byBand || {});
        // Auto-select the first non-empty band so the page isn't initially blank.
        const firstWithEntries = GRADE_BAND_ORDER.find((b) => (data.byBand?.[b] || []).length > 0);
        if (firstWithEntries) setSelectedBand(firstWithEntries);
      } catch (e) {
        if (!cancelled) setErr(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const bandsWithEntries = useMemo(
    () => GRADE_BAND_ORDER.filter((b) => (byBand?.[b] || []).length > 0),
    [byBand]
  );
  const presetsForBand = useMemo(
    () => byBand?.[selectedBand] || [],
    [byBand, selectedBand]
  );

  const handleLaunch = (preset) => {
    const code = String(roomCode || "").trim().toUpperCase();
    if (!code) {
      setErr("No active room code. Use the Live page to create one, then come back.");
      return;
    }
    setLaunchingKey(preset.key);
    setErr("");
    socket.emit(
      "teacher:loadQuickstart",
      { roomCode: code, presetKey: preset.key, onScreenOnly: false },
      (ack) => {
        setLaunchingKey(null);
        if (!ack?.ok) {
          setErr(ack?.error || "Could not load the preset. Try again.");
          return;
        }
        if (typeof onLaunched === "function") onLaunched(preset);
        // Jump to the live monitor — same place the standard launch lands.
        navigate("/host");
      }
    );
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <PageHeader
        title="🚀 Quick Start"
        subtitle="Pick a grade band, pick a topic, click Launch. Eight ready-to-play tasks. No setup."
      />

      {loading && (
        <div style={{ padding: "30px 0", textAlign: "center", color: "#64748b" }}>
          Loading presets…
        </div>
      )}

      {err && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            color: "#991b1b",
            fontWeight: 700,
            fontSize: "0.88rem",
          }}
        >
          {err}
        </div>
      )}

      {!loading && !err && (
        <>
          {/* Grade band picker */}
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 24,
            }}
          >
            {bandsWithEntries.map((band) => {
              const meta = GRADE_BAND_LABELS[band] || { label: band, sub: "" };
              const active = selectedBand === band;
              return (
                <button
                  key={band}
                  type="button"
                  onClick={() => setSelectedBand(band)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 14,
                    border: active ? "2px solid #2563eb" : "1px solid #cbd5e1",
                    background: active ? "#eff6ff" : "#ffffff",
                    color: active ? "#1d4ed8" : "#0f172a",
                    fontWeight: 800,
                    cursor: "pointer",
                    minWidth: 140,
                    boxShadow: active ? "0 4px 14px rgba(37,99,235,0.18)" : "none",
                    transition: "all 0.15s",
                  }}
                  aria-pressed={active}
                >
                  <div style={{ fontSize: "0.98rem" }}>{meta.label}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 600, color: active ? "#1d4ed8" : "#64748b", marginTop: 2 }}>
                    {meta.sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Preset cards for the selected band */}
          {presetsForBand.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>
              No presets yet for this grade band.
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {presetsForBand.map((preset) => {
              const isLaunching = launchingKey === preset.key;
              return (
                <div
                  key={preset.key}
                  style={{
                    padding: 18,
                    borderRadius: 16,
                    border: "1px solid #e2e8f0",
                    background: "#ffffff",
                    boxShadow: "0 2px 6px rgba(15,23,42,0.04)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 900,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                        color: "#6366f1",
                        background: "#eef2ff",
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      {preset.subject}
                    </span>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b" }}>
                      ~{preset.estimatedMinutes} min
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 900, color: "#0f172a" }}>
                      {preset.title}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#475569", marginTop: 2 }}>
                      {preset.topic}
                    </div>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#475569", lineHeight: 1.45 }}>
                    {preset.summary}
                  </div>
                  <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#94a3b8", marginTop: "auto" }}>
                    {preset.taskCount} tasks · Grade {preset.gradeLevel}
                  </div>
                  <Button
                    onClick={() => handleLaunch(preset)}
                    disabled={isLaunching}
                    style={{
                      marginTop: 6,
                      background: isLaunching ? "#94a3b8" : undefined,
                      width: "100%",
                    }}
                  >
                    {isLaunching ? "Launching…" : "🚀 Launch"}
                  </Button>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 28, padding: "12px 14px", borderRadius: 10, background: "#f1f5f9", color: "#475569", fontSize: "0.82rem", lineHeight: 1.45 }}>
            <strong>How it works:</strong> Quick Start loads a hand-curated 8-task
            set into your room and drops you straight into the Host view —
            ready to share the room code with your students. No topic typing,
            no AI wait. Want more variety? Use <em>Generate A New Set</em> in
            the sidebar for the full custom flow.
          </div>
        </>
      )}
    </div>
  );
}
