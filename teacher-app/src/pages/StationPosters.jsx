// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { COPY } from "@shared/config/copy";

const COLORS = [
  "red", "blue", "green", "yellow", "purple", "orange", "teal", "pink",
  "lime", "navy", "brown", "gray",
];

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function StationPosters() {
  const query = useQuery();
  const navigate = useNavigate();

  const [locationInput, setLocationInput] = useState(query.get("location") || "Classroom");
  const [stationCount, setStationCount] = useState(() => {
    const raw = Number(query.get("stations") || 8);
    return Math.min(12, Math.max(4, Number.isFinite(raw) ? raw : 8));
  });

  const locations = locationInput
    .split(",")
    .map(loc => loc.trim())
    .filter(loc => loc.length > 0);

  const colors = COLORS.slice(0, stationCount);
  const posters = locations.flatMap(location =>
    colors.map(color => ({ location, color, upper: color.toUpperCase() }))
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
      {/* Perfect Print CSS */}
      <style>
        {`
          @page { size: letter portrait; margin: 0; }
          @media print {
            html, body { margin: 0; padding: 0; height: auto; }
            body * { visibility: hidden; }
            .print-page, .print-page * { visibility: visible; }
            .print-page {
              position: absolute;
              left: 0;
              width: 8.5in;
              height: 11in;
              page-break-after: always;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: white;
            }
            .no-print { display: none; }
          }
        `}
      </style>

      {/* Controls + Print Button */}
      <div className="no-print" style={{ padding: 32, maxWidth: 1000, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 24px", fontSize: "2.2rem", fontWeight: 700 }}>
          Station Posters
        </h1>
        <p style={{ color: "#555", marginBottom: 32, fontSize: "1.1rem", lineHeight: 1.6 }}>
          One perfectly centered poster per page. Ready for printing on letter paper.
        </p>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
              Location(s)
              <span
                style={{ marginLeft: 8, fontSize: "0.9rem", color: "#0ea5e9", cursor: "help" }}
                title={`Feel free to make your own station sheets. Make sure the QR Code encodes ${COPY.DOMAIN}/Location/color.`}
              >
                [?]
              </span>
            </label>
            <input
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              onBlur={updateUrl}
              placeholder="e.g. Boshart Gym, Library, Cafeteria"
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 12,
                border: "2px solid #ddd",
                fontSize: "1.1rem",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
              Number of colors
            </label>
            <select
              value={stationCount}
              onChange={(e) => {
                setStationCount(Number(e.target.value));
                updateUrl();
              }}
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                border: "2px solid #ddd",
                fontSize: "1.1rem",
                minWidth: 180,
              }}
            >
              {[4,5,6,7,8,9,10,11,12].map(n => (
                <option key={n} value={n}>{n} colors</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ textAlign: "center", margin: "40px 0" }}>
          <button
            onClick={handlePrint}
            style={{
              padding: "18px 48px",
              fontSize: "1.6rem",
              fontWeight: 700,
              background: "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: 16,
              cursor: "pointer",
              boxShadow: "0 10px 24px rgba(14,165,233,0.4)",
            }}
          >
            Print All {posters.length} Posters
          </button>
        </div>
      </div>

      {/* All Posters */}
      {posters.map(({ location, color, upper }, index) => {
        const qrTarget = `https://${COPY.DOMAIN}/${encodeURIComponent(location)}/${color.toLowerCase()}`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrTarget)}&size=580&margin=4`;
        const textColor = ["yellow","lime","pink","orange"].includes(color) ? "#000" : "#fff";

        return (
          <div
            key={`${location}-${color}`}
            className="print-page"
            style={{ top: `calc(${index} * 11in)` }}
          >
            <div style={{ textAlign: "center", marginBottom: "1.2in" }}>
              <div style={{ fontSize: "2.7rem", fontWeight: 900, color: "#1e40af" }}>
                {COPY.APP_NAME}
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "#475569", marginTop: "0.4in" }}>
                {COPY.TAGLINE}
              </div>
            </div>

            <div style={{ height: "0.8in" }} />

            <div
              style={{
                width: "84%",
                maxWidth: "7.2in",
                height: "3.4in",
                background: color,
                borderRadius: 32,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: textColor,
                fontSize: "2.6rem",
                fontWeight: 900,
                textTransform: "uppercase",
                textAlign: "center",
                lineHeight: 1.1,
              }}
            >
              {upper} Station
              <div style={{ fontSize: "1.9rem", marginTop: 16, fontWeight: 700 }}>
                {location}
              </div>
            </div>

            <div style={{ height: "0.8in" }} />

            <div style={{ fontSize: "1.9rem", fontWeight: 700 }}>
              Scan to Arrive
            </div>

            <img src={qrUrl} alt={`${upper} - ${location}`} style={{ width: "3.6in", height: "3.6in" }} />

            <div style={{ fontSize: "1.35rem", color: "#666", fontWeight: 500 }}>
              {COPY.DOMAIN}
            </div>
          </div>
        );
      })}
    </div>
  );
}