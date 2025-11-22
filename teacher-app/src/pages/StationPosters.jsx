// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE_URL } from "../config";

const COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "teal", "pink", "lime", "navy", "brown", "gray"];

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function StationPosters() {
  const query = useQuery();
  const room = (query.get("room") || "AB").toUpperCase();
  const locationLabel = query.get("location") || "Classroom";

  const stationCount = Math.min(
    12,
    Math.max(4, Number(query.get("stations") || 8))
  );

  const stations = COLORS.slice(0, stationCount);

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Station posters</h1>
      <p style={{ fontSize: "0.85rem", color: "#4b5563", maxWidth: 520 }}>
        One page per station. These are meant for printing on letter-size
        paper and posting at each colour station. QR codes point to{" "}
        <code>play.curriculate.net/{room}/[colour]</code>.
      </p>

      <button
        type="button"
        onClick={() => window.print()}
        style={{
          marginBottom: 16,
          padding: "6px 12px",
          borderRadius: 999,
          border: "1px solid #d1d5db",
          background: "#ffffff",
          cursor: "pointer",
          fontSize: "0.85rem",
        }}
      >
        Print all
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 24,
        }}
      >
        {stations.map((color) => {
          const upper = color.toUpperCase();
          const qrTarget = `https://play.curriculate.net/${room.toLowerCase()}/${color}`;
          const qrUrl = `https://chart.googleapis.com/chart?chs=250x250&cht=qr&chl=${encodeURIComponent(
            qrTarget
          )}`;

          const textColor =
            ["yellow", "lime", "pink", "orange"].includes(color) ? "#111827" : "#ffffff";

          return (
            <div
              key={color}
              style={{
                width: "8.5in",
                height: "11in",
                margin: "0 auto",
                boxSizing: "border-box",
                padding: "1in 0.75in",
                background: "#faf5e4",
                pageBreakAfter: "always",
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  fontSize: "1.4rem",
                  fontWeight: 600,
                  marginBottom: "0.4in",
                }}
              >
                Curriculate
              </div>

              <div
                style={{
                  margin: "0 auto 0.6in",
                  width: "100%",
                  height: "2.2in",
                  background: color,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: textColor,
                  fontSize: "1.3rem",
                  fontWeight: 700,
                  textAlign: "center",
                  textTransform: "uppercase",
                  padding: "0 0.5in",
                  boxSizing: "border-box",
                }}
              >
                {upper} Station<br />
                {locationLabel}
              </div>

              <div
                style={{
                  textAlign: "center",
                  fontSize: "1.2rem",
                  fontWeight: 600,
                  marginBottom: "0.35in",
                }}
              >
                Scan to Arrive
              </div>

              <div
                style={{
                  textAlign: "center",
                  marginBottom: "0.25in",
                }}
              >
                <img
                  src={qrUrl}
                  alt={`${upper} Station QR`}
                  style={{
                    width: "2.5in",
                    height: "2.5in",
                  }}
                />
              </div>

              <div
                style={{
                  textAlign: "center",
                  fontSize: "0.65rem",
                  color: "#4b5563",
                }}
              >
                {qrTarget}
              </div>

              <div
                style={{
                  position: "absolute",
                  bottom: "0.7in",
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontSize: "0.6rem",
                  color: "#9ca3af",
                }}
              >
                play.curriculate.net
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
