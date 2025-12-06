// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo, useState } from "react";
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

  const [room] = useState((query.get("room") || "8A").toUpperCase());
  const [locationLabel] = useState(query.get("location") || "Classroom");
  const [stationCount] = useState(() => {
    const raw = Number(query.get("stations") || 8);
    const n = Number.isFinite(raw) ? raw : 8;
    return Math.min(12, Math.max(4, n));
  });

  const stations = COLORS.slice(0, stationCount);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Print-only CSS */}
      <style>
        {`
          @page {
            size: letter portrait;
            margin: 0;
          }

          @media print {
            html, body, #root {
              margin: 0 !important;
              padding: 0 !important;
              height: 100% !important;
            }

            body * {
              visibility: hidden;
            }

            .print-page, .print-page * {
              visibility: visible;
            }

            .print-page {
              position: fixed;
              left: 0;
              top: 0;
              width: 8.5in;
              height: 11in;
              page-break-after: always;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: white;
            }
          }
        `}
      </style>

      {/* On-screen preview + controls */}
      <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 16px" }}>Station Posters</h1>
        <p style={{ color: "#555", marginBottom: 24 }}>
          One perfectly centered poster per page. Ready for printing.
        </p>
      </div>

      {/* Actual printable posters */}
      {stations.map((color) => {
        const upper = color.toUpperCase();
        const qrTarget = `https://play.curriculate.net/${encodeURIComponent(locationLabel)}/${color.toLowerCase()}`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrTarget)}&size=560&margin=2`;

        const textColor = ["yellow", "lime", "pink", "orange"].includes(color) ? "#000" : "#fff";

        return (
          <div
            key={color}
            className="print-page"
            style={{
              // On-screen preview
              width: "8.5in",
              height: "11in",
              margin: "20px auto",
              border: "1px solid #ddd",
              background: "white",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.8in",
            }}
          >
            {/* Header */}
            <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "#1e40af" }}>
              Curriculate
            </div>

            {/* Colored Station Box */}
            <div
              style={{
                width: "80%",
                maxWidth: "6in",
                height: "2.4in",
                background: color,
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: textColor,
                fontWeight: 700,
                fontSize: "1.6rem",
                textTransform: "uppercase",
                textAlign: "center",
                lineHeight: 1.2,
              }}
            >
              {upper} Station
              <div style={{ fontSize: "1.3rem", marginTop: 8 }}>
                {locationLabel}
              </div>
            </div>

            {/* Scan to Arrive */}
            <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>
              Scan to Arrive
            </div>

            {/* QR Code */}
            <img
              src={qrUrl}
              alt={`QR for ${upper} station`}
              style={{ width: "2.8in", height: "2.8in" }}
            />

            {/* Footer URL */}
            <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.5in" }}>
              play.curriculate.net
            </div>
          </div>
        );
      })}
    </div>
  );
}