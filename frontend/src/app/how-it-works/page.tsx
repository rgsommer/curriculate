// frontend/src/app/how-it-works/page.tsx
import React from "react";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      {children}
    </div>
  );
}

function Dot() {
  return <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />;
}

function StepCard({
  number,
  title,
  desc,
  icon,
  bullets,
}: {
  number: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  bullets: string[];
}) {
  return (
    <div className="group relative overflow-hidden rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 transition hover:shadow-md">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-50 blur-2xl" />
      <div className="relative flex items-start gap-4">
        <div className="shrink-0">
          <Icon>{icon}</Icon>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              Step {number}
            </span>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{desc}</p>

          <ul className="mt-4 space-y-2">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-1">
                  <Dot />
                </span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function LifecycleNode({
  label,
  sub,
  icon,
}: {
  label: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5">
      <Icon>{icon}</Icon>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="text-xs text-slate-600">{sub}</div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center px-2 text-slate-400">
      <svg width="28" height="14" viewBox="0 0 28 14" fill="none" aria-hidden="true">
        <path
          d="M1 7h24m0 0-5-5m5 5-5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-indigo-50">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pt-16 pb-10 sm:pt-20">
        <div className="absolute inset-0 opacity-60">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-200 blur-3xl" />
          <div className="absolute -right-24 top-10 h-72 w-72 rounded-full bg-indigo-200 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-semibold text-slate-700 ring-1 ring-black/5 backdrop-blur">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            For teachers & session leaders
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            How Curriculate Works
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-700 sm:text-lg">
            A simple loop: prepare a task set, launch a live session, students rotate through stations,
            work is captured automatically, and you finish with clear reports you can reuse next time.
          </p>

          {/* Quick lifecycle strip */}
          <div className="mt-10 rounded-3xl bg-white/70 p-5 shadow-sm ring-1 ring-black/5 backdrop-blur">
            <div className="text-sm font-semibold text-slate-900">The quick life-cycle</div>
            <p className="mt-1 text-sm text-slate-600">
              Everything runs as a repeatable flow you can use again and again.
            </p>

            <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <LifecycleNode
                label="Build"
                sub="Pick standards + tasks"
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 7h16M4 12h10M4 17h16"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                }
              />
              <div className="hidden lg:block">
                <Arrow />
              </div>
              <LifecycleNode
                label="Launch"
                sub="Start a live session"
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M8 5v14l11-7-11-7Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
              />
              <div className="hidden lg:block">
                <Arrow />
              </div>
              <LifecycleNode
                label="Play"
                sub="Stations + teamwork"
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M7 20a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm10 0a4 4 0 1 1 0-8 4 4 0 0 1 0 8ZM7 12V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                }
              />
              <div className="hidden lg:block">
                <Arrow />
              </div>
              <LifecycleNode
                label="Capture"
                sub="Answers auto-saved"
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M8 12h8M8 16h5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                }
              />
              <div className="hidden lg:block">
                <Arrow />
              </div>
              <LifecycleNode
                label="Report"
                sub="Teacher + student views"
                icon={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M7 3h10v18H7V3Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M9 7h6M9 11h6M9 15h4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                }
              />
            </div>
          </div>
        </div>
      </section>

      {/* Steps grid */}
      <section className="px-6 pb-14">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">In a bit more detail</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            The goal is to keep teacher setup fast, keep student directions simple, and make the end-of-session
            reporting automatic.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <StepCard
              number="1"
              title="Build a Task Set"
              desc="Create (or generate) a set of station activities for your lesson."
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 6a2 2 0 0 1 2-2h8l6 6v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M14 4v6h6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </svg>
              }
              bullets={[
                "Choose a subject/topic and the number of stations.",
                "Mix task types: quick checks, collaboration, short written work, etc.",
                "Save it so you can reuse it (and tweak it) anytime.",
              ]}
            />

            <StepCard
              number="2"
              title="Launch a Live Session"
              desc="Start the session on the teacher screen and get teams ready."
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 2v4M12 18v4M4 12H2M22 12h-2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M7 12a5 5 0 0 1 10 0"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              }
              bullets={[
                "Teams join quickly (scan/code).",
                "You control pacing: start, pause, rotate, and end.",
                "Everything is tracked automatically while students work.",
              ]}
            />

            <StepCard
              number="3"
              title="Students Rotate & Complete Tasks"
              desc="Students work station-by-station with clear on-screen prompts."
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M7 7h10v10H7V7Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M4 4h4M16 4h4M4 20h4M16 20h4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              }
              bullets={[
                "One device per team is enough (others can watch/assist).",
                "Stations can be QR-coded posters, table signs, or screen prompts.",
                "Keeps students moving, collaborating, and focused.",
              ]}
            />

            <StepCard
              number="4"
              title="Work is Captured & Organized"
              desc="Responses, scores, and timestamps are saved without extra teacher steps."
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 12v9"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              }
              bullets={[
                "Team answers are stored by station and task type.",
                "Optional scoring and feedback can be generated automatically.",
                "No “paper chase” after class—everything is already sorted.",
              ]}
            />

            <StepCard
              number="5"
              title="Reports & Next Steps"
              desc="End the session and review what happened—fast."
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M7 7h10M7 11h10M7 15h6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              }
              bullets={[
                "Teacher report: whole-class overview + station performance.",
                "Student/team report: what they did + what to improve next time.",
                "Reuse the task set next week with quick edits.",
              ]}
            />

            <div className="relative overflow-hidden rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
              <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-indigo-50 blur-2xl" />
              <h3 className="relative text-lg font-semibold text-slate-900">Recommended devices</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-slate-600">
                Students can participate with phones, but the best experience is when each team has a shared screen.
              </p>

              <div className="relative mt-5 space-y-3">
                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-black/5">
                  <div className="text-sm font-semibold text-slate-900">Ideal setup (most classrooms)</div>
                  <div className="mt-1 text-sm text-slate-700">
                    <span className="font-semibold">~1 tablet per 3 students</span> (one device per team).
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    <li className="flex items-start gap-2">
                      <span className="mt-1">
                        <Dot />
                      </span>
                      <span>Teams collaborate around a single screen (fewer logins, fewer distractions).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1">
                        <Dot />
                      </span>
                      <span>Teachers can run a class with a small cart/roaming set of tablets.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1">
                        <Dot />
                      </span>
                      <span>Phones still work for “extra hands,” quick look-ups, or accessibility needs.</span>
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                  <div className="text-sm font-semibold text-slate-900">Reality check (and encouragement)</div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">
                    Many schools already have tablets (classroom sets or carts). If not, Curriculate still works on
                    student phones—just expect a slightly smaller, more “tap-heavy” experience for younger students.
                  </p>
                </div>
              </div>

              <div className="relative mt-5 flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  Tablet cart friendly
                </span>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
                  Phones supported
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-black/5">
                  One device per team
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-6xl rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-white shadow-lg">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold sm:text-2xl">Ready to try it with your class?</h2>
              <p className="mt-2 max-w-2xl text-sm text-white/80">
                Start with one lesson, 4–6 stations, and teams of 3. If you have access to a tablet cart,
                you’re basically set.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href="/pricing"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-white/20 transition hover:opacity-95"
              >
                See Plans
              </a>
              <a
                href="/signup"
                className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm ring-1 ring-emerald-400/30 transition hover:brightness-105"
              >
                Get Started
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
