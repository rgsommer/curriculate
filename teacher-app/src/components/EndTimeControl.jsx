// teacher-app/src/components/EndTimeControl.jsx
//
// Compact HH:MM picker the teacher uses to declare when the live session
// should auto-end. Used by both LiveSession (pre-launch) and HostView
// (mid-session) so the same control follows the teacher from lobby to
// live monitor.
//
// Smart suggestion: when the input gets focus and is empty, we pre-fill
// it with `now + estimatedMinutes` snapped to the nearest 5-minute
// boundary. The teacher can edit; clearing the field unsets the auto-
// end. Behind the scenes we emit `teacher:setEndTime` with the resulting
// epoch ms; the backend ticker handles the actual stop.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";

/**
 * Snap a Date to the nearest N-minute boundary. Used to keep suggested
 * end times on tidy 5-min marks (3:25, 3:30 …) instead of 3:27:14.
 */
function snapToMinutes(date, stepMinutes = 5) {
  const ms = stepMinutes * 60 * 1000;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

/**
 * Local "HH:MM" string (24-hour) for use inside <input type="time"> —
 * which natively expects this format regardless of locale.
 */
function toHHMM(date) {
  if (!date) return "";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Parse "HH:MM" into a Date today at that time. If the parsed time has
 * already passed for today, roll it to tomorrow (rare — a teacher
 * picking 8:00 at 8:01 probably meant tomorrow morning).
 */
function parseHHMM(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (!(h >= 0 && h < 24) || !(m >= 0 && m < 60)) return null;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m);
  if (d.getTime() < Date.now() - 60_000) {
    // Rolled past — pick tomorrow.
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Hover / focus tooltip used next to "End at". Pure CSS — popover lives
 * inside the same wrapper so it appears on `:hover` and on keyboard focus
 * (tab to the trigger icon). Keeps it accessible without a popper lib.
 */
function InfoTip({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", marginLeft: 2 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="What does End at do?"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "1px solid #94a3b8",
          background: "#fff",
          color: "#475569",
          fontWeight: 900,
          fontSize: 11,
          lineHeight: 1,
          cursor: "help",
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ⓘ
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 50,
            width: 280,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            boxShadow: "0 10px 28px rgba(15,23,42,0.18)",
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "#0f172a",
            whiteSpace: "normal",
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** Pretty m:ss style countdown — e.g. "12:04 remaining" or "in 1:23 hr". */
function formatCountdown(msLeft) {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return "ends now";
  const totalSec = Math.round(msLeft / 1000);
  if (totalSec < 60) return `${totalSec}s remaining`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) {
    return `${m}:${String(s).padStart(2, "0")} remaining`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m remaining`;
}

export default function EndTimeControl({
  roomCode,
  endsAt, // epoch ms or null
  estimatedDurationMinutes = null,
  compact = false,
  disabled = false,
}) {
  // What's in the <input>. Local string so blanking it doesn't auto-fire.
  const [draft, setDraft] = useState(endsAt ? toHHMM(new Date(endsAt)) : "");
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  // Keep input in sync if the room state pushes a fresh endsAt (other
  // device set it, or backend rejected our value).
  useEffect(() => {
    setDraft(endsAt ? toHHMM(new Date(endsAt)) : "");
  }, [endsAt]);

  // Suggested end time = now + estimatedDurationMinutes, snapped to 5.
  const suggested = useMemo(() => {
    const mins = Number(estimatedDurationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) return null;
    const d = new Date(Date.now() + mins * 60 * 1000);
    return snapToMinutes(d, 5);
  }, [estimatedDurationMinutes]);

  // ── Live countdown text (updates every 15s — accurate enough at scale) ──
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [endsAt]);
  const countdownText = useMemo(() => {
    if (!endsAt) return "";
    return formatCountdown(endsAt - Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, tick]);

  const handleFocus = () => {
    if (!draft && suggested) {
      setDraft(toHHMM(suggested));
    }
  };

  const commit = (next) => {
    setError("");
    const code = String(roomCode || "").toUpperCase().trim();
    if (!code) return;

    // Empty draft = clear the auto-end.
    if (!next || !next.trim()) {
      socket.emit("teacher:setEndTime", { roomCode: code, endsAt: null }, (ack) => {
        if (ack && ack.ok === false) setError(ack.error || "Could not clear end time");
        else setSavedAt(Date.now());
      });
      return;
    }
    const parsed = parseHHMM(next);
    if (!parsed) {
      setError("Use HH:MM (e.g. 3:25 PM → 15:25)");
      return;
    }
    socket.emit(
      "teacher:setEndTime",
      { roomCode: code, endsAt: parsed.getTime() },
      (ack) => {
        if (ack && ack.ok === false) {
          setError(ack.error || "Could not save end time");
        } else {
          setSavedAt(Date.now());
        }
      }
    );
  };

  const clear = () => {
    setDraft("");
    commit("");
  };

  const useSuggested = () => {
    if (!suggested) return;
    const next = toHHMM(suggested);
    setDraft(next);
    commit(next);
    inputRef.current?.blur();
  };

  return (
    <div
      data-testid="end-time-control"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: compact ? "6px 8px" : "10px 12px",
        borderRadius: 12,
        border: "1px solid #cbd5e1",
        background: endsAt ? "#ecfeff" : "#f8fafc",
        fontSize: compact ? "0.78rem" : "0.85rem",
      }}
    >
      <span
        style={{
          fontWeight: 800,
          color: "#0f172a",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        ⏰ <span>End at</span>
        <InfoTip>
          <div style={{ fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>
            Hard auto-end at the bell
          </div>
          <div style={{ color: "#334155", lineHeight: 1.45 }}>
            When this time hits, the session closes immediately —{" "}
            <b>even if students are still working</b>. Nothing is lost:
            results <b>are captured and reported</b> on whatever each
            student completed up to that moment. Use it so the activity
            ends cleanly on the bell without you needing to be at the device.
          </div>
        </InfoTip>
      </span>

      <input
        ref={inputRef}
        type="time"
        value={draft}
        disabled={disabled}
        onFocus={handleFocus}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder={suggested ? toHHMM(suggested) : "--:--"}
        style={{
          padding: "5px 8px",
          borderRadius: 8,
          border: "1px solid #cbd5e1",
          background: "#fff",
          fontWeight: 700,
          fontSize: compact ? "0.85rem" : "0.95rem",
          color: "#0f172a",
          minWidth: 110,
        }}
      />

      {suggested && draft !== toHHMM(suggested) && (
        <button
          type="button"
          onClick={useSuggested}
          disabled={disabled}
          title={`Suggested: now + ${estimatedDurationMinutes} min, snapped to 5-min`}
          style={{
            padding: "5px 10px",
            borderRadius: 8,
            border: "1px solid #2563eb",
            background: "#fff",
            color: "#1d4ed8",
            fontWeight: 800,
            fontSize: compact ? "0.72rem" : "0.78rem",
            cursor: "pointer",
          }}
        >
          Use {toHHMM(suggested)}
        </button>
      )}

      {endsAt && (
        <>
          <span
            style={{
              padding: "3px 8px",
              borderRadius: 999,
              background: "#cffafe",
              color: "#0e7490",
              fontWeight: 800,
              fontSize: compact ? "0.7rem" : "0.75rem",
            }}
            title="Live countdown to auto-end"
          >
            {countdownText}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            style={{
              padding: "3px 8px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#64748b",
              fontWeight: 700,
              fontSize: compact ? "0.7rem" : "0.75rem",
              cursor: "pointer",
            }}
            title="Clear the auto-end"
          >
            Clear
          </button>
        </>
      )}

      {!endsAt && suggested && (
        <span style={{ color: "#64748b", fontSize: compact ? "0.7rem" : "0.78rem" }}>
          Suggested: {toHHMM(suggested)} ({estimatedDurationMinutes}-min set)
        </span>
      )}

      {error && (
        <span style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.72rem" }}>
          {error}
        </span>
      )}

      {savedAt && Date.now() - savedAt < 3000 && (
        <span style={{ color: "#15803d", fontWeight: 700, fontSize: "0.72rem" }}>
          ✓ saved
        </span>
      )}
    </div>
  );
}
