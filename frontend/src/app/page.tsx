  // frontend/src/app/page.tsx
  "use client";
  import React from "react";
  import Link from "next/link";
  import HoverVideo from "../components/HoverVideo";
  import {
    ArrowRight,
    Sparkles,
    CheckCircle,
    Printer,
    Zap,
    Users,
    BarChart3,
    Footprints,
    ShieldCheck,
  } from "lucide-react";

  const why = [
    {
      icon: <Footprints className="w-6 h-6 text-blue-600" />,
      title: "Purposeful movement",
      desc: "Stations get students moving with structure — not wandering.",
    },
    {
      icon: <Users className="w-6 h-6 text-purple-600" />,
      title: "Real collaboration",
      desc: "Teams submit together, build roles naturally, and learn from each other.",
    },
    {
      icon: <Zap className="w-6 h-6 text-yellow-600" />,
      title: "More than recall",
      desc: "Debate, creation, explanation, and evidence — not just multiple choice.",
    },
    {
      icon: <BarChart3 className="w-6 h-6 text-emerald-600" />,
      title: "Instant insight",
      desc: "See understanding during the lesson and adjust in real time.",
    },
    {
      icon: <ShieldCheck className="w-6 h-6 text-indigo-600" />,
      title: "Teacher-controlled AI",
      desc: "Optional AI generation and feedback — always overrideable by the teacher.",
    },
  ];

  const steps = [
    { n: "1", title: "Launch a task set", desc: "Start from the Teacher Dashboard in one click." },
    { n: "2", title: "Teams join fast", desc: "No accounts — just a room code + team name." },
    { n: "3", title: "Rotate stations", desc: "QR or color stations guide movement with clarity." },
    { n: "4", title: "Submit together", desc: "Text, photos, drawings, audio — evidence included." },
    { n: "5", title: "Reports generated", desc: "Teacher + student reports appear automatically." },
  ];


  function Testimonials() {
    const [active, setActive] = React.useState<"teacher" | "student">("teacher");
    const [controls, setControls] = React.useState(false);
    const [unmuted, setUnmuted] = React.useState(false);

    const teacherRef = React.useRef<HTMLVideoElement | null>(null);
    const studentRef = React.useRef<HTMLVideoElement | null>(null);

    function getActiveVideo() {
      return active === "teacher" ? teacherRef.current : studentRef.current;
    }
    function getOtherVideo() {
      return active === "teacher" ? studentRef.current : teacherRef.current;
    }

    function resetVideo(v: HTMLVideoElement | null) {
      if (!v) return;
      v.pause();
      v.currentTime = 0;
      v.muted = true;
    }

    React.useEffect(() => {
      // switch videos: keep autoplay muted, hide controls until user taps
      setControls(false);
      setUnmuted(false);

      resetVideo(getOtherVideo());

      const v = getActiveVideo();
      if (!v) return;
      v.muted = true;
      v.loop = true;
      v.play().catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    function onTap() {
      const v = getActiveVideo();
      if (!v) return;

      // First interaction: unmute + show controls
      if (v.muted) {
        v.muted = false;
        setUnmuted(true);
        setControls(true);
        v.play().catch(() => {});
        return;
      }

      // After unmuted: toggle play/pause
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }

    const btnBase =
      "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold transition";
    const btnOn =
      "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm";
    const btnOff =
      "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50";

    return (
      <section className="mx-auto mt-24 max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
            Real Voices. Real Learning.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-gray-600">
            Autoplay muted for browsing. Tap to play with sound and captions.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setActive("teacher")}
              className={`${btnBase} ${active === "teacher" ? btnOn : btnOff}`}
            >
              🎓 Watch teacher
            </button>
            <button
              type="button"
              onClick={() => setActive("student")}
              className={`${btnBase} ${active === "student" ? btnOn : btnOff}`}
            >
              🧠 Watch student
            </button>
          </div>
        </div>

        <div className="mx-auto mt-10 max-w-4xl">
          <div className="rounded-3xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            <div
              className="relative cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label="Tap to play / unmute"
              onClick={onTap}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onTap();
                }
              }}
            >
              <video
                ref={teacherRef}
                src="/testimonials/teacher-testimonial.mp4"
                poster="/images/posters/teacher-testimonial.png"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                controls={controls && active === "teacher"}
                className={`w-full h-auto ${active === "teacher" ? "block" : "hidden"}`}
              >
                <track
                  kind="captions"
                  src="/testimonials/teacher-testimonial.vtt"
                  srcLang="en"
                  label="English"
                  default
                />
              </video>

              <video
                ref={studentRef}
                src="/testimonials/student-testimonial.mp4"
                poster="/images/posters/student-testimonial.png"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                controls={controls && active === "student"}
                className={`w-full h-auto ${active === "student" ? "block" : "hidden"}`}
              >
                <track
                  kind="captions"
                  src="/testimonials/student-testimonial.vtt"
                  srcLang="en"
                  label="English"
                  default
                />
              </video>

              <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-extrabold text-white">
                  {unmuted ? "Tap to pause/play" : "Tap for sound"}
                </span>
                <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-extrabold text-white">
                  CC
                </span>
              </div>
            </div>

            <div className="p-6">
              {active === "teacher" ? (
                <>
                  <h3 className="text-lg font-extrabold text-gray-900">
                    For Teachers
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Less prep. Smooth station flow. End-of-session reports that
                    support grading and formative feedback for students and
                    parents.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-extrabold text-gray-900">
                    For Students
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Learning by doing — moving, collaborating, and understanding
                    the material more deeply, not just memorizing it.
                  </p>
                </>
              )}

              <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-gray-500">
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                  Autoplay muted
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                  Tap to hear audio
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                  Captions available
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  function SampleMultipleChoice() {
    return (
      <div className="max-w-md mx-auto">
        <h3 className="text-2xl font-extrabold text-gray-900 mb-6 text-center">
          Photosynthesis Review
        </h3>

        <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50/60 p-6 shadow-inner">
          <p className="text-lg font-bold text-gray-800 mb-6 text-center">
            What is the primary source of energy for Earth’s climate system?
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-500 text-white px-4 py-4 font-bold shadow">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-emerald-600 font-black">
                ✓
              </span>
              The Sun
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-gray-400 font-semibold">
              Geothermal heat
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-gray-400 font-semibold">
              Ocean currents
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-gray-400 font-semibold">
              Earth’s core
            </div>
          </div>
        </div>
      </div>
    );
  }

  export default function Home() {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        {/* Hero */}
        <section className="relative overflow-hidden px-6 py-12 sm:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="text-center">
              <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-gray-900 mb-4 sm:mb-6 leading-[1.05] tracking-tight">
                Curriculate<span className="text-blue-600">.net</span>
              </h1>

              <p className="text-lg sm:text-2xl text-gray-700 mb-8 sm:mb-10 max-w-2xl mx-auto font-medium leading-snug">
                Active, movement-based learning — without the chaos.
              </p>

              <div className="grid grid-cols-1 sm:flex sm:flex-row gap-3 sm:gap-4 justify-center mb-10 sm:mb-14 max-w-md sm:max-w-none mx-auto">
                <Link
                  href="/dashboard"
                  className="group inline-flex w-full sm:w-auto items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white text-lg sm:text-xl font-bold py-4 sm:py-5 px-6 sm:px-10 rounded-2xl shadow-2xl transform hover:scale-[1.02] transition-all"
                >
                  Get Started Free
                  <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition" />
                </Link>

                <Link
                  href="/reports"
                  className="inline-flex w-full sm:w-auto items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-900 text-lg sm:text-xl font-bold py-4 sm:py-5 px-6 sm:px-8 rounded-2xl shadow-xl border border-gray-200"
                >
                  View Sample Reports
                </Link>

                <Link
                  href="/station-posters"
                  className="inline-flex w-full sm:w-auto items-center justify-center gap-3 bg-purple-600 hover:bg-purple-700 text-white text-lg sm:text-xl font-bold py-4 sm:py-5 px-6 sm:px-8 rounded-2xl shadow-2xl"
                >
                  <Printer className="w-6 h-6" />
                  Station Posters
                </Link>
              </div>
            </div>

            {/* LIVE PREVIEW */}
            <div className="mx-auto mt-10 sm:mt-0 max-w-6xl">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-10 items-start">
                {/* LEFT: the big sample card (takes 2/3 on desktop) */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-200">
                    <div className="bg-gray-100 px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 border-b">
                      <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-400"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                        <div className="w-3 h-3 rounded-full bg-green-400"></div>
                      </div>
                      <div className="ml-2 sm:ml-4 flex-1 bg-white rounded-lg px-3 sm:px-4 py-1 text-xs sm:text-sm text-gray-600 truncate">
                        curriculate.net/play/abcd1234
                      </div>
                    </div>

                    <div className="p-6 sm:p-10">
                      <SampleMultipleChoice />
                    </div>
                  </div>
                  <p className="text-center mt-6 sm:mt-8 text-gray-500 font-medium text-sm sm:text-base">
                    ↑ This is what your students see — live, beautiful, and instant
                  </p>
                </div>

                {/* RIGHT: inset HoverVideo (sticky on desktop) */}
                <div className="lg:col-span-1">
                  <div className="lg:sticky lg:top-24">
                    <div className="rounded-3xl border border-gray-200 bg-white shadow-xl overflow-hidden">
                      <div className="px-4 py-3 border-b bg-gray-50">
                        <div className="text-sm font-extrabold text-gray-900">Station Preview</div>
                        <div className="text-xs text-gray-600 font-medium">Hover to switch views</div>
                      </div>

                      <div className="p-3">
                        <div className="mx-auto w-full max-w-sm lg:max-w-none">
                          <HoverVideo
                            primarySrc="/videos/station-rotation-single-room.mp4"
                            hoverSrc="/videos/station-rotation-multi-room.mp4"
                            primaryPoster="/images/posters/station-rotation-single-room.png"
                            hoverPoster="/images/posters/station-rotation-multi-room.png"
                            label="Station Rotation Preview"
                          />
                        </div>
                      </div>

                      <div className="px-4 pb-4">
                        <p className="text-xs text-gray-500 font-medium">
                          Desktop: hover to compare. Mobile: tap to play.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Why */}
        <section className="px-6 py-14">
          <div className="mx-auto max-w-7xl">
            <h2 className="text-4xl font-black text-gray-900 text-center mb-4">
              Not another quiz app. A better way to run class.
            </h2>
            <p className="text-lg text-gray-700 text-center max-w-3xl mx-auto mb-10">
              Curriculate blends movement, teamwork, and formative assessment — while keeping teachers in control.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {why.map((f) => (
                <div key={f.title} className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                      {f.icon}
                    </div>
                    <h3 className="text-xl font-extrabold text-gray-900">{f.title}</h3>
                  </div>
                  <p className="text-gray-700 font-medium">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-6 py-14">
          <div className="mx-auto max-w-7xl">
            <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
              <h2 className="text-4xl font-black text-gray-900 mb-3">How it works</h2>
              <p className="text-lg text-gray-700 font-medium mb-10 max-w-3xl">
                A clear, repeatable flow that supports both energetic and structured classrooms.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                {steps.map((s) => (
                  <div key={s.n} className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
                    <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white font-black flex items-center justify-center mb-4">
                      {s.n}
                    </div>
                    <h3 className="text-lg font-extrabold text-gray-900 mb-2">{s.title}</h3>
                    <p className="text-gray-700 font-medium">{s.desc}</p>
                  </div>
                ))}
              </div>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/features"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
                >
                  Explore Features <ArrowRight className="w-5 h-5" />
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
                >
                  See Plans
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-6 py-16">
          <div className="mx-auto max-w-7xl">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-2xl p-12 text-white">
              <h2 className="text-4xl font-black mb-3">Active learning — done right.</h2>
              <p className="text-lg font-medium text-white/90 max-w-3xl">
                Run stations with clarity, capture real evidence, and leave class with reports already done.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl hover:bg-gray-100"
                >
                  Get Started Free <ArrowRight className="w-5 h-5" />
                </Link>
                <Link
                  href="/reports"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 py-4 text-white text-lg font-black hover:bg-white/15"
                >
                  View Reports
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }