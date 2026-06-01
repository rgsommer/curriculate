// teacher-app/src/pages/StationPosters.jsx
import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { COPY } from "@shared/config/copy";
import { PageHeader, Field, TextInput, Select, Button } from "../components/ui";

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
    <div
      className="station-posters-print-root"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      {/* Print layout */}
      <style>
        {`
          @page {
            size: letter portrait;
            margin: 0.6in 0.75in;
          }

          @media print {
            /* Hide everything in the app except this page's root */
            body * {
              visibility: hidden;
            }

            .station-posters-print-root,
            .station-posters-print-root * {
              visibility: visible;
            }

            .station-posters-print-root {
              position: absolute;
              inset: 0;
              margin: 0;
              padding: 0;
            }

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
        <PageHeader
          title="Station Posters"
          subtitle="Clean 1&quot; margins • Perfect for letter paper • Ready to print"
        />

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "3rem" }}>
          <Field label="Location(s)" style={{ flex: 1, minWidth: "300px" }}>
            <TextInput
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              onBlur={updateUrl}
              placeholder="e.g. Gym, Library, Room 201"
            />
          </Field>

          <Field label="Number of colors" style={{ minWidth: "180px" }}>
            <Select
              value={stationCount}
              onChange={(e) => {
                setStationCount(Number(e.target.value));
                updateUrl();
              }}
            >
              {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <option key={n} value={n}>
                  {n} colors
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div style={{ textAlign: "center" }}>
          {/* Large print CTA — keep the dominant visual; <Button> with an
              explicit style override preserves the original prominence. */}
          <Button
            onClick={handlePrint}
            style={{
              padding: "1.2rem 3rem",
              fontSize: "1.5rem",
              borderRadius: "16px",
              boxShadow: "0 10px 30px rgba(14,165,233,0.3)",
            }}
          >
            Print All {posters.length} Posters
          </Button>
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
        const textColor = ["yellow", "lime", "pink", "orange"].includes(color)
          ? "#000"
          : "#fff";

        return (
          <div key={`${location}-${color}`} className="print-page">
            {/* Header */}
            <div
              style={{
                textAlign: "center",
                marginBottom: "0.2in",
              }}
            >
              <div
                style={{
                  fontSize: "2.6rem",
                  fontWeight: 900,
                  color: "#1e40af",
                }}
              >
                {COPY.APP_NAME}
              </div>
              <div
                style={{
                  fontSize: "1.3rem",
                  fontWeight: 600,
                  color: "#475569",
                  marginTop: "0.1in",
                }}
              >
                {COPY.TAGLINE}
              </div>
            </div>

            {/* Color Box */}
            <div
              style={{
                width: "86%",
                maxWidth: "7in",
                height: "2.8in",
                background: color,
                borderRadius: "30px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: textColor,
                fontSize: "2.6rem",
                fontWeight: 900,
                textTransform: "uppercase",
                lineHeight: 1.1,
                margin: "0.15in 0",
              }}
            >
              {upper} Station
              <div
                style={{
                  fontSize: "1.9rem",
                  marginTop: "0.4rem",
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
                marginTop: "0.15in",
              }}
            >
              <div
                style={{
                  fontSize: "1.8rem",
                  fontWeight: 700,
                  marginBottom: "0.2in",
                }}
              >
                Scan to Arrive
              </div>
              <img
                src={qrUrl}
                alt={`CurricQR to ${upper} - ${location}`}
                style={{
                  width: "3.6in",
                  height: "3.6in",
                }}
              />
              <div
                style={{
                  fontSize: "1.8rem",
                  color: "#1e40af",
                  marginTop: "0.2in",
                  fontWeight: 700,
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
