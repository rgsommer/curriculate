// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { COPY } from "@shared/config/copy";

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

  const [locationInput, setLocationInput] = useState(
    query.get("location") || "Classroom",
  );
  const [stationCount, setStationCount] = useState(() => {
    const raw = Number(query.get("stations") || 8);
    return Math.min(12, Math.max(4, Number.isFinite(raw) ? raw : 8));
  });

  const locations = locationInput
    .split(",")
    .map((loc) => loc.trim())
    .filter((loc) => loc.length > 0);

  const colors = COLORS.slice(0, stationCount);
  const posters = locations.flatMap((location) =>
    colors.map((color) => ({
      location,
      color,
      upper: color.toUpperCase(),
    })),
  );

  const updateUrl = () => {
    const params = new URLSearchParams();
    params.set("location", locationInput);
    params.set("stations", String(stationCount));
    navigate({ search: params.toString() }, { replace: true });
  };

  const handlePrint = () => window.print();

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Print layout */}
      <style>
        {`
          @page {
            size: letter portrait;
            margin: 1in;
          }

          @media print {
            body {
              margin: 0;
              padding: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .no-print {
              display: none !important;
            }

            /* Each poster should be its own page, in normal flow */
            .print-page {
              page-break-after: always;
              break-after: page;
              width: 100%;
              min-height: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: #ffffff;
            }
          }
        `}
      </style>

      {/* Controls */}
      <div
        className="no-print"
        style={{
          padding: "2rem",
          maxWidth: "1000px",
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: "0 0 1.5rem",
            fontSize: "2.5rem",
            fontWeight: 800,
          }}
        >
          Station Posters
        </h1>
        <p style={{ color: "#555", marginBottom: "2rem" }}>
          Clean 1" margins • Perfect for letter paper • Ready to print
        </p>

        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "3rem",
          }}
        >
          <div style={{ flex: 1, minWidth: "300px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: 600,
              }}
            >
              Location(s)
            </label>
            <input
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              onBlur={updateUrl}
              placeholder="e.g. Gym, Library, Room 201"
              style={{
                width: "100%",
                padding: "0.9rem 1rem",
                fontSize: "1.1rem",
                borderRadius: "12px",
                border: "2px solid #e2e8f0",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: 600,
              }}
            >
              Number of colors
            </label>
            <select
              value={stationCount}
              onChange={(e) => {
                setStationCount(Number(e.target.value));
                updateUrl();
              }}
              style={{
                padding: "0.9rem 1rem",
                fontSize: "1.1rem",
                borderRadius: "12px",
                border: "2px solid #e2e8f0",
                minWidth: "180px",
              }}
            >
              {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <option key={n} value={n}>
                  {n} colors
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={handlePrint}
            style={{
              padding: "1.2rem 3rem",
              fontSize: "1.8rem",
              fontWeight: 800,
              background: "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: "16px",
              cursor: "pointer",
              boxShadow: "0 10px 30px rgba(14,165,233,0.3)",
            }}
          >
            Print All {posters.length} Posters
          </button>
        </div>
      </div>

      {/* Printable Posters */}
      {posters.map(({ location, color, upper }) => {
        const qrTarget = `https://${COPY.DOMAIN}/${encodeURIComponent(
          location,
        )}/${color.toLowerCase()}`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(
          qrTarget,
        )}&size=620&margin=3`;
        const textColor = ["yellow", "lime", "pink", "orange"].includes(
          color,
        )
          ? "#000"
          : "#fff";

        return (
          <div
            key={`${location}-${color}`}
            className="print-page"
          >
            {/* Header */}
            <div
              style={{
                textAlign: "center",
                marginBottom: "0.4in",
              }}
            >
              <div
                style={{
                  fontSize: "2.8rem",
                  fontWeight: 900,
                  color: "#1e40af",
                }}
              >
                {COPY.APP_NAME}
              </div>
              <div
                style={{
                  fontSize: "1.6rem",
                  fontWeight: 600,
                  color: "#475569",
                  marginTop: "0.25in",
                }}
              >
                {COPY.TAGLINE}
              </div>
            </div>

            {/* Color Box */}
            <div
              style={{
                width: "86%",
                maxWidth: "7.4in",
                height: "3.6in",
                background: color,
                borderRadius: "36px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: textColor,
                fontSize: "2.8rem",
                fontWeight: 900,
                textTransform: "uppercase",
                lineHeight: 1.1,
                margin: "0.4in 0",
              }}
            >
              {upper} Station
              <div
                style={{
                  fontSize: "2.1rem",
                  marginTop: "0.5rem",
                  fontWeight: 700,
                }}
              >
                {location}
              </div>
            </div>

            {/* QR Code Section */}
            <div
              style={{
                textAlign: "center",
                marginTop: "0.4in",
              }}
            >
              <div
                style={{
                  fontSize: "2rem",
                  fontWeight: 700,
                  marginBottom: "0.4in",
                }}
              >
                Scan to Arrive
              </div>
              <img
                src={qrUrl}
                alt={`QR to ${upper} - ${location}`}
                style={{
                  width: "4.2in",
                  height: "4.2in",
                }}
              />
              <div
                style={{
                  fontSize: "1.4rem",
                  color: "#666",
                  marginTop: "0.4in",
                  fontWeight: 500,
                }}
              >
                {COPY.DOMAIN}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
