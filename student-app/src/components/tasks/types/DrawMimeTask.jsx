// student-app/src/components/tasks/types/DrawMimeTask.jsx
import React, { useRef, useState, useEffect } from "react";

export default function DrawMimeTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("#000000");
  const [lineWidth, setLineWidth] = useState(8);
  const [tool, setTool] = useState("pen"); // "pen" | "eraser"

  // Undo/Redo
  const historyRef = useRef([]);
  const historyStepRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Load saved drawing
  useEffect(() => {
    if (answerDraft?.imageData) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        ctx.drawImage(img, 0, 0);
        pushToHistory();
        setHasDrawn(true);
      };
      img.src = answerDraft.imageData;
    }
  }, [answerDraft]);

  // Canvas setup + resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height - 200;
      redrawFromHistory();
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const pushToHistory = () => {
    const dataUrl = canvasRef.current.toDataURL();
    historyRef.current = historyRef.current.slice(0, historyStepRef.current + 1);
    historyRef.current.push(dataUrl);
    historyStepRef.current += 1;
    if (historyRef.current.length > 30) {
      historyRef.current.shift();
      historyStepRef.current -= 1;
    }
    setCanUndo(historyStepRef.current > 0);
    setCanRedo(false);
    onAnswerChange?.({ imageData: dataUrl, completed: true });
  };

  const redrawFromHistory = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (historyStepRef.current < 0) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = historyRef.current[historyStepRef.current];
  };

  const undo = () => {
    if (historyStepRef.current <= 0) return;
    historyStepRef.current -= 1;
    redrawFromHistory();
    setCanUndo(historyStepRef.current > 0);
    setCanRedo(true);
    setHasDrawn(historyStepRef.current > 0);
  };

  const redo = () => {
    if (historyStepRef.current >= historyRef.current.length - 1) return;
    historyStepRef.current += 1;
    redrawFromHistory();
    setCanRedo(historyStepRef.current < historyRef.current.length - 1);
    setCanUndo(true);
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    historyRef.current = [];
    historyStepRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
    setHasDrawn(false);
    onAnswerChange?.(null);
  };

  // Pressure-aware drawing
  const startDrawing = (e) => {
    if (disabled) return;
    setIsDrawing(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();

    const getPointerInfo = (e) => {
      const pointer = e.nativeEvent;
      return {
        x: pointer.clientX - rect.left,
        y: pointer.clientY - rect.top,
        pressure: pointer.pressure || 0.5, // 0.0 to 1.0 (fallback 0.5)
        isTouch: e.type.includes("touch"),
      };
    };

    const { x, y, pressure } = getPointerInfo(e);

    // Set tool
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }

    // Base line width + pressure multiplier
    const baseWidth = lineWidth;
    const maxWidth = baseWidth * 3; // Pressure can triple thickness
    ctx.lineWidth = baseWidth + pressure * (maxWidth - baseWidth);

    ctx.beginPath();
    ctx.moveTo(x, y);

    const draw = (e) => {
      const { x: mx, y: my, pressure: p } = getPointerInfo(e);
      const currentWidth = baseWidth + p * (maxWidth - baseWidth);
      ctx.lineWidth = currentWidth;
      ctx.lineTo(mx, my);
      ctx.stroke();
    };

    const stop = () => {
      canvas.removeEventListener("pointermove", draw);
      canvas.removeEventListener("pointerup", stop);
      canvas.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("pointerleave", stop);

      pushToHistory();
      setHasDrawn(true);
    };

    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);
  };

  const handleSubmit = () => {
    if (disabled || !hasDrawn) return;
    const imageData = canvasRef.current.toDataURL();
    onSubmit({ imageData, type: "drawing" });
  };

  const prompt = task?.prompt || "Draw with feeling! Use Apple Pencil or stylus for pressure magic!";

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-purple-600 via-pink-600 to-orange-500 text-white">
      {/* Header */}
      <div className="p-6 text-center">
        <h2 className="text-5xl md:text-7xl font-black drop-shadow-2xl mb-4">
          DRAW OR MIME IT!
        </h2>
        <p className="text-3xl md:text-4xl font-bold drop-shadow-lg px-4">
          {prompt}
        </p>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative mx-4 mb-4 bg-white rounded-3xl shadow-2xl overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          onPointerDown={startDrawing}
          style={{ touchAction: "none" }} // Critical for pressure on iPad
        />

        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-6xl font-black text-gray-300 opacity-50">
              Press hard for thick lines!
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-6 bg-black/40 backdrop-blur-lg">
        <div className="flex flex-wrap items-center justify-center gap-6 mb-6">
          {/* Tool Switcher */}
          <div className="flex bg-white/20 rounded-2xl p-2">
            <button
              onClick={() => setTool("pen")}
              disabled={disabled}
              className={`px-8 py-4 rounded-xl text-3xl font-bold transition ${
                tool === "pen" ? "bg-white text-black" : "text-white"
              }`}
            >
              Pen
            </button>
            <button
              onClick={() => setTool("eraser")}
              disabled={disabled}
              className={`px-8 py-4 rounded-xl text-3xl font-bold transition ${
                tool === "eraser" ? "bg-white text-black" : "text-white"
              }`}
            >
              Eraser
            </button>
          </div>

          {/* Undo / Redo */}
          <div className="flex gap-4">
            <button
              onClick={undo}
              disabled={!canUndo || disabled}
              className="px-8 py-5 bg-white/20 rounded-2xl text-4xl hover:bg-white/30 disabled:opacity-30 transition"
            >
              Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo || disabled}
              className="px-8 py-5 bg-white/20 rounded-2xl text-4xl hover:bg-white/30 disabled:opacity-30 transition"
            >
              Redo
            </button>
          </div>

          {/* Color Palette */}
          {["#000000", "#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"].map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); setTool("pen"); }}
              disabled={disabled}
              className={`w-16 h-16 rounded-full shadow-xl transition transform hover:scale-110 ${
                color === c && tool === "pen" ? "ring-8 ring-white scale-125" : ""
              }`}
              style={{ backgroundColor: c }}
            />
          ))}

          {/* Brush Size */}
          <div className="flex items-center gap-4 bg-white/20 rounded-2xl px-6 py-3">
            <span className="text-2xl">Brush</span>
            {[4, 8, 12, 20].map((w) => (
              <button
                key={w}
                onClick={() => setLineWidth(w)}
                disabled={disabled}
                className={`w-${w === 4 ? "10" : w === 8 ? "12" : w === 12 ? "14" : "16"} h-${w === 4 ? "10" : w === 8 ? "12" : w === 12 ? "14" : "16"} rounded-full transition hover:scale-125 ${
                  lineWidth === w ? "bg-white scale-125" : "bg-gray-400"
                }`}
              />
            ))}
          </div>

          {/* Clear */}
          <button
            onClick={clearCanvas}
            disabled={disabled}
            className="px-8 py-4 bg-red-600 text-white text-2xl font-bold rounded-2xl hover:bg-red-700 transition shadow-xl"
          >
            Clear All
          </button>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={disabled || !hasDrawn}
          className="w-full py-8 text-6xl font-black bg-gradient-to-r from-green-500 to-emerald-600 rounded-3xl shadow-2xl hover:scale-105 transition disabled:opacity-50"
        >
          {hasDrawn ? "SUBMIT MASTERPIECE!" : "DRAW FIRST!"}
        </button>
      </div>
    </div>
  );
}