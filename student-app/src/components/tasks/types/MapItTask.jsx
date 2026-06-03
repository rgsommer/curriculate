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
    if (isDisabled) return;
    // Allow partial submission — a stuck tester used to be trapped by a
    // hard `!isComplete` gate, with Skip as their only escape (tester
    // sehraj 2026-06-03: mapit "didn't work" via-skip). Now if a few
    // markers are unmatched we confirm and proceed; missing ones render
    // as red in review so the player still sees the right answers.
    if (!isComplete) {
      const missing = markers.length - Object.keys(matches).length;
      const ok = window.confirm(
        `You haven't matched ${missing} marker${missing === 1 ? "" : "s"} yet.\n\n` +
          `Submit anyway and see the answers?`
      );
      if (!ok) return;
    }
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

  // Compose the map background from OpenStreetMap's CANONICAL tile server
  // (tile.openstreetmap.org). The previous implementation used staticmap.
  // openstreetmap.de, a known-flaky third-party static composer — it was
  // intermittently down, which triggered the empty-grey fallback (tester
  // 2026-05-31 screenshot: grey background, no map).
  // The canonical tile URL is reliable, free, no key required, and only
  // costs a handful of tile requests per task (≈ 6–12 per map view).
  const TILE_SIZE = 256;
  const tileGrid = useMemo(() => {
    if (!mapPx.w || !mapPx.h) return [];
    const z = map.zoom;
    const cxFloat = lonToTileX(map.centerLng, z);
    const cyFloat = latToTileY(map.centerLat, z);
    // Render one tile beyond the viewport on every side so panning artefacts
    // are absent and tiny rounding gaps disappear.
    const halfWTiles = Math.ceil(mapPx.w / TILE_SIZE / 2) + 1;
    const halfHTiles = Math.ceil(mapPx.h / TILE_SIZE / 2) + 1;
    const maxTile = Math.pow(2, z) - 1;
    const tiles = [];
    for (let dx = -halfWTiles; dx <= halfWTiles; dx++) {
      for (let dy = -halfHTiles; dy <= halfHTiles; dy++) {
        const tx = Math.floor(cxFloat) + dx;
        const ty = Math.floor(cyFloat) + dy;
        if (tx < 0 || ty < 0 || tx > maxTile || ty > maxTile) continue;
        const left = (tx - cxFloat) * TILE_SIZE + mapPx.w / 2;
        const top = (ty - cyFloat) * TILE_SIZE + mapPx.h / 2;
        tiles.push({ tx, ty, z, left, top });
      }
    }
    return tiles;
  }, [map.centerLat, map.centerLng, map.zoom, mapPx.w, mapPx.h]);

  // Project (lat,lng) → (px,py) relative to the tile composite centre.
  function project(latVal, lngVal) {
    const z = map.zoom;
    const cx = lonToTileX(map.centerLng, z) * TILE_SIZE;
    const cy = latToTileY(map.centerLat, z) * TILE_SIZE;
    const x = lonToTileX(lngVal, z) * TILE_SIZE - cx + mapPx.w / 2;
    const y = latToTileY(latVal, z) * TILE_SIZE - cy + mapPx.h / 2;
    return { x, y };
  }

  // De-overlap projected marker positions so nothing stacks on top of
  // anything else (tester 2026-05-31 screenshot: markers 3 and 4 sitting
  // on top of each other; marker 2 hidden behind one of them). Walk the
  // markers in order, nudging any whose projected centre is within MIN_GAP
  // of an already-placed marker outward along the bearing between them.
  const MIN_GAP = 42; // px — slightly larger than the 36px badge diameter
  const positionedMarkers = useMemo(() => {
    if (!mapPx.w || !mapPx.h) return [];
    const placed = [];
    return markers.map((m) => {
      let { x, y } = project(m.lat, m.lng);
      // Iterate until the marker is at least MIN_GAP away from every other.
      for (let pass = 0; pass < 8; pass++) {
        let collided = false;
        for (const p of placed) {
          const dx = x - p.x, dy = y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < MIN_GAP) {
            const ang = d < 0.5 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx);
            x = p.x + Math.cos(ang) * MIN_GAP;
            y = p.y + Math.sin(ang) * MIN_GAP;
            collided = true;
          }
        }
        if (!collided) break;
      }
      // Clamp inside the visible map area.
      const px = Math.max(20, Math.min(mapPx.w - 20, x));
      const py = Math.max(20, Math.min(mapPx.h - 20, y));
      placed.push({ x: px, y: py });
      return { ...m, _px: px, _py: py };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, mapPx.w, mapPx.h, map.centerLat, map.centerLng, map.zoom]);

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
    // paddingBottom keeps the Submit button clear of TaskRunner's global
    // Skip Task button (position:absolute, bottom:10, right:10) — tester
    // (2026-05-31): "Skip Task button is on top of the Submit button".
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: palette.text, paddingBottom: 56 }}>
      {/* Prompt — region hint is now a chip on the map itself, so don't
          duplicate it here. */}
      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: palette.subtext, lineHeight: 1.45 }}>
        {task?.prompt || "Tap a numbered marker on the map, then tap the matching choice."}
      </div>

      {/* Map area — OSM tile composite + de-overlapped marker overlay. */}
      <div
        ref={mapWrapRef}
        style={{
          position: "relative",
          width: "100%",
          height: mapPx.h,
          borderRadius: 14,
          overflow: "hidden",
          border: palette.border,
          background: "#dbeafe",
        }}
      >
        {/* Tile grid — each tile is an absolutely-positioned <img> over the
            blue water background. Tile load failures (rare) leave a small
            transparent gap that the blue bg fills, so the task stays usable. */}
        {tileGrid.map((t) => (
          <img
            key={`${t.z}-${t.tx}-${t.ty}`}
            src={`https://tile.openstreetmap.org/${t.z}/${t.tx}/${t.ty}.png`}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
            style={{
              position: "absolute",
              left: t.left,
              top: t.top,
              width: TILE_SIZE,
              height: TILE_SIZE,
              pointerEvents: "none",
              userSelect: "none",
            }}
          />
        ))}

        {/* Region hint chip — small, top-left, never overlapping the markers. */}
        {map.regionHint && (
          <div style={{
            position: "absolute",
            top: 10, left: 10, zIndex: 2,
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(15,23,42,0.12)",
            color: palette.text,
            fontSize: "0.75rem", fontWeight: 700,
            boxShadow: "0 2px 6px rgba(15,23,42,0.10)",
            maxWidth: "70%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            🗺️ {map.regionHint}
          </div>
        )}

        {/* OSM attribution — required by the OSM tile usage policy. */}
        <div style={{
          position: "absolute",
          bottom: 4, right: 6, zIndex: 2,
          padding: "1px 6px",
          borderRadius: 4,
          background: "rgba(255,255,255,0.78)",
          color: "#374151",
          fontSize: "0.62rem",
          fontWeight: 500,
        }}>
          © OpenStreetMap contributors
        </div>

        {/* Marker overlay — uses the de-overlapped pre-computed positions. */}
        {positionedMarkers.map((m) => {
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
                left: m._px,
                top: m._py,
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
                zIndex: 3,
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
          // Review of an unmatched marker — show as a wrong/missed row so the
          // tester can still see the correct answer instead of an empty slot.
          const missed = showReview && hasAnswerKey && !picked;
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
                background: correct ? "#f0fdf4" : wrong || missed ? "#fef2f2" : palette.panel,
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
                ) : missed ? (
                  <span style={{ fontWeight: 700, color: "#b91c1c" }}>
                    no answer
                    {correctMatches[m.id] && (
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
            disabled={isDisabled}
            style={{
              padding: "12px 22px",
              borderRadius: 12,
              border: "none",
              background: showReview ? "#16a34a" : isComplete ? palette.primary : "#64748b",
              color: "#ffffff",
              fontWeight: 800,
              fontSize: "1rem",
              cursor: isDisabled ? "not-allowed" : "pointer",
              boxShadow: "0 6px 14px rgba(37,99,235,0.25)",
              opacity: isDisabled ? 0.6 : 1,
            }}
          >
            {showReview
              ? "✓ Continue"
              : isComplete
              ? "Submit"
              : `Submit (${Object.keys(matches).length}/${markers.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
