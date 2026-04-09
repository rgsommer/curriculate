import React, { useEffect, useMemo, useRef, useState } from "react";
import Lottie from "lottie-react";

/**
 * Motion Mission (MOTION_MISSION)
 * - Players WATCH the motion animation and COPY it.
 * - A big 3–2–1–GO happens before the mission.
 * - Students tap DONE when finished (not objective-scored by default).
 *
 * Notes:
 * - We keep device-motion counting as an optional bonus signal when available,
 *   but the "Done" button is the primary completion mechanic (per your tweak).
 * - Lottie JSON is loaded at runtime from /public/animations/*.json
 */

const ACTIVITY_CONFIG = {
  "Jump 10 times": { type: "jump", target: 10, emoji: "🦘", file: "jump.json" },
  "Do 8 squats": { type: "squat", target: 8, emoji: "🏋️‍♂️", file: "squat.json" },
  "Run on the spot": { type: "run", target: 15, emoji: "🏃‍♂️", file: "run.json" },
  "Dance wildly!": { type: "dance", target: 12, emoji: "💃", file: "dance.json" },
  "Spin around 5 times": { type: "spin", target: 5, emoji: "🌀", file: "spin.json" },
};

export default function MotionMissionTask({ task, onSubmit, disabled, presenter }) {
  const activityPrompt = task?.prompt || task?.activity || "Jump 10 times";
  const activityName = useMemo(() => String(activityPrompt || "").trim() || "Jump 10 times", [activityPrompt]);

  const config = ACTIVITY_CONFIG[activityName] || null;
  const hasConfiguredActivity = !!ACTIVITY_CONFIG[activityName];
  const emoji = config?.emoji || "🏃‍♂️";
  const target = config?.target || 10;
  const file = config?.file || null;

  const [animData, setAnimData] = useState(null);

  const [phase, setPhase] = useState("demo"); // demo -> countdown -> active -> done
  const [countdown, setCountdown] = useState(3);

  // Optional motion counting (kept, but not required)
  const [count, setCount] = useState(0);
  const [noMotionSupport, setNoMotionSupport] = useState(false);
  const lastShakeTime = useRef(0);
  const shakeThreshold = 1.9;
  const minInterval = 380;

  const [done, setDone] = useState(false);
  const [delayElapsed, setDelayElapsed] = useState(false); // for no-accelerometer fallback

  // Load Lottie
  useEffect(() => {
    let cancelled = false;
    setAnimData(null);

    if (!file) return;

    fetch(`/animations/${file}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setAnimData(data);
      })
      .catch(() => {
        // fall back to emoji demo
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  // Reset on task change
  useEffect(() => {
    setPhase("demo");
    setCountdown(3);
    setCount(0);
    setNoMotionSupport(false);
    setDone(false);
    setDelayElapsed(false);
  }, [task?.taskType, task?.title, task?.prompt]);

  // When no accelerometer, show DONE after a delay so kids actually do the activity
  const NO_MOTION_DELAY_MS = 8000;
  useEffect(() => {
    if (phase !== "active") return;
    if (!noMotionSupport) return; // accelerometer available — gate on count instead

    setDelayElapsed(false);
    const id = setTimeout(() => setDelayElapsed(true), NO_MOTION_DELAY_MS);
    return () => clearTimeout(id);
  }, [phase, noMotionSupport]);

  // Countdown flow
  useEffect(() => {
    if (phase !== "countdown") return;
    if (disabled) return;

    setCountdown(3);
    const id = setInterval(() => {
      setCountdown((c) => {
        const next = c - 1;
        if (next <= 0) {
          clearInterval(id);
          setPhase("active");
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [phase, disabled]);

  // Optional motion listener during ACTIVE
  useEffect(() => {
    if (phase !== "active") return;

    let cancelled = false;

    const handleMotion = (event) => {
      if (cancelled || disabled || done) return;

      const acc = event.accelerationIncludingGravity;
      if (!acc) return;

      const ax = typeof acc.x === "number" ? acc.x : 0;
      const ay = typeof acc.y === "number" ? acc.y : 0;
      const az = typeof acc.z === "number" ? acc.z : 0;

      const total = Math.abs(ax) + Math.abs(ay) + Math.abs(az);
      const now = Date.now();

      if (total > shakeThreshold && now - lastShakeTime.current > minInterval) {
        lastShakeTime.current = now;
        setCount((prev) => Math.min(prev + 1, target));
      }
    };

    const requestMotionPermission = async () => {
      try {
        if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
          const response = await DeviceMotionEvent.requestPermission();
          if (response === "granted") {
            window.addEventListener("devicemotion", handleMotion);
          } else {
            setNoMotionSupport(true);
          }
        } else if (typeof window !== "undefined" && window.DeviceMotionEvent) {
          window.addEventListener("devicemotion", handleMotion);
        } else {
          setNoMotionSupport(true);
        }
      } catch (err) {
        setNoMotionSupport(true);
      }
    };

    requestMotionPermission();

    return () => {
      cancelled = true;
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [phase, disabled, done, target]);

  const submitDone = () => {
    if (disabled || done) return;
    setDone(true);
    setPhase("done");
    try {
      new Audio("/sounds/victory.mp3").play();
    } catch (e) {
      // ignore
    }
    onSubmit?.({ completed: true, points: 10, activity: activityName, count, target });
  };

  return (
    <div className="relative flex flex-col items-center h-full p-6 md:p-8 bg-gradient-to-br from-orange-600 via-red-600 to-pink-700 text-white overflow-hidden">
      <h1 className="text-5xl md:text-7xl font-black drop-shadow-2xl z-10 mt-2 mb-4 text-center">
        MOTION MISSION!
      </h1>

      {/* Demo phase: read prompt + start */}
      {phase === "demo" && (
        <div className="text-center w-full max-w-4xl flex-1 flex flex-col items-center justify-center">
          {hasConfiguredActivity && (
            <>
              <div className="text-3xl md:text-5xl font-black mb-4 drop-shadow-2xl">
                Watch and Copy
              </div>
              <div className="mx-auto w-[70vw] max-w-md md:max-w-lg flex items-center justify-center rounded-3xl bg-black/20 border border-white/20 shadow-2xl" style={{ maxHeight: "50vh" }}>
                {animData ? (
                  <Lottie animationData={animData} loop autoplay style={{ width: "100%", height: "100%", maxHeight: "50vh" }} />
                ) : (
                  <div className="text-8xl md:text-[7rem] animate-bounce drop-shadow-2xl">{emoji}</div>
                )}
              </div>
            </>
          )}

          <div className="mt-5 px-4 text-2xl md:text-4xl font-black text-yellow-200 drop-shadow-2xl leading-tight" style={{ maxWidth: "90vw" }}>
            {activityName}
          </div>

          <div className="mt-6 flex flex-col md:flex-row gap-3 items-center justify-center">
            <button
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (disabled) return;
                if (presenter?.showCountdown) {
                  try {
                    await presenter.showCountdown({
                      title: "Get ready…",
                      seconds: 3,
                      subtext: "1-2-3 GO!",
                      mode: "video",
                      videoSrc: "/animations/categories/1-2-3-go.mp4",
                    });
                  } catch (_) {}
                  setPhase("active");
                  return;
                }
                setPhase("countdown");
              }}
              className={[
                "px-8 py-4 rounded-3xl text-2xl md:text-3xl font-black shadow-2xl border",
                disabled ? "bg-white/20 border-white/10 opacity-60" : "bg-yellow-400 text-black border-yellow-300 hover:scale-[1.02] transition",
              ].join(" ")}
            >
              Start
            </button>
            <div className="opacity-85 text-lg md:text-xl font-bold">
              Follow the instructions, then tap <span className="text-yellow-200">DONE</span>.
            </div>
          </div>
        </div>
      )}

      {/* Countdown */}
      {phase === "countdown" && !(presenter?.showCountdown) && (
        <div className="text-center flex-1 flex flex-col items-center justify-center">
          <div className="text-3xl md:text-4xl font-extrabold opacity-90">Get ready…</div>
          <div className="mt-4 text-7xl md:text-9xl font-black animate-bounce drop-shadow-2xl">
            {countdown}
          </div>
          <div className="mt-2 text-6xl md:text-8xl font-black text-yellow-200 drop-shadow-2xl">
            GO!
          </div>
        </div>
      )}

      {/* Active */}
      {phase === "active" && (() => {
        // With accelerometer: require count >= target to enable DONE
        // Without accelerometer: require delay to have elapsed
        const motionComplete = !noMotionSupport && count >= target;
        const delayComplete = noMotionSupport && delayElapsed;
        const canFinish = motionComplete || delayComplete;

        return (
          <div className="w-full max-w-5xl flex flex-col items-center flex-1 justify-center">
            <div className="text-2xl md:text-3xl font-black mb-3 px-4 text-center leading-tight">{activityName}</div>

            {hasConfiguredActivity && (
              <div className="w-[70vw] max-w-md md:max-w-lg flex items-center justify-center rounded-3xl bg-black/20 border border-white/20 shadow-2xl" style={{ maxHeight: "50vh" }}>
                {animData ? (
                  <Lottie animationData={animData} loop autoplay style={{ width: "100%", height: "100%", maxHeight: "50vh" }} />
                ) : (
                  <div className="text-8xl md:text-[7rem] animate-bounce drop-shadow-2xl">{emoji}</div>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-4 flex-wrap justify-center">
              {!noMotionSupport && (
                <div className={[
                  "px-5 py-3 rounded-2xl border shadow text-lg md:text-xl font-extrabold transition-colors",
                  motionComplete
                    ? "bg-green-400/30 border-green-300/40 text-green-100"
                    : "bg-white/10 border-white/15",
                ].join(" ")}>
                  {motionComplete
                    ? <span className="text-yellow-200">✓ {target} / {target} — Tap DONE!</span>
                    : <span>Motion count: <span className="text-yellow-200">{count}</span> / {target}</span>
                  }
                </div>
              )}

              {canFinish ? (
                <button
                  type="button"
                  disabled={disabled || done}
                  onClick={submitDone}
                  className={[
                    "px-10 py-4 rounded-3xl text-3xl md:text-4xl font-black shadow-2xl border transition animate-pulse",
                    disabled || done
                      ? "bg-white/20 border-white/10 opacity-60"
                      : "bg-green-400 text-black border-green-200 hover:scale-[1.03]",
                  ].join(" ")}
                >
                  DONE ✓
                </button>
              ) : (
                <div className="px-8 py-4 rounded-3xl text-2xl md:text-3xl font-black bg-white/10 border border-white/10 text-white/50 select-none">
                  {noMotionSupport ? "Keep going..." : `${count} / ${target}`}
                </div>
              )}
            </div>

            {noMotionSupport && !done && !delayElapsed && (
              <div className="mt-3 text-lg md:text-xl font-bold opacity-90 animate-pulse">
                Do the activity! DONE button appears when you're ready...
              </div>
            )}
            {noMotionSupport && !done && delayElapsed && (
              <div className="mt-3 text-lg md:text-xl font-bold opacity-90">
                Finished? Tap DONE above!
              </div>
            )}
          </div>
        );
      })()}

      {/* Done */}
      {phase === "done" && (
        <div className="text-center flex-1 flex flex-col items-center justify-center">
          <div className="text-8xl md:text-9xl font-black text-yellow-200 drop-shadow-2xl">NICE!</div>
          <div className="mt-4 text-3xl md:text-4xl font-extrabold opacity-90">Mission complete.</div>
        </div>
      )}
    </div>
  );
}
