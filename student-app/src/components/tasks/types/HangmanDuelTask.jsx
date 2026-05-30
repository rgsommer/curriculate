import React, { useEffect, useMemo, useRef, useState } from "react";
import TaskInstructions from "../TaskInstructions";
import { getPlayerName } from "../../../utils/playerName";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

// -----------------------------------------------------------------------------
// Hangman Duel (HANGMAN_DUEL)
//
// This file implements the missing gameplay features from your spec:
// - Drop letters anywhere in the TRAY (container). If letter is in the word,
//   it auto-fills the correct blank(s).
// - Wrong guesses add 1 body part (6 wrong guesses total => 7 stages 0..6).
// - When fully built (wrongGuesses==6) BOTH teams lose. Word is NOT revealed.
// - Rematch resets the round and picks a NEW word (from aiWordBank/wordsByStation/etc).
// - Strict turn rotation (skips eliminated players).
// - Full-word guess: correct => instant win; wrong => player eliminated (unless Extra Guess).
// - Power-up cards: Steal Letter, Extra Guess, Reveal Letter (simple but functional).
// - One shared A–Z letter pool. Only the current player can drag/click.
// - Timer defaults to 120s per round; last 5 seconds beep.
// - Optional: precise placement bonus if dropped on the exact correct blank.
//
// Notes:
// - This is local/pass-and-play by default (socket code intentionally off here).
// - TaskRunner injects `presenter` into tasks. We use presenter.showCountdown(...) if available.
// -----------------------------------------------------------------------------

// Shared sizes so tiles == slots
const TILE_W = 52;
const TILE_H = 62;
const RADIUS = 12;

const MAX_WRONG = 6; // 0..6 stages

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeUpperLetter(x) {
  const L = String(x || "").toUpperCase().slice(0, 1);
  return /^[A-Z]$/.test(L) ? L : "";
}

function playBeep(freq = 880, ms = 90, vol = 0.05) {
  // Tiny, safe beep. If blocked, it just fails silently.
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      try {
        o.stop();
        ctx.close();
      } catch {}
    }, ms);
  } catch {}
}

function playBonusChime() {
  // A tiny "reward" sound. Best-effort only.
  playBeep(1040, 85, 0.06);
  setTimeout(() => playBeep(1318, 110, 0.05), 120);
}

// -----------------------------------------------------------------------------
// Draggable Letter Tile
// -----------------------------------------------------------------------------
function DraggableLetter({ id, letter, disabled, status, selected, onClick, visual, title }) {
  // status: "unused" | "used" | "full" | "wrong"
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  });

  const bg =
    visual?.bg ||
    (status === "unused"
      ? "#ffffff"
      : status === "used"
        ? "#f3f4f6"
        : status === "wrong"
          ? "#fee2e2"
          : "#e5e7eb");

  const border =
    visual?.border ||
    (selected
      ? "3px solid #111827"
      : status === "full"
        ? "3px solid rgba(0,0,0,0.28)"
        : "3px solid rgba(0,0,0,0.18)");

  const text = status === "full" ? "#6b7280" : "#111827";

  const style = {
    width: TILE_W,
    height: TILE_H,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.65 : 1,
    cursor: disabled ? "not-allowed" : "grab",
    borderRadius: RADIUS,
    border,
    background: bg,
    boxShadow: selected ? "0 0 0 3px rgba(99,102,241,0.25)" : "0 4px 12px rgba(0,0,0,0.12)",
    fontWeight: 900,
    fontSize: 28,
    color: text,
    userSelect: "none",
    touchAction: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: 6,
    position: "relative",
    filter: disabled ? "grayscale(0.15)" : "none",
  };

  const badge = visual?.badge ?? "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={disabled ? undefined : onClick}
      role="button"
      aria-disabled={disabled ? "true" : "false"}
      title={title || ""}
    >
      {letter}
      {badge ? (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: 12,
            fontWeight: 900,
            opacity: 0.85,
          }}
        >
          {badge}
        </div>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Droppable Slot
// -----------------------------------------------------------------------------
function DroppableSlot({ id, value, canAct, onClear, isCorrectGlow }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const filled = !!value && value !== "_";

  const style = {
    width: TILE_W,
    height: TILE_H,
    borderRadius: RADIUS,
    border: isCorrectGlow ? "3px solid #f59e0b" : "3px solid #111827",
    background: isOver
      ? "rgba(56,189,248,0.20)"
      : filled
        ? "rgba(34,197,94,0.18)"
        : "rgba(255,255,255,0.90)",
    color: filled ? "#16a34a" : "#111827",
    fontWeight: 900,
    fontSize: 28,
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: 6,
    cursor: canAct ? "pointer" : "default",
    boxShadow: isCorrectGlow ? "0 0 0 3px rgba(245,158,11,0.22)" : "none",
    transition: "background 120ms ease, box-shadow 120ms ease, border 120ms ease",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onContextMenu={(e) => {
        e.preventDefault();
        if (canAct) onClear?.();
      }}
      title={canAct ? "Drop a letter here (optional). Right-click to clear." : ""}
    >
      {filled ? value : "_"}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Droppable TRAY (container)
// -----------------------------------------------------------------------------
function DroppableTray({ id, canAct, children, label, dragActive, bonusPulse }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        padding: 10,
        borderRadius: 18,
        border: bonusPulse
          ? "3px solid rgba(245,158,11,0.95)"
          : isOver
            ? "3px dashed rgba(34,197,94,0.85)"
            : dragActive
              ? "3px dashed rgba(59,130,246,0.80)"
              : "3px dashed rgba(17,24,39,0.35)",
        background: bonusPulse
          ? "rgba(245,158,11,0.16)"
          : isOver
            ? "rgba(34,197,94,0.20)"
            : dragActive
              ? "rgba(59,130,246,0.12)"
              : "rgba(255,255,255,0.55)",
        boxShadow: "0 8px 26px rgba(2,6,23,0.10)",
        transition: "background 120ms ease",
        cursor: canAct ? "pointer" : "default",
        position: "relative",
        animation: bonusPulse ? "bonusPulse 520ms ease" : "none",
      }}
      title={canAct ? "Drop a letter anywhere in this box." : ""}
    >
      {!!label && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 10,
            fontSize: 12,
            fontWeight: 900,
            opacity: 0.7,
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Hangman SVG stages
// - 7 stages each (0..6)
// -----------------------------------------------------------------------------
function HangmanSVG({ style, parts }) {
  const snowmanStages = [
    // 0
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/></svg>',
    // 1
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#475569" stroke-width="2"/></svg>',
    // 2
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#475569" stroke-width="2"/></svg>',
    // 3
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/></svg>',
    // 4
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/></svg>',
    // 5
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/><line x1="100" y1="220" x2="50" y2="180" stroke="#8b4513" stroke-width="8"/><line x1="200" y1="220" x2="250" y2="180" stroke="#8b4513" stroke-width="8"/></svg>',
    // 6
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#e0f2fe"/><circle cx="150" cy="320" r="60" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="220" r="45" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="150" cy="140" r="30" fill="#ffffff" stroke="#475569" stroke-width="2"/><circle cx="140" cy="135" r="5" fill="#333333"/><circle cx="160" cy="135" r="5" fill="#333333"/><polygon points="150,140 180,145 150,150" fill="#f97316"/><line x1="100" y1="220" x2="50" y2="180" stroke="#8b4513" stroke-width="8"/><line x1="200" y1="220" x2="250" y2="180" stroke="#8b4513" stroke-width="8"/><rect x="120" y="100" width="60" height="40" fill="#000000"/><rect x="105" y="120" width="90" height="15" fill="#000000"/></svg>',
  ];

  const classicStages = [
    // 0
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/></svg>',
    // 1
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#0f172a" stroke-width="4"/></svg>',
    // 2
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#0f172a" stroke-width="4"/></svg>',
    // 3
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#0f172a" stroke-width="4"/></svg>',
    // 4
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#0f172a" stroke-width="4"/></svg>',
    // 5
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="220" x2="140" y2="260" stroke="#0f172a" stroke-width="4"/></svg>',
    // 6
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="380" x2="280" y2="380" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="380" x2="50" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="50" y1="50" x2="180" y2="50" stroke="#8b4513" stroke-width="10"/><line x1="180" y1="50" x2="180" y2="100" stroke="#8b4513" stroke-width="8"/><circle cx="180" cy="120" r="20" fill="none" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="140" x2="180" y2="220" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="160" x2="140" y2="180" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="160" x2="220" y2="180" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="220" x2="140" y2="260" stroke="#0f172a" stroke-width="4"/><line x1="180" y1="220" x2="220" y2="260" stroke="#0f172a" stroke-width="4"/></svg>',
  ];

  // Simple "decorate the tree" build
  const treeStages = [
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#dcfce7"/><polygon points="150,70 90,190 210,190" fill="#16a34a"/><polygon points="150,130 75,270 225,270" fill="#15803d"/><rect x="135" y="270" width="30" height="60" fill="#92400e"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#dcfce7"/><polygon points="150,70 90,190 210,190" fill="#16a34a"/><polygon points="150,130 75,270 225,270" fill="#15803d"/><rect x="135" y="270" width="30" height="60" fill="#92400e"/><circle cx="150" cy="60" r="12" fill="#f59e0b"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#dcfce7"/><polygon points="150,70 90,190 210,190" fill="#16a34a"/><polygon points="150,130 75,270 225,270" fill="#15803d"/><rect x="135" y="270" width="30" height="60" fill="#92400e"/><circle cx="150" cy="60" r="12" fill="#f59e0b"/><circle cx="120" cy="160" r="10" fill="#ef4444"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#dcfce7"/><polygon points="150,70 90,190 210,190" fill="#16a34a"/><polygon points="150,130 75,270 225,270" fill="#15803d"/><rect x="135" y="270" width="30" height="60" fill="#92400e"/><circle cx="150" cy="60" r="12" fill="#f59e0b"/><circle cx="120" cy="160" r="10" fill="#ef4444"/><circle cx="180" cy="200" r="10" fill="#3b82f6"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#dcfce7"/><polygon points="150,70 90,190 210,190" fill="#16a34a"/><polygon points="150,130 75,270 225,270" fill="#15803d"/><rect x="135" y="270" width="30" height="60" fill="#92400e"/><circle cx="150" cy="60" r="12" fill="#f59e0b"/><circle cx="120" cy="160" r="10" fill="#ef4444"/><circle cx="180" cy="200" r="10" fill="#3b82f6"/><circle cx="150" cy="235" r="10" fill="#22c55e"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#dcfce7"/><polygon points="150,70 90,190 210,190" fill="#16a34a"/><polygon points="150,130 75,270 225,270" fill="#15803d"/><rect x="135" y="270" width="30" height="60" fill="#92400e"/><circle cx="150" cy="60" r="12" fill="#f59e0b"/><circle cx="120" cy="160" r="10" fill="#ef4444"/><circle cx="180" cy="200" r="10" fill="#3b82f6"/><circle cx="150" cy="235" r="10" fill="#22c55e"/><path d="M95 210 C120 190, 180 190, 205 210" fill="none" stroke="#fbbf24" stroke-width="6" stroke-linecap="round"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#dcfce7"/><polygon points="150,70 90,190 210,190" fill="#16a34a"/><polygon points="150,130 75,270 225,270" fill="#15803d"/><rect x="135" y="270" width="30" height="60" fill="#92400e"/><circle cx="150" cy="60" r="12" fill="#f59e0b"/><circle cx="120" cy="160" r="10" fill="#ef4444"/><circle cx="180" cy="200" r="10" fill="#3b82f6"/><circle cx="150" cy="235" r="10" fill="#22c55e"/><path d="M95 210 C120 190, 180 190, 205 210" fill="none" stroke="#fbbf24" stroke-width="6" stroke-linecap="round"/><circle cx="100" cy="240" r="10" fill="#a855f7"/></svg>',
  ];

  // Simple gingerbread house build
  const gingerbreadStages = [
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#fef3c7"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#fef3c7"/><rect x="95" y="190" width="110" height="120" rx="8" fill="#d97706" stroke="#92400e" stroke-width="4"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#fef3c7"/><rect x="95" y="190" width="110" height="120" rx="8" fill="#d97706" stroke="#92400e" stroke-width="4"/><polygon points="150,140 80,200 220,200" fill="#b45309" stroke="#92400e" stroke-width="4"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#fef3c7"/><rect x="95" y="190" width="110" height="120" rx="8" fill="#d97706" stroke="#92400e" stroke-width="4"/><polygon points="150,140 80,200 220,200" fill="#b45309" stroke="#92400e" stroke-width="4"/><rect x="138" y="245" width="24" height="65" rx="6" fill="#92400e"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#fef3c7"/><rect x="95" y="190" width="110" height="120" rx="8" fill="#d97706" stroke="#92400e" stroke-width="4"/><polygon points="150,140 80,200 220,200" fill="#b45309" stroke="#92400e" stroke-width="4"/><rect x="138" y="245" width="24" height="65" rx="6" fill="#92400e"/><rect x="112" y="225" width="30" height="30" rx="6" fill="#60a5fa"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#fef3c7"/><rect x="95" y="190" width="110" height="120" rx="8" fill="#d97706" stroke="#92400e" stroke-width="4"/><polygon points="150,140 80,200 220,200" fill="#b45309" stroke="#92400e" stroke-width="4"/><rect x="138" y="245" width="24" height="65" rx="6" fill="#92400e"/><rect x="112" y="225" width="30" height="30" rx="6" fill="#60a5fa"/><rect x="160" y="225" width="30" height="30" rx="6" fill="#34d399"/></svg>',
    '<svg width="260" height="320" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="350" width="300" height="50" fill="#fef3c7"/><rect x="95" y="190" width="110" height="120" rx="8" fill="#d97706" stroke="#92400e" stroke-width="4"/><polygon points="150,140 80,200 220,200" fill="#b45309" stroke="#92400e" stroke-width="4"/><rect x="138" y="245" width="24" height="65" rx="6" fill="#92400e"/><rect x="112" y="225" width="30" height="30" rx="6" fill="#60a5fa"/><rect x="160" y="225" width="30" height="30" rx="6" fill="#34d399"/><path d="M90 200 C120 185, 180 185, 210 200" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/></svg>',
  ];

  const styleKey = String(style || "classic").toLowerCase();
  const stages =
    styleKey === "snowman" ? snowmanStages :
    styleKey === "tree" ? treeStages :
    styleKey === "gingerbread" ? gingerbreadStages :
    classicStages;

  const safeParts = clamp(Number(parts || 0), 0, MAX_WRONG);
  return stages[safeParts] || stages[0];
}

// -----------------------------------------------------------------------------
// Small tally marks
// -----------------------------------------------------------------------------
function TallyMarks({ count = 0, label }) {
  const n = Math.max(0, Number(count) || 0);
  const groups = Math.floor(n / 5);
  const rem = n % 5;

  const Group5 = ({ k }) => (
    <svg
      key={`g5-${k}`}
      width={46}
      height={22}
      viewBox="0 0 46 22"
      style={{ marginRight: 8, opacity: 0.92 }}
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="19" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
      <line x1="16" y1="3" x2="16" y2="19" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
      <line x1="26" y1="3" x2="26" y2="19" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
      <line x1="36" y1="3" x2="36" y2="19" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
      <line x1="4" y1="20" x2="40" y2="2" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );

  const Rem = () => (
    <svg width={46} height={22} viewBox="0 0 46 22" style={{ marginRight: 8, opacity: 0.92 }} aria-hidden="true">
      {Array.from({ length: rem }).map((_, i) => (
        <line
          key={`r-${i}`}
          x1={6 + i * 10}
          y1="3"
          x2={6 + i * 10}
          y2="19"
          stroke="#111827"
          strokeWidth="4"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", minWidth: 0 }} aria-label={label || `Score ${n}`}>
      {Array.from({ length: groups }).map((_, k) => (
        <Group5 key={`g-${k}`} k={k} />
      ))}
      {rem ? <Rem /> : null}
      <div style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{n}</div>
    </div>
  );
}

function ScoreTick({ text, show }) {
  if (!show) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: -10,
        right: 10,
        fontWeight: 950,
        fontSize: 14,
        color: "#16a34a",
        textShadow: "0 2px 10px rgba(22,163,74,0.25)",
        pointerEvents: "none",
        animation: "scoreTickFloat 650ms ease-out",
      }}
    >
      {text}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------
export default function HangmanDuelTask({ task, onSubmit, presenter, socket, roomCode, teamId, memberNames = [], practiceMode = false }) {
  // If `socket` + `roomCode` exist, we mirror state across devices (inter-team).
  // If not, this runs local/pass-and-play (intra-team).
  const socketObj = socket?.current || socket || null;
  // IMPORTANT: Do NOT auto-enable sockets just because a socket + roomCode exist.
  // In most classroom runs, TaskRunner provides these props for other tasks, but Hangman
  // should still behave as local/pass-and-play unless you explicitly opt in.
  // Opt-in flag: task.config.enableSockets === true
  const USE_SOCKETS = !!(socketObj && roomCode && task?.config?.enableSockets === true);
  const teamKey = String(teamId || "").trim();

  // ------------------------------
  // Word / stations / banks
  // ------------------------------
  const stationIdx = useMemo(() => {
    const n =
      Number.isInteger(task?.stationIndex) ? task.stationIndex :
      Number.isInteger(task?.stationIdIndex) ? task.stationIdIndex :
      0;
    return Math.max(0, n);
  }, [task]);

  const normalizeWord = (w) => String(w || "").trim().toUpperCase();

  const bankWords = useMemo(() => {
    const fromAi = task?.config?.aiWordBank;
    const fromConfig = task?.config?.wordBank || task?.config?.words || task?.words;
    const fromStations =
      task?.config?.wordsByStation?.map((x) => x?.word).filter(Boolean) ||
      task?.wordsByStation?.map((x) => x?.word).filter(Boolean) ||
      [];

    const flat = [];

    const addList = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const x of arr) {
        const ww = normalizeWord(x?.word ?? x);
        if (ww) flat.push(ww);
      }
    };

    addList(fromAi);
    addList(fromConfig);
    addList(fromStations);

    // de-dupe, keep order
    const seen = new Set();
    const out = [];
    for (const w of flat) {
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
    return out;
  }, [task]);

  const initialWord = useMemo(() => {
    const fromStations =
      task?.config?.wordsByStation?.[stationIdx]?.word ||
      task?.wordsByStation?.[stationIdx]?.word ||
      task?.config?.wordsByStation?.[0]?.word ||
      task?.wordsByStation?.[0]?.word ||
      "";

    const raw = normalizeWord(
      task?.word || task?.config?.word || fromStations || task?.hangmanWord || task?.data?.word || ""
    );

    // If the word is empty but we have a bank, pick from bank using stationIdx.
    if (!raw && bankWords.length) return bankWords[stationIdx % bankWords.length];

    return raw;
  }, [task, stationIdx, bankWords]);

  const [word, setWord] = useState(initialWord);

  useEffect(() => {
    setWord(initialWord);
  }, [initialWord]);

  const slots = useMemo(() => {
    if (!word) return [];
    return word.split("").map((ch, idx) => ({ idx, ch, isLetter: /^[A-Z]$/.test(ch) }));
  }, [word]);

  const requiredCounts = useMemo(() => {
    const counts = {};
    for (const s of slots) {
      if (!s.isLetter) continue;
      counts[s.ch] = (counts[s.ch] || 0) + 1;
    }
    return counts;
  }, [slots]);

  // ------------------------------
  // Players, teams, turn order
  // ------------------------------
  // Real names take precedence in this order:
  //   1. memberNames prop (live classroom roster)
  //   2. task.config.players[].name (AI-supplied)
  //   3. Practice-mode bogus names (so demo doesn't show "Player 1, 2, 3, 4")
  //   4. Generic "Player N"
  // Tester reported "show actual player (or in practice, bogus) names".
  const playerNames = useMemo(() => {
    const fromMembers = (Array.isArray(memberNames) ? memberNames : [])
      .map((n) => String(n || "").trim())
      .filter(Boolean);
    const fromConfig =
      (Array.isArray(task?.config?.players) && task.config.players.map((p) => p?.name).filter(Boolean)) ||
      (Array.isArray(task?.players) && task.players.map((p) => p?.name).filter(Boolean)) ||
      [];

    const count =
      (Number.isInteger(task?.config?.playerCount) && task.config.playerCount) ||
      Math.max(fromMembers.length, fromConfig.length, 2);

    // Take whichever has more real names; pad with practice bots
    // (only in practice mode) before falling through to "Player N".
    const PRACTICE_BOTS = ["Riley", "Quinn", "Avery", "Sam", "Jamie", "Morgan", "Casey", "Drew"];
    const seedSrc = String(task?.id || task?._id || task?.title || "hd");
    let h = 0;
    for (let i = 0; i < seedSrc.length; i += 1) h = (h * 31 + seedSrc.charCodeAt(i)) | 0;
    const botStart = Math.abs(h) % PRACTICE_BOTS.length;

    const names = (fromMembers.length ? fromMembers : fromConfig).slice(0, count);
    // Solo practice with no roster → seat the player (by name) first, then bots.
    if (practiceMode && names.length === 0) names.push(getPlayerName());
    while (names.length < count) {
      if (practiceMode) {
        const bi = (botStart + names.length) % PRACTICE_BOTS.length;
        names.push(`${PRACTICE_BOTS[bi]} (bot)`);
      } else {
        names.push(`Player ${names.length + 1}`);
      }
    }
    return names;
  }, [task, memberNames, practiceMode]);

  const playerCount = playerNames.length;

  const playerSideFor = (playerNum) => {
    const n = Number(playerNum) || 1;
    // 4 players => 1&2 left, 3&4 right
    if (playerCount === 4) return n <= 2 ? "left" : "right";
    // otherwise odd/even
    return n % 2 === 1 ? "left" : "right";
  };

  const turnOrderBase = useMemo(() => {
    if (playerCount === 4) return [1, 3, 2, 4];
    return Array.from({ length: playerCount }, (_, i) => i + 1);
  }, [playerCount]);

  const [eliminated, setEliminated] = useState([]); // player numbers
  const [currentTurn, setCurrentTurn] = useState(1);

  // Map server turn index (0-based) <-> local player number (1-based)
  const toPlayerNum = (serverIdx) => clamp((Number(serverIdx) || 0) + 1, 1, Math.max(1, playerCount));
  const toServerIdx = (playerNum) => clamp((Number(playerNum) || 1) - 1, 0, Math.max(0, playerCount - 1));

  const activeSide = playerSideFor(currentTurn);

  const currentPlayerName = useMemo(() => {
    const n = Number(currentTurn) || 1;
    const idx = clamp(n - 1, 0, playerNames.length - 1);
    return playerNames[idx] || `Player ${n}`;
  }, [currentTurn, playerNames]);

  const getNextTurn = (from) => {
    const cur = Number(from) || 1;
    const order = turnOrderBase;
    const startIdx = Math.max(0, order.indexOf(cur));
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = order[(startIdx + step) % order.length];
      if (!eliminated.includes(candidate)) return candidate;
    }
    return cur;
  };

  const advanceTurn = () => {
    setCurrentTurn((prev) => getNextTurn(prev));
  };

  // Subtle "pulse" for active team box on turn change
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    setPulseKey((k) => k + 1);
    // best-effort: your turn beep
    playBeep(activeSide === "left" ? 740 : 880, 80, 0.05);
  }, [currentTurn]);

  // ------------------------------
  // Letter pool (ONE shared pool)
  // ------------------------------
  const alphabet = useMemo(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), []);

  // ------------------------------
  // Round state
  // ------------------------------
  const [placed, setPlaced] = useState([]); // array of '_' or actual letters in correct positions
  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [scoreLeft, setScoreLeft] = useState(0);
  const [scoreRight, setScoreRight] = useState(0);

  // Tracks guessed letters that are NOT in the word.
  const [wrongLetters, setWrongLetters] = useState(() => ({})); // {A:true}

  // For correct letters, count how many occurrences are already revealed.
  const placedCounts = useMemo(() => {
    const counts = {};
    for (let i = 0; i < placed.length; i++) {
      const v = placed[i];
      if (v && v !== "_" && /^[A-Z]$/.test(v)) counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  }, [placed]);

  // Determine status + tick marks per letter
  const tileMeta = useMemo(() => {
    const out = {};
    for (const L of alphabet) {
      const need = requiredCounts[L] || 0;
      const used = placedCounts[L] || 0;
      const isWrong = !!wrongLetters[L];

      // Tick marks: show how many times this letter has been used.
      // Grey out ONLY when the letter is fully used up (all occurrences revealed).
      const ticks = isWrong ? 0 : used;
      const isFull = need > 0 && used >= need;

      let status = "unused";
      if (isWrong) status = "wrong";
      else if (isFull) status = "full";

      out[L] = {
        need,
        used,
        isWrong,
        isFull,
        status,
        badge:
          isWrong
            ? "×"
            : ticks <= 0
              ? ""
              : ticks >= 4
                ? "✓✓✓+"
                : "✓".repeat(ticks),
      };
    }
    return out;
  }, [alphabet, requiredCounts, placedCounts, wrongLetters]);

  const [gameStyle, setGameStyle] = useState(task?.style || "classic");

  // Timer (120 seconds default)
  const timeLimitSeconds = useMemo(() => {
    const n =
      (Number.isFinite(task?.config?.timeLimitSeconds) && task.config.timeLimitSeconds) ||
      (Number.isFinite(task?.timeLimitSeconds) && task.timeLimitSeconds) ||
      (Number.isFinite(task?.config?.totalSeconds) && task.config.totalSeconds) ||
      120;
    return clamp(n, 30, 600);
  }, [task]);

  // Countdown is optional. Default OFF (no '1-2-3-GO' each round).
  const countdownOnStart = !!(task?.config?.showCountdownOnStart);

  const [roundStarted, setRoundStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(timeLimitSeconds);

  // Round finish overlay
  const [roundResult, setRoundResult] = useState(null);
  // { kind:'lose'|'win', headline, detail, winnerPlayer, winnerSide, bonus }

  // Track turns taken for bonus scoring
  const [turnsTaken, setTurnsTaken] = useState(0);

  // Power-ups per player
  const [cards, setCards] = useState(() => {
    // Generator can provide counts like { reveal:1, steal:1, extra:1 }
    const defaults = { reveal: 1, steal: 1, extra: 1 };
    const fromCfg = task?.config?.powerUpsByPlayer;
    const by = {};
    for (let p = 1; p <= playerCount; p += 1) {
      const c = fromCfg?.[p] || fromCfg?.[String(p)] || task?.config?.powerUps || defaults;
      by[p] = {
        reveal: Number.isFinite(c?.reveal) ? c.reveal : defaults.reveal,
        steal: Number.isFinite(c?.steal) ? c.steal : defaults.steal,
        extra: Number.isFinite(c?.extra) ? c.extra : defaults.extra,
      };
    }
    return by;
  });

  // Extra guess shield for the current player
  const [extraShieldActive, setExtraShieldActive] = useState(() => ({})); // {playerNum:true}

  // "Steal" mode: allow current player to use one letter from another player's row this turn.
  const [stealActive, setStealActive] = useState(false);

  // Currently selected letter (tap-to-place mode on touch devices)
  const [selectedLetter, setSelectedLetter] = useState(null);

  // Drag state (used for tray highlight)
  const [dragging, setDragging] = useState(false);

  // Bonus + score tick UI
  const [bonusPulse, setBonusPulse] = useState(false);
  const [scoreTick, setScoreTick] = useState({ showLeft: false, showRight: false, textLeft: "", textRight: "" });

  const canAct = !roundResult && !eliminated.includes(currentTurn);


  // Sensors
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Reset round when word changes
  useEffect(() => {
    if (!slots.length) {
      setPlaced([]);
      return;
    }
    setPlaced(slots.map((s) => (s.isLetter ? "_" : s.ch)));
    setWrongGuesses(0);
    setWrongLetters({});
    setEliminated([]);
    setCurrentTurn(1);
    setRoundStarted(false);
    setTimeLeft(timeLimitSeconds);
    setRoundResult(null);
    setTurnsTaken(0);
    setSelectedLetter(null);
    setStealActive(false);
    setExtraShieldActive({});
  }, [word, slots, timeLimitSeconds]);

  // ------------------------------------------------
  // Socket sync (inter-team)
  // ------------------------------------------------
  const applyServerPatch = (patch = {}) => {
    if (!patch || typeof patch !== "object") return;

    if (patch.word) {
      const w = normalizeWord(patch.word);
      if (w && w !== word) setWord(w);
    }
    if (Array.isArray(patch.blanks)) {
      // Server sends blanks with punctuation already visible.
      setPlaced(patch.blanks.map((ch) => (ch === "" ? "_" : ch)));
    }
    if (Number.isFinite(patch.wrongGuesses)) setWrongGuesses(clamp(patch.wrongGuesses, 0, MAX_WRONG));
    if (patch.style) setGameStyle(String(patch.style));

    // Turn + eliminated are server-indexed (0-based / booleans)
    if (Number.isFinite(patch.currentTurn)) setCurrentTurn(toPlayerNum(patch.currentTurn));
    if (Array.isArray(patch.eliminated)) {
      const elimNums = [];
      for (let i = 0; i < patch.eliminated.length; i += 1) {
        if (patch.eliminated[i]) elimNums.push(i + 1);
      }
      setEliminated(elimNums);
    }

    // If server tells us the word is solved, we trigger a local win overlay.
    if (Array.isArray(patch.blanks) && patch.blanks.length && patch.blanks.every((x) => x !== "_" && x !== "")) {
      // Winner is "who moved last" isn't tracked server-side; we keep it simple.
      setTimeout(() => {
        setPlaced((prev) => {
          if (!prev) return prev;
          if (isWordComplete(prev)) {
            finishWin({ winnerPlayer: currentTurn, headline: "Word solved!", detail: "Nice teamwork." });
          }
          return prev;
        });
      }, 0);
    }
  };

  useEffect(() => {
    if (!USE_SOCKETS || !socketObj || !roomCode || !teamKey) return;

    const onPatch = (patch) => applyServerPatch(patch);
    socketObj.on?.("hangman-update", onPatch);

    // Ask server for the current state as soon as we mount.
    try {
      socketObj.emit?.("hangman-get-state", { roomCode, teamId: teamKey }, (resp) => {
        if (resp?.ok && resp?.state) applyServerPatch(resp.state);
      });
    } catch {}

    return () => {
      try {
        socketObj.off?.("hangman-update", onPatch);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [USE_SOCKETS, socketObj, roomCode, teamKey]);

  // Timer countdown
  useEffect(() => {
    if (!roundStarted) return;
    if (roundResult) return;
    if (timeLeft <= 0) return;

    const id = setInterval(() => {
      setTimeLeft((t) => {
        const next = Math.max(0, (Number(t) || 0) - 1);
        // last 5 seconds beep
        if (next > 0 && next <= 5) playBeep(660, 80, 0.05);
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [roundStarted, timeLeft, roundResult]);

  // Time over => both lose
  useEffect(() => {
    if (!roundStarted) return;
    if (roundResult) return;
    if (timeLeft !== 0) return;
    finishBothLose("Time is up!");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, roundStarted, roundResult]);

  // If fully built => both lose
  useEffect(() => {
    if (roundResult) return;
    if (wrongGuesses >= MAX_WRONG) {
      finishBothLose("Hung! The build is complete.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrongGuesses, roundResult]);

  const startRoundIfNeeded = async () => {
    if (roundStarted) return;
    setRoundStarted(true);

    // Optional: one-time round-start countdown (OFF by default).
    // Note: This should NOT run after every letter drop.
    if (!countdownOnStart) return;

    // Show standard 1-2-3 countdown if TaskRunner injected presenter.
    if (presenter?.showCountdown && typeof presenter.showCountdown === "function") {
      try {
        await presenter.showCountdown({ title: "Hangman Duel", seconds: 3, subtext: "1-2-3 GO!" });
      } catch {}
    } else {
      // Local fallback beep sequence
      playBeep(440, 80, 0.05);
      setTimeout(() => playBeep(520, 80, 0.05), 350);
      setTimeout(() => playBeep(660, 120, 0.06), 700);
    }
  };

  const finishBothLose = (reason) => {
    // participation points
    setScoreLeft((n) => (Number(n) || 0) + 1);
    setScoreRight((n) => (Number(n) || 0) + 1);

    setRoundResult({
      kind: "lose",
      headline: "Both teams lose!",
      detail: reason || "Hung!",
      winnerPlayer: null,
      winnerSide: null,
      bonus: 0,
    });
  };

  const finishWin = ({ winnerPlayer, headline = "Winner!", detail = "" }) => {
    const side = playerSideFor(winnerPlayer);

    // participation points
    setScoreLeft((n) => (Number(n) || 0) + 1);
    setScoreRight((n) => (Number(n) || 0) + 1);

    // bonus based on how few turns
    const turns = Math.max(1, Number(turnsTaken) || 1);
    const bonus = clamp(10 - turns, 2, 8); // fewer turns => bigger bonus

    if (side === "left") setScoreLeft((n) => (Number(n) || 0) + bonus);
    else setScoreRight((n) => (Number(n) || 0) + bonus);

    setRoundResult({
      kind: "win",
      headline,
      detail,
      winnerPlayer,
      winnerSide: side,
      bonus,
    });
  };

  const isWordComplete = (arr) => {
    for (let i = 0; i < slots.length; i += 1) {
      if (!slots[i]?.isLetter) continue;
      if (!arr[i] || arr[i] === "_") return false;
    }
    return true;
  };

  const fillLetterOccurrences = (L) => {
    // Fill all occurrences (classic hangman reveal). No need to place precisely.
    setPlaced((prev) => {
      const next = [...(prev || [])];
      for (let i = 0; i < slots.length; i += 1) {
        if (!slots[i]?.isLetter) continue;
        if (slots[i].ch !== L) continue;
        next[i] = L;
      }
      return next;
    });
  };

  const fillLetterFirstEmpty = (L) => {
    // Used for precise drop onto a specific slot, or if you ever change to single placement.
    let filledIndex = null;
    setPlaced((prev) => {
      const next = [...(prev || [])];
      for (let i = 0; i < slots.length; i += 1) {
        if (!slots[i]?.isLetter) continue;
        if (slots[i].ch !== L) continue;
        if (next[i] && next[i] !== "_") continue;
        next[i] = L;
        filledIndex = i;
        break;
      }
      return next;
    });
    return filledIndex;
  };

  const addPointForPlayer = (playerNum, points) => {
    const side = playerSideFor(playerNum);
    const delta = Number(points) || 0;
    if (delta === 0) return;

    const tickText = delta > 0 ? `+${delta}` : `${delta}`;

    if (side === "left") {
      setScoreLeft((n) => (Number(n) || 0) + delta);
      setScoreTick({ showLeft: true, showRight: false, textLeft: tickText, textRight: "" });
      setTimeout(() => {
        setScoreTick((prev) => ({ ...(prev || {}), showLeft: false }));
      }, 700);
    } else {
      setScoreRight((n) => (Number(n) || 0) + delta);
      setScoreTick({ showLeft: false, showRight: true, textLeft: "", textRight: tickText });
      setTimeout(() => {
        setScoreTick((prev) => ({ ...(prev || {}), showRight: false }));
      }, 700);
    }
    // Tiny "tick" sound when points are awarded.
    playBeep(660, 60, 0.04);
  };

  const markWrongLetter = (L) => {
    setWrongLetters((prev) => ({ ...(prev || {}), [L]: true }));
  };

  const handleCorrectLetter = (L, preciseBonus = 0) => {
    // Correct letter locks in + score
    fillLetterOccurrences(L);

    // 1 point for correct letter
    addPointForPlayer(currentTurn, 1);

    if (preciseBonus > 0) {
      addPointForPlayer(currentTurn, preciseBonus);
      // Bonus cue: subtle pulse + small chime
      setBonusPulse(true);
      playBonusChime();
      setTimeout(() => setBonusPulse(false), 520);
    } else {
      // small correct beep
      playBeep(880, 80, 0.05);
    }

    // check win after update flush
    setTimeout(() => {
      setPlaced((prev) => {
        if (!prev) return prev;
        if (isWordComplete(prev)) {
          finishWin({ winnerPlayer: currentTurn, headline: `${currentPlayerName} wins!`, detail: `Bonus +${clamp(10 - Math.max(1, turnsTaken || 1), 2, 8)} for speed.` });
        }
        return prev;
      });
    }, 0);
  };

  const handleWrongLetter = (L) => {
    markWrongLetter(L);
    setWrongGuesses((w) => clamp((Number(w) || 0) + 1, 0, MAX_WRONG));
    // wrong beep
    playBeep(220, 120, 0.05);
  };

  const registerMove = () => {
    setTurnsTaken((t) => (Number(t) || 0) + 1);
    // In socket mode, the server advances the turn and broadcasts it back.
    if (!USE_SOCKETS) {
      advanceTurn();
    }
    setSelectedLetter(null);
    setStealActive(false);
  };

  const doLetterGuess = async (letter, { precise = false } = {}) => {
    if (!canAct) return;
    const L = safeUpperLetter(letter);
    if (!L) return;

    await startRoundIfNeeded();

    // Socket-driven mode (inter-team): server is the source of truth.
    if (USE_SOCKETS && socketObj && roomCode && teamKey) {
      try {
        socketObj.emit(
          "hangman-place-letter",
          { roomCode, teamId: teamKey, letter: L },
          () => {}
        );
      } catch {}

      // We still keep the local turn/bonus UI snappy.
      if (precise) addPointForPlayer(currentTurn, 1);
      registerMove();
      return;
    }

    // Local mode (intra-team)
    if (wrongLetters[L]) return; // already known wrong

    if (!requiredCounts[L]) {
      handleWrongLetter(L);
      registerMove();
      return;
    }

    const bonus = precise ? 1 : 0;
    handleCorrectLetter(L, bonus);
    registerMove();
  };

  const eliminatePlayer = (playerNum) => {
    const n = Number(playerNum) || 1;
    setEliminated((prev) => {
      if ((prev || []).includes(n)) return prev;
      return [...(prev || []), n];
    });

    // If everyone eliminated, both lose.
    setTimeout(() => {
      setEliminated((prev) => {
        const alive = turnOrderBase.filter((p) => !(prev || []).includes(p));
        if (alive.length <= 0) {
          finishBothLose("Everyone was eliminated.");
        }
        return prev;
      });
    }, 0);
  };

  const [wordGuessOpen, setWordGuessOpen] = useState(false);
  const [wordGuessText, setWordGuessText] = useState("");

  const submitWordGuess = async () => {
    if (!canAct) return;
    await startRoundIfNeeded();

    const guess = normalizeWord(wordGuessText);
    setWordGuessOpen(false);
    setWordGuessText("");

    if (!guess) return;

    // Socket-driven mode: delegate to server.
    if (USE_SOCKETS && socketObj && roomCode && teamKey) {
      try {
        socketObj.emit("hangman-guess-word", { roomCode, teamId: teamKey, guess }, () => {});
      } catch {}
      registerMove();
      return;
    }

    if (guess === word) {
      // instant win
      finishWin({ winnerPlayer: currentTurn, headline: `${currentPlayerName} guessed the word!`, detail: `Big win! Bonus for speed still applies.` });
      return;
    }

    // Wrong full-word guess
    const hasShield = !!extraShieldActive[currentTurn];
    if (hasShield) {
      // Shield used up, no elimination
      setExtraShieldActive((prev) => ({ ...(prev || {}), [currentTurn]: false }));
      // Still counts as a move and adds a wrong body part (risk)
      setWrongGuesses((w) => clamp((Number(w) || 0) + 1, 0, MAX_WRONG));
      registerMove();
      return;
    }

    // eliminated
    eliminatePlayer(currentTurn);
    // also add a wrong part (risk)
    setWrongGuesses((w) => clamp((Number(w) || 0) + 1, 0, MAX_WRONG));

    // move on
    registerMove();
  };

  // Cards
  const useCard = async (kind) => {
    if (!canAct) return;
    const cur = currentTurn;
    const have = cards?.[cur]?.[kind] || 0;
    if (have <= 0) return;

    await startRoundIfNeeded();

    if (kind === "reveal") {
      // Reveal a random missing letter and lock it in.
      const missing = [];
      for (let i = 0; i < slots.length; i += 1) {
        if (!slots[i]?.isLetter) continue;
        if (placed[i] && placed[i] !== "_") continue;
        missing.push(slots[i].ch);
      }
      if (!missing.length) return;
      const L = missing[Math.floor(Math.random() * missing.length)];
      handleCorrectLetter(L, 0);
      setCards((prev) => ({
        ...(prev || {}),
        [cur]: { ...(prev?.[cur] || {}), reveal: Math.max(0, have - 1) },
      }));
      registerMove();
      return;
    }

    if (kind === "extra") {
      // Next wrong word guess is safe (no elimination)
      setExtraShieldActive((prev) => ({ ...(prev || {}), [cur]: true }));
      setCards((prev) => ({
        ...(prev || {}),
        [cur]: { ...(prev?.[cur] || {}), extra: Math.max(0, have - 1) },
      }));
      playBeep(990, 80, 0.05);
      return;
    }

    if (kind === "steal") {
      // This turn: you can use ANY letter (from any row) one time.
      setStealActive(true);
      setCards((prev) => ({
        ...(prev || {}),
        [cur]: { ...(prev?.[cur] || {}), steal: Math.max(0, have - 1) },
      }));
      playBeep(560, 80, 0.05);
      return;
    }
  };

  // DnD
  const handleDragEnd = async (event) => {
    if (!canAct) return;

    const { active, over } = event;
    if (!over) return;

    const activeId = String(active?.id || "");
    if (!activeId.startsWith("L:")) return;

    const L = safeUpperLetter(activeId.slice(2));
    if (!L) return;

    // One shared pool: only the current player can act (enforced by canAct + UI disabling).
    // Steal is still allowed as a power-up, but in shared-pool mode it does not change which letters exist.

    const overId = String(over?.id || "");

    // Dropping anywhere (tray or anywhere else) guesses the letter
    if (overId === "TRAY") {
      await doLetterGuess(L, { precise: false });
      return;
    }
  };

  // Rematch with new word
  const pickNewWord = () => {
    const options = bankWords.filter(Boolean);
    if (!options.length) return word; // nothing else
    if (options.length === 1) return options[0];

    // pick a different one
    const cur = word;
    const pool = options.filter((w) => w !== cur);
    if (!pool.length) return options[(Math.floor(Math.random() * options.length) + 1) % options.length];
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const handleRematch = () => {
    // Tester: 'rematch not work'.  Root cause: when the word bank
    // had only one word (or pickNewWord returned the same word) the
    // setWord() call didn't change state, so the [word, slots,
    // timeLimitSeconds] reset effect never re-ran — eliminated
    // players, wrong-counts and guessed letters all carried over.
    // Now we ALSO force-reset every round-scoped state explicitly
    // so a rematch is a clean slate even on a single-word bank.
    setRoundResult(null);
    const next = pickNewWord();
    setWord(next);
    // Explicit per-round reset (mirrors the effect at lines ~730-746):
    setWrongGuesses(0);
    setWrongLetters({});
    setEliminated([]);
    setCurrentTurn(1);
    setRoundStarted(false);
    setTimeLeft(timeLimitSeconds);
    setTurnsTaken(0);
    setSelectedLetter(null);
    setStealActive(false);
    setExtraShieldActive({});
    // Slots / placed will follow when `word` changes via the existing
    // effect; if the word is identical, force a re-blank here.
    if (next === word) {
      setPlaced(slots.map((s) => (s.isLetter ? "_" : s.ch)));
    }
  };

  // Submit to TaskRunner
  const handleFinishTask = () => {
    setRoundResult(null);
    if (typeof onSubmit === "function") {
      onSubmit({
        answer: "hangman-complete",
        autoComplete: true,
      });
    }
  };

  if (!word) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Hangman Duel</h2>
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "#fee2e2" }}>
          <div style={{ fontWeight: 900 }}>Hangman error:</div>
          <div>No word provided for this task.</div>
        </div>
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(task, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, textAlign: "center" }}>
      <style>{`
        @keyframes teamPulse {
          0% { transform: scale(1); box-shadow: 0 10px 24px rgba(0,0,0,0.06); }
          50% { transform: scale(1.01); box-shadow: 0 0 0 4px rgba(34,197,94,0.20); }
          100% { transform: scale(1); box-shadow: 0 10px 24px rgba(0,0,0,0.06); }
        }
        @keyframes arrowBob {
          0% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
          100% { transform: translateY(0); }
        }
        @keyframes scoreTickFloat {
          0% { opacity: 0; transform: translateY(6px) scale(0.98); }
          20% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-14px) scale(1.02); }
        }
        @keyframes bonusPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.01); }
          100% { transform: scale(1); }
        }
      `}</style>

      <h2 style={{ margin: 0 }}>Hangman Duel</h2>

      {/* Style picker */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0 10px", flexWrap: "wrap" }}>
        {[
          { k: "classic", label: "Classic" },
          { k: "snowman", label: "Snowman" },
          { k: "tree", label: "Tree" },
          { k: "gingerbread", label: "Gingerbread" },
        ].map((x) => (
          <button
            key={x.k}
            onClick={() => setGameStyle(x.k)}
            disabled={roundStarted}
            style={{
              padding: "8px 14px",
              borderRadius: 12,
              border: "2px solid rgba(0,0,0,0.2)",
              fontWeight: 900,
              background: gameStyle === x.k ? "#111827" : "#fff",
              color: gameStyle === x.k ? "#fff" : "#111827",
              cursor: roundStarted ? "not-allowed" : "pointer",
              opacity: roundStarted ? 0.6 : 1,
            }}
            title={roundStarted ? "Style is locked once the round starts." : ""}
          >
            {x.label}
          </button>
        ))}
      </div>

      {/* Build drawing */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}
        dangerouslySetInnerHTML={{ __html: HangmanSVG({ style: gameStyle, parts: wrongGuesses }) }}
      />

      {/* Turn-prompt banner — colour-tinted to the active team
          (green = left, blue = right) and updates per turn so the
          right player knows they're up.  Tester wanted a clearer
          "whose turn is it" cue + a team-coloured letter box. */}
      <div
        style={{
          marginTop: 10,
          padding: "10px 14px",
          borderRadius: 14,
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
          background:
            activeSide === "left"
              ? "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.05))"
              : "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(59,130,246,0.05))",
          border: `2px solid ${activeSide === "left" ? "rgba(34,197,94,0.85)" : "rgba(59,130,246,0.85)"}`,
          textAlign: "center",
          fontWeight: 900,
          fontSize: 18,
          color: "#0f172a",
          transition: "all 180ms ease",
        }}
      >
        <span style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", opacity: 0.7, fontWeight: 800 }}>
          {activeSide === "left" ? "🟢 Left side's turn" : "🔵 Right side's turn"}
        </span>
        <div style={{ marginTop: 4, fontSize: 20 }}>
          📲 Pass to <span style={{ textDecoration: "underline" }}>{currentPlayerName}</span>
          {eliminated.includes(currentTurn) ? " (Eliminated)" : ""}
        </div>
      </div>

      <div style={{ marginTop: 6, fontSize: 14, opacity: 0.8 }}>
        Time left: <span style={{ fontWeight: 900 }}>{timeLeft}s</span> • Wrong guesses: <span style={{ fontWeight: 900 }}>{wrongGuesses}/{MAX_WRONG}</span>
      </div>

      {/* Team boxes with active indicator */}
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          alignItems: "stretch",
          maxWidth: 900,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <div
          style={{
            padding: 12,
            borderRadius: 16,
            background: activeSide === "left" ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.70)",
            border: activeSide === "left" ? "2px solid rgba(34,197,94,0.95)" : "1px solid rgba(34,197,94,0.25)",
            boxShadow: activeSide === "left" ? "0 0 0 3px rgba(34,197,94,0.25)" : "0 10px 24px rgba(0,0,0,0.06)",
            textAlign: "left",
            transition: "all 180ms ease",
            position: "relative",
            animation: activeSide === "left" ? `teamPulse 520ms ease` : "none",
          }}
          key={`left-${pulseKey}-${activeSide === "left" ? "on" : "off"}`}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900, opacity: 0.95 }}>Left Team</div>
            {activeSide === "left" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, background: "rgba(34,197,94,0.22)", padding: "4px 8px", borderRadius: 999 }}>
                  YOUR TURN
                </div>
                <div style={{ fontSize: 18, animation: "arrowBob 900ms ease-in-out infinite" }}>⬇️</div>
              </div>
            ) : null}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
            {playerCount === 4 ? `${playerNames[0]} + ${playerNames[1]}` : "Players 1, 3, 5…"}
          </div>
          <TallyMarks count={scoreLeft} label="Left team score" />
          <ScoreTick show={!!scoreTick?.showLeft} text={scoreTick?.textLeft || "+1"} />
        </div>

        <div
          style={{
            padding: 12,
            borderRadius: 16,
            background: activeSide === "right" ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.70)",
            border: activeSide === "right" ? "2px solid rgba(34,197,94,0.95)" : "1px solid rgba(59,130,246,0.25)",
            boxShadow: activeSide === "right" ? "0 0 0 3px rgba(34,197,94,0.25)" : "0 10px 24px rgba(0,0,0,0.06)",
            textAlign: "left",
            transition: "all 180ms ease",
            position: "relative",
            animation: activeSide === "right" ? `teamPulse 520ms ease` : "none",
          }}
          key={`right-${pulseKey}-${activeSide === "right" ? "on" : "off"}`}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900, opacity: 0.95 }}>Right Team</div>
            {activeSide === "right" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, background: "rgba(34,197,94,0.22)", padding: "4px 8px", borderRadius: 999 }}>
                  YOUR TURN
                </div>
                <div style={{ fontSize: 18, animation: "arrowBob 900ms ease-in-out infinite" }}>⬇️</div>
              </div>
            ) : null}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
            {playerCount === 4 ? `${playerNames[2]} + ${playerNames[3]}` : "Players 2, 4, 6…"}
          </div>
          <TallyMarks count={scoreRight} label="Right team score" />
          <ScoreTick show={!!scoreTick?.showRight} text={scoreTick?.textRight || "+1"} />
        </div>
      </div>

      <TaskInstructions
        label="How to play (easy drops)"
        style={{ marginTop: 14, maxWidth: 900, marginLeft: "auto", marginRight: "auto" }}
        steps={[
          <>Look at the <b>Shared Letter Pool</b>.</>,
          "When it is your turn, drag any letter into the big tray (you can drop anywhere).",
          "If the letter is in the word, it fills the right blank(s) and you score.",
          "If it is not in the word, one part is added.",
          "Bonus: if you drop a letter on the exact correct blank, you get an extra point.",
        ]}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={(evt) => {
          setDragging(false);
          handleDragEnd(evt);
        }}
      >
        {/* Slots tray */}
        <div style={{ marginTop: 14 }}>
          <DroppableTray id="TRAY" canAct={canAct} dragActive={!!dragging} bonusPulse={!!bonusPulse} label="DROP LETTERS HERE">
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap" }}>
              {slots.map((s, i) => {
                if (!s.isLetter) {
                  return (
                    <div
                      key={`sp-${i}`}
                      style={{
                        width: TILE_W,
                        height: TILE_H,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: 6,
                        fontSize: 28,
                        fontWeight: 900,
                        opacity: 0.65,
                      }}
                    >
                      {s.ch}
                    </div>
                  );
                }

                const filled = !!(placed[i] && placed[i] !== "_");

                return (
                  <div
                    key={`slot-${i}`}
                    style={{
                      width: TILE_W,
                      height: TILE_H,
                      borderRadius: RADIUS,
                      border: "3px solid #111827",
                      background: filled ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.90)",
                      color: filled ? "#16a34a" : "#111827",
                      fontWeight: 900,
                      fontSize: 28,
                      userSelect: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: 6,
                      boxShadow: "none",
                      transition: "background 120ms ease, border 120ms ease",
                    }}
                  >
                    {filled ? placed[i] : "_"}
                  </div>
                );
              })}
            </div>
          </DroppableTray>
        </div>

        {/* Cards + Word Guess */}
        <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setWordGuessOpen(true)}
            disabled={!canAct}
            style={{
              padding: "12px 20px",
              borderRadius: 14,
              border: "3px solid #dc2626",
              fontWeight: 950,
              fontSize: 14,
              background: canAct ? "linear-gradient(135deg, #dc2626, #991b1b)" : "#9ca3af",
              color: "#fff",
              cursor: canAct ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              boxShadow: canAct ? "0 4px 15px rgba(220, 38, 38, 0.3)" : "none",
              transition: "all 150ms ease",
            }}
          >
            WINNER TAKES ALL
          </button>

          <button
            onClick={() => useCard("reveal")}
            disabled={!canAct || (cards?.[currentTurn]?.reveal || 0) <= 0}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "2px solid rgba(0,0,0,0.18)",
              fontWeight: 900,
              background: "#fff",
              cursor: canAct ? "pointer" : "not-allowed",
              opacity: (cards?.[currentTurn]?.reveal || 0) > 0 ? 1 : 0.45,
            }}
            title="Reveal Letter: auto-fills one correct letter"
          >
            Reveal ({cards?.[currentTurn]?.reveal || 0})
          </button>

          <button
            onClick={() => useCard("extra")}
            disabled={!canAct || (cards?.[currentTurn]?.extra || 0) <= 0}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "2px solid rgba(0,0,0,0.18)",
              fontWeight: 900,
              background: extraShieldActive[currentTurn] ? "#fde68a" : "#fff",
              cursor: canAct ? "pointer" : "not-allowed",
              opacity: (cards?.[currentTurn]?.extra || 0) > 0 ? 1 : 0.45,
            }}
            title="Extra Guess: your next wrong full-word guess does not eliminate you"
          >
            Extra Guess ({cards?.[currentTurn]?.extra || 0})
          </button>

          <button
            onClick={() => useCard("steal")}
            disabled={!canAct || (cards?.[currentTurn]?.steal || 0) <= 0}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "2px solid rgba(0,0,0,0.18)",
              fontWeight: 900,
              background: stealActive ? "#bfdbfe" : "#fff",
              cursor: canAct ? "pointer" : "not-allowed",
              opacity: (cards?.[currentTurn]?.steal || 0) > 0 ? 1 : 0.45,
            }}
            title="Steal Letter: this turn you can use any letter"
          >
            Steal ({cards?.[currentTurn]?.steal || 0})
          </button>
        </div>

        {/* Shared letter pool (ONE pool for everyone) */}
        <div style={{ marginTop: 14, maxWidth: 1020, marginLeft: "auto", marginRight: "auto" }}>
          <div
            style={{
              padding: 12,
              borderRadius: 16,
              border: "1px solid rgba(0,0,0,0.10)",
              background: "rgba(255,255,255,0.60)",
              boxShadow: "0 8px 18px rgba(0,0,0,0.05)",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 950 }}>
                Shared Letter Pool
                <span style={{ marginLeft: 8, opacity: 0.75, fontWeight: 800 }}>(Only {playerNames[currentTurn - 1]} can play right now.)</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
                Tap or drag a letter to guess it.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", marginTop: 10 }}>
              {alphabet.map((L) => {
                const meta = tileMeta[L];
                const need = meta?.need || 0;
                const used = meta?.used || 0;
                const isWrong = meta?.isWrong;
                const isFull = meta?.isFull;

                const disabled =
                  !canAct ||
                  eliminated.includes(currentTurn) ||
                  (isWrong ? true : isFull ? true : false);

                const badge = meta?.badge || "";
                const status = meta?.status || "unused";

                const visual = (() => {
                  // Wrong letters should look "used up" (greyed out), not like an error banner.
                  // We still show a small × so students can see it has been tried.
                  if (isWrong) return { bg: "#e5e7eb", border: "#9ca3af", badge };
                  if (need > 0 && used > 0 && !isFull) return { bg: "#e5e7eb", border: "#9ca3af", badge };
                  if (isFull) return { bg: "#e5e7eb", border: "#9ca3af", badge };
                  return { bg: "#ffffff", border: "rgba(0,0,0,0.18)", badge };
                })();

                const title = isWrong
                  ? "Tried already (not in the word)"
                  : need <= 0
                    ? "Unused"
                    : isFull
                      ? "All done (all occurrences filled)"
                      : used > 0
                        ? "Used once (still usable if there are doubles)"
                        : "Unused";

                return (
                  <DraggableLetter
                    key={`POOL-${L}`}
                    id={`L:${L}`}
                    letter={L}
                    disabled={disabled}
                    status={status}
                    selected={false}
                    visual={visual}
                    title={title}
                    onClick={() => {
                      if (!canAct) return;
                      if (disabled) return;
                      // Tapping a letter immediately guesses it (don't just select)
                      doLetterGuess(L, { precise: false });
                    }}
                  />
                );
              })}
            </div>

            {stealActive ? (
              <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: "#2563eb" }}>
                Steal is active: this turn you can use any letter.
              </div>
            ) : null}
          </div>
        </div>

      </DndContext>

      {/* Full-word guess modal */}
      {wordGuessOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div style={{ width: "min(520px, 96vw)", background: "#fff", borderRadius: 18, padding: 16, textAlign: "left" }}>
            <div style={{ fontWeight: 950, fontSize: 18, color: "#dc2626" }}>WINNER TAKES ALL</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
              Guess the entire word. If correct, you win immediately with a big bonus. If wrong, you are <b>eliminated</b> (unless Extra Guess is active).
            </div>

            <input
              value={wordGuessText}
              onChange={(e) => setWordGuessText(e.target.value)}
              placeholder="Type your guess"
              style={{
                width: "100%",
                boxSizing: "border-box",
                marginTop: 10,
                padding: "12px 12px",
                borderRadius: 12,
                border: "2px solid rgba(0,0,0,0.15)",
                fontSize: 16,
                fontWeight: 800,
                textTransform: "uppercase",
                background: "#fff",
                color: "#0f172a",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
              <button
                onClick={() => {
                  setWordGuessOpen(false);
                  setWordGuessText("");
                }}
                style={{ padding: "10px 12px", borderRadius: 12, border: "2px solid rgba(0,0,0,0.15)", fontWeight: 900, background: "#fff" }}
              >
                Cancel
              </button>
              <button
                onClick={submitWordGuess}
                style={{
                  padding: "12px 20px",
                  borderRadius: 12,
                  border: "3px solid #dc2626",
                  fontWeight: 950,
                  background: "linear-gradient(135deg, #dc2626, #991b1b)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                GO FOR IT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Round result overlay */}
      {roundResult && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 1100,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            textAlign: "center",
            padding: 20,
          }}
        >
          <div style={{ fontSize: "3rem", fontWeight: 950, marginBottom: 12 }}>{roundResult.headline}</div>
          <div style={{ fontSize: "1.2rem", opacity: 0.92, maxWidth: 800 }}>{roundResult.detail}</div>

          {roundResult.kind === "win" ? (
            <div style={{ marginTop: 14, fontSize: "1.1rem" }}>
              Speed bonus: <b>+{roundResult.bonus}</b>
            </div>
          ) : null}

          <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={handleRematch}
              style={{
                padding: "12px 16px",
                borderRadius: 14,
                border: "2px solid rgba(255,255,255,0.25)",
                fontWeight: 900,
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Rematch (New Word)
            </button>
            <button
              onClick={handleFinishTask}
              style={{
                padding: "12px 16px",
                borderRadius: 14,
                border: "2px solid rgba(255,255,255,0.25)",
                fontWeight: 900,
                background: "rgba(255,255,255,0.18)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Next Task
            </button>
          </div>

          {roundResult.kind !== "win" && (
            <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
              Note: The losing word is not revealed.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        Local mode: pass the device on each turn. (Sockets are currently off in this file.)
        {USE_SOCKETS ? "" : ""}
      </div>
    </div>
  );
}
