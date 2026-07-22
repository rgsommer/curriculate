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

// Canonical 8 station colors, always in this order. Matches
// backend/socket/roomEngine.js `NUM_STATIONS = 8` and the
// hardcoded index → color mapping the client-side normalizer
// depends on. If we ever grow beyond 8, extend this list AND
// bump NUM_STATIONS to match.
const CANONICAL_COLORS = [
  "red", "blue", "green", "yellow",
  "purple", "orange", "teal", "pink",
];
const STATION_TARGET = 8;

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
 * Build EXACTLY 8 cards in canonical color order. Rules:
 *   - The 8 slots come from CANONICAL_COLORS. Never fewer, never more.
 *   - If a live session provided per-color tokens, use them so the QR
 *     payload contains the opaque token rather than the visible color
 *     name. Missing slots (e.g. room somehow returned only 5 stations,
 *     or we're in legacy no-session mode) fall back to the color URL
 *     the old StationPosters page has always printed.
 *   - This is the "always 8, always same colors, always same order"
 *     guarantee — teachers who print a fresh set can drop it straight
 *     into their existing station layout without renumbering.
 */
function buildCards({ stations, locationCode, legacyLocation }) {
  const displayLocation = locationCode || legacyLocation || "Classroom";

  // Index the session's stations by color so we can look up tokens by
  // canonical color slot below.
  const tokenByColor = {};
  const stationIdByColor = {};
  if (Array.isArray(stations)) {
    for (const st of stations) {
      const c = String(st?.color || "").toLowerCase();
      const t = String(st?.qrToken || "").toLowerCase();
      if (c && t) tokenByColor[c] = t;
      if (c && st?.id) stationIdByColor[c] = st.id;
    }
  }

  return CANONICAL_COLORS.map((color) => {
    const token = tokenByColor[color] || null;
    const qrPayload = token
      ? `https://${COPY.DOMAIN}/${encodeURIComponent(displayLocation)}/scan?t=${token}`
      : `https://${COPY.DOMAIN}/${encodeURIComponent(displayLocation)}/${color}`;
    return {
      stationId: stationIdByColor[color] || null,
      color,
      upper: color.toUpperCase(),
      location: displayLocation,
      qrPayload,
      tokenized: !!token,
    };
  });
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
            // Bigger quiet zone helps laptop webcams at oblique angles
            // where the QR sits ~10cm from the lens and lighting is
            // uneven — 4 modules of white padding vs the classic 2.
            margin: 4,
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

  // Legacy fallback — teacher can edit the physical-room label when
  // there's no live session (e.g. printing ahead of time). Always 8
  // stations regardless.
  const [legacyLocation, setLegacyLocation] = useState(
    query.get("location") || session?.locationCode || "Classroom",
  );

  const cards = useMemo(
    () => buildCards({
      stations: session?.stations,
      locationCode: session?.locationCode,
      legacyLocation,
    }),
    [session, legacyLocation],
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
          subtitle={`${sessionAware ? session.locationCode || "Classroom" : legacyLocation} · ${STATION_TARGET} stations`}
        />

        {!sessionAware && (
          <div style={legacyBanner}>
            <strong>Not linked to a live session.</strong>{" "}
            To print token-based cards (recommended), click <em>Print Laptop
            Hidden Cards</em> from a Live Session page. This page fell back
            to color-URL cards, which still work with every already-printed
            classroom poster.
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
            <SmallText label="Room label (front of card)" value={legacyLocation}
              onChange={(v) => setLegacyLocation(v)} placeholder="Room 112" />
          )}
        </div>

        {format === FORMATS.STANDARD && (
          <div data-testid="standard-simplex-note" style={softNote}>
            <strong>Single-sided format.</strong> Turn duplex OFF in your
            printer dialog — otherwise every second card will land on the
            back of the previous one.
          </div>
        )}

        {format !== FORMATS.STANDARD && (
          <>
            <HiddenCardInstructions flip={flip} />
            <SetupMockup flip={flip} />
          </>
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
        {/* Force a leading page to burn — some duplex printers pair
            odd-page-front-with-even-page-back automatically. Keeping
            an even page count when we have an odd count of physical
            cards helps sheets stay right-side-up. Not needed at 8
            stations × 2 sides = 16 pages (even) but harmless. */}
      </div>

      {/* Print-only CSS.
          .card-page HEIGHT is set explicitly per paper size so the
          card fills its sheet exactly with 0.35in margins:
             Letter (11in) - 0.7in margins = 10.3in
             A4     (11.69in) - 0.7in margins ≈ 10.99in
          Any smaller and duplex printers leave a blank strip; any
          larger and the browser splits the card across two pages. */}
      <style>{`
        .no-print { break-inside: avoid; }
        .card-page {
          box-sizing: border-box;
          width: 100%;
          height: ${paper === "a4" ? "10.99in" : "10.3in"};
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0.55in 0.5in;
          break-after: page;
          page-break-after: always;
          break-inside: avoid;
          page-break-inside: avoid;
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
          margin-top: 18px;
          font-size: 0.9rem;
          color: #64748b;
        }
        .card-orientation-marker {
          font-size: 3rem;
          color: #0f172a;
        }
        /* Explicit "tape here" strip on the physical top edge of the
           front side. Reserves space above the title so the ▲ marker
           and station name are never obscured by whatever adhesive
           the teacher uses. */
        .card-tape-strip {
          position: absolute;
          top: 0.28in;
          left: 0.5in;
          right: 0.5in;
          padding: 6px 0;
          text-align: center;
          font-size: 0.66rem;
          font-weight: 800;
          letter-spacing: 0.35em;
          color: #b45309;
          border-top: 2px dashed #b45309;
          border-bottom: 2px dashed #b45309;
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
            padding: 44px 12px 20px;
            break-after: auto;
            page-break-after: auto;
          }
          .card-tape-strip {
            top: 8px;
            left: 8px;
            right: 8px;
            font-size: 0.52rem;
            padding: 3px 0;
          }
          .card-face-title { font-size: 2rem; }
          .card-face-sub { font-size: 0.95rem; }
          .card-face-lift { font-size: 0.85rem; padding: 6px 14px; margin-top: 20px; }
          .card-swatch { width: 44px; height: 44px; margin-top: 14px; }
          .card-orientation-marker { font-size: 1.6rem; }
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

function PrintSheets({ cards, qrSvgs, format, flip }) {
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
          return <HiddenBackCard key={key} card={card} qrSvg={qrSvgs[card.qrPayload]} flip={flip} />;
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
    <div className="card-page hidden-face" data-testid={`hidden-face-${card.color}`}>
      {/* Explicit "Tape or pin along this edge" strip so the teacher
          doesn't have to interpret the ▲ marker on its own. Same
          strip prints regardless of flip direction because the front
          side always faces the room right-side-up. */}
      <div className="card-tape-strip">✂ ATTACH ALONG THIS EDGE ✂</div>
      <div className="card-orientation-marker" aria-hidden="true">▲</div>
      <h1 className="card-face-title" style={{ marginTop: 30 }}>{card.upper} STATION</h1>
      <div className="card-face-sub">{card.location}</div>
      <div className="card-swatch" style={{ background: swatchColor(card.color) }} />
      <div className="card-face-lift">🖐 Lift card to scan</div>
    </div>
  );
}

/**
 * Back-side card. The orientation marker MUST end up at the FREE
 * (bottom, un-taped) edge of the physical sheet no matter which
 * duplex flip direction the teacher chose.
 *
 *   Long-edge flip (portrait, book-style): the sheet flips around
 *   its vertical axis. DOM top of the back stays at physical top of
 *   the sheet. Marker at DOM top ends up at physical BOTTOM after the
 *   card hangs from the wall — WRONG in isolation, so we push the
 *   marker to the DOM BOTTOM here (via column-reverse below) so it
 *   ends up at the physical top — the taped edge — meaning it points
 *   AT the tape. But we want it to point AT the free (lift) edge…
 *
 * Rethink: the marker is a cue for the STUDENT lifting the card. It
 * should be at the free edge, pointing "lift here." That edge is:
 *   long-edge flip  → DOM bottom of the back page = physical bottom
 *                     = free edge
 *   short-edge flip → DOM top of the back page = physical bottom
 *                     = free edge (because the whole page flipped
 *                     upside down during the short-edge fold)
 *
 * Concretely: put the marker at the "free edge" of the physical
 * sheet in both cases by using flex column vs column-reverse.
 */
function HiddenBackCard({ card, qrSvg, flip }) {
  const isShort = flip === "short";
  return (
    <div
      className="card-page card-back qr-page hidden-back"
      data-testid={`hidden-back-${card.color}`}
      style={{ flexDirection: isShort ? "column" : "column-reverse" }}
    >
      {/* At the FREE (lift) edge — student sees this when they lift
          the bottom of the card up to reveal the QR. */}
      <div className="card-orientation-marker" aria-hidden="true">▲</div>
      <div style={{ marginTop: 24, marginBottom: 24 }} dangerouslySetInnerHTML={{ __html: qrSvg || "" }} />
      <div className="card-orientation">
        Hidden QR — {card.upper} station
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

function HiddenCardInstructions({ flip = "long" }) {
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
        <li>
          Set your printer to <strong>double-sided (duplex)</strong>{" "}
          with <strong>{flip === "short" ? "short-edge" : "long-edge"} binding</strong>{" "}
          — matches the picker above.
        </li>
        <li>Cut / separate the cards.</li>
        <li>Attach ONLY the top edge to the wall (tape or a single pushpin) — a dashed strip on the front shows exactly where.</li>
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

/**
 * SetupMockup — small SVG illustration showing the physical setup so
 * teachers can see the intended layout without printing first. Two
 * scenes side-by-side: hung against a wall (QR hidden) and lifted
 * (QR visible to camera below). Pure SVG, no external assets.
 */
function SetupMockup({ flip }) {
  return (
    <div data-testid="setup-mockup" style={{
      marginTop: 14,
      padding: 18,
      borderRadius: 16,
      background: "#f5f3ff",
      border: "1px solid #ddd6fe",
      color: "#4c1d95",
    }}>
      <div style={{ fontWeight: 900, marginBottom: 8, fontSize: "0.92rem" }}>
        📐 What it looks like on the wall
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
      }}>
        {/* Panel 1 — card hung, QR hidden */}
        <MockupPanel label="1. Hung (QR hidden)">
          <svg viewBox="0 0 240 170" width="100%" aria-hidden="true">
            {/* wall */}
            <rect x="0" y="0" width="240" height="170" fill="#faf5ff" />
            {/* card */}
            <g>
              <rect x="70" y="20" width="100" height="130" rx="4" fill="#fff" stroke="#a855f7" strokeWidth="1.5" />
              {/* tape strip */}
              <line x1="72" y1="30" x2="168" y2="30" stroke="#b45309" strokeWidth="1.5" strokeDasharray="3 3" />
              <text x="120" y="40" fontSize="7" textAnchor="middle" fill="#b45309" fontWeight="700">ATTACH EDGE</text>
              {/* station label */}
              <text x="120" y="80" fontSize="12" textAnchor="middle" fill="#0f172a" fontWeight="900">STATION</text>
              <circle cx="120" cy="95" r="7" fill="#ef4444" />
              <text x="120" y="122" fontSize="7" textAnchor="middle" fill="#78350f">🖐 Lift to scan</text>
            </g>
            {/* pin */}
            <circle cx="120" cy="18" r="3" fill="#0f172a" />
          </svg>
        </MockupPanel>

        {/* Panel 2 — card lifted, camera below */}
        <MockupPanel label="2. Lifted (QR visible to webcam below)">
          <svg viewBox="0 0 240 170" width="100%" aria-hidden="true">
            <rect x="0" y="0" width="240" height="170" fill="#faf5ff" />
            {/* pin at top */}
            <circle cx="120" cy="16" r="3" fill="#0f172a" />
            {/* card lifted — hinges at top, back visible */}
            <g transform="translate(120,20) rotate(-45)">
              <rect x="-50" y="0" width="100" height="130" rx="4" fill="#fafafa" stroke="#a855f7" strokeWidth="1.5" />
              {/* QR grid stub */}
              <g transform={`translate(-30, ${flip === "short" ? 20 : 50})`}>
                {[0,1,2,3,4,5].flatMap((r) =>
                  [0,1,2,3,4,5].map((c) => (
                    <rect key={`${r}-${c}`} x={c*10} y={r*10} width="8" height="8"
                      fill={(r+c) % 2 === 0 ? "#0f172a" : "#fff"} />
                  ))
                )}
              </g>
              <text x="0" y="115" fontSize="6" textAnchor="middle" fill="#64748b">Hidden QR</text>
            </g>
            {/* laptop below */}
            <g transform="translate(70,130)">
              <rect x="0" y="0" width="100" height="4" rx="1" fill="#0f172a" />
              <polygon points="10,0 90,0 80,-24 20,-24" fill="#1e293b" stroke="#334155" />
              <circle cx="50" cy="-14" r="3" fill="#38bdf8" />
              <text x="50" y="-4" fontSize="5" textAnchor="middle" fill="#38bdf8">webcam</text>
            </g>
          </svg>
        </MockupPanel>
      </div>
      <div style={{
        marginTop: 10,
        fontSize: "0.78rem",
        color: "#5b21b6",
        opacity: 0.85,
      }}>
        The QR reads whichever way up jsQR sees it — but the {flip === "short" ? "short-edge" : "long-edge"}{" "}
        flip picker below tunes the back-page markers to point at the free (lift) edge.
      </div>
    </div>
  );
}

function MockupPanel({ label, children }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 6,
      padding: 10,
      background: "#fff",
      borderRadius: 12,
      border: "1px solid #ede9fe",
    }}>
      {children}
      <div style={{ fontSize: "0.7rem", fontWeight: 700, textAlign: "center", color: "#5b21b6" }}>
        {label}
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

const softNote = {
  marginTop: 18,
  padding: "10px 14px",
  borderRadius: 12,
  background: "#f0f9ff",
  color: "#0c4a6e",
  border: "1px solid #bae6fd",
  fontSize: "0.86rem",
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
