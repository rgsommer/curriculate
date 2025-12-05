// student-app/src/components/tasks/types/MadDashSequenceTask.jsx
import React, { useEffect, useState, useRef } from "react";
import QrScanner from "../../QrScanner.jsx";

const COLORS = ["Red,Blue,Green,Yellow,Purple,Orange,Pink,Teal"];

export default function MadDashSequenceTask({
  task,
  onSubmit,
  disabled,
  socket,
}) {
  const [sequence] = useState(task.sequence || []);
  const [scanned, setScanned] = useState([]);
  const [showSequence, setShowSequence] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [timerActive, setTimerActive] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isWinner, setIsWinner] = useState(null);

  const videoRef = useRef(null);
  const qrScannerRef = useRef(null);

  // 10s sequence → 3-2-1-GO → start
  useEffect(() => {
    if (!task.sequence) return;

    const timer = setTimeout(() => {
      setShowSequence(false);
      const cd = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(cd);
            setTimerActive(true);
            startScanner();
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }, 10000);
    return () => clearTimeout(timer);
  }, [task.sequence]);

  // Timer
  useEffect(() => {
    if (!timerActive || isWinner !== null) return;
    const i = setInterval(() => setTimeElapsed(t => t + 1), 1000);
    return () => clearInterval(i);
  }, [timerActive, isWinner]);

  // Start QR scanner
  const startScanner = async () => {
    if (!videoRef.current) return;
    try {
      qrScannerRef.current = new QrScanner(
        videoRef.current,
        result => {
          const color = result.data.trim();
          if (COLORS.includes(color) && timerActive && isWinner === null) {
            handleScan(color);
          }
        },
        { highlightScanRegion: true, highlightCodeOutline: true }
      );
      await qrScannerRef.current.start();
    } catch (err) {
      alert("Camera not available");
    }
  };

  const handleScan = (color) => {
    const next = [...scanned, color];
    setScanned(next);
    new Audio("/sounds/scan-beep.mp3").play();

    if (next.length === sequence.length) {
      const correct = next.every((c, i) => c === sequence[i]);
      setIsWinner(correct);

      const points = correct
        ? timeElapsed < 10 ? 25
        : timeElapsed < 20 ? 20
        : timeElapsed < 30 ? 15
        : 10
        : 0;

      onSubmit({ completed: correct, timeElapsed, points });
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      qrScannerRef.current?.stop();
      qrScannerRef.current?.destroy();
    };
  }, []);

  const getColorClass = (color) => {
    const map = {
      Red: "from-red-500 to-pink-500 ring-red-400",
      Blue: "from-blue-500 to-cyan-500 ring-blue-400",
      Green: "from-green-500 to-emerald-500 ring-green-400",
      Yellow: "from-yellow-400 to-amber-500 ring-yellow-300",
      Purple: "from-purple-500 to-pink-500 ring-purple-400",
      Orange: "from-orange-500 to-red-500 ring-orange-400",
    };
    return map[color] || "from-gray-500 to-gray-600";
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-full bg-gradient-to-br from-red-700 via-orange-600 to-yellow-500 text-white overflow-hidden">
      <h1 className="absolute top-8 text-7xl md:text-9xl font-black drop-shadow-2xl z-10 animate-pulse">
        MAD DASH!
      </h1>

      {/* SEQUENCE PHASE – GLOWING BUBBLES */}
      {showSequence && (
        <div className="text-center px-8">
          <p className="text-5xl md:text-7xl font-black mb-16 drop-shadow-2xl">
            MEMORIZE THE SEQUENCE!
          </p>

          <div className="flex flex-wrap justify-center gap-12 md:gap-20">
            {sequence.map((color, i) => (
              <div
                key={i}
                className="relative animate__animated animate__bounceIn"
                style={{ animationDelay: `${i * 0.5}s` }}
              >
                {/* Outer glow ring */}
                <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${getColorClass(color)} blur-3xl scale-150 opacity-70 animate-ping`} />
                
                {/* Main bubble */}
                <div className={`relative w-48 h-48 md:w-64 md:h-64 rounded-full bg-gradient-to-br ${getColorClass(color)} 
                  shadow-2xl border-8 border-white/30 flex items-center justify-center
                  transform hover:scale-110 transition-all`}>
                  <span className="text-6xl md:text-8xl font-black drop-shadow-2xl">
                    {color}
                  </span>
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 text-9xl font-black opacity-20">
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
        <div className="text-center">
          <p className="text-10xl md:text-12xl font-black animate-bounce drop-shadow-2xl">
            {countdown === 3 ? "ON YOUR MARK" :
             countdown === 2 ? "GET SET" :
             "GO!!!"}
          </p>
        </div>
      )}

      {/* GAME ACTIVE */}
      {!showSequence && countdown === 0 && (
        <div className="w-full flex flex-col items-center">
          <div className="text-6xl font-bold mb-8">Time: <span className="text-yellow-300">{timeElapsed}s</span></div>

          {/* Progress Bubbles */}
          <div className="flex gap-8 mb-16">
            {sequence.map((color, i) => (
              <div
                key={i}
                className={`w-32 h-32 rounded-full flex items-center justify-center text-5xl font-black transition-all
                  ${scanned[i] === color ? "bg-green-500 ring-8 ring-green-300 scale-125" : "bg-gray-600"}
                `}
              >
                {scanned[i] ? "Checkmark" : i + 1}
              </div>
            ))}
          </div>

          {/* Camera */}
          <div className="relative w-full max-w-2xl h-96 bg-black rounded-3xl overflow-hidden shadow-2xl mb-8">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline />
            <div className="absolute inset-0 border-8 border-yellow-400 rounded-3xl pointer-events-none animate-pulse" />
            <p className="absolute bottom-8 left-1/2 -translate-x-1/2 text-5xl font-bold bg-black/70 px-8 py-4 rounded-2xl">
              SCAN NEXT!
            </p>
          </div>

          {/* Winner */}
          {isWinner !== null && (
            <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/80">
              <div className="text-center">
                {isWinner ? (
                  <>
                    <p className="text-9xl font-black text-green-400 animate-bounce">WINNER!</p>
                    <p className="text-8xl text-yellow-300 mt-8">
                      +{timeElapsed < 10 ? "25" : timeElapsed < 20 ? "20" : timeElapsed < 30 ? "15" : "10"} POINTS!
                    </p>
                  </>
                ) : (
                  <p className="text-9xl font-black text-red-500 animate-pulse">WRONG ORDER!</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}