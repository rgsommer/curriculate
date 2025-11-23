// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
  "lime",
  "navy",
  "brown",
  "gray",
];

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function StationPosters() {
  const query = useQuery();
  const navigate = useNavigate();

  // "Room" here is your class code or label shown on the poster
  const room = (query.get("room") || "8A").toUpperCase();

  // This is the *path* segment and label under the colour block
  // e.g., Classroom, Hallway, Library, etc.
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
      {/* Print-only CSS */}
      <style>
        {`
          @media print {
            body * {
              visibility: hidden;
            }
            .station-print-page,
            .station-print-page * {
              visibility: visible;
            }
            .station-print-page {
              page-break-after: always;
            }
          }
        `}
      </style>

      <h1 style={{ marginTop: 0 }}>Station posters</h1>
      <p style={{ fontSize: "0.85rem", color: "#4b5563", maxWidth: 520 }}>
        One page per station. These are meant for printing on letter-size
        paper and posting at each colour station. QR codes point to{" "}
        <code>play.curriculate.net/{locationLabel}/[colour]</code>.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: "#ffffff",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          ← Back
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          style={{
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
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 24,
        }}
      >
        {stations.map((color) => {
          const upper = color.toUpperCase();

          // Path now matches what the student app expects:
          // e.g. https://play.curriculate.net/Classroom/red
          const qrTarget = `https://play.curriculate.net/${encodeURIComponent(
            locationLabel
          )}/${color.toLowerCase()}`;

          // Use QuickChart (best printing reliability)
          const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(
            qrTarget
          )}&size=250`;

          const textColor = ["yellow", "lime", "pink", "orange"].includes(color)
            ? "#111827"
            : "#ffffff";

          return (
            <div
              key={color}
              className="station-print-page"
              style={{
                width: "8.5in",
                height: "11in",
                margin: "0 auto",
                boxSizing: "border-box",
                padding: "1in 0.75in",
                background: "#faf5e4",
                position: "relative",
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
                Curriculate – Room {room}
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
                {upper} Station
                <br />
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
