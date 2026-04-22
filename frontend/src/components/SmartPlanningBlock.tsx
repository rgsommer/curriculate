// components/SmartPlanningBlock.tsx
export function SmartPlanningBlock() {
  const bullets = [
    "Plans the learning experience first — then generates the tasks to match.",
    "Uses real task durations to fill your lesson window (e.g., 45 minutes).",
    "Balances variety: quick retrieval, deeper thinking, collaboration, and creativity.",
    "Includes movement/body-break tasks intentionally (not randomly).",
    "Prevents movement from being overused or back-to-back.",
    "Only selects task types that are classroom-ready and UI-supported.",
  ];

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800">
          🧠 Smart Task Planning
        </div>
        <h2 className="text-2xl font-bold text-slate-900">
          Not just AI task generation — AI scavenger hunt pacing and planning
        </h2>
        <p className="text-slate-600">
          Curriculate doesn’t generate a random pile of activities. It first plans a
          time-fit, grade-appropriate mix of task types for your topic and learning goal —
          then generates tasks to match that plan.
        </p>

        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-slate-700">
              <span className="mt-1 text-green-600">✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          <span className="font-semibold">Why this matters:</span> a 45-minute scavenger hunt is designed to
          actually run for about 45 minutes — without rushed endings or dead time.
        </div>
      </div>
    </section>
  );
}
