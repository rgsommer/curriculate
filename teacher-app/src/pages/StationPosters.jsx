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

const LOCATIONS = ["classroom", "hallway", "gym", "library"];

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/**
 * Printable QR station posters.
 * Requirements:
 * - White background
 * - QR code should fill the page nicely
 * - Web address printed under the QR should be ONLY `play.curriculate.net`
 */
export default function StationPosters() {
  const navigate = useNavigate();
  const query = useQuery();

  const selectedLocation = query.get("location") || "classroom";
  const selectedColors = query.getAll("color").length
    ? query.getAll("color")
    : ["red", "blue", "green", "yellow"];

  const handleLocationChange = (e) => {
    const loc = e.target.value;
    const params = new URLSearchParams();
    params.set("location", loc);
    selectedColors.forEach((c) => params.append("color", c));
    navigate({ search: params.toString() });
  };

  const handleColorToggle = (color) => {
    const set = new Set(selectedColors);
    if (set.has(color)) {
      set.delete(color);
    } else {
      set.add(color);
    }
    const params = new URLSearchParams();
    params.set("location", selectedLocation);
    Array.from(set).forEach((c) => params.append("color", c));
    navigate({ search: params.toString() });
  };

  const makeQrTarget = (color) =>
    `https://play.curriculate.net/${selectedLocation}/${color}`;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Station Posters</h1>
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        Choose a location and colours, then print. Each page is formatted for
        8.5×11&quot; with a white background.
      </p>

      {/* Controls (not printed) */}
      <div
        style={{
          marginBottom: 16,
          padding: 12,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <label
            style={{
              marginRight: 8,
              fontSize: "0.85rem",
              color: "#374151",
            }}
          >
            Location:
          </label>
          <select
            value={selectedLocation}
            onChange={handleLocationChange}
            style={{
              padding: "4px 8px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              fontSize: "0.9rem",
            }}
          >
            {LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {loc.charAt(0).toUpperCase() + loc.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: "0.85rem", color: "#374151" }}>
          Colours:&nbsp;
          {COLORS.map((color) => {
            const active = selectedColors.includes(color);
            return (
              <button
                key={color}
                type="button"
                onClick={() => handleColorToggle(color)}
                style={{
                  marginRight: 6,
                  marginBottom: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: active ? "none" : "1px solid #d1d5db",
                  background: active ? color : "#ffffff",
                  color: active ? "#ffffff" : "#111827",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                {color}
              </button>
            );
          })}
        </div>
      </div>

      {/* Printable pages */}
      <div>
        {selectedColors.map((color) => {
          const qrTarget = makeQrTarget(color);
          return (
            <div
              key={color}
              className="station-print-page"
              style={{
                width: "8.5in",
                height: "11in",
                margin: "0 auto 24px",
                boxSizing: "border-box",
                padding: "0.75in",
                background: "#ffffff",
                color: "#111827",
                position: "relative",
                pageBreakAfter: "always",
                border: "1px solid #e5e7eb",
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  marginBottom: "0.5in",
                }}
              >
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {color} Station
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: "0.95rem",
                    textTransform: "capitalize",
                    color: "#4b5563",
                  }}
                >
                  {selectedLocation}
                </div>
              </div>

              {/* QR code box */}
              <div
                style={{
                  width: "100%",
                  height: "6.5in",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src={`https://chart.googleapis.com/chart?chs=700x700&cht=qr&chl=${encodeURIComponent(
                    qrTarget
                  )}`}
                  alt={`${color} station QR`}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                  }}
                />
              </div>

              {/* Footer: simple web address only */}
              <div
                style={{
                  position: "absolute",
                  bottom: "0.7in",
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontSize: "0.9rem",
                  color: "#4b5563",
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
