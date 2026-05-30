// student-app/src/components/tasks/types/MapItTask.jsx
//
// Map It — match-on-a-map. Students see a real map with 3–5 numbered coloured
// markers; they tap a marker number, then tap the choice they think it is,
// using the same two-tap UX as MatchingTask. After Submit they get a review
// overlay (green = correct, red = wrong) before final onSubmit fires.
//
// Data model (canonical, mirrors backend validator):
//   task.markers : [{ id:"M1", number:1, lat, lng, correctAnswer, clue?, note? }]
//   task.choices : ["Detroit", "York", "Niagara", "Plains of Abraham", ...]
//   task.map     : { regionHint, centerLat, centerLng, zoom }
//   task.correctMatches : { M1: "Detroit", M2: "York", ... }
//
// Submission shape (mirrors Matching):
//   { matches: { M1: "Detroit", M2: "York", ... } }
//
// Map rendering: OpenStreetMap static tiles via the standard tile server
// (no API key needed). For each marker we project (lat,lng) onto pixel
// coords relative to the chosen viewport using the Web Mercator math and
// position a coloured numbered badge absolutely. The map image and the
// markers live in the same coordinate space so they stay aligned at any
// width.

import React, { useEffect, useMemo, useRef, useState } from "react";

// ── Web Mercator projection (matches OSM tile math) ──────────────────────
// Reference: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
function lonToTileX(lon, z) { return ((lon + 180) / 360) * Math.pow(2, z); }
function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
}

// Marker colours cycle through a high-contrast palette (good against the
// muted OSM background; white numbers on top for legibility).
const MARKER_COLORS = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed"];

export default function MapItTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  mode = "play",
  review,
  readOnly,
}) {
  const norm = (x) => String(x ?? "").trim();

  // ── Normalize task shape (be tolerant of root vs config wrappers) ──
  const normalized = useMemo(() => {
    const cfg = task?.config && typeof task.config === "object" ? task.config : {};
    const markersRaw =
      (Array.isArray(task?.markers) && task.markers) ||
      (Array.isArray(cfg.markers) && cfg.markers) ||
      [];
    const choicesRaw =
      (Array.isArray(task?.choices) && task.choices) ||
      (Array.isArray(cfg.choices) && cfg.choices) ||
      [];
    const mapRaw = (task?.map && typeof task.map === "object" ? task.map : cfg.map) || {};

    const markers = markersRaw
      .map((m, i) => {
        const number = Number(m?.number ?? m?.markerNumber ?? i + 1);
        const lat = Number(m?.lat ?? m?.latitude);
        const lng = Number(m?.lng ?? m?.lon ?? m?.longitude);
        const correctAnswer = norm(m?.correctAnswer ?? m?.label ?? m?.answer ?? m?.text);
        return {
          id: norm(m?.id) || `M${Number.isFinite(number) ? number : i + 1}`,
          number: Number.isFinite(number) ? number : i + 1,
          lat: Number.isFinite(lat) ? lat : 0,
          lng: Number.isFinite(lng) ? lng : 0,
          correctAnswer,
          clue: norm(m?.clue ?? m?.hint),
          note: norm(m?.note ?? m?.context),
        };
      })
      .filter((m) => m.correctAnswer)
      .slice(0, 5);

    const choices = choicesRaw
      .map((c) => (typeof c === "string" ? c : (c?.text || c?.label || "")))
      .map((s) => norm(s))
      .filter(Boolean);
    // Dedup, case-insensitive
    const seen = new Set();
    const deduped = [];
    for (const c of choices) {
      const k = c.toLowerCase();
      if (!seen.has(k)) { seen.add(k); deduped.push(c); }
    }

    // Default viewport: centre on the markers if the AI omitted it.
    const fallbackLat = markers.length ? markers.reduce((s, m) => s + m.lat, 0) / markers.length : 45;
    const fallbackLng = markers.length ? markers.reduce((s, m) => s + m.lng, 0) / markers.length : -90;
    const map = {
      regionHint: norm(mapRaw.regionHint),
      centerLat: Number.isFinite(Number(mapRaw.centerLat)) ? Number(mapRaw.centerLat) : fallbackLat,
      centerLng: Number.isFinite(Number(mapRaw.centerLng)) ? Number(mapRaw.centerLng) : fallbackLng,
      zoom: Number.isFinite(Number(mapRaw.zoom)) ? Math.max(1, Math.min(10, Number(mapRaw.zoom))) : 5,
    };

    const correctMatches =
      (task?.correctMatches && typeof task.correctMatches === "object" && task.correctMatches) ||
      Object.fromEntries(markers.map((m) => [m.id, m.correctAnswer]));

    return { markers, choices, map, correctMatches };
  }, [task]);

  const { markers, choices, map, correctMatches } = normalized;

  // ── State (mirrors MatchingTask) ──
  const isReview = mode === "review" || readOnly;
  const reviewMatches =
    (review &&
      typeof review === "object" &&
      (review.matches || review.answer?.matches || review.studentAnswer?.matches)) ||
    null;

  const [matches, setMatches] = useState({});       // { markerId: choiceText }
  const [activeMarker, setActiveMarker] = useState(null);
  const [activeChoice, setActiveChoice] = useState(null);
  const [localReview, setLocalReview] = useState(false);

  useEffect(() => {
    setMatches({});
    setActiveMarker(null);
    setActiveChoice(null);
    setLocalReview(false);
  }, [task?.taskType, task?.title, task?.prompt]);

  useEffect(() => {
    if (!isReview || !reviewMatches) return;
    setMatches(
      Object.fromEntries(
        Object.entries(reviewMatches).map(([k, v]) => [norm(k), norm(v)])
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReview]);

  useEffect(() => {
    if (isReview) return;
    onAnswerChange?.({ matches });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, isReview]);

  const isDisabled = !!disabled || isReview;
  const showReview = isReview || localReview;

  // Shuffled choices — stable per task instance so they don't jump on every
  // re-render but do reshuffle when a new task loads.
  const shuffledChoices = useMemo(() => {
    if (choices.length === 0) return [];
    const arr = choices.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices.join("|")]);

  const isComplete = markers.length > 0 && Object.keys(matches).length === markers.length;
  const hasAnswerKey = correctMatches && Object.keys(correctMatches).length > 0;

  const getMarkerForChoice = (choiceText) => {
    const entry = Object.entries(matches).find(([, v]) => norm(v) === norm(choiceText));
    return entry ? entry[0] : null;
  };

  function doMatch(markerId, choiceText) {
    if (!markerId || !choiceText || isDisabled) return;
    if (matches[markerId]) return;                            // marker already used
    if (Object.values(matches).some((v) => norm(v) === norm(choiceText))) return; // choice already used
    setMatches((prev) => ({ ...prev, [markerId]: choiceText }));
    setActiveMarker(null);
    setActiveChoice(null);
  }

  function removeMatch(markerId) {
    if (isDisabled) return;
    setMatches((prev) => {
      const next = { ...prev };
      delete next[markerId];
      return next;
    });
    setActiveMarker(null);
    setActiveChoice(null);
  }

  function onMarkerTap(markerId) {
    if (isDisabled) return;
    if (matches[markerId]) { removeMatch(markerId); return; }
    if (activeChoice) { doMatch(markerId, activeChoice); return; }
    setActiveMarker((cur) => (cur === markerId ? null : markerId));
  }

  function onChoiceTap(choiceText) {
    if (isDisabled) return;
    const usedByMarker = getMarkerForChoice(choiceText);
    if (usedByMarker) { removeMatch(usedByMarker); return; }
    if (activeMarker) { doMatch(activeMarker, choiceText); return; }
    setActiveChoice((cur) => (cur === choiceText ? null : choiceText));
  }

  function clearAll() {
    if (isDisabled) return;
    setMatches({});
    setActiveMarker(null);
    setActiveChoice(null);
  }

  function handleSubmit() {
    if (!isComplete || isDisabled) return;
    if (hasAnswerKey && !localReview && !isReview) {
      setLocalReview(true);
      return;
    }
    onSubmit?.({ matches });
  }

  const reviewScore = useMemo(() => {
    if (!hasAnswerKey) return null;
    let correct = 0;
    markers.forEach((m) => {
      if (norm(matches[m.id]) === norm(correctMatches[m.id])) correct += 1;
    });
    return { correct, total: markers.length };
  }, [hasAnswerKey, markers, matches, correctMatches]);

  // ── Map sizing (responsive square-ish image area) ──
  const mapWrapRef = useRef(null);
  const [mapPx, setMapPx] = useState({ w: 640, h: 360 });
  useEffect(() => {
    if (!mapWrapRef.current) return;
    const update = () => {
      const w = mapWrapRef.current.clientWidth || 640;
      // 16:9 viewport, capped so it stays readable on tall mobile screens.
      const h = Math.max(220, Math.min(420, Math.round(w * 0.56)));
      setMapPx({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(mapWrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Compute map URL + per-marker pixel positions. We use the StaticMapLite
  // pattern: a single OSM tile-server URL doesn't return a composed image,
  // so we instead use the `staticmap.openstreetmap.de` legacy service via
  // the staticmap rendering hosted at osm-staticmap (free, no key). If that
  // host is blocked, we fall back to a plain "no image — markers only over
  // a grey canvas with a region label" mode so the task is still playable.
  const staticMapUrl = useMemo(() => {
    const z = map.zoom;
    const lat = map.centerLat;
    const lng = map.centerLng;
    const size = `${mapPx.w}x${mapPx.h}`;
    // staticmap.openstreetmap.de — free, no key, returns a PNG.
    // Markers are drawn by the student app overlay (not by the URL) so we
    // get our coloured numbered badges instead of generic pushpins.
    return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${z}&size=${size}&maptype=mapnik`;
  }, [map.centerLat, map.centerLng, map.zoom, mapPx.w, mapPx.h]);

  // Project (lat,lng) → (px,py) relative to the static map's centre.
  function project(latVal, lngVal) {
    const z = map.zoom;
    const tileSize = 256;
    const cx = lonToTileX(map.centerLng, z) * tileSize;
    const cy = latToTileY(map.centerLat, z) * tileSize;
    const x = lonToTileX(lngVal, z) * tileSize - cx + mapPx.w / 2;
    const y = latToTileY(latVal, z) * tileSize - cy + mapPx.h / 2;
    return { x, y };
  }

  const [mapErrored, setMapErrored] = useState(false);

  // ── Render ──────────────────────────────────────────────────────────
  const palette = {
    text: "#0f172a",
    subtext: "#475569",
    border: "1px solid #e2e8f0",
    panel: "#ffffff",
    panelMuted: "#f8fafc",
    primary: "#2563eb",
  };

  function markerColor(m) {
    if (showReview && hasAnswerKey) {
      const picked = matches[m.id];
      if (!picked) return "#9ca3af";
      return norm(picked) === norm(correctMatches[m.id]) ? "#16a34a" : "#dc2626";
    }
    return MARKER_COLORS[(m.number - 1) % MARKER_COLORS.length];
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: palette.text }}>
      {/* Prompt */}
      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: palette.subtext, lineHeight: 1.45 }}>
        {task?.prompt || "Tap a numbered marker on the map, then tap the matching choice."}
        {map.regionHint && (
          <span style={{ marginLeft: 8, color: palette.subtext, fontWeight: 500 }}>
            ({map.regionHint})
          </span>
        )}
      </div>

      {/* Map area */}
      <div
        ref={mapWrapRef}
        style={{
          position: "relative",
          width: "100%",
          height: mapPx.h,
          borderRadius: 14,
          overflow: "hidden",
          border: palette.border,
          background: mapErrored ? "#e5e7eb" : "#dbeafe",
        }}
      >
        {!mapErrored && (
          <img
            src={staticMapUrl}
            alt={`Map of ${map.regionHint || "the region"}`}
            referrerPolicy="no-referrer"
            onError={() => setMapErrored(true)}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}

        {/* Fallback when the static map service is blocked — the markers
            still position correctly relative to each other thanks to the
            Mercator math, so the task is playable as a "spatial diagram". */}
        {mapErrored && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6,
            color: palette.subtext, fontSize: "0.85rem", fontWeight: 600, textAlign: "center", padding: 16,
          }}>
            <div>🗺️ {map.regionHint || "Map unavailable — positions still shown to scale"}</div>
          </div>
        )}

        {/* Marker overlay */}
        {markers.map((m) => {
          const { x, y } = project(m.lat, m.lng);
          // Clamp so markers always render inside the visible area even
          // if the AI's coords drift slightly outside the static viewport.
          const px = Math.max(18, Math.min(mapPx.w - 18, x));
          const py = Math.max(18, Math.min(mapPx.h - 18, y));
          const color = markerColor(m);
          const isActive = activeMarker === m.id;
          const picked = matches[m.id];
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onMarkerTap(m.id)}
              disabled={isDisabled}
              title={picked ? `${m.number}: ${picked} — tap to unset` : `Marker ${m.number}`}
              style={{
                position: "absolute",
                left: px,
                top: py,
                transform: "translate(-50%, -50%)",
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: color,
                border: isActive ? "3px solid #facc15" : "3px solid #ffffff",
                boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
                color: "#ffffff",
                fontWeight: 900,
                fontSize: 16,
                lineHeight: 1,
                cursor: isDisabled ? "default" : "pointer",
                outline: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-label={`Marker ${m.number}${picked ? `, currently set to ${picked}` : ""}`}
              aria-pressed={isActive}
            >
              {m.number}
            </button>
          );
        })}
      </div>

      {/* Marker list — like Matching's left column, but with the chosen
          choice shown inline. Tap a marker here OR on the map; both work. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {markers.map((m) => {
          const color = markerColor(m);
          const isActive = activeMarker === m.id;
          const picked = matches[m.id];
          const correct = showReview && hasAnswerKey && picked && norm(picked) === norm(correctMatches[m.id]);
          const wrong = showReview && hasAnswerKey && picked && norm(picked) !== norm(correctMatches[m.id]);
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 12,
                border: isActive ? `2px solid ${palette.primary}` : "1px solid #e2e8f0",
                background: correct ? "#f0fdf4" : wrong ? "#fef2f2" : palette.panel,
              }}
            >
              <button
                type="button"
                onClick={() => onMarkerTap(m.id)}
                disabled={isDisabled}
                style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: color, color: "#fff",
                  fontWeight: 900, fontSize: 14, lineHeight: 1,
                  border: "2px solid #ffffff", boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
                  cursor: isDisabled ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
                aria-label={`Marker ${m.number}`}
              >
                {m.number}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                {picked ? (
                  <span style={{
                    fontWeight: 700,
                    color: correct ? "#15803d" : wrong ? "#b91c1c" : palette.text,
                  }}>
                    {picked}
                    {wrong && correctMatches[m.id] && (
                      <span style={{ marginLeft: 8, fontWeight: 600, color: "#15803d", fontSize: "0.85rem" }}>
                        (was: {correctMatches[m.id]})
                      </span>
                    )}
                  </span>
                ) : (
                  <span style={{ color: palette.subtext, fontStyle: "italic", fontWeight: 500 }}>
                    {isActive ? "Tap a choice below…" : m.clue ? m.clue : "Tap to set"}
                  </span>
                )}
              </div>
              {picked && !showReview && (
                <button
                  type="button"
                  onClick={() => removeMatch(m.id)}
                  style={{
                    border: "none", background: "transparent",
                    color: "#6b7280", cursor: "pointer", fontSize: 18, padding: 4,
                  }}
                  aria-label="Remove this match"
                  title="Clear this match"
                >
                  ×
                </button>
              )}
              {showReview && m.note && (
                <span style={{ fontSize: "0.78rem", color: palette.subtext, marginLeft: 8 }}>
                  {m.note}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Choices — shuffled. Tap a choice to "activate" it; then tap a marker
          (on the map or in the list) to commit. Tap a used choice to clear. */}
      {!showReview && (
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: 0.5, color: palette.subtext, textTransform: "uppercase", marginBottom: 6 }}>
            Choices
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {shuffledChoices.map((c) => {
              const isUsed = !!getMarkerForChoice(c);
              const isActive = activeChoice === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChoiceTap(c)}
                  disabled={isDisabled}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: isActive
                      ? `2px solid ${palette.primary}`
                      : isUsed
                      ? "2px solid #cbd5e1"
                      : "1px solid #cbd5e1",
                    background: isUsed ? "#f1f5f9" : isActive ? "#eff6ff" : "#ffffff",
                    color: isUsed ? "#94a3b8" : palette.text,
                    fontWeight: 700,
                    fontSize: "0.9rem",
                    cursor: isDisabled ? "default" : "pointer",
                    textDecoration: isUsed ? "line-through" : "none",
                  }}
                  aria-pressed={isActive}
                  title={isUsed ? "Tap to clear this choice" : "Tap, then tap a marker"}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isReview && (
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
          {showReview && reviewScore && (
            <div style={{ marginRight: "auto", fontWeight: 800, color: palette.text }}>
              {reviewScore.correct}/{reviewScore.total} correct
            </div>
          )}
          {!showReview && Object.keys(matches).length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              disabled={isDisabled}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: palette.subtext,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isDisabled || !isComplete}
            style={{
              padding: "12px 22px",
              borderRadius: 12,
              border: "none",
              background: !isComplete ? "#cbd5e1" : showReview ? "#16a34a" : palette.primary,
              color: "#ffffff",
              fontWeight: 800,
              fontSize: "1rem",
              cursor: !isComplete || isDisabled ? "not-allowed" : "pointer",
              boxShadow: "0 6px 14px rgba(37,99,235,0.25)",
              opacity: isDisabled ? 0.6 : 1,
            }}
          >
            {showReview ? "✓ Continue" : isComplete ? "Submit" : `${Object.keys(matches).length}/${markers.length} placed`}
          </button>
        </div>
      )}
    </div>
  );
}
