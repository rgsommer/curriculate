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

// For now, LiveSession-launched tasks are assumed to use "Classroom"
const DEFAULT_LOCATION = "Classroom";

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
    return {
      id: `station-${m[1]}`,
      color,
      label: color
        ? `Station-${color[0].toUpperCase()}${color.slice(1)}`
        : `Station-${m[1]}`,
    };
  }

  // Case 2: numeric only: "1", "2", ...
  m = /^(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const color = COLOR_NAMES[idx] || null;
    return {
      id: `station-${m[1]}`,
      color,
      label: color
        ? `Station-${color[0].toUpperCase()}${color.slice(1)}`
        : `Station-${m[1]}`,
    };
  }

  // Case 3: colour-based id: "station-red", "red", ...
  const colorIndex = COLOR_NAMES.indexOf(lower.replace(/^station-/, ""));
  if (colorIndex >= 0) {
    const n = colorIndex + 1;
    const color = COLOR_NAMES[colorIndex];
    return {
      id: `station-${n}`,
      color,
      label: `Station-${color[0].toUpperCase()}${color.slice(1)}`,
    };
  }

  // Fallback – unknown station format
  return { id: s, color: null, label: s };
}

// Format remaining time nicely as M:SS
function formatRemainingMs(ms) {
  if (ms == null || ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/* -----------------------------------------------------------
   Minimal QR Scanner – camera only stops when onCode(value) returns true
----------------------------------------------------------- */

function QrScanner({ active, onCode, onError }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function stopCamera() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }

    async function detectLoop(detector) {
      if (cancelled) return;

      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(() => detectLoop(detector));
        return;
      }

      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes && barcodes.length > 0) {
          const value = barcodes[0].rawValue || "";
          const shouldStop = await onCode(value);
          if (shouldStop) {
            await stopCamera();
            return;
          }
        }
      } catch (err) {
        console.warn("Barcode detect error", err);
        onError?.("Could not read QR code. Try again or tell your teacher.");
      }

      if (!cancelled) {
        rafRef.current = requestAnimationFrame(() => detectLoop(detector));
      }
    }

    async function startCamera() {
      if (!active) return;
      if (!("BarcodeDetector" in window)) {
        onError?.(
          "This browser does not support QR scanning. Try another browser or device."
        );
        return;
      }

      try {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!videoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        detectLoop(detector);
      } catch (err) {
        console.error("Camera start error", err);
        onError?.(
          "Unable to access camera. Check permissions or tell your teacher."
        );
      }
    }

    if (active) {
      startCamera();
    } else {
      stopCamera();
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
        }}
        autoPlay
        playsInline
        muted
      />
    </div>
  );
}

/* -----------------------------------------------------------
   Student App main
----------------------------------------------------------- */
function NoiseSensor({ active, roomCode, socket, ignoreNoise }) {
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const rafRef = useRef(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!active || ignoreNoise) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      dataArrayRef.current = null;
      return;
    }

    let cancelled = false;
    let stream = null;

    async function setup() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const AudioCtx =
          window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();
        const analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);

        analyser.fftSize = 512;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        source.connect(analyser);

        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;
        dataArrayRef.current = dataArray;

        const loop = () => {
          if (
            cancelled ||
            !analyserRef.current ||
            !dataArrayRef.current
          ) {
            return;
          }

          analyserRef.current.getByteTimeDomainData(
            dataArrayRef.current
          );

          let sum = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            const v = dataArrayRef.current[i] - 128;
            sum += v * v;
          }
          const rms = Math.sqrt(
            sum / dataArrayRef.current.length
          );

          // Approximate noise level 0–100
          const level = Math.min(
            100,
            Math.max(0, Math.round((rms / 50) * 100))
          );

          const now = Date.now();
          if (
            roomCode &&
            now - lastSentRef.current > 500 &&
            !ignoreNoise
          ) {
            socket.emit("noise:sample", {
              roomCode: roomCode.trim().toUpperCase(),
              level,
            });
            lastSentRef.current = now;
          }

          rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.warn("NoiseSensor getUserMedia failed:", err);
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      analyserRef.current = null;
      dataArrayRef.current = null;
    };
  }, [active, ignoreNoise, roomCode, socket]);

  return null;
}

export default function StudentApp() {
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState([""]);
  const [joined, setJoined] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [teamId, setTeamId] = useState(null);

  const [assignedStationId, setAssignedStationId] = useState(null);
  const [scannedStationId, setScannedStationId] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);

  const [currentTask, setCurrentTask] = useState(null);
  const [taskIndex, setTaskIndex] = useState(null);

  const [statusMessage, setStatusMessage] = useState(
    "Enter your room code and team name to begin."
  );

    const [locationCode, setLocationCode] = useState(DEFAULT_LOCATION);

  const [submitting, setSubmitting] = useState(false);
  const sndAlert = useRef(null);
  const sndTreat = useRef(null);

  // Ambient noise state pushed from server
  const [noiseState, setNoiseState] = useState({
    enabled: false,
    brightness: 1,
    level: 0,
    threshold: 0,
  });

  // Random treat banner
  const [treatMessage, setTreatMessage] = useState(null);

  // timeout-related state
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(null);

  const [remainingMs, setRemainingMs] = useState(null);
  const timeoutTimerRef = useRef(null);
  const timeoutSubmittedRef = useRef(false);

  // draft answer tracking (for timeout auto-submit)
  const [currentAnswerDraft, setCurrentAnswerDraft] = useState(null);

  // Pulse CSS for colour box
  useEffect(() => {
    const styleId = "station-pulse-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      @keyframes stationPulse {
        0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.9); }
        70% { box-shadow: 0 0 0 22px rgba(255,255,255,0); }
        100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (sndAlert.current) {
      sndAlert.current.volume = 1.0;
    }
    if (sndTreat.current) {
      sndTreat.current.volume = 1.0;
    }
  }, []);

  // Socket events
  useEffect(() => {
    const handleConnect = () => {
      console.log("Student socket connected:", socket.id);
      setConnected(true);
    };

    const handleDisconnect = () => {
      console.log("Student socket disconnected");
      setConnected(false);

      // We are no longer in the room on the server,
      // so force the UI back to “not joined”.
      setJoined(false);
      setTeamId(null);
      setAssignedStationId(null);
      setScannedStationId(null);
      setCurrentTask(null);
      setTaskIndex(null);
      setStatusMessage(
        "Connection lost. Check Wi-Fi and tap READY again to rejoin your room."
      );
    };

    const handleRoomState = (state = {}) => {
      // Update location (Classroom / Gym / etc.)
      const loc = state.locationCode || DEFAULT_LOCATION;
      setLocationCode(loc);

      const teams = state.teams || {};
      // On the backend, teamId === socket.id for this device
      const me = teams[socket.id];

      if (!me) {
        // Server no longer has us as a team (e.g., teacher restarted room);
        // leave joined as-is so the student can still see they need to rejoin.
        return;
      }

      const newAssigned = me.currentStationId || null;

      // If the assigned station changed, clear the previous scan
      setAssignedStationId((prev) => {
        if (prev && prev !== newAssigned) {
          setScannedStationId(null);
        }
        return newAssigned;
      });
    };

    const handleTaskLaunch = ({ index, task, timeLimitSeconds }) => {
      console.log("[Student] task:launch", { index, task, timeLimitSeconds });

      setCurrentTask(task || null);
      setTaskIndex(index ?? null);

      // Time-limit handling (ties into your timeout effect)
      if (timeLimitSeconds && timeLimitSeconds > 0) {
        setTimeLimitSeconds(timeLimitSeconds);
      } else {
        setTimeLimitSeconds(null);
        setRemainingMs(null);
      }

      // New task → clear any previous draft + timeout flag
      setCurrentAnswerDraft(null);
      timeoutSubmittedRef.current = false;

      // IMPORTANT: do NOT clear scannedStationId here.
      // If the team is still at the same station, they should NOT have to rescan
      // just because a new task was delivered.

      // Play alert sound on task arrival
      const a = sndAlert.current;
      if (a) {
        a.currentTime = 0;
        a
          .play()
          .then(() => {})
          .catch((err) =>
            console.warn("Student task sound play blocked/failed", err)
          );
      }

      setStatusMessage(
        "Task received! Read carefully and submit your best answer."
      );
    };

        const handleNoiseLevel = (payload) => {
      if (!payload) return;
      const { brightness, enabled, level, threshold } = payload;

      setNoiseState((prev) => ({
        ...prev,
        enabled: !!enabled,
        brightness:
          typeof brightness === "number"
            ? Math.min(1, Math.max(0.3, brightness))
            : prev.brightness,
        level: typeof level === "number" ? level : prev.level,
        threshold:
          typeof threshold === "number" ? threshold : prev.threshold,
      }));
    };

    const handleTreatAssigned = (payload) => {
      if (!payload) return;

      // Only respond if this is for our team & room
      if (payload.teamId && payload.teamId !== teamId) return;

      if (
        payload.roomCode &&
        roomCode &&
        payload.roomCode.toUpperCase() !== roomCode.trim().toUpperCase()
      ) {
        return;
      }

      setTreatMessage(
        payload.message || "See your teacher for a treat!"
      );

      try {
        if (sndTreat.current) {
          sndTreat.current.currentTime = 0;
          sndTreat.current.play().catch((err) => {
            console.warn("Unable to play treat sound:", err);
          });
        }
      } catch (err) {
        console.warn("Treat sound error:", err);
      }
    };

      useEffect(() => {
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:state", handleRoomState);
    socket.on("task:launch", handleTaskLaunch);
    socket.on("session:noiseLevel", handleNoiseLevel);
    socket.on("student:treatAssigned", handleTreatAssigned);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:state", handleRoomState);
      socket.off("task:launch", handleTaskLaunch);
      socket.off("session:noiseLevel", handleNoiseLevel);
      socket.off("student:treatAssigned", handleTreatAssigned);
    };
    // roomCode/teamId so the handler always has fresh values
  }, [roomCode, teamId]);

  // Timeout timer effect
  useEffect(() => {
    if (!currentTask || !timeLimitSeconds || timeLimitSeconds <= 0) {
      if (timeoutTimerRef.current) {
        clearInterval(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      setRemainingMs(null);
      timeoutSubmittedRef.current = false;
      return;
    }

    const totalMs = timeLimitSeconds * 1000;
    const start = Date.now();
    setRemainingMs(totalMs);
    timeoutSubmittedRef.current = false;

    timeoutTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const remain = totalMs - elapsed;

      if (remain <= 0) {
        if (timeoutTimerRef.current) {
          clearInterval(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        setRemainingMs(0);

        if (!timeoutSubmittedRef.current) {
          timeoutSubmittedRef.current = true;

          const finalAnswer = currentAnswerDraft ?? null;

          if (roomCode && teamId != null && taskIndex != null) {
            socket.emit(
              "student:submitAnswer",
              {
                roomCode: roomCode.trim().toUpperCase(),
                teamId,
                taskIndex,
                answer: finalAnswer,
                isTimeout: true,
              },
              (ack) => {
                console.log("Timeout submit ack:", ack);
              }
            );
          }

          setCurrentTask(null);
          setStatusMessage("Time is up! Your answer was submitted.");
        }
      } else {
        setRemainingMs(remain);
      }
    }, 250);

    return () => {
      if (timeoutTimerRef.current) {
        clearInterval(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [
    currentTask,
    timeLimitSeconds,
    roomCode,
    teamId,
    taskIndex,
    currentAnswerDraft,
  ]);

  // Scanner activation logic – independent of scanError
  useEffect(() => {
    const mustScan =
      joined && !!assignedStationId && scannedStationId !== assignedStationId;

    if (mustScan) {
      setScannerActive(true);
      const a = sndAlert.current;
      a?.play().catch(() => {});
    } else {
      setScannerActive(false);
    }
  }, [joined, assignedStationId, scannedStationId]);

  const unlockAudioForBrowser = () => {
    const a = sndAlert.current;
    if (!a) return;

    a
      .play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
      })
      .catch((err) => {
        console.warn("Audio unlock failed", err);
      });
  };

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

    unlockAudioForBrowser();

    const filteredMembers = members
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    console.log("[Student] Ready click", {
      finalRoom,
      realMembersCount: filteredMembers.length,
      socketConnected: connected,
    });

    setJoiningRoom(true);
    setStatusMessage(`Joining Room ${finalRoom}…`);

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
          setJoiningRoom(false);
          alert(ack?.error || "Unable to join room.");
          return;
        }

        setRoomCode(finalRoom);
        setJoined(true);
        setJoiningRoom(false);
        setTeamId(ack.teamId || socket.id);

        const teams = ack.roomState?.teams || {};
        const team = teams[ack.teamId] || null;
        const locLabel = (
          ack.roomState?.locationCode ||
          locationCode ||
          DEFAULT_LOCATION
        ).toUpperCase();

        if (team?.currentStationId) {
          setAssignedStationId(team.currentStationId);
          const norm = normalizeStationId(team.currentStationId);
          const colourLabel = norm.color ? norm.color.toUpperCase() : "";
          if (colourLabel) {
            setStatusMessage(`Scan a ${locLabel} ${colourLabel} station.`);
          } else {
            setStatusMessage(`Scan a ${locLabel} station.`);
          }
        } else {
          setStatusMessage(`Scan a ${locLabel} station.`);
        }
      }
    );
  };

  // onCode handler: returns true to stop camera, false to keep scanning
  // For a scan to be correct, BOTH location and colour must match.
  const handleScannedCode = (value) => {
    try {
      if (!assignedStationId) {
        setScanError(
          "No station has been assigned yet. Please wait for your teacher."
        );
        return false;
      }

      // Normalise slashes first so we can handle backslash QR text
      let raw = (value || "").trim().replace(/\\/g, "/");

      let segments = [];

      // Try parse as full URL first
      try {
        const url = new URL(raw);
        segments = url.pathname
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);
      } catch {
        // Not a valid URL; treat as path-like string
        segments = raw.split("/").map((s) => s.trim()).filter(Boolean);
      }

      if (segments.length < 2) {
        setScanError(
          `Unrecognized station code: "${raw}". Ask your teacher which QR to use.`
        );
        return false;
      }

      // Keep ProperCase for location (e.g. "Classroom"), lowercase for colour
      const location = segments[segments.length - 2];
      const colour = segments[segments.length - 1].toLowerCase();

      const assignedNorm = normalizeStationId(assignedStationId);
      const assignedColour = assignedNorm.color; // "red", "blue", etc.
      const assignedLocation = locationCode || DEFAULT_LOCATION;

      if (!assignedColour) {
        setScanError(
          `The assigned station colour could not be determined. Please tell your teacher.`
        );
        return false;
      }

      if (location !== assignedLocation || colour !== assignedColour) {
        const scannedLabel = `${location}/${colour}`;
        const correctLabel = `${assignedLocation}/${assignedColour}`;

        setScanError(
          `This is the wrong station.\n\nYou scanned: ${scannedLabel}.\n\nCorrect: ${correctLabel}.\n\nPlease go to the correct station and try again.`
        );
        return false; // wrong station → keep scanning
      }

      // ✅ Correct location + colour for the currently assigned station
      setScannedStationId(assignedStationId);
      setScanError(null);

      const nonEmptyMembers = members.map((m) => m.trim()).filter(Boolean);
      if (nonEmptyMembers.length > 0) {
        setStatusMessage(`Team members: ${nonEmptyMembers.join(", ")}`);
      } else {
        setStatusMessage("Station confirmed.");
      }

      if (roomCode) {
        socket.emit("station:scan", {
          roomCode: roomCode.trim().toUpperCase(),
          teamId,
          stationId: assignedNorm.id || assignedStationId,
        });
      }

      return true; // correct station → stop camera
    } catch (err) {
      console.error("Error handling scanned QR", err);
      setScanError(
        "Something went wrong reading that code. Please tell your teacher."
      );
      return false;
    }
  };

  const handleSubmitAnswer = async (answerPayload) => {
    if (!roomCode || !joined || !currentTask) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      await new Promise((resolve, reject) => {
        socket
          .timeout(8000)
          .emit(
            "student:submitAnswer",
            {
              roomCode: roomCode.trim().toUpperCase(),
              teamId,
              taskIndex,
              answer: answerPayload,
            },
            (err, ack) => {
              if (err) {
                console.warn("Submit timeout/error:", err);
                reject(err);
                return;
              }
              if (!ack || !ack.ok) {
                console.warn("Submit not OK:", ack);
                reject(new Error(ack?.error || "Submit failed"));
                return;
              }
              resolve();
            }
          );
      });

      if (timeoutTimerRef.current) {
        clearInterval(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      setTimeLimitSeconds(null);
      setRemainingMs(null);
      timeoutSubmittedRef.current = false;

      setStatusMessage("Answer submitted! Wait for the next task.");
      setCurrentTask(null);
    } catch (err) {
      alert(
        "We couldn't submit your answer. Check your connection and tell your teacher."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const assignedNorm = normalizeStationId(assignedStationId);
  const scannedNorm = normalizeStationId(scannedStationId);
  const assignedColor = assignedNorm.color;

  const mustScan =
    joined && !!assignedStationId && scannedStationId !== assignedStationId;

  // Shared scan prompt string (used in text section + above scanner)
  const locLabel = (locationCode || DEFAULT_LOCATION).toUpperCase();
  const colourLabel = assignedNorm.color
    ? ` ${assignedNorm.color.toUpperCase()}`
    : "";
  const scanPrompt = `Scan a ${locLabel}${colourLabel} station.`;

    return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "flex-start",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        backgroundColor: "#ffffff",
        color: "#111827",
        opacity: noiseState.enabled ? noiseState.brightness : 1,
        transition: "opacity 120ms ease-out",
      }}

    >
      {/* Hidden audio element for task / scan sounds */}
      <audio
        ref={sndAlert}
        src="/sounds/scan-alert.mp3"
        preload="auto"
        style={{ display: "none" }}
      />

      {/* Hidden audio element for random-treat sound */}
      <audio
        ref={sndTreat}
        src="/sounds/treat-chime.mp3"
        preload="auto"
        style={{ display: "none" }}
      />

      {/* Main content column */}
      <div
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 520,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <header style={{ marginBottom: 4 }}>
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
            {joined
              ? roomCode
                ? `Connected · Room ${roomCode.toUpperCase()}`
                : "Connected"
              : joiningRoom
              ? roomCode
                ? `Joining Room ${roomCode.toUpperCase()}…`
                : "Joining Room…"
              : connected
              ? "Connected to server"
              : "Connecting…"}
          </p>
        </header>
        
        {treatMessage && (
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              background: "#f97316",
              color: "#ffffff",
              fontSize: "0.9rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div>
              <strong style={{ marginRight: 4 }}>Treat time!</strong>
              {treatMessage}
            </div>
            <button
              type="button"
              onClick={() => setTreatMessage(null)}
              style={{
                border: "none",
                background: "rgba(255,255,255,0.15)",
                color: "#ffffff",
                padding: "4px 8px",
                borderRadius: 999,
                fontSize: "0.8rem",
              }}
            >
              Got it
            </button>
          </div>
        )}

        {!joined && (
          <section
            style={{
              marginBottom: 8,
              padding: 12,
              borderRadius: 12,
              background: "#eff6ff",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "1.1rem",
              }}
            >
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
                  onChange={(e) =>
                    setRoomCode(e.target.value.toUpperCase())
                  }
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
                        fontSize: "0.95rem",
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addMemberField}
                  style={{
                    marginTop: 4,
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "none",
                    background: "#e5e7eb",
                    fontSize: "0.8rem",
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
              marginBottom: 8,
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
                  {scanPrompt}
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
                    color: "#b91c1c",
                    fontSize: "0.8rem",
                  }}
                >
                  {scanError}
                </div>
              )}
            </div>
          </section>
        )}

        {joined && scannerActive && (
          <section
            style={{
              marginBottom: 8,
              padding: 12,
              borderRadius: 12,
              background: assignedColor ? assignedColor : "#eff6ff",
              animation:
                scannerActive && assignedColor
                  ? "stationPulse 1.6s infinite"
                  : "none",
              boxShadow:
                scannerActive && assignedColor
                  ? "0 0 0 0 rgba(255,255,255,0.9)"
                  : "0 1px 3px rgba(15,23,42,0.12)",
              transition: "background 0.2s ease, box-shadow 0.2s ease",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 8,
                fontSize: "1rem",
                color: assignedColor ? "#ffffff" : "#111827",
              }}
            >
              {scanPrompt}
            </h2>
            <QrScanner
              active={scannerActive}
              onCode={handleScannedCode}
              onError={setScanError}
            />
          </section>
        )}

        {joined && currentTask && !mustScan && (
          <section
            style={{
              marginBottom: 8,
              padding: 12,
              borderRadius: 12,
              background: "#f9fafb",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 4,
                fontSize: "1rem",
              }}
            >
              {currentTask?.taskType === TASK_TYPES.JEOPARDY
                ? "Jeopardy clue"
                : "Task"}
            </h2>

            {currentTask?.taskType === TASK_TYPES.JEOPARDY &&
              currentTask?.jeopardyConfig?.boardTitle && (
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: "0.85rem",
                    color: "#4b5563",
                  }}
                >
                  Game:{" "}
                  <strong>{currentTask.jeopardyConfig.boardTitle}</strong>
                </p>
              )}

            {timeLimitSeconds && timeLimitSeconds > 0 && (
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: "0.85rem",
                  color: "#b91c1c",
                }}
              >
                Time left: {formatRemainingMs(remainingMs)}
              </p>
            )}

            <TaskRunner
              task={currentTask}
              taskTypes={TASK_TYPES}
              onSubmit={handleSubmitAnswer}
              submitting={submitting}
              onAnswerChange={setCurrentAnswerDraft}
              answerDraft={currentAnswerDraft}
            />
          </section>
        )}
      </div>

      {joined && (
        <NoiseSensor
          active={noiseState.enabled}
          roomCode={roomCode}
          socket={socket}
          ignoreNoise={!!currentTask?.ignoreNoise}
        />
      )}

      {/* Persistent colour band at the bottom (about half the screen) */}
      <div
        style={{
          marginTop: 16,
          width: "100%",
          height: "50vh",
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          backgroundColor: assignedColor ? assignedColor : "#e5e7eb",
          boxShadow: "0 -4px 12px rgba(15,23,42,0.25)",
        }}
      />
    </div>
  );
}
