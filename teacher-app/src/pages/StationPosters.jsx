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

  const handlePrint = () => {
    window.print();
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
            .no-print { display: none !important; }
          }
        `}
      </style>

      {/* Header with BIG PRINT BUTTON */}
      <div className="no-print" style={{ padding: 32, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: "0 0 12px", fontSize: "2.4rem", fontWeight: 800, color: "#1e293b" }}>
              Station Posters
            </h1>
            <p style={{ margin: 0, fontSize: "1.1rem", color: "#475569" }}>
              One poster per color per location. Use commas to add multiple locations.
            </p>
            <p style={{ margin: "8px 0 0", fontSize: "1rem", color: "#64748b" }}>
              {locations.length} location(s) × {colors.length} colors = <strong>{posters.length} posters</strong>
            </p>
          </div>

          {/* BIG PRINT BUTTON */}
          <button
            onClick={handlePrint}
            style={{
              padding: "16px 32px",
              background: "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: 16,
              fontSize: "1.3rem",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 8px 16px rgba(14,165,233,0.3)",
              transition: "all 0.2s",
            }}
            onMouseOver={(e) => e.target.style.background = "#0284c7"}
            onMouseOut={(e) => e.target.style.background = "#0ea5e9"}
          >
            Print All Posters
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="no-print" style={{ padding: "32px 32px 16px", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "end" }}>
          <div>
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
                padding: "14px 18px",
                borderRadius: 12,
                border: "2px solid #cbd5e1",
                fontSize: "1.1rem",
                background: "white",
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
                padding: "14px 18px",
                borderRadius: 12,
                border: "2px solid #cbd5e1",
                fontSize: "1.1rem",
                minWidth: 180,
                background: "white",
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
              margin: "40px auto",
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.1in",
            }}
          >
            <div style={{ fontSize: "1.9rem", fontWeight: 600, color: "#1e40af" }}>
              Curriculate
            </div>

            <div
              style={{
                width: "84%",
                maxWidth: "7in",
                height: "3in",
                background: color,
                borderRadius: 24,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: textColor,
                fontSize: "2.3rem",
                fontWeight: 800,
                textTransform: "uppercase",
                textAlign: "center",
                lineHeight: 1.1,
              }}
            >
              {upper} Station
              <div style={{ fontSize: "1.7rem", marginTop: 12, fontWeight: 600 }}>
                {location}
              </div>
            </div>

            <div style={{ fontSize: "1.8rem", fontWeight: 600 }}>
              Scan to Arrive
            </div>

            <img src={qrUrl} alt={`${upper} - ${location}`} style={{ width: "3.4in", height: "3.4in" }} />

            <div style={{ fontSize: "0.9rem", color: "#666" }}>
              play.curriculate.net
            </div>
          </div>
        );
      })}
    </div>
  );
}