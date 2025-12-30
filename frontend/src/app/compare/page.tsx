import Link from "next/link";

type Mark = "yes" | "no" | "partial" | "text";

function IconMark({
  value,
  label,
}: {
  value: Exclude<Mark, "text">;
  label: string;
}) {
  const base =
    "inline-flex items-center gap-2 font-semibold whitespace-nowrap";
  if (value === "yes") {
    return (
      <span className={`${base} text-emerald-700`}>
        <span aria-hidden="true">✔</span>
        <span className="sr-only">{label}: Yes</span>
        <span aria-hidden="true">Yes</span>
      </span>
    );
  }
  if (value === "no") {
    return (
      <span className={`${base} text-rose-700`}>
        <span aria-hidden="true">✖</span>
        <span className="sr-only">{label}: No</span>
        <span aria-hidden="true">No</span>
      </span>
    );
  }
  // partial
  return (
    <span className={`${base} text-amber-700`}>
      <span aria-hidden="true">◯</span>
      <span className="sr-only">{label}: Limited</span>
      <span aria-hidden="true">Limited</span>
    </span>
  );
}

function Cell({
  mark,
  text,
  label,
  className = "",
}: {
  mark: Mark;
  text?: string;
  label: string;
  className?: string;
}) {
  if (mark === "text") {
    return <td className={`p-4 ${className}`}>{text}</td>;
  }
  return (
    <td className={`p-4 ${className}`}>
      <IconMark value={mark} label={label} />
      {text ? <span className="ml-2 text-gray-600 font-medium">({text})</span> : null}
    </td>
  );
}

export default function ComparePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      {/* Print styles + hide non-print UI */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          main {
            max-width: 100% !important;
            padding: 0 !important;
          }
          table {
            font-size: 12px !important;
          }
          th,
          td {
            padding: 10px !important;
          }
        }
      `}</style>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-3">Compare Curriculate</h1>
          <p className="text-lg text-gray-600">
            See how Curriculate compares to traditional station learning tools,
            static worksheets, and common edtech platforms.
          </p>
        </div>

        <div className="no-print flex gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border px-4 py-2 font-semibold hover:bg-gray-50"
            aria-label="Print or save as PDF"
          >
            Print / Save PDF
          </button>
          <Link
            href="/pricing"
            className="rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700"
          >
            View Pricing
          </Link>
        </div>
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full border border-gray-200 rounded-xl overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-4 text-left">Feature</th>
              <th className="p-4 text-left">Curriculate</th>
              <th className="p-4 text-left">Traditional Stations</th>
              <th className="p-4 text-left">Other EdTech Tools</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            <tr>
              <td className="p-4">AI-generated tasks</td>
              <Cell mark="yes" label="Curriculate AI-generated tasks" />
              <Cell mark="no" label="Traditional stations AI-generated tasks" />
              <Cell mark="partial" label="Other edtech AI-generated tasks" text="Varies / limited" />
            </tr>

            <tr>
              <td className="p-4">Live teacher pacing</td>
              <Cell mark="yes" label="Curriculate live pacing" />
              <Cell mark="no" label="Traditional stations live pacing" />
              <Cell mark="partial" label="Other edtech live pacing" text="Often timer-based" />
            </tr>

            <tr>
              <td className="p-4">Student engagement tracking</td>
              <Cell mark="yes" label="Curriculate engagement tracking" text="Built-in" />
              <Cell mark="partial" label="Traditional stations engagement tracking" text="Manual" />
              <Cell mark="partial" label="Other edtech engagement tracking" text="Clicks/answers only" />
            </tr>

            <tr>
              <td className="p-4">Reports & transcripts</td>
              <Cell mark="yes" label="Curriculate reports & transcripts" text="Automatic" />
              <Cell mark="no" label="Traditional stations reports & transcripts" />
              <Cell mark="partial" label="Other edtech reports & transcripts" text="Basic exports" />
            </tr>

            <tr>
              <td className="p-4">Setup time</td>
              <td className="p-4 font-semibold text-emerald-700">&lt; 3 minutes</td>
              <td className="p-4 text-gray-700 font-semibold">30–60 minutes</td>
              <td className="p-4 text-gray-700 font-semibold">5–20 minutes</td>
            </tr>

            <tr>
              <td className="p-4">Evidence capture (photo, audio, drawing)</td>
              <Cell mark="yes" label="Curriculate evidence capture" text="Built-in" />
              <Cell mark="partial" label="Traditional stations evidence capture" text="Possible, manual" />
              <Cell mark="partial" label="Other edtech evidence capture" text="Some tools only" />
            </tr>

            <tr>
              <td className="p-4">Auto-scoring & feedback</td>
              <Cell mark="yes" label="Curriculate auto-scoring & feedback" text="Optional AI + rubric" />
              <Cell mark="no" label="Traditional stations auto-scoring & feedback" />
              <Cell mark="partial" label="Other edtech auto-scoring & feedback" text="Mainly objective" />
            </tr>

            <tr>
              <td className="p-4">Designed for movement & rotation</td>
              <Cell mark="yes" label="Curriculate movement & rotation" text="QR-based flow" />
              <Cell mark="yes" label="Traditional stations movement & rotation" text="Manual" />
              <Cell mark="partial" label="Other edtech movement & rotation" text="Usually seated" />
            </tr>

            <tr>
              <td className="p-4">Supports fixed stations & multi-room activities</td>
              <Cell mark="yes" label="Curriculate fixed stations & multi-room" text="Exhibits, art, scavenger hunts" />
              <Cell mark="partial" label="Traditional fixed stations & multi-room" text="Doable, high effort" />
              <Cell mark="partial" label="Other edtech fixed stations & multi-room" text="Not the focus" />
            </tr>

            <tr>
              <td className="p-4">Differentiation & variants</td>
              <Cell mark="yes" label="Curriculate differentiation & variants" text="Instant variants" />
              <Cell mark="no" label="Traditional differentiation & variants" text="Rebuild / reprint" />
              <Cell mark="partial" label="Other edtech differentiation & variants" text="Limited branching" />
            </tr>

            <tr>
              <td className="p-4">Team accountability</td>
              <Cell mark="yes" label="Curriculate team accountability" text="Team submissions" />
              <Cell mark="partial" label="Traditional team accountability" text="Hard to track" />
              <Cell mark="partial" label="Other edtech team accountability" text="Often individual" />
            </tr>

            <tr>
              <td className="p-4">Teacher insight during class</td>
              <Cell mark="yes" label="Curriculate teacher insight" text="Live dashboard" />
              <Cell mark="partial" label="Traditional teacher insight" text="Walk-around" />
              <Cell mark="partial" label="Other edtech teacher insight" text="After answers" />
            </tr>

            <tr>
              <td className="p-4">Works on any mobile device (no app required)</td>
              <Cell mark="yes" label="Curriculate mobile no app" text="Phone, tablet, Chromebook" />
              <Cell mark="partial" label="Traditional stations mobile no app" text="Depends on materials" />
              <Cell mark="partial" label="Other edtech mobile no app" text="Varies by platform" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="no-print mt-12 flex gap-4">
        <Link
          href="/demo"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-700"
        >
          Try the Demo
        </Link>
        <Link
          href="/pricing"
          className="rounded-lg border px-6 py-3 font-semibold hover:bg-gray-50"
        >
          View Pricing
        </Link>
      </div>
    </main>
  );
}
