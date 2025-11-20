// student-app/src/App.jsx
import React, {
  useEffect,
  useState,
  useRef,
} from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";

import { API_BASE_URL } from "/config";
//const SOCKET_URL = import.meta.env.VITE_API_URL;
//const socket = io(SOCKET_URL);
const socket = io(API_BASE_URL, {
  withCredentials: true,
});

/* -----------------------------------------------------------
   Socket + station colour helpers
   ----------------------------------------------------------- */


// Station colours in order: station-1 → red, station-2 → blue, etc.
const COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
];

function stationIdToColor(id) {
  const m = /^station-(\d+)$/.exec(id || "");
  if (!m) return null;
  const idx = parseInt(m[1], 10) - 1;
  return COLORS[idx] || null;
}

/* -----------------------------------------------------------
   QR Scanner component (in-app camera)
   ----------------------------------------------------------- */

function QrScanner({ active, onCode, onError }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if ("BarcodeDetector" in window) {
          const detector = new window.BarcodeDetector({
            formats: ["qr_code", "code_128", "code_39", "ean_13"],
          });

          const detectLoop = async () => {
            if (cancelled) return;

            if (!videoRef.current || videoRef.current.readyState < 2) {
              rafRef.current = requestAnimationFrame(detectLoop);
              return;
            }

            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes && barcodes.length > 0) {
                const value = barcodes[0].rawValue || "";
                if (value) {
                  try {
                    onCode?.(value);
                  } catch (err) {
                    console.error("Error in onCode callback", err);
                  }
                }
              }
            } catch (err) {
              console.warn("Barcode detection error", err);
            }

            rafRef.current = requestAnimationFrame(detectLoop);
          };

          detectLoop();
        } else {
          const msg =
            "Camera is on, but this browser cannot auto-detect QR codes. Try Chrome or Edge.";
          onError?.(msg);
        }
      } catch (err) {
        console.error("Error starting camera", err);
        const msg =
          "Unable to access camera. Please allow camera access or use a different browser.";
        onError?.(msg);
      }
    }

    function stopCamera() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }

    if (active) {
      startCamera();
    }

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [active, onCode, onError]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      <video
        ref={videoRef}
        style={{
          width: "100%",
          borderRadius: 16,
          background: "#000",
        }}
        muted
        playsInline
      />
      <div
        style={{
          position: "absolute",
          inset: "15%",
          border: "3px solid rgba(59,130,246,0.9)",
          borderRadius: 24,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/* -----------------------------------------------------------
   Main App — DEVICE = TEAM
   ----------------------------------------------------------- */

export default function App() {
  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState(["", "", "", "", "", ""]);
  const [joined, setJoined] = useState(false);

  const [apiStatus, setApiStatus] = useState("Checking API…");
  const [roomState, setRoomState] = useState({
    stations: [],
    teams: {},
    scores: {},
  });
  const [currentTask, setCurrentTask] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [taskStartTime, setTaskStartTime] = useState(null);

  // QR / scanning state
  const [scannedStationId, setScannedStationId] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scanError, setScanError] = useState(null);

  // sounds
  const sndJoin = useRef(
    new Audio(
      "https://actions.google.com/sounds/v1/cartoon/pop.ogg"
    )
  );
  const sndTask = useRef(
    new Audio(
      "https://actions.google.com/sounds/v1/alarms/beep_short.ogg"
    )
  );
  const sndSubmit = useRef(
    new Audio(
      "https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg"
    )
  );
  const sndAlert = useRef(
    new Audio(
      "https://actions.google.com/sounds/v1/alarms/beep_short.ogg"
    )
  );

  /* ---------------- API health ---------------- */

  useEffect(() => {
    fetch(`${SOCKET_URL}/db-check`)
      .then((r) => r.json())
      .then(() => setApiStatus("✅ API OK"))
      .catch(() => setApiStatus("❌ cannot reach API"));
  }, []);

  /* ---------------- Socket listeners ---------------- */

  useEffect(() => {
    const onTaskUpdate = (task) => {
      setCurrentTask(task);
      setAnswered(false);
      setTaskStartTime(Date.now());
      sndTask.current.play().catch(() => {});
    };

    const onRoomState = (state) => {
      setRoomState(
        state || { stations: [], teams: {}, scores: {} }
      );
    };

    socket.on("taskUpdate", onTaskUpdate);
    socket.on("roomState", onRoomState);

    return () => {
      socket.off("taskUpdate", onTaskUpdate);
      socket.off("roomState", onRoomState);
    };
  }, []);

  /* ---------------- Team & assignment (this device) ---------------- */

  const teamHere = roomState.teams[socket.id];
  const teamId = teamHere?.teamId || socket.id;

  const assignedStationId = teamHere?.currentStationId || null;
  const assignedColor = stationIdToColor(assignedStationId);

  const mustScan =
  joined &&
  !!assignedStationId &&
  scannedStationId !== assignedStationId;

  // Turn scanner on whenever we have an assignment but no matching scan
  useEffect(() => {
  if (mustScan && !scanError) {
    setScannerActive(true);
    sndAlert.current.play().catch(() => {});
  } else {
    setScannerActive(false);
  }
  }, [mustScan, scanError]);

  /* ---------------- QR scanned handler ---------------- */

  const handleScannedCode = (value) => {
  try {
    let text = (value || "").trim();

    // If it's a URL, grab last path segment
    try {
      const url = new URL(text);
      const segments = url.pathname
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length > 0) {
        text = segments[segments.length - 1];
      }
    } catch {
      // not a URL, keep raw text
    }

    text = text.toLowerCase();

    let stationIdFromCode = null;

    if (/^station-\d+$/.test(text)) {
      stationIdFromCode = text;
    } else {
      const idx = COLORS.indexOf(text);
      if (idx !== -1) {
        stationIdFromCode = `station-${idx + 1}`;
      }
    }

    if (!stationIdFromCode) {
      setScanError(
        `Unrecognized station code: "${text}". Ask your teacher which QR to use.`
      );
      return;
    }

    // Enforce correct station: wrong scan → show error + stop camera
    if (assignedStationId && stationIdFromCode !== assignedStationId) {
      const scannedColor = stationIdToColor(stationIdFromCode);
      const correctColor = stationIdToColor(assignedStationId);
      const scannedLabel = scannedColor
        ? `${scannedColor.toUpperCase()} station`
        : stationIdFromCode;
      const correctLabel = correctColor
        ? `${correctColor.toUpperCase()} station`
        : assignedStationId;

      setScanError(
        `This is the wrong station.\n\nYou scanned: ${scannedLabel}\nYour team is assigned to: ${correctLabel}.\n\nPlease go to the correct station and try again.`
      );
      // Camera will be turned OFF by the effect (because scanError != null)
      return;
    }

    // ✅ Correct station — accept the scan
    setScannedStationId(stationIdFromCode);
    setScanError(null);

    if (roomCode) {
      socket.emit("station:scan", {
        roomCode: roomCode.trim().toUpperCase(),
        teamId,
        stationId: stationIdFromCode,
      });
    }
  } catch (err) {
    console.error("Error handling scanned code", err);
    setScanError("Something went wrong while scanning. Please try again.");
  }
};

  /* ---------------- Handlers ---------------- */

  const handleMemberChange = (idx, val) => {
    const next = [...members];
    next[idx] = val;
    setMembers(next);
  };

  // Ready for Action (joins as a team; device stays with this team)
  const handleReady = () => {
    const finalRoom = roomCode.trim().toUpperCase();
    const realMembers = members
      .map((m) => m.trim())
      .filter(Boolean);

    if (!finalRoom) {
      alert("Room code is required");
      return;
    }
    if (realMembers.length === 0) {
      alert("Enter at least one student name");
      return;
    }

    socket.emit("joinRoom", {
      roomCode: finalRoom,
      teamName: teamName.trim(),
      members: realMembers,
      // no teamColor — station colour is what matters
    });

    sndJoin.current.play().catch(() => {});
    setJoined(true);
    setScannedStationId(null); // force first scan once first station is assigned
  };

  const handleSubmit = (answerTextFromTask) => {
    console.log("handleSubmit called:", { answerTextFromTask, answered, mustScan, teamHere });

    if (answered) return;

    // Enforce that they've scanned their assigned station first
    if (mustScan) {
      alert(
        "Before answering, your team must go to the station you were assigned and scan its QR code."
      );
      return;
    }

    if (!teamHere) {
      alert("Your team is not fully registered in the room yet.");
      return;
    }

    const elapsedMs = taskStartTime
      ? Date.now() - taskStartTime
      : null;

    socket.emit("submitTask", {
      roomCode: roomCode.trim().toUpperCase(),
      teamId: teamHere.teamId || socket.id,
      answerText: (answerTextFromTask || "").trim(),
      correct: false, // teacher/host can grade or auto-check
      timeMs: elapsedMs,
    });

    setAnswered(true);
    setCurrentTask(null);
    sndSubmit.current.play().catch(() => {});
  };

  /* ---------------- Render: scanner gate ---------------- */

  const currentStationLabel = assignedStationId
    ? `${assignedStationId}${
        assignedColor ? ` (${assignedColor.toUpperCase()})` : ""
      }`
    : "Not assigned yet";

  if (joined && mustScan) {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        alignItems: "center",
        justifyContent: "center",
        background: "#020617",
        color: "#e5e7eb",
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ margin: 0, textAlign: "center" }}>
        Scan your station
      </h1>

      <p
        style={{
          margin: 0,
          textAlign: "center",
          maxWidth: 320,
          fontSize: "0.9rem",
        }}
      >
        Move to the colour station your team was assigned, and
        point the camera at the QR code on that pad.
      </p>

      <div
        style={{
          marginTop: 10,
          textAlign: "center",
          fontSize: "0.85rem",
        }}
      >
        Assigned station: <strong>{currentStationLabel}</strong>
      </div>

      {assignedColor && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: assignedColor,
              border: "2px solid #e5e7eb",
            }}
          />
          <div
            style={{
              textTransform: "uppercase",
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {assignedColor} station
          </div>
        </div>
      )}

      {/* Error message & retry button (instead of alerts) */}
      {scanError && (
        <div
          style={{
            maxWidth: 360,
            background: "#7f1d1d",
            borderRadius: 8,
            padding: 10,
            fontSize: "0.8rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {scanError}
          <div style={{ marginTop: 8, textAlign: "right" }}>
            <button
              type="button"
              onClick={() => {
                setScanError(null);
                setScannerActive(true);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "none",
                background: "#f97316",
                color: "#fff",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Try scanning again
            </button>
          </div>
        </div>
      )}

      {/* Only show camera when there is no error */}
      {!scanError && (
        <QrScanner
          active={scannerActive}
          onCode={handleScannedCode}
          onError={(msg) =>
            console.warn("Scanner error:", msg)
          }
        />
      )}

      <p
        style={{
          marginTop: 12,
          fontSize: "0.75rem",
          textAlign: "center",
          color: "#9ca3af",
        }}
      >
        If asked, tap <strong>Allow</strong> so your browser can
        use the camera.
      </p>
    </div>
  );
}

  /* ---------------- Render: normal UI ---------------- */

  const bandColor =
    assignedColor || (joined ? "#0f172a" : "#111827");

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "30px auto",
        fontFamily: "system-ui",
      }}
    >
      <style>{`
        @keyframes flashBand {
          0% { filter: brightness(1); }
          50% { filter: brightness(1.35); }
          100% { filter: brightness(1); }
        }
      `}</style>

      <p style={{ fontSize: "0.75rem", marginBottom: 8 }}>
        {apiStatus} • Room:{" "}
        {roomCode.trim()
          ? roomCode.trim().toUpperCase()
          : "—"}
      </p>

      {!joined ? (
        <>
          <h1>Team check-in</h1>

          <label>Room code</label>
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="e.g. AB"
            style={{
              display: "block",
              width: "100%",
              marginBottom: 10,
              padding: 6,
            }}
          />

          <label>Team name (optional)</label>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="e.g. The Bobsy Twins"
            style={{
              display: "block",
              width: "100%",
              marginBottom: 10,
              padding: 6,
            }}
          />

          <label>Student names (up to 6)</label>
          {members.map((m, idx) => (
            <input
              key={idx}
              value={m}
              onChange={(e) =>
                handleMemberChange(idx, e.target.value)
              }
              placeholder={`Student ${idx + 1}`}
              style={{
                display: "block",
                width: "100%",
                marginBottom: 6,
                padding: 6,
              }}
            />
          ))}

          <button
            type="button"
            onClick={handleReady}
            style={{
              marginTop: 16,
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              background: "#0ea5e9",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Ready for Action
          </button>
        </>
      ) : (
        <div style={{ minHeight: "60vh" }}>
          <h2>
            {teamHere?.teamName || "Your team"}
          </h2>
          {Array.isArray(teamHere?.members) &&
            teamHere.members.length > 0 && (
              <p
                style={{
                  fontSize: "0.8rem",
                  marginBottom: 10,
                }}
              >
                {teamHere.members.join(", ")}
              </p>
            )}

          <p
            style={{
              fontSize: "0.85rem",
              marginTop: 4,
            }}
          >
            Current station: <strong>{currentStationLabel}</strong>
          </p>

          {currentTask && !answered ? (
            <TaskRunner
              task={currentTask}
              onSubmit={handleSubmit}
              disabled={answered}
            />
          ) : (
            <p>Waiting for task…</p>
          )}

          {/* bottom band shows current station colour for THIS TEAM */}
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              height: "35vh",
              background: bandColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              textAlign: "center",
              padding: 12,
              transition: "background 0.25s ease-in-out",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "1.6rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {assignedColor
                  ? `${assignedColor.toUpperCase()} STATION`
                  : "WAITING FOR STATION"}
              </div>
              <div>{teamHere?.teamName || "Your team"}</div>
              {Array.isArray(teamHere?.members) &&
                teamHere.members.length > 0 && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: "0.75rem",
                    }}
                  >
                    {teamHere.members.join(", ")}
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
