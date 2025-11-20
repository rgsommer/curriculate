// src/components/StationScanScreen.tsx

import React, { useState } from "react";
import { COLOR_HEX, extractColorFromUrl, StationColor } from "../utils/stationColors";

// If you use react-qr-reader or similar, import it here.
// Example:
// import { QrReader } from "react-qr-reader";

type Props = {
  assignedColor: StationColor | null; // from your socket / assignment
  roomCode: string;
  teamId: string;
  socket: any; // your existing socket.io client
  onArrived?: (color: StationColor) => void;
};

export const StationScanScreen: React.FC<Props> = ({
  assignedColor,
  roomCode,
  teamId,
  socket,
  onArrived,
}) => {
  const [scanError, setScanError] = useState<string | null>(null);
  const [hasArrived, setHasArrived] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleScan(scannedValue: string | null) {
    if (!scannedValue || isSubmitting || hasArrived) return;

    const scannedColor = extractColorFromUrl(scannedValue);

    if (!scannedColor) {
      setScanError("That QR code doesn’t look like a Curriculate station. Try again.");
      return;
    }

    if (!assignedColor) {
      setScanError("Your station hasn’t been assigned yet. Ask your teacher to start the next round.");
      return;
    }

    if (scannedColor !== assignedColor) {
      setScanError(
        `This QR is for the ${scannedColor.toUpperCase()} station, but you’re assigned to ${assignedColor.toUpperCase()}.`
      );
      return;
    }

    setScanError(null);
    setIsSubmitting(true);

    // Tell the server we’ve arrived
    socket.emit(
      "student:station-arrived",
      {
        roomCode,
        teamId,
        color: scannedColor,
      },
      (ack: { ok: boolean; error?: string }) => {
        setIsSubmitting(false);
        if (!ack || !ack.ok) {
          setScanError(ack?.error ?? "Something went wrong. Please try again.");
          return;
        }
        setHasArrived(true); // this will also stop rendering the camera
        if (onArrived) onArrived(scannedColor);
      }
    );
  }

  const colorBox =
    assignedColor && (
      <div
        style={{
          margin: "1rem auto 2rem",
          width: 200,
          height: 200,
          borderRadius: 24,
          backgroundColor: COLOR_HEX[assignedColor],
          boxShadow: "0 0 12px rgba(0,0,0,0.25)",
        }}
      />
    );

  return (
    <div
      style={{
        padding: "2rem",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1rem",
      }}
    >
      <h1>Curriculate</h1>

      {assignedColor ? (
        <>
          <h2>Go to the {assignedColor.toUpperCase()} station</h2>
          {colorBox}
          <p>When you’re at this station, scan the QR code on the wall.</p>
        </>
      ) : (
        <p>Waiting for your station color from the teacher…</p>
      )}

      {scanError && (
        <div style={{ color: "red", marginBottom: "0.5rem" }}>{scanError}</div>
      )}

      {/* IMPORTANT: we only render the scanner **before** arrival.
          Once hasArrived is true, this block disappears and the camera is released. */}
      {!hasArrived && assignedColor && (
        <div style={{ width: 260, maxWidth: "100%" }}>
          {/* Replace with whatever QR component you use */}
          {/* Example if using react-qr-reader: */}
          {/* 
          <QrReader
            constraints={{ facingMode: "environment" }}
            onResult={(result, error) => {
              if (!!result) {
                handleScan(result.getText ? result.getText() : result.text);
              }
            }}
            containerStyle={{ width: "100%" }}
          />
          */}

          <p style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            Point the camera at the QR code.
          </p>
        </div>
      )}

      {hasArrived && (
        <p style={{ marginTop: "1rem", fontWeight: 600 }}>
          Station confirmed! Waiting for the next task…
        </p>
      )}
    </div>
  );
};
