// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";

// Up to 12 clearly distinct colours, with text colour chosen for contrast
const MASTER_COLORS = [
  { key: "RED", hex: "#ff0000", text: "#ffffff" },
  { key: "BLUE", hex: "#0066ff", text: "#ffffff" },
  { key: "GREEN", hex: "#00aa33", text: "#ffffff" },
  { key: "YELLOW", hex: "#ffcc00", text: "#111827" },
  { key: "ORANGE", hex: "#ff8800", text: "#111827" },
  { key: "PURPLE", hex: "#9900cc", text: "#ffffff" },
  { key: "TEAL", hex: "#08a39a", text: "#ffffff" },
  { key: "PINK", hex: "#ff4f9a", text: "#ffffff" },
  { key: "LIME", hex: "#8bc34a", text: "#111827" },
  { key: "NAVY", hex: "#002b5c", text: "#ffffff" },
  { key: "BROWN", hex: "#8b4513", text: "#ffffff" },
  { key: "GRAY", hex: "#555555", text: "#ffffff" },
];

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function StationPosters() {
  const query = useQuery();
  const room = (query.get("room") || "").toUpperCase();
  const locationLabel = query.get("location") || "Classroom";

  // Number of stations: default 8, but allow 4–12
  const countRaw = parseInt(query.get("count") || "8", 10);
  const count = Math.min(12, Math.max(4, isNaN(countRaw) ? 8 : countRaw));

  const colors = MASTER_COLORS.slice(0, count);

  const basePlayUrl = "https://play.curriculate.net";

  // Helper: build QR URL (Google Charts)
  const buildQrUrl = (colorKey) => {
    const fullUrl = `${basePlayUrl}/?room=${encodeURIComponent(
      room
    )}&station=${encodeURIComponent(colorKey)}`;
    return (
      "https://chart.googleapis.com/chart" +
      `?chs=250x250&cht=qr&chl=${encodeURIComponent(fullUrl)}`
    );
  };

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Print hint */}
      <div
        style={{
          padding: 8,
          textAlign: "center",
          borderBottom: "1px solid #e5e7eb",
          marginBottom: 8,
          position: "sticky",
          top: 0,
          background: "#f9fafb",
        }}
        className="no-print"
      >
        <span style={{ fontSize: "0.9rem", marginRight: 12 }}>
          Station posters for room{" "}
          <strong>{room || "?"}</strong> – location:{" "}
          <strong>{locationLabel}</strong> –{" "}
          <strong>{count}</strong> station
          {count === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: "none",
            background: "#2563eb",
            color: "#fff",
            fontSize: "0.85rem",
            cursor: "pointer",
          }}
        >
          Print all
        </button>
      </div>

      {/* One page per station */}
      {colors.map((c, index) => (
        <div
          key={c.key}
          style={{
            width: "8.5in",
            height: "11in",
            boxSizing: "border-box",
            padding: "1in 0.75in",
            margin: "0 auto 0.5in",
            pageBreakAfter: index === colors.length - 1 ? "auto" : "always",
            border: "1px solid #e5e7eb",
            background: "#fdfaf3",
          }}
          className="poster-page"
        >
          {/* Title */}
          <div
            style={{
              textAlign: "center",
              fontSize: "1.4rem",
              fontWeight: 600,
              marginBottom: "1.2rem",
            }}
          >
            Curriculate
          </div>

          {/* Colour block */}
          <div
            style={{
              width: "100%",
              height: "3in",
              background: c.hex,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "1.2rem",
            }}
          >
            <div
              style={{
                color: c.text,
                fontSize: "1.5rem",
                fontWeight: 700,
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              {c.key} Station
              <br />
              {locationLabel}
            </div>
          </div>

          {/* Instructions */}
          <div
            style={{
              textAlign: "center",
              fontSize: "1.2rem",
              fontWeight: 600,
              marginBottom: "0.8rem",
            }}
          >
            Scan to Arrive
          </div>

          {/* QR */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: "0.8rem",
            }}
          >
            <img
              src={buildQrUrl(c.key.toLowerCase())}
              alt={`${c.key} Station QR`}
              style={{ width: 250, height: 250 }}
            />
          </div>

          {/* Footer URL */}
          <div
            style={{
              textAlign: "center",
              fontSize: "0.8rem",
              color: "#111827",
              textDecoration: "underline",
              marginTop: "0.6rem",
            }}
          >
            play.curriculate.net
          </div>
        </div>
      ))}

      {/* Simple print CSS – hide toolbar when printing */}
      <style>
        {`
          @media print {
            .no-print {
              display: none !important;
            }
            body {
              margin: 0;
            }
            .poster-page {
              border: none !important;
              margin: 0 !important;
            }
          }
        `}
      </style>
    </div>
  );
}
