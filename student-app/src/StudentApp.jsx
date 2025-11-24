// student-app/src/StudentApp.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import TaskRunner from "./components/tasks/TaskRunner.jsx";
import { TASK_TYPES } from "../../shared/taskTypes.js";
import { API_BASE_URL } from "./config.js";

// Shared socket instance for this app
export const socket = io(API_BASE_URL, {
  withCredentials: true,
});

console.log("API_BASE_URL (student) =", API_BASE_URL);

/* -----------------------------------------------------------
   Station colour helpers – numeric ids (station-1, station-2…)
   are canonical. Colours are derived from that.
----------------------------------------------------------- */

const COLOR_NAMES = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
];

function normalizeStationId(raw) {
  if (!raw) {
    return { id: null, color: null, label: "Not assigned yet" };
  }

  const s = String(raw).trim();
  let lower = s.toLowerCase();

  // Case 1: full numeric id: "station-1", "station-2", ...
  let m = /^station-(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const color = COLOR_NAMES[idx] || null;
    if (!color) {
      return { id: `station-${m[1]}`, color: null, label: s };
    }
    const prettyColor = color.charAt(0).toUpperCase() + color.slice(1);
    return {
      id: `station-${m[1]}`,
      color,
      label: `Station-${prettyColor}`,
    };
  }

  // Case 2: plain number: "1", "2", ...
  m = /^(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const color = COLOR_NAMES[idx] || null;
    if (!color) {
      return {
        id: `station-${m[1]}`,
        color: null,
        label: `Station-${m[1]}`,
      };
    }
    const prettyColor = color.charAt(0).toUpperCase() + color.slice(1);
    return {
      id: `station-${m[1]}`,
      color,
      label: `Station-${prettyColor}`,
    };
  }

  // Case 3: colour-based: "station-red" or "red"
  if (lower.startsWith("station-")) {
    lower = lower.slice("station-".length);
  }
  const colorIndex = COLOR_NAMES.indexOf(lower);
  if (colorIndex >= 0) {
    const id = `station-${colorIndex + 1}`;
    const prettyColor = lower.charAt(0).toUpperCase() + lower.slice(1);
    return {
      id,
      color: lower,
      label: `Station-${prettyColor}`,
    };
  }

  // Fallback
  return { id: s, color: null, label: s };
}

/* -----------------------------------------------------------
   QR Scanner component – opens camera & decodes QR
----------------------------------------------------------- */

function QrScanner({ active, onCode, onError }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (!active || cancelled) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.(
          "Camera is not available in this browser. Try Chrome, Edge, or a modern mobile browser."
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
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
                  // Stop camera after first successful scan
                  cancelled = true;
                  stopCamera();
                  return;
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
        borderRadius: 12,
        overflow: "hidden",
        background: "#000",
        maxWidth: 360,
        margin: "0 auto",
      }}
    >
      <video
        ref={videoRef}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          background: "#000",
        }}
        playsInline
        muted
      />
    </div>
  );
}

/* -----------------------------------------------------------
   Student App main
----------------------------------------------------------- */

export default function StudentApp() {
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState([""]);
  const [joined, setJoined] = useState(false);
  const [teamId, setTeamId] = useState(null);

  const [assignedStationId, setAssignedStationId] = useState(null);
  const [scannedStationId, setScannedStationId] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);

  const [currentTask, setCurrentTask] = useState(null);
  const [taskIndex, setTaskIndex] = useState(null);
  const [taskSetMeta, setTaskSetMeta] = useState(null);

  const [statusMessage, setStatusMessage] = useState(
    "Enter your room code and team name to begin."
  );

  const [submitting, setSubmitting] = useState(false);
  const sndAlert = useRef(null);

  useEffect(() => {
    const audio = new Audio("/sounds/scan-alert.mp3");
    sndAlert.current = audio;
  }, []);

  useEffect(() => {
    socket.on("connect", () => {
      console.log("Student socket connected:", socket.id);
      setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("Student socket disconnected");
      setConnected(false);
    });

    socket.on("room:state", (state) => {
      console.log("[Student] room:state", state);

      const teams = state?.teams || {};
      const team = teams[teamId] || null;

      if (team) {
        const stationId = team.currentStationId || null;
        setAssignedStationId(stationId || null);
      }

      if (state?.taskIndex != null && state.taskIndex >= 0) {
        setTaskIndex(state.taskIndex);
      }
    });

    socket.on("task:launch", ({ index, task, timeLimitSeconds }) => {
      console.log("[Student] task:launch", { index, task });
      setCurrentTask(task || null);
      setTaskIndex(index);
      setStatusMessage(
        "New task received! Read carefully and submit your best answer."
      );
    });

    socket.on("session:complete", () => {
      setCurrentTask(null);
      setStatusMessage(
        "Task set complete! Wait for your teacher to show the results."
      );
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("room:state");
      socket.off("task:launch");
      socket.off("session:complete");
    };
  }, [teamId]);

  useEffect(() => {
    const mustScan =
      joined && !!assignedStationId && scannedStationId !== assignedStationId;

    if (mustScan && !scanError) {
      setScannerActive(true);
      sndAlert.current?.play().catch(() => {});
    } else {
      setScannerActive(false);
    }
  }, [joined, assignedStationId, scannedStationId, scanError]);

  /* ---------------- Handlers ---------------- */

  const handleMemberChange = (idx, val) => {
    setMembers((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  const addMemberField = () => {
    setMembers((prev) => [...prev, ""]);
  };

  const handleJoin = () => {
    const finalRoom = roomCode.trim().toUpperCase();
    if (!finalRoom || !teamName.trim()) {
      alert("Please enter both a room code and team name.");
      return;
    }
    if (!connected) {
      alert("Not connected to server yet. Please wait a moment.");
      return;
    }

    const filteredMembers = members
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    console.log("[Student] Ready click", {
      finalRoom,
      realMembersCount: filteredMembers.length,
      socketConnected: connected,
    });

    socket.emit(
      "student:joinRoom",
      {
        roomCode: finalRoom,
        teamName: teamName.trim(),
        members: filteredMembers,
      },
      (ack) => {
        console.log("[Student] joinRoom ack:", ack);
        if (!ack || !ack.ok) {
          alert(ack?.error || "Unable to join room.");
          return;
        }

        setRoomCode(finalRoom);
        setJoined(true);
        setTeamId(ack.teamId || socket.id);
        setStatusMessage(
          "Joined! Wait for your teacher to assign your first station."
        );

        const teams = ack.roomState?.teams || {};
        const team = teams[ack.teamId] || null;
        if (team?.currentStationId) {
          setAssignedStationId(team.currentStationId);
        }
      }
    );
  };

  const handleScannedCode = (value) => {
    try {
      let text = (value || "").trim();

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
        // not a URL, keep raw
      }

      text = text.toLowerCase();

      const normFromCode = normalizeStationId(text);
      const stationIdFromCode = normFromCode.id;

      if (!stationIdFromCode) {
        setScanError(
          `Unrecognized station code: "${text}". Ask your teacher which QR to use.`
        );
        return;
      }

      if (assignedStationId && stationIdFromCode !== assignedStationId) {
        const scannedNorm = normalizeStationId(stationIdFromCode);
        const assignedNorm = normalizeStationId(assignedStationId);
        const scannedLabel = scannedNorm.label || stationIdFromCode;
        const correctLabel = assignedNorm.label || assignedStationId;

        setScanError(
          `This is the wrong station.\n\nYou scanned: ${scannedLabel}.\nThe correct station is: ${correctLabel}.\n\nPlease go to the correct station and try again.`
        );
        return;
      }

      const norm = normalizeStationId(stationIdFromCode);
      setScannedStationId(norm.id);
      setScanError(null);

      if (roomCode) {
        socket.emit("station:scan", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
          stationId: norm.id,
        });
      }
    } catch (err) {
      console.error("Error handling scanned code", err);
      setScanError("Something went wrong while scanning. Please try again.");
    }
  };

  const handleSubmitAnswer = async (taskPayload) => {
    if (!roomCode || !joined || taskIndex == null) return;

    try {
      setSubmitting(true);
      socket.emit(
        "student:submitAnswer",
        {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
          taskIndex,
          ...taskPayload,
        },
        (ack) => {
          setSubmitting(false);
          if (!ack || !ack.ok) {
            alert(
              ack?.error ||
                "There was a problem submitting your answer. Please try again."
            );
            return;
          }
          setStatusMessage("Answer submitted! Wait for the next task.");
        }
      );
    } catch (err) {
      console.error("Error submitting answer", err);
      setSubmitting(false);
      alert(
        "There was a problem submitting your answer. Please check your connection and try again."
      );
    }
  };

  /* ---------------- Render ---------------- */

  const assignedNorm = normalizeStationId(assignedStationId);
  const scannedNorm = normalizeStationId(scannedStationId);

  const mustScan =
    joined && !!assignedStationId && scannedStationId !== assignedStationId;

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        backgroundColor: "#fefce8",
        color: "#111827",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            margin: 0,
            fontSize: "1.4rem",
          }}
        >
          Curriculate – Team Station
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            color: "#4b5563",
          }}
        >
          {connected ? "Connected" : "Connecting…"}{" "}
          {roomCode ? `· Room ${roomCode.toUpperCase()}` : null}
        </p>
      </header>

      {!joined && (
        <section
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            background: "#f3f4ff",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: "1rem" }}>
            Join your room
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <label style={{ fontSize: "0.85rem" }}>
              Room code
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  marginTop: 2,
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: "1rem",
                }}
              />
            </label>

            <label style={{ fontSize: "0.85rem" }}>
              Team name
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  marginTop: 2,
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: "1rem",
                }}
              />
            </label>

            <div>
              <div
                style={{
                  fontSize: "0.85rem",
                  marginBottom: 4,
                }}
              >
                Team members (optional)
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {members.map((m, idx) => (
                  <input
                    key={idx}
                    type="text"
                    value={m}
                    onChange={(e) =>
                      handleMemberChange(idx, e.target.value)
                    }
                    placeholder={`Member ${idx + 1}`}
                    style={{
                      width: "100%",
                      padding: "4px 6px",
                      borderRadius: 6,
                      border: "1px solid #e5e7eb",
                      fontSize: "0.9rem",
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={addMemberField}
                style={{
                  marginTop: 6,
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: "none",
                  fontSize: "0.8rem",
                  background: "#e5e7eb",
                  cursor: "pointer",
                }}
              >
                + Add member field
              </button>
            </div>

            <button
              type="button"
              onClick={handleJoin}
              style={{
                marginTop: 8,
                padding: "8px 12px",
                borderRadius: 999,
                border: "none",
                background: "#16a34a",
                color: "#ffffff",
                fontSize: "0.95rem",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Ready for action
            </button>
          </div>
        </section>
      )}

      {joined && (
        <section
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            background: "#fef9c3",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: "1rem" }}>
            Team {teamName || "?"}
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: "0.85rem",
              color: "#4b5563",
            }}
          >
            {statusMessage}
          </p>

          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid #e5e7eb",
              fontSize: "0.85rem",
            }}
          >
            <div>
              <strong>Current station: </strong>
              {assignedNorm.label}
            </div>
            {mustScan ? (
              <div style={{ color: "#b91c1c", marginTop: 2 }}>
                Please scan the QR code at your assigned station.
              </div>
            ) : scannedStationId ? (
              <div style={{ color: "#059669", marginTop: 2 }}>
                Station confirmed ({scannedNorm.label}). Wait for the task.
              </div>
            ) : (
              <div style={{ color: "#6b7280", marginTop: 2 }}>
                Waiting for a task…
              </div>
            )}
            {scanError && (
              <div
                style={{
                  marginTop: 6,
                  padding: 6,
                  borderRadius: 8,
                  background: "#fee2e2",
                  color: "#991b1b",
                  whiteSpace: "pre-wrap",
                  fontSize: "0.8rem",
                }}
              >
                {scanError}
              </div>
            )}
          </div>
        </section>
      )}

      {joined && (
        <section
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            background: "#eff6ff",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: "1rem" }}>
            Scan your station
          </h2>
          <QrScanner
            active={scannerActive}
            onCode={handleScannedCode}
            onError={setScanError}
          />
        </section>
      )}

      {joined && currentTask && (
        <section
          style={{
            padding: 12,
            borderRadius: 12,
            background: "#f1f5f9",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: "1rem" }}>
            Task {taskIndex != null ? taskIndex + 1 : ""}
          </h2>
          <TaskRunner
            task={currentTask}
            taskTypes={TASK_TYPES}
            onSubmit={handleSubmitAnswer}
            submitting={submitting}
          />
        </section>
      )}
    </div>
  );
}
