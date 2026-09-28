"use client";

/**
 * HomeworkCapture — shoot a whole class's homework without leaving the app.
 *
 * The previous flow was: shoot the room with the phone's camera, then find
 * those photos on a computer, work out which ones belonged to this assignment,
 * upload them, and correct the app's guess at who each one belonged to. Every
 * step after the shutter was bookkeeping.
 *
 * Here the roster is the interface. Tap a student, shoot their pages — one,
 * three, however many the assignment runs to — tap the next student. Each photo
 * is attributed the moment it is taken, so there is no name to read off the
 * page, no grouping to guess, and no contact sheet to correct afterwards. A
 * student who was missed is simply one that never got ticked, visible before
 * you leave the room.
 *
 * Photos live in component state as JPEG data URLs and are handed to the parent
 * in capture order with the student each belongs to; uploading is the parent's
 * job, using the same resumable uploader the file path uses.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

const JPEG_QUALITY = 0.82;
const MAX_EDGE = 1600; // enough for handwriting; keeps a 25-photo batch sane

function labelOf(s) {
  const last = String(s?.lastName || "").trim();
  const first = String(s?.firstName || "").trim();
  if (last && first) return `${last}, ${first.charAt(0)}.`;
  return last || first || "(unnamed)";
}

export default function HomeworkCapture({ students = [], className = "", onDone, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [camError, setCamError] = useState("");
  const [current, setCurrent] = useState(0);        // index into students
  const [shots, setShots] = useState([]);           // [{ dataUrl, capturedAt, studentIdx }]
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);

  // ---- camera ----
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCamError("This browser can't open the camera. Use “Choose photos” instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (err) {
        // Denied, already in use, or no camera. Say which, since the fix differs.
        const name = err?.name || "";
        setCamError(
          name === "NotAllowedError"
            ? "Camera access was refused. Allow it for this site, then reopen this screen."
            : name === "NotFoundError"
              ? "No camera found on this device."
              : name === "NotReadableError"
                ? "The camera is being used by another app. Close it and try again."
                : "Could not open the camera."
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      // Release the camera. Without this the light stays on and a second visit
      // to this screen hits NotReadableError.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // ---- shutter ----
  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || !ready || busy) return;
    setBusy(true);
    try {
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      if (!vw || !vh) return;
      const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      setShots((prev) => [...prev, { dataUrl, capturedAt: Date.now(), studentIdx: current }]);
      setFlash(true);
      setTimeout(() => setFlash(false), 110);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
    } finally {
      setBusy(false);
    }
  }, [ready, busy, current]);

  // Space / Enter fire the shutter — a Bluetooth page-turner or clicker shows up
  // as one of these, which is easier than tapping while holding a stack of paper.
  useEffect(() => {
    function onKey(e) {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); shoot(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shoot]);

  const countFor = useCallback((idx) => shots.filter((s) => s.studentIdx === idx).length, [shots]);
  const currentCount = countFor(current);
  const doneCount = students.reduce((n, _s, i) => n + (countFor(i) > 0 ? 1 : 0), 0);

  function undoLast() {
    setShots((prev) => {
      // Undo within the student being shot, so moving on doesn't put the last
      // photo of the previous student at risk.
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].studentIdx === current) { const next = [...prev]; next.splice(i, 1); return next; }
      }
      return prev;
    });
  }

  function nextStudent() {
    // Next student still without a photo, else simply the next one along.
    const after = students.findIndex((_s, i) => i > current && countFor(i) === 0);
    setCurrent(after >= 0 ? after : Math.min(current + 1, students.length - 1));
  }

  function finish() {
    const withPhotos = shots.length;
    if (!withPhotos) return;
    const missing = students.filter((_s, i) => countFor(i) === 0).length;
    if (missing > 0 && !confirm(
      `${missing} student${missing === 1 ? " has" : "s have"} no photos. Submit anyway?\n\n`
      + "They'll simply be left out of this check."
    )) return;
    // Hand over in capture order, each photo carrying its student.
    onDone?.(shots.map((s) => ({
      dataUrl: s.dataUrl,
      capturedAt: s.capturedAt,
      student: students[s.studentIdx] || null,
    })));
  }

  if (!students.length) {
    return (
      <div style={st.wrap}>
        <div style={st.msg}>
          <b>No roster for this class.</b> In-app capture works off your class list — pick a class
          with a roster, or use “Choose photos” to upload from this device instead.
        </div>
        <button type="button" style={st.secondary} onClick={onCancel}>Back</button>
      </div>
    );
  }

  return (
    <div style={st.wrap}>
      <div style={st.head}>
        <div style={{ fontWeight: 800 }}>
          {className || "Class"} — {doneCount} of {students.length} done
        </div>
        <button type="button" style={st.link} onClick={onCancel}>Cancel</button>
      </div>

      {camError ? (
        <div style={st.msg}>{camError}</div>
      ) : (
        <div style={st.stage}>
          <video ref={videoRef} playsInline muted style={st.video} />
          {flash && <div style={st.flash} />}
          <div style={st.nowShooting}>
            {labelOf(students[current])}
            <span style={{ opacity: 0.8, fontWeight: 600 }}>
              {" "}· {currentCount} page{currentCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      )}

      <div style={st.controls}>
        <button
          type="button"
          style={{ ...st.secondary, opacity: currentCount ? 1 : 0.4 }}
          disabled={!currentCount}
          onClick={undoLast}
        >
          Undo page
        </button>
        <button
          type="button"
          style={{ ...st.shutter, opacity: ready ? 1 : 0.4 }}
          disabled={!ready}
          onClick={shoot}
          aria-label={`Photograph a page for ${labelOf(students[current])}`}
        >
          ⬤
        </button>
        <button type="button" style={st.secondary} onClick={nextStudent}>
          Next student →
        </button>
      </div>

      {/* The roster is the progress bar: who is done, who is being shot now, and
          who has been passed over — readable at a glance before leaving the room. */}
      <div style={st.roster}>
        {students.map((s, i) => {
          const n = countFor(i);
          const isCur = i === current;
          return (
            <button
              key={s.edsbyId || s.studentId || `${labelOf(s)}-${i}`}
              type="button"
              onClick={() => setCurrent(i)}
              style={{
                ...st.chip,
                ...(isCur ? st.chipCurrent : n > 0 ? st.chipDone : null),
              }}
            >
              {isCur ? "●" : n > 0 ? "✓" : "○"} {labelOf(s)}
              {n > 0 && <span style={{ opacity: 0.7 }}> ({n})</span>}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        style={{ ...st.primary, opacity: shots.length ? 1 : 0.4 }}
        disabled={!shots.length}
        onClick={finish}
      >
        Done — {shots.length} photo{shots.length === 1 ? "" : "s"}, {doneCount} student{doneCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}

const st = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 },
  link: { background: "none", border: "none", color: "#2563eb", fontWeight: 700, cursor: "pointer", fontSize: 13 },
  stage: { position: "relative", background: "#000", borderRadius: 12, overflow: "hidden" },
  video: { width: "100%", maxHeight: "48vh", objectFit: "contain", display: "block" },
  flash: { position: "absolute", inset: 0, background: "#fff", opacity: 0.75, pointerEvents: "none" },
  nowShooting: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    background: "linear-gradient(transparent, rgba(0,0,0,0.65))",
    color: "#fff", fontWeight: 800, fontSize: 16, padding: "18px 12px 8px",
  },
  controls: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  shutter: {
    width: 68, height: 68, borderRadius: "50%", border: "4px solid #cbd5e1",
    background: "#dc2626", color: "#fff", fontSize: 22, cursor: "pointer", flex: "0 0 auto",
  },
  secondary: {
    background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8,
    padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  primary: {
    background: "#2563eb", color: "#fff", border: "none", borderRadius: 10,
    padding: "12px 16px", fontSize: 15, fontWeight: 800, cursor: "pointer",
  },
  roster: {
    display: "flex", flexWrap: "wrap", gap: 6, maxHeight: "22vh", overflowY: "auto",
    padding: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
  },
  chip: {
    background: "#fff", border: "1px solid #e2e8f0", borderRadius: 999,
    padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#475569",
  },
  chipDone: { background: "rgba(22,163,74,0.10)", borderColor: "rgba(22,163,74,0.35)", color: "#166534", fontWeight: 700 },
  chipCurrent: { background: "#2563eb", borderColor: "#2563eb", color: "#fff", fontWeight: 800 },
  msg: {
    fontSize: 13, color: "#7c2d12", background: "rgba(234,88,12,0.10)",
    border: "1px solid rgba(234,88,12,0.35)", borderRadius: 8, padding: "10px 12px", lineHeight: 1.5,
  },
};
