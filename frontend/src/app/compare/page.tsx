import Link from "next/link";

type Mark = "yes" | "no" | "partial";

function MarkIcon({ value }: { value: Mark }) {
  if (value === "yes") {
    return (
      <span className="inline-flex items-center gap-2 font-semibold text-emerald-700">
        <span aria-hidden="true">✔</span>
        <span className="sr-only">Yes</span>
        <span aria-hidden="true">Yes</span>
      </span>
    );
  }
  if (value === "no") {
    return (
      <span className="inline-flex items-center gap-2 font-semibold text-rose-700">
        <span aria-hidden="true">✖</span>
        <span className="sr-only">No</span>
        <span aria-hidden="true">No</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-amber-700">
      <span aria-hidden="true">◯</span>
      <span className="sr-only">Limited</span>
      <span aria-hidden="true">Limited</span>
    </span>
  );
}

function Cell({
  mark,
  detail,
}: {
  mark: Mark;
  detail?: string;
}) {
  return (
    <td className="p-4">
      <MarkIcon value={mark} />
      {detail ? (
        <span className="ml-2 text-gray-600 font-medium">({detail})</span>
      ) : null}
    </td>
  );
}

export default function ComparePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16 print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between print:block">
        <div>
          <h1 className="text-4xl font-bold mb-3 print:mb-2">
            Compare Curriculate
          </h1>
          <p className="text-lg text-gray-600 print:text-gray-800 print:text-base">
            See how Curriculate compares to traditional station learning tools,
            static worksheets, and common edtech platforms.
          </p>

          {/* Print hint (shows only on screen) */}
          <p className="mt-2 text-sm text-gray-500 print:hidden">
            Tip: Use your browser’s Print command to save as PDF.
          </p>
        </div>

        {/* Screen-only buttons */}
        <div className="flex gap-3 print:hidden">
          <Link
            href="/pricing"
            className="rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700"
          >
            View Pricing
          </Link>
          <Link
            href="/demo"
            className="rounded-lg border px-4 py-2 font-semibold hover:bg-gray-50"
          >
            Try the Demo
          </Link>
        </div>
      </div>

      <div className="mt-10 overflow-x-auto print:overflow-visible">
        <table className="w-full border border-gray-200 rounded-xl overflow-hidden print:border-gray-300">
          <thead className="bg-gray-50 print:bg-white">
            <tr>
              <th className="p-4 text-left">Feature</th>
              <th className="p-4 text-left">Curriculate</th>
              <th className="p-4 text-left">Traditional Stations</th>
              <th className="p-4 text-left">Other EdTech Tools</th>
            </tr>
          </thead>

          <tbody className="divide-y print:divide-gray-200">
            <tr>
              <td className="p-4">AI-generated tasks</td>
              <Cell mark="yes" />
              <Cell mark="no" />
              <Cell mark="partial" detail="Varies / limited" />
            </tr>

            <tr>
              <td className="p-4">Live teacher pacing</td>
              <Cell mark="yes" />
              <Cell mark="no" />
              <Cell mark="partial" detail="Often timer-based" />
            </tr>

            <tr>
              <td className="p-4">Student engagement tracking</td>
              <Cell mark="yes" detail="Built-in" />
              <Cell mark="partial" detail="Manual" />
              <Cell mark="partial" detail="Clicks/answers only" />
            </tr>

            <tr>
              <td className="p-4">Reports & transcripts</td>
              <Cell mark="yes" detail="Automatic" />
              <Cell mark="no" />
              <Cell mark="partial" detail="Basic exports" />
            </tr>

            <tr>
              <td className="p-4">Setup time</td>
              <td className="p-4 font-semibold text-emerald-700">&lt; 3 minutes</td>
              <td className="p-4 text-gray-700 font-semibold">30–60 minutes</td>
              <td className="p-4 text-gray-700 font-semibold">5–20 minutes</td>
            </tr>

            <tr>
              <td className="p-4">Evidence capture (photo, audio, drawing)</td>
              <Cell mark="yes" detail="Built-in" />
              <Cell mark="partial" detail="Possible, manual" />
              <Cell mark="partial" detail="Some tools only" />
            </tr>

            <tr>
              <td className="p-4">Auto-scoring & feedback</td>
              <Cell mark="yes" detail="Optional AI + rubric" />
              <Cell mark="no" />
              <Cell mark="partial" detail="Mostly objective" />
            </tr>

            <tr>
              <td className="p-4">Designed for movement & rotation</td>
              <Cell mark="yes" detail="QR-based flow" />
              <Cell mark="yes" detail="Manual" />
              <Cell mark="partial" detail="Usually seated" />
            </tr>

            <tr>
              <td className="p-4">Supports fixed stations & multi-room activities</td>
              <Cell mark="yes" detail="Exhibits, art, scavenger hunts" />
              <Cell mark="partial" detail="Doable, high effort" />
              <Cell mark="partial" detail="Not the focus" />
            </tr>

            <tr>
              <td className="p-4">Differentiation & variants</td>
              <Cell mark="yes" detail="Instant variants" />
              <Cell mark="no" detail="Rebuild / reprint" />
              <Cell mark="partial" detail="Limited branching" />
            </tr>

            <tr>
              <td className="p-4">Team accountability</td>
              <Cell mark="yes" detail="Team submissions" />
              <Cell mark="partial" detail="Hard to track" />
              <Cell mark="partial" detail="Often individual" />
            </tr>

            <tr>
              <td className="p-4">Teacher insight during class</td>
              <Cell mark="yes" detail="Live dashboard" />
              <Cell mark="partial" detail="Walk-around" />
              <Cell mark="partial" detail="After answers" />
            </tr>

            <tr>
              <td className="p-4">Works on any mobile device (no app required)</td>
              <Cell mark="yes" detail="Phone, tablet, Chromebook" />
              <Cell mark="partial" detail="Depends on materials" />
              <Cell mark="partial" detail="Varies by platform" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-10 text-sm text-gray-500 print:text-gray-700">
        <span className="font-semibold">Printing:</span> On Chrome/Edge/Safari, choose{" "}
        <span className="font-semibold">Print</span> →{" "}
        <span className="font-semibold">Save as PDF</span>.
      </div>
    </main>
  );
}
