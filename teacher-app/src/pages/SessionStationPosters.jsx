// teacher-app/src/pages/SessionStationPosters.jsx
//
// Phase 3 — Hidden QR cards + print pipeline. Session-aware poster
// generator that supports two formats:
//
//   • Standard         — single-sided, visible QR (like the existing
//                        StationPosters). Suits tablet-only sessions.
//   • Laptop Hidden    — double-sided card. Front shows station name +
//                        "Lift card to scan". QR lives on the reverse.
//                        Teacher tapes only the top edge to the wall so
//                        students lift the card and hold a laptop
//                        webcam beneath it. Preserves movement-based
//                        pedagogy; keeps station codes off any surface
//                        a student can memorize or photograph from
//                        across the room.
//   • Mixed            — prints both formats back-to-back so classrooms
//                        with a device mix can use whichever card
//                        matches each team's device.
//
// Data flow (session-aware):
//   1. Teacher launches this page from LiveSession's Print QR Cards
//      button. That button writes { stations, locationCode, roomCode }
//      into localStorage under "curriculate.printPayload".
//   2. This page reads that payload on mount, then clears it.
//   3. QR payloads encode the per-station qrToken (Phase 2b) so the
//      classroom copy contains no visible color name in the URL.
//   4. If the payload is missing / stale, the page falls back to the
//      legacy color-URL flow so a teacher who bookmarked the URL still
//      gets working (color-based) posters.
//
// QR generation: local `qrcode` npm package (SVG output). No external
// service — offline classrooms print cleanly.

import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { COPY } from "@shared/config/copy";
import { PageHeader, Button } from "../components/ui";

const LEGACY_COLORS = [
  "red", "blue", "green", "yellow",
  "purple", "orange", "teal", "pink",
  "lime", "navy", "brown", "gray",
];

const FORMATS = {
  STANDARD: "standard",
  HIDDEN: "hidden",
  MIXED: "mixed",
};

const PAPER = {
  LETTER: { key: "letter", label: "US Letter (8.5×11″)", cssSize: "letter" },
  A4:     { key: "a4",     label: "A4 (210×297 mm)",     cssSize: "A4"     },
};

const FLIP = {
  LONG:  { key: "long",  label: "Flip on long edge (most common)"  },
  SHORT: { key: "short", label: "Flip on short edge (calendar style)" },
};

const STORAGE_KEY = "curriculate.printPayload";
const PAYLOAD_TTL_MS = 60 * 1000; // 60s — the payload is a one-shot handoff

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/**
 * Read the localStorage handoff written by LiveSession. Returns null if
 * the payload doesn't exist or is stale. Does NOT clear the payload —
 * StrictMode mounts this component twice in dev and we don't want the
 * first mount to wipe the payload before the second reads it. The 60s
 * TTL is short enough that stale reuse isn't a concern.
 */
function readPrintPayload() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const age = Date.now() - Number(parsed?.at || 0);
    if (age > PAYLOAD_TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the list of cards to render, given room state (session-aware) OR
 * legacy inputs (location + station count).
 */
function buildCards({ stations, locationCode, roomCode, legacyLocation, legacyCount }) {
  const hasSessionStations = Array.isArray(stations) && stations.length > 0;
  if (hasSessionStations) {
    const cards = [];
    const displayLocation = locationCode || "Classroom";
    for (const st of stations) {
      const color = String(st?.color || "").toLowerCase() || "gray";
      const token = String(st?.qrToken || "").toLowerCase();
      // Prefer token payload so the printed URL contains no visible
      // color name. Fall back to legacy color URL if a station somehow
      // has no token (e.g. very old room state).
      const qrPayload = token
        ? `https://${COPY.DOMAIN}/${encodeURIComponent(displayLocation)}/scan?t=${token}`
        : `https://${COPY.DOMAIN}/${encodeURIComponent(displayLocation)}/${color}`;
      cards.push({
        stationId: st.id,
        color,
        upper: color.toUpperCase(),
        location: displayLocation,
        qrPayload,
        roomCode,
        tokenized: !!token,
      });
    }
    return cards;
  }
  // Legacy — no session state. Use the same color-URL scheme the old
  // StationPosters page prints, so the URL matches every currently-
  // printed poster.
  const displayLocation = legacyLocation || "Classroom";
  const colors = LEGACY_COLORS.slice(0, legacyCount);
  return colors.map((color) => ({
    color,
    upper: color.toUpperCase(),
    location: displayLocation,
    qrPayload: `https://${COPY.DOMAIN}/${encodeURIComponent(displayLocation)}/${color}`,
    roomCode: null,
    tokenized: false,
  }));
}

/** Generate all QR SVGs up front and cache in state. */
function useQrSvgs(cards) {
  const [svgs, setSvgs] = useState({});
  useEffect(() => {
    let cancelled = false;
    const gen = async () => {
      const results = {};
      for (const c of cards) {
        try {
          const svg = await QRCode.toString(c.qrPayload, {
            type: "svg",
            margin: 2,
            errorCorrectionLevel: "M",
            width: 620,
          });
          results[c.qrPayload] = svg;
        } catch (err) {
          console.error("[SessionStationPosters] QR gen failed:", err);
        }
      }
      if (!cancelled) setSvgs(results);
    };
    gen();
    return () => { cancelled = true; };
  }, [cards]);
  return svgs;
}

/* ─────────────────────── COMPONENT ─────────────────────── */

export default function SessionStationPosters() {
  const query = useQuery();
  const navigate = useNavigate();

  // Try to consume the session handoff first.
  const [session, setSession] = useState(() => readPrintPayload());

  // UI state
  const [format, setFormat] = useState(FORMATS.HIDDEN);
  const [paper, setPaper] = useState(PAPER.LETTER.key);
  const [flip, setFlip] = useState(FLIP.LONG.key);

  // Legacy fallback inputs
  const [legacyLocation, setLegacyLocation] = useState(
    query.get("location") || session?.locationCode || "Classroom",
  );
  const [legacyCount, setLegacyCount] = useState(() => {
    const raw = Number(query.get("stations") || 8);
    return Math.min(12, Math.max(4, Number.isFinite(raw) ? raw : 8));
  });

  const cards = useMemo(
    () => buildCards({
      stations: session?.stations,
      locationCode: session?.locationCode,
      roomCode: session?.roomCode,
      legacyLocation,
      legacyCount,
    }),
    [session, legacyLocation, legacyCount],
  );

  const qrSvgs = useQrSvgs(cards);
  const sessionAware = !!session;

  const handlePrint = () => window.print();

  return (
    <div style={{ padding: "24px 20px 60px", maxWidth: 1100, margin: "0 auto" }}>
      <style>{`@page { size: ${paper === "a4" ? "A4" : "letter"} portrait; margin: 0.35in; }`}</style>

      {/* On-screen chrome — hidden when printing */}
      <div className="no-print">
        <PageHeader
          title="Session QR Cards"
          subtitle={sessionAware
            ? `Room ${session.roomCode || ""} · ${cards.length} stations`
            : "Legacy mode — printing color-based posters (no active session)"}
        />

        {!sessionAware && (
          <div style={legacyBanner}>
            <strong>Not linked to a live session.</strong>{" "}
            To print token-based cards, click <em>Print QR Cards</em> from a Live
            Session page. This page fell back to legacy color URLs, which still
            work with every already-printed classroom poster.
          </div>
        )}

        {/* Format picker */}
        <div style={pickerRow}>
          <FormatCard
            id={FORMATS.STANDARD}
            active={format === FORMATS.STANDARD}
            onClick={() => setFormat(FORMATS.STANDARD)}
            icon="📄"
            title="Standard"
            blurb="Single-sided posters with a visible QR. Best for tablet-only classrooms."
          />
          <FormatCard
            id={FORMATS.HIDDEN}
            active={format === FORMATS.HIDDEN}
            onClick={() => setFormat(FORMATS.HIDDEN)}
            icon="🃏"
            title="Laptop Hidden"
            blurb="Double-sided card. QR sits on the back so it's invisible from across the room. Laptop teams lift the card and scan with the webcam."
            recommended
          />
          <FormatCard
            id={FORMATS.MIXED}
            active={format === FORMATS.MIXED}
            onClick={() => setFormat(FORMATS.MIXED)}
            icon="🎛"
            title="Mixed"
            blurb="Prints both formats one after the other. Every station gets a standard poster and a hidden card."
          />
        </div>

        {/* Paper + flip + optional legacy inputs */}
        <div style={pickerRow2}>
          <SmallSelect label="Paper size" value={paper} onChange={setPaper}
            options={Object.values(PAPER).map((p) => ({ value: p.key, label: p.label }))} />
          {format !== FORMATS.STANDARD && (
            <SmallSelect label="Duplex flip" value={flip} onChange={setFlip}
              options={Object.values(FLIP).map((f) => ({ value: f.key, label: f.label }))} />
          )}
          {!sessionAware && (
            <>
              <SmallText label="Location label" value={legacyLocation}
                onChange={(v) => setLegacyLocation(v)} placeholder="Classroom" />
              <SmallNum label="Stations" value={legacyCount} min={4} max={12}
                onChange={(v) => setLegacyCount(v)} />
            </>
          )}
        </div>

        {format !== FORMATS.STANDARD && (
          <HiddenCardInstructions />
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <Button onClick={handlePrint} data-testid="print-button">
            🖨 Print {cards.length} cards
            {format === FORMATS.MIXED ? " × 2 formats" : ""}
          </Button>
          <Button variant="secondary" onClick={() => navigate("/live-session")}>
            ← Back to Live Session
          </Button>
        </div>
      </div>

      {/* Print surface */}
      <div className="print-surface" data-testid="print-surface" style={{ marginTop: 28 }}>
        <PrintSheets
          cards={cards}
          qrSvgs={qrSvgs}
          format={format}
          flip={flip}
        />
      </div>

      {/* Print-only CSS */}
      <style>{`
        .no-print { break-inside: avoid; }
        .card-page {
          box-sizing: border-box;
          width: 100%;
          height: 10.2in;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0.6in;
          break-after: page;
          page-break-after: always;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          background: #fff;
          color: #0f172a;
        }
        .card-page:last-child { break-after: auto; page-break-after: auto; }
        .card-back {
          background: #fafafa;
        }
        .card-face-title {
          font-size: 3.8rem;
          font-weight: 900;
          letter-spacing: 0.02em;
          margin: 0;
          text-align: center;
        }
        .card-face-sub {
          margin-top: 12px;
          font-size: 1.25rem;
          color: #475569;
          text-align: center;
        }
        .card-face-lift {
          margin-top: 36px;
          padding: 12px 22px;
          border-radius: 999px;
          background: #fde68a;
          color: #78350f;
          font-weight: 800;
          font-size: 1.05rem;
        }
        .card-swatch {
          margin-top: 30px;
          width: 84px;
          height: 84px;
          border-radius: 18px;
          box-shadow: inset 0 0 0 3px rgba(0,0,0,0.08), 0 3px 6px rgba(0,0,0,0.15);
        }
        .card-orientation {
          margin-top: 22px;
          font-size: 0.9rem;
          color: #64748b;
        }
        .card-orientation-marker {
          margin-top: 22px;
          font-size: 3rem;
          color: #0f172a;
        }
        .card-back .card-orientation-marker {
          transform: rotate(180deg);
        }

        @media screen {
          .print-surface {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 14px;
          }
          .card-page {
            border: 1px dashed #e2e8f0;
            border-radius: 14px;
            height: auto;
            min-height: 340px;
            padding: 20px 12px;
            break-after: auto;
            page-break-after: auto;
          }
          .card-face-title { font-size: 2rem; }
          .card-face-sub { font-size: 0.95rem; }
          .card-face-lift { font-size: 0.85rem; padding: 6px 14px; margin-top: 20px; }
          .card-swatch { width: 44px; height: 44px; margin-top: 14px; }
          .card-orientation-marker { font-size: 1.6rem; margin-top: 10px; }
          .card-page.qr-page svg { width: 60% !important; height: auto !important; }
        }

        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────── PRINT LAYOUT ─────────────────────── */

function PrintSheets({ cards, qrSvgs, format }) {
  // For hidden and mixed formats, the layout is one card per page:
  //   Standard: Face page only
  //   Hidden:   Face page + QR back page (two pages per station)
  //   Mixed:    All standard first, then all hidden
  const pages = [];
  const emit = (kind, card) => pages.push({ kind, card, key: `${kind}:${card.stationId || card.color}` });

  if (format === FORMATS.STANDARD) {
    for (const c of cards) {
      emit("standard-visible", c);
    }
  } else if (format === FORMATS.HIDDEN) {
    for (const c of cards) {
      emit("hidden-face", c);
      emit("hidden-back", c);
    }
  } else if (format === FORMATS.MIXED) {
    for (const c of cards) emit("standard-visible", c);
    for (const c of cards) emit("hidden-face", c);
    for (const c of cards) emit("hidden-back", c);
  }

  return (
    <>
      {pages.map(({ kind, card, key }) => {
        if (kind === "standard-visible") {
          return <StandardCard key={key} card={card} qrSvg={qrSvgs[card.qrPayload]} />;
        }
        if (kind === "hidden-face") {
          return <HiddenFaceCard key={key} card={card} />;
        }
        if (kind === "hidden-back") {
          return <HiddenBackCard key={key} card={card} qrSvg={qrSvgs[card.qrPayload]} />;
        }
        return null;
      })}
    </>
  );
}

function StandardCard({ card, qrSvg }) {
  return (
    <div className="card-page qr-page" data-testid={`std-${card.color}`}>
      <h1 className="card-face-title">{card.upper} STATION</h1>
      <div className="card-face-sub">{card.location}</div>
      <div className="card-swatch" style={{ background: swatchColor(card.color) }} />
      <div style={{ marginTop: 30 }} dangerouslySetInnerHTML={{ __html: qrSvg || "" }} />
      <div className="card-orientation">Scan to arrive at this station</div>
    </div>
  );
}

function HiddenFaceCard({ card }) {
  return (
    <div className="card-page" data-testid={`hidden-face-${card.color}`}>
      <div className="card-orientation-marker">▲</div>
      <h1 className="card-face-title" style={{ marginTop: 30 }}>{card.upper} STATION</h1>
      <div className="card-face-sub">{card.location}</div>
      <div className="card-swatch" style={{ background: swatchColor(card.color) }} />
      <div className="card-face-lift">🖐 Lift card to scan</div>
    </div>
  );
}

function HiddenBackCard({ card, qrSvg }) {
  return (
    <div className="card-page card-back qr-page" data-testid={`hidden-back-${card.color}`}>
      {/* On the REVERSE side the orientation marker points DOWN so
          when the card is taped by its top edge, the QR reads right-
          side-up to the laptop camera lifted underneath. */}
      <div className="card-orientation-marker">▼</div>
      <div style={{ marginTop: 24 }} dangerouslySetInnerHTML={{ __html: qrSvg || "" }} />
      <div className="card-orientation" style={{ marginTop: 30 }}>
        Position the laptop camera below the card
      </div>
    </div>
  );
}

/* ─────────────────────── UI HELPERS ─────────────────────── */

function FormatCard({ id, active, onClick, icon, title, blurb, recommended }) {
  return (
    <button
      type="button"
      data-testid={`format-${id}`}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 200,
        padding: "16px 18px",
        borderRadius: 16,
        border: active ? "2px solid #7c3aed" : "2px solid #e2e8f0",
        background: active ? "linear-gradient(160deg, #fff, #ede9fe)" : "#fff",
        boxShadow: active ? "0 8px 22px rgba(124,58,237,0.18)" : "0 2px 8px rgba(15,23,42,0.04)",
        textAlign: "left",
        cursor: "pointer",
        color: "#0f172a",
        position: "relative",
      }}
    >
      {recommended && (
        <span style={{
          position: "absolute", top: 8, right: 10,
          fontSize: "0.6rem", fontWeight: 800, letterSpacing: 0.5,
          textTransform: "uppercase",
          padding: "2px 8px", borderRadius: 999,
          background: "#7c3aed", color: "#fff",
        }}>Recommended</span>
      )}
      <div style={{ fontSize: "1.8rem" }}>{icon}</div>
      <div style={{ marginTop: 6, fontWeight: 900, fontSize: "1.02rem" }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: "0.8rem", color: "#475569" }}>{blurb}</div>
    </button>
  );
}

function SmallSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
      <span style={smallLabel}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={smallInput}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function SmallText({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
      <span style={smallLabel}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={smallInput} />
    </label>
  );
}

function SmallNum({ label, value, onChange, min, max }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
      <span style={smallLabel}>{label}</span>
      <input
        type="number" min={min} max={max} value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)));
        }}
        style={smallInput}
      />
    </label>
  );
}

function HiddenCardInstructions() {
  return (
    <div data-testid="hidden-instructions" style={{
      marginTop: 22,
      padding: 18,
      borderRadius: 16,
      background: "#fff7ed",
      border: "1px solid #fed7aa",
      color: "#7c2d12",
    }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>
        🃏 How to hang & use the hidden cards
      </div>
      <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.7 }}>
        <li>Print double-sided — the QR sits on the reverse of each card.</li>
        <li>Cut / separate the cards.</li>
        <li>Attach ONLY the top edge to the wall (tape or a single pushpin).</li>
        <li>Keep the QR side facing the wall so students can't see the code from a distance.</li>
        <li>Team lifts the lower edge of the card and holds the laptop camera underneath — the webcam reads the QR from below.</li>
      </ol>
      <div style={{ marginTop: 10, fontSize: "0.85rem", opacity: 0.85 }}>
        This preserves movement-based pedagogy — a student still has to physically
        travel to the station to scan, even on a laptop.
      </div>
    </div>
  );
}

/* ─────────────────────── STYLE CONSTANTS ─────────────────────── */

const legacyBanner = {
  padding: "12px 16px",
  borderRadius: 12,
  background: "#fef3c7",
  color: "#78350f",
  border: "1px solid #fcd34d",
  fontSize: "0.9rem",
  marginBottom: 18,
};

const pickerRow = {
  display: "flex",
  gap: 14,
  flexWrap: "wrap",
  marginTop: 20,
};

const pickerRow2 = {
  display: "flex",
  gap: 14,
  flexWrap: "wrap",
  marginTop: 22,
  padding: 16,
  borderRadius: 14,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
};

const smallLabel = { fontSize: "0.7rem", fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#64748b" };
const smallInput = { padding: "8px 10px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: "0.9rem" };

function swatchColor(color) {
  const map = {
    red: "#ef4444", blue: "#3b82f6", green: "#10b981", yellow: "#eab308",
    purple: "#a855f7", orange: "#fb923c", teal: "#14b8a6", pink: "#ec4899",
    lime: "#84cc16", navy: "#1e3a8a", brown: "#92400e", gray: "#64748b",
  };
  return map[color] || "#64748b";
}
