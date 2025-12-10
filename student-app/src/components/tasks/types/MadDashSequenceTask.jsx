// student-app/src/components/tasks/types/MadDashSequenceTask.jsx
import React, { useEffect, useState, useRef } from "react";
import QrScanner from "../../QrScanner.jsx";

// Station → colour mapping for Mad Dash.
// These should match your physical station colours / posters.
const STATION_COLORS = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Teal", "Pink"];

// Helper: map a scanned QR value (e.g. "station-1") to a colour name.
function stationIdToColor(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const m = /^station-(\d+)$/i.exec(trimmed);
  if (!m) {
    // If someone encodes the colour directly in the QR, accept that too.
    const direct = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    return STATION_COLORS.includes(direct) ? direct : null;
  }
  const idx = parseInt(m[1], 10) - 1;
  if (idx < 0 || idx >= STATION_COLORS.length) return null;
  return STATION_COLORS[idx];
}

export default function MadDashSequenceTask({
  task,
  onSubmit,
  disabled,
  socket, // reserved for future inter-team effects
}) {
  // Normalise sequence once from task (e.g., ["Red","Blue",...])
  const [sequence] = useState(() =>
    (task.sequence || []).map((c) => String(c).trim())
  );

  const [scanned, setScanned] = useState([]);
  const [showSequence, setShowSequence] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [timerActive, setTimerActive] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isWinner, setIsWinner] = useState(null);

  const videoRef = useRef(null);
  const qrScannerRef = useRef(null);

  // --------- PHASE 1: show sequence for 10s, then 3–2–1–GO ----------
  useEffect(() => {
    if (!task.sequence || !task.sequence.length) return;

    const showTimer = setTimeout(() => {
      setShowSequence(false);

      let counter = 3;
      setCountdown(counter);

      const cd = setInterval(() => {
        counter -= 1;
        setCountdown(counter);
        if (counter <= 0) {
          clearInterval(cd);
          if (!disabled) {
            setTimerActive(true);
            startScanner();
          }
        }
      }, 1000);
    }, 10000); // 10s to memorise

    return () => {
      clearTimeout(showTimer);
    };
  }, [task.sequence, disabled]);

  // --------- TIMER TICK ----------
  useEffect(() => {
    if (!timerActive || isWinner !== null) return;
    const i = setInterval(() => {
      setTimeElapsed((t) => t + 1);
    }, 1000);
    return () => clearInterval(i);
  }, [timerActive, isWinner]);

  // --------- START / STOP SCANNER ----------
  const startScanner = async () => {
    if (!videoRef.current || disabled) return;
    try {
      qrScannerRef.current = new QrScanner(
        videoRef.current,
        (result) => {
          if (!result || !result.data) return;
          const raw = result.data.trim();
          const colorName = stationIdToColor(raw);
          if (!colorName) return;

          if (timerActive && isWinner === null && !disabled) {
            handleScan(colorName);
          }
        },
        { highlightScanRegion: true, highlightCodeOutline: true }
      );
      await qrScannerRef.current.start();
    } catch (err) {
      console.error("MadDash scanner error:", err);
      alert("Camera not available");
    }
  };

  const stopScanner = () => {
    try {
      qrScannerRef.current?.stop();
      qrScannerRef.current?.destroy();
    } catch (e) {
      // ignore
    }
    qrScannerRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------- HANDLE SCAN ----------
  const handleScan = (colorName) => {
    if (isWinner !== null || disabled) return;

    const next = [...scanned, colorName];
    setScanned(next);

    try {
      new Audio("/sounds/scan-beep.mp3").play();
    } catch (e) {
      // audio not critical; ignore errors
    }

    if (next.length === sequence.length) {
      // Compare ignoring case, in case of mismatched capitalisation
      const correct = next.every(
        (c, i) =>
          c.toLowerCase() === (sequence[i] || "").toLowerCase()
      );

      setIsWinner(correct);
      setTimerActive(false);
      stopScanner();

      const points = correct
        ? timeElapsed < 10
          ? 25
          : timeElapsed < 20
          ? 20
          : timeElapsed < 30
          ? 15
          : 10
        : 0;

      onSubmit &&
        onSubmit({
          completed: correct,
          timeElapsed,
          points,
          sequence,
          scanned: next,
        });
    }
  };

  // --------- COLOUR BUBBLE STYLING ----------
  const getColorClass = (color) => {
    const map = {
      Red: "from-red-500 to-pink-500 ring-red-400",
      Blue: "from-blue-500 to-cyan-500 ring-blue-400",
      Green: "from-green-500 to-emerald-500 ring-green-400",
      Yellow: "from-yellow-400 to-amber-500 ring-yellow-300",
      Purple: "from-purple-500 to-pink-500 ring-purple-400",
      Orange: "from-orange-500 to-red-500 ring-orange-400",
      Teal: "from-teal-500 to-cyan-500 ring-teal-400",
      Pink: "from-pink-500 to-rose-500 ring-pink-400",
    };
    return map[color] || "from-gray-500 to-gray-600";
  };

  // --------- RENDER ----------
  return (
    <div className="relative flex flex-col items-center justify-center h-full bg-gradient-to-br from-red-700 via-orange-600 to-yellow-500 text-white overflow-hidden">
      <h1 className="absolute top-8 text-5xl md:text-7xl lg:text-8xl font-black drop-shadow-2xl z-10 animate-pulse">
        MAD DASH!
      </h1>

      {/* SEQUENCE PHASE – GLOWING BUBBLES */}
      {showSequence && (
        <div className="text-center px-4 md:px-8">
          <p className="text-3xl md:text-5xl lg:text-6xl font-black mb-8 md:mb-16 drop-shadow-2xl">
            MEMORIZE THE SEQUENCE!
          </p>

          <div className="flex flex-wrap justify-center gap-6 md:gap-12 lg:gap-16">
            {sequence.map((color, i) => (
              <div
                key={i}
                className="relative animate__animated animate__bounceIn"
                style={{ animationDelay: `${i * 0.5}s` }}
              >
                {/* Outer glow ring */}
                <div
                  className={`absolute inset-0 rounded-full bg-gradient-to-br ${getColorClass(
                    color
                  )} blur-3xl scale-150 opacity-70 animate-ping`}
                />

                {/* Main bubble */}
                <div
                  className={`relative w-32 h-32 md:w-40 md:h-40 lg:w-52 lg:h-52 rounded-full bg-gradient-to-br ${getColorClass(
                    color
                  )} shadow-2xl border-4 md:border-8 border-white/30 flex items-center justify-center transform hover:scale-110 transition-all`}
                >
                  <span className="text-3xl md:text-4xl lg:text-5xl font-black drop-shadow-2xl">
                    {color}
                  </span>
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-5xl md:text-6xl font-black opacity-20">
                    {i + 1}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COUNTDOWN */}
      {!showSequence && countdown > 0 && (
        <div className="text-center px-4">
          <p className="text-4xl md:text-6xl lg:text-7xl font-black animate-bounce drop-shadow-2xl">
            {countdown === 3
              ? "ON YOUR MARK"
              : countdown === 2
              ? "GET SET"
              : "GO!!!"}
          </p>
        </div>
      )}

      {/* GAME ACTIVE */}
      {!showSequence && countdown <= 0 && (
        <div className="w-full flex flex-col items-center px-4">
          <div className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 md:mb-8">
            Time:{" "}
            <span className="text-yellow-300">{timeElapsed}s</span>
          </div>

          {/* Progress Bubbles */}
          <div className="flex flex-wrap justify-center gap-4 md:gap-8 mb-8 md:mb-16">
            {sequence.map((color, i) => {
              const done =
                scanned[i] &&
                scanned[i].toLowerCase() === color.toLowerCase();
              return (
                <div
                  key={i}
                  className={`w-16 h-16 md:w-24 md:h-24 lg:w-28 lg:h-28 rounded-full flex items-center justify-center text-2xl md:text-3xl lg:text-4xl font-black transition-all ${
                    done
                      ? "bg-green-500 ring-4 md:ring-8 ring-green-300 scale-125"
                      : "bg-gray-600"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </div>
              );
            })}
          </div>

          {/* Camera */}
          <div className="relative w-full max-w-2xl h-64 md:h-80 lg:h-96 bg-black rounded-3xl overflow-hidden shadow-2xl mb-6 md:mb-8">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
            />
            <div className="absolute inset-0 border-4 md:border-8 border-yellow-400 rounded-3xl pointer-events-none animate-pulse" />
            <p className="absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 text-2xl md:text-3xl lg:text-4xl font-bold bg-black/70 px-4 md:px-8 py-2 md:py-4 rounded-2xl">
              {disabled ? "WAIT..." : "SCAN NEXT!"}
            </p>
          </div>

          {/* Winner Overlay */}
          {isWinner !== null && (
            <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/80">
              <div className="text-center px-4">
                {isWinner ? (
                  <>
                    <p className="text-5xl md:text-7xl lg:text-8xl font-black text-green-400 animate-bounce">
                      WINNER!
                    </p>
                    <p className="text-4xl md:text-5xl lg:text-6xl text-yellow-300 mt-4 md:mt-8">
                      +
                      {timeElapsed < 10
                        ? "25"
                        : timeElapsed < 20
                        ? "20"
                        : timeElapsed < 30
                        ? "15"
                        : "10"}{" "}
                      POINTS!
                    </p>
                  </>
                ) : (
                  <p className="text-5xl md:text-7xl lg:text-8xl font-black text-red-500 animate-pulse">
                    WRONG ORDER!
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
