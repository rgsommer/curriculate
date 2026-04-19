// student-app/src/components/tasks/types/MindMapperTask.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ORGANIZERS = {
  "mind-map": { name: "Mind Map", center: true },
  hierarchy: { name: "Hierarchy Tree", levels: 3 },
  fishbone: { name: "Fishbone Diagram", causes: 4 },
  flowchart: { name: "Flow Chart", steps: true },
  venn: { name: "Venn Diagram", circles: 3 },
  web: { name: "Concept Web", connections: true },
};


function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

function extractListFromText(text) {
  const t = String(text || "");
  // Try to pull bullet-ish lines: "- item", "• item", "1) item", "1. item"
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    const m = l.match(/^(\-|\•|\*|\d+[\.\)])\s+(.*)$/);
    if (m && m[2]) out.push(m[2].trim());
  }
  // Also support comma-separated quick lists if we got nothing.
  if (out.length === 0 && t.includes(",") && t.length < 260) {
    t.split(",").map(s=>s.trim()).filter(Boolean).forEach(s=>out.push(s));
  }
  return out;
}

function inferIdeas(task) {
  const t = task || {};
  const cfg = (t?.config && typeof t.config === "object") ? t.config : {};

  // "mustHave" treatment: accept many aliases from AI + older generators.
  const candidates =
    safeArray(cfg.mustHave)
      .concat(safeArray(t.mustHave))
      .concat(safeArray(cfg.concepts))
      .concat(safeArray(t.concepts))
      .concat(safeArray(cfg.ideas))
      .concat(safeArray(t.ideas))
      .concat(safeArray(cfg.ideaCards))
      .concat(safeArray(t.ideaCards))
      .concat(safeArray(cfg.cards))
      .concat(safeArray(t.cards))
      .concat(safeArray(cfg.items))
      .concat(safeArray(t.items))
      .concat(safeArray(cfg.options))
      .concat(safeArray(t.options))
      .concat(safeArray(cfg.wordBank))
      .concat(safeArray(t.wordBank));

  const normalized = [];

  const pushOne = (v) => {
    const s = String(v ?? "").trim();
    if (!s) return;
    normalized.push(s);
  };

  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === "string") {
      pushOne(c);
      continue;
    }
    if (typeof c === "object") {
      pushOne(c.text ?? c.label ?? c.prompt ?? c.name ?? c.term ?? c.concept ?? c.idea);
    }
  }

  // prompt fallback (some generators put the list into the prompt)
  if (normalized.length === 0) {
    const fromPrompt = extractListFromText(t.prompt || cfg.prompt || "");
    fromPrompt.forEach(pushOne);
  }

  // de-dupe, keep order
  const seen = new Set();
  const deduped = normalized.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped;
}

function normalizeAndShuffleItems(task) {
  const t = task || {};

  // Preferred: task.shuffledItems (already randomized from backend/editor)
  if (Array.isArray(t.shuffledItems) && t.shuffledItems.length > 0) {
    return t.shuffledItems.map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `item-${index}`,
          text: item,
          correctIndex: index,
        };
      }
      return {
        id: item.id ?? `item-${index}`,
        text:
          item.text ??
          item.label ??
          item.prompt ??
          item.name ??
          item.term ??
          item.concept ??
          `Idea ${index + 1}`,
        correctIndex:
          typeof item.correctIndex === "number" ? item.correctIndex : index,
      };
    });
  }

  // Must-have treatment: try to infer ideas from many shapes (cfg.mustHave, cards, concepts, prompt bullets, etc.)
  const ideaList = inferIdeas(t);

  // Fallback: use task.items or task.options as the source (legacy)
  const baseItems =
    (ideaList.length > 0 && ideaList) ||
    (Array.isArray(t.items) && t.items.length > 0 && t.items) ||
    (Array.isArray(t.options) && t.options.length > 0 && t.options) ||
    [];

  const normalized = baseItems.map((item, index) => {
    if (typeof item === "string") {
      return { id: `item-${index}`, text: item, correctIndex: index };
    }
    return {
      id: item.id ?? `item-${index}`,
      text:
        item.text ??
        item.label ??
        item.prompt ??
        item.name ??
        item.term ??
        item.concept ??
        `Idea ${index + 1}`,
      correctIndex:
        typeof item.correctIndex === "number" ? item.correctIndex : index,
    };
  });

  // If still empty, create a safe placeholder set (prevents the "No concept cards" dead-end in demos)
  if (normalized.length === 0) {
    const n = Math.max(5, Math.min(7, Number(t?.config?.ideaCount) || 6));
    for (let i = 0; i < n; i += 1) {
      normalized.push({ id: `placeholder-${i}`, text: `Idea ${i + 1}`, correctIndex: i });
    }
  }

  // Shuffle in-place (Fisher–Yates)
  for (let i = normalized.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [normalized[i], normalized[j]] = [normalized[j], normalized[i]];
  }
  return normalized;
}

function DraggableCard({ id, children, disabled, level = 0 }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled });

  // Color palette by level (depth)
  const levelColors = [
    { bg: "linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)", border: "#1e40af", emoji: "💡" }, // Blue - Level 1
    { bg: "linear-gradient(135deg, #10b981 0%, #065f46 100%)", border: "#065f46", emoji: "🎯" }, // Green - Level 2
    { bg: "linear-gradient(135deg, #a855f7 0%, #6b21a8 100%)", border: "#6b21a8", emoji: "⭐" }, // Purple - Level 3
    { bg: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)", border: "#b45309", emoji: "🔥" }, // Amber - Level 4
    { bg: "linear-gradient(135deg, #ec4899 0%, #831843 100%)", border: "#831843", emoji: "💫" }, // Pink - Level 5
    { bg: "linear-gradient(135deg, #06b6d4 0%, #0c4a6e 100%)", border: "#0c4a6e", emoji: "🚀" }, // Cyan - Level 6
  ];

  const colorIdx = Math.min(level, levelColors.length - 1);
  const { bg, border, emoji } = levelColors[colorIdx];

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "default" : "grab",
    background: bg,
    border: `3px solid ${border}`,
    borderRadius: "20px",
    padding: "16px 12px",
    minHeight: level === 0 ? "120px" : "100px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    fontWeight: 900,
    textAlign: "center",
    boxShadow: level === 0
      ? `0 0 30px ${border}80, 0 8px 24px rgba(0,0,0,0.15)`
      : `0 4px 12px rgba(0,0,0,0.1)`,
    position: "relative",
    overflow: "hidden",
  };

  // Add animation keyframes style
  const glowKeyframes = `
    @keyframes pop-in-${id} {
      0% {
        opacity: 0;
        transform: scale(0.6) translateY(20px);
      }
      60% {
        transform: scale(1.08);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }
    @keyframes glow-pulse-${id} {
      0%, 100% {
        box-shadow: 0 0 30px ${border}80, 0 8px 24px rgba(0,0,0,0.15);
      }
      50% {
        box-shadow: 0 0 50px ${border}cc, 0 8px 24px rgba(0,0,0,0.15);
      }
    }
  `;

  const animatedStyle = {
    ...style,
    animation: level === 0
      ? `pop-in-${id} 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), glow-pulse-${id} 3s ease-in-out infinite`
      : `pop-in-${id} 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)`,
  };

  return (
    <>
      <style>{glowKeyframes}</style>
      <div
        ref={setNodeRef}
        style={animatedStyle}
        {...(!disabled ? { ...attributes, ...listeners } : {})}
      >
        <div style={{ fontSize: "32px", marginBottom: "6px" }}>{emoji}</div>
        <div style={{ fontSize: "14px", lineHeight: "1.3" }}>{children}</div>
      </div>
    </>
  );
}


function Confetti({ trigger }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!trigger) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const particleCount = 60;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -10,
        w: Math.random() * 10 + 5,
        h: Math.random() * 10 + 5,
        dx: Math.random() * 4 - 2,
        dy: Math.random() * 8 + 5,
        rotation: Math.random() * Math.PI * 2,
        dRotation: Math.random() * 0.2 - 0.1,
        opacity: 1,
        color: ["#3b82f6", "#10b981", "#a855f7", "#f59e0b", "#ec4899"][Math.floor(Math.random() * 5)],
      });
    }

    let frame = 0;
    const maxFrames = 150;

    const animate = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.y += p.dy;
        p.dy += 0.15; // gravity
        p.x += p.dx;
        p.rotation += p.dRotation;
        p.opacity = 1 - frame / maxFrames;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      if (frame < maxFrames) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }, [trigger]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 1000,
      }}
    />
  );
}

function CelebrationOverlay({ show, onDismiss }) {
  useEffect(() => {
    if (!show) return;
    try {
      new Audio("/sounds/yay.mp3").play().catch(() => {});
    } catch (e) {
      // Fail silently
    }
    const timer = setTimeout(onDismiss, 2500);
    return () => clearTimeout(timer);
  }, [show, onDismiss]);

  if (!show) return null;

  const celebrationMessages = [
    "🎉 Mind Map Mastery! 🎉",
    "✨ Perfect Arrangement! ✨",
    "🚀 Ideas in Order! 🚀",
    "⭐ Brilliant Thinking! ⭐",
    "🌟 You Got It! 🌟",
  ];

  const msg = celebrationMessages[Math.floor(Math.random() * celebrationMessages.length)];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.3)",
        backdropFilter: "blur(4px)",
        zIndex: 999,
        animation: "fade-in 0.3s ease-out",
      }}
      onClick={onDismiss}
    >
      <style>{`
        @keyframes bounce-in {
          0% {
            opacity: 0;
            transform: scale(0.3) rotateX(100deg);
          }
          70% {
            transform: scale(1.1);
          }
          100% {
            opacity: 1;
            transform: scale(1) rotateX(0deg);
          }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
      <div
        style={{
          background: "linear-gradient(135deg, #3b82f6 0%, #a855f7 100%)",
          padding: "40px 60px",
          borderRadius: "30px",
          color: "white",
          textAlign: "center",
          fontSize: "48px",
          fontWeight: 1000,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3), 0 0 40px rgba(59, 130, 246, 0.6)",
          animation: "bounce-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
          maxWidth: "90%",
        }}
      >
        {msg}
      </div>
    </div>
  );
}

function OrganizerTemplate({ organizerKey, ideas = [], difficulty = "easy" }) {
  const key = String(organizerKey || "mind-map");
  const level = String(difficulty || "easy").toLowerCase();
  const organizer = ORGANIZERS[key] || ORGANIZERS["mind-map"];

  const n = Math.max(5, Math.min(7, ideas.length || 6));
  const labels = new Array(n).fill(0).map((_, i) => {
    if (level === "easy") {
      // mark first 3 as "main" and the rest as "sub"
      const isMain = i < 3;
      return isMain ? `Main idea ${i + 1}` : `Detail ${i - 2}`;
    }
    if (level === "hard" && i >= n - 2) {
      return `Your idea`;
    }
    return `Idea ${i + 1}`;
  });

  const box = (x, y, w, h, text) => (
    <g key={`${x}:${y}:${text}`}>
      <rect x={x} y={y} width={w} height={h} rx="12" fill="#ffffff" opacity="0.95" />
      <rect x={x} y={y} width={w} height={h} rx="12" fill="none" stroke="rgba(15,23,42,0.18)" strokeWidth="2" />
      <text x={x + w / 2} y={y + h / 2 + 6} textAnchor="middle" fontSize="18" fontWeight="900" fill="#0f172a">
        {text}
      </text>
    </g>
  );

  // simple, consistent SVG "blanks" templates (keeps UI stable even without AI images)
  const w = 900;
  const h = 520;

  const nodes = (() => {
    if (key === "venn") {
      return (
        <>
          <circle cx="330" cy="250" r="150" fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.35)" strokeWidth="6" />
          <circle cx="450" cy="250" r="150" fill="rgba(16,185,129,0.10)" stroke="rgba(16,185,129,0.35)" strokeWidth="6" />
          <circle cx="390" cy="360" r="150" fill="rgba(168,85,247,0.10)" stroke="rgba(168,85,247,0.35)" strokeWidth="6" />
          {box(70, 70, 240, 64, labels[0])}
          {box(590, 70, 240, 64, labels[1])}
          {box(330, 430, 240, 64, labels[2] || "Idea 3")}
        </>
      );
    }

    if (key === "flowchart") {
      return (
        <>
          {new Array(n).fill(0).map((_, i) => {
            const y = 60 + i * 72;
            return (
              <g key={`step:${i}`}>
                {box(240, y, 420, 58, labels[i] || `Step ${i + 1}`)}
                {i < n - 1 && (
                  <line x1="450" y1={y + 58} x2="450" y2={y + 72} stroke="rgba(15,23,42,0.28)" strokeWidth="4" />
                )}
              </g>
            );
          })}
        </>
      );
    }

    // default: mind-map / web / hierarchy-ish: center + satellites
    return (
      <>
        {box(330, 210, 240, 78, "Central concept")}
        {box(80, 80, 240, 60, labels[0])}
        {box(580, 80, 240, 60, labels[1] || "Idea 2")}
        {box(80, 380, 240, 60, labels[2] || "Idea 3")}
        {box(580, 380, 240, 60, labels[3] || "Idea 4")}
        {n > 5 && box(330, 80, 240, 60, labels[4] || "Idea 5")}
        {n > 6 && box(330, 380, 240, 60, labels[5] || "Idea 6")}
        {/* connectors */}
        <line x1="330" y1="250" x2="200" y2="140" stroke="rgba(15,23,42,0.20)" strokeWidth="4" />
        <line x1="570" y1="250" x2="700" y2="140" stroke="rgba(15,23,42,0.20)" strokeWidth="4" />
        <line x1="330" y1="250" x2="200" y2="420" stroke="rgba(15,23,42,0.20)" strokeWidth="4" />
        <line x1="570" y1="250" x2="700" y2="420" stroke="rgba(15,23,42,0.20)" strokeWidth="4" />
      </>
    );
  })();

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 18,
        border: "1px solid rgba(15,23,42,0.12)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(248,250,252,0.9))",
        boxShadow: "0 14px 40px rgba(2,6,23,0.10)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 1000, color: "#0f172a" }}>
          Organizer template: {organizer?.name || "Mind Map"}
        </div>
        <div style={{ fontWeight: 900, color: "#475569", fontSize: 12 }}>
          Difficulty: {level.toUpperCase()} • Copy this in your notes and fill the blanks
        </div>
      </div>

      <div style={{ padding: 10 }}>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="auto" role="img" aria-label="Graphic organizer template">
          <rect x="0" y="0" width={w} height={h} rx="22" fill="url(#mm_bg)" />
          <defs>
            <linearGradient id="mm_bg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(219,234,254,0.92)" />
              <stop offset="50%" stopColor="rgba(224,231,255,0.90)" />
              <stop offset="100%" stopColor="rgba(240,253,250,0.92)" />
            </linearGradient>
          </defs>
          {nodes}
        </svg>
      </div>
    </div>
  );
}

export default function MindMapperTask({ task, onSubmit, disabled }) {
  const [items, setItems] = useState(() => normalizeAndShuffleItems(task));
  const [showCelebration, setShowCelebration] = useState(false);
  const [triggerConfetti, setTriggerConfetti] = useState(false);

  const t = task || {};
  const cfg = (t?.config && typeof t.config === "object") ? t.config : {};
  const ideasRaw = inferIdeas(t);
  const difficulty = String(cfg.difficulty || cfg.level || t.difficulty || t.level || "easy").toLowerCase();
  const organizerKey = String(t.organizerType || cfg.organizerType || "mind-map");
  const organizer = ORGANIZERS[organizerKey] || ORGANIZERS["mind-map"];

  const usedPlaceholder = Array.isArray(ideasRaw) ? (ideasRaw.length === 0) : true;

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");

  const readFileAsDataUrl = (file) =>
    new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => resolve("");
      fr.readAsDataURL(file);
    });

  const sensors = useSensors(
    useSensor(PointerSensor, { distance: 8 }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    if (disabled) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((prevItems) => {
      const oldIndex = prevItems.findIndex((i) => i.id === active.id);
      const newIndex = prevItems.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prevItems;

      const newItems = arrayMove(prevItems, oldIndex, newIndex);

      // Check win condition: each item's correctIndex matches its index
      const correct = newItems.every(
        (item, index) => item.correctIndex === index
      );
      if (correct) {
        try {
          // Non-blocking; ignore if audio can't play
          new Audio("/sounds/yay.mp3").play().catch(() => {});
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Celebration sound failed:", e);
        }
        setShowCelebration(true);
        setTriggerConfetti(true);

        if (onSubmit) {
          // Use timeout to let animation play first
          setTimeout(() => {
            onSubmit({ completed: true });
          }, 500);
        }
      }
      return newItems;
    });
  };

  const hasItems = Array.isArray(items) && items.length > 0;

  return (
    <div style={{
      position: "relative",
      width: "100%",
      minHeight: "100%",
      padding: "20px",
      borderRadius: "20px",
      overflow: "visible",
      background: "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(219,234,254,0.85) 50%, rgba(224,231,255,0.90) 100%)",
      boxShadow: "inset 0 1px 2px rgba(255,255,255,0.8), 0 4px 12px rgba(0,0,0,0.08)",
    }}>
      <Confetti trigger={triggerConfetti} />
      <CelebrationOverlay show={showCelebration} onDismiss={() => setShowCelebration(false)} />

      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        flexWrap: "wrap",
        marginBottom: "20px",
      }}>
        <div style={{
          fontWeight: 1000,
          fontSize: "1.4rem",
          color: "#0f172a",
          background: "linear-gradient(135deg, #3b82f6 0%, #a855f7 100%)",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          🧠 Mind Mapper: {organizer.name}
        </div>
        <div style={{
          padding: "8px 12px",
          borderRadius: "999px",
          border: "2px solid rgba(59, 130, 246, 0.3)",
          background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(168,85,247,0.08) 100%)",
          fontWeight: 900,
          color: "#334155",
          fontSize: "12px",
          letterSpacing: "0.5px",
        }}>
          ✨ Arrange & Connect Ideas
        </div>
      </div>

      <div style={{ marginTop: "14px", width: "min(980px, 98%)" }}>
        <OrganizerTemplate organizerKey={organizerKey} ideas={items.map((x)=>x.text)} difficulty={difficulty} />
      </div>

      {!hasItems ? (
        <div style={{
          marginTop: "14px",
          padding: "16px",
          borderRadius: "16px",
          border: "2px solid rgba(239,68,68,0.2)",
          background: "linear-gradient(135deg, rgba(254,242,242,0.8) 0%, rgba(254,229,229,0.8) 100%)",
          color: "#7f1d1d",
          maxWidth: "900px",
        }}>
          <div style={{ fontWeight: 1000, marginBottom: "6px", fontSize: "16px" }}>⚠️ Mind Mapper is missing its idea list.</div>
          <div style={{ fontWeight: 800, fontSize: "14px" }}>This task should include 5–7 ideas (mustHave / concepts / ideas).</div>
          <div style={{ marginTop: "6px", color: "#7f1d1d", fontSize: "14px" }}>For now, we created placeholder ideas so students can still play.</div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={rectSortingStrategy}
          >
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "16px",
              maxWidth: "100%",
              marginTop: "20px",
            }}>
              {items.map((item, idx) => (
                <DraggableCard
                  key={item.id}
                  id={item.id}
                  disabled={disabled}
                  level={idx === 0 ? 0 : Math.floor(idx / 2) % 6}
                >
                  {item.text}
                </DraggableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div style={{
        marginTop: "24px",
        width: "min(980px, 98%)",
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "12px",
      }}>
        <div style={{
          padding: "16px",
          borderRadius: "16px",
          border: "2px solid rgba(59,130,246,0.15)",
          background: "linear-gradient(135deg, rgba(59,130,246,0.05) 0%, rgba(168,85,247,0.05) 100%)",
        }}>
          <div style={{ fontWeight: 1000, color: "#0f172a", marginBottom: "8px", fontSize: "15px" }}>📋 What to do</div>
          <ol style={{ margin: "0 0 0 20px", color: "#334155", fontWeight: 700, lineHeight: 1.6, fontSize: "14px" }}>
            <li>Copy the organizer template into your notes.</li>
            <li>Fill the blanks with the ideas (and add your own if it's Hard).</li>
            <li>Take a photo of your completed organizer and submit it below.</li>
          </ol>
        </div>
        <div style={{
          padding: "16px",
          borderRadius: "16px",
          border: "2px solid rgba(16,185,129,0.15)",
          background: "linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(6,95,70,0.05) 100%)",
        }}>
          <div style={{ fontWeight: 1000, color: "#0f172a", marginBottom: "8px", fontSize: "15px" }}>📸 Submit your organizer</div>
          <div style={{ marginTop: "8px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={disabled}
              onChange={async (e) => {
                const f = e?.target?.files?.[0] || null;
                setPhotoFile(f);
                const url = f ? await readFileAsDataUrl(f) : "";
                setPhotoPreview(url);
              }}
              style={{
                fontWeight: 800,
                fontSize: "14px",
                padding: "6px 8px",
                borderRadius: "8px",
                border: "1px solid rgba(15,23,42,0.2)",
                cursor: "pointer",
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (disabled) return;
                const photoDataUrl = photoPreview || "";
                onSubmit?.({
                  completed: true,
                  organizerType: organizerKey,
                  difficulty,
                  ideas: items.map((x) => x.text),
                  photoDataUrl,
                  mode: "mind-mapper",
                });
              }}
              style={{
                padding: "10px 18px",
                borderRadius: "999px",
                border: "none",
                background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                color: "#fff",
                fontWeight: 1000,
                fontSize: "14px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(22,163,74,0.3)",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!disabled) {
                  e.target.style.boxShadow = "0 6px 20px rgba(22,163,74,0.4)";
                  e.target.style.transform = "translateY(-2px)";
                }
              }}
              onMouseLeave={(e) => {
                if (!disabled) {
                  e.target.style.boxShadow = "0 4px 12px rgba(22,163,74,0.3)";
                  e.target.style.transform = "translateY(0)";
                }
              }}
            >
              Submit photo ✅
            </button>
          </div>
          {photoPreview ? (
            <div style={{ marginTop: "12px" }}>
              <img src={photoPreview} alt="Submission preview" style={{
                width: "100%",
                maxHeight: "280px",
                objectFit: "contain",
                borderRadius: "12px",
                border: "2px solid rgba(16,185,129,0.2)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }} />
            </div>
          ) : (
            <div style={{ marginTop: "8px", color: "#64748b", fontWeight: 700, fontSize: "14px" }}>
              📸 Snap a photo of your completed organizer to submit.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
