// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

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

  // Split comma-separated locations and trim whitespace
  const locations = locationInput
    .split(",")
    .map(loc => loc.trim())
    .filter(loc => loc.length > 0);

  const colors = COLORS.slice(0, stationCount);

  // Generate all combinations: location first, then color
  const posters = locations.flatMap(location =>
    colors.map(color => ({ location, color, upper: color.toUpperCase() }))
  );

  const updateUrl = () => {
    const params = new URLSearchParams();
    params.set("location", locationInput);
    params.set("stations", String(stationCount));
    navigate({ search: params.toString() }, { replace: true });
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Perfect Print CSS */}
      <style>
        {`
          @page { size: letter portrait; margin: 0; }
          @media print {
            html, body, #root { margin: 0 !important; padding: 0 !important; }
            body * { visibility: hidden; }
            .print-page, .print-page * { visibility: visible; }
            .print-page {
              position: fixed;
              left: 0; top: 0;
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

      {/* On-screen controls */}
      <div style={{ padding: 32, maxWidth: 1000, margin: "0 auto" }}>
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
                title="Enter multiple locations separated by commas (e.g. Boshart Gym, Library, Cafeteria). One set of posters will be created for each location."
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
            <p style={{ margin: "8px 0 0", fontSize: "0.9rem", color: "#666" }}>
              {locations.length === 1
                ? `1 location → ${colors.length} posters`
                : `${locations.length} locations → ${posters.length} posters total`}
            </p>
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
      </div>

      {/* All Posters */}
      {posters.map(({ location, color, upper }) => {
        const qrTarget = `https://play.curriculate.net/${encodeURIComponent(location)}/${color.toLowerCase()}`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrTarget)}&size=580&margin=4`;
        const textColor = ["yellow","lime","pink","orange"].includes(color) ? "#000" : "#fff";

        return (
          <div
            key={`${location}-${color}`}
            className="print-page"
            style={{
              width: "8.5in",
              height: "11in",
              margin: "30px auto",
              background: "white",
              border: "1px solid #eee",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1in",
            }}
          >
            <div style={{ fontSize: "1.9rem", fontWeight: 600, color: "#1e40af" }}>
              Curriculate
            </div>

            <div
              style={{
                width: "82%",
                maxWidth: "6.8in",
                height: "2.9in",
                background: color,
                borderRadius: 24,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: textColor,
                fontSize: "2.1rem",
                fontWeight: 800,
                textTransform: "uppercase",
                textAlign: "center",
                lineHeight: 1.1,
              }}
            >
              {upper} Station
              <div style={{ fontSize: "1.6rem", marginTop: 12, fontWeight: 600 }}>
                {location}
              </div>
            </div>

            <div style={{ fontSize: "1.7rem", fontWeight: 600 }}>
              Scan to Arrive
            </div>

            <img src={qrUrl} alt={`${upper} - ${location}`} style={{ width: "3.3in", height: "3.3in" }} />

            <div style={{ fontSize: "0.95rem", color: "#666" }}>
              play.curriculate.net
            </div>
          </div>
        );
      })}
    </div>
  );
}