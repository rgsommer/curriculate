// frontend/src/app/faq/page.tsx
const faqs = [
  {
    q: "Do students need accounts?",
    a: "No. Students join with a room code and team name. Fast onboarding and fewer privacy concerns.",
  },
  {
    q: "Does Curriculate replace teaching?",
    a: "No. It amplifies effective teaching practices by adding structure, visibility, and evidence — not replacing instruction.",
  },
  {
    q: "Is it chaotic because students move around?",
    a: "Movement is purposeful and structured. Stations, time limits, and teacher-controlled pacing keep energy productive.",
  },
  {
    q: "What devices does it work on?",
    a: "Any modern browser: phones, tablets, Chromebooks, and laptops. No installs required.",
  },
  {
    q: "Is AI required?",
    a: "No. AI is optional and teacher-controlled. Use it for generation/feedback when helpful; turn it off anytime.",
  },
  {
    q: "Can this work in a quiet, structured classroom?",
    a: "Yes. Curriculate supports timers, clear expectations, and teacher pacing controls. Competition and effects can be disabled.",
  },
];

export default function FAQPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">FAQ</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Quick answers to the questions teachers and administrators ask most often.
        </p>

        <div className="space-y-4">
          {faqs.map((f) => (
            <div key={f.q} className="bg-white rounded-3xl shadow-xl border border-gray-200 p-8">
              <div className="text-xl font-extrabold text-gray-900 mb-2">{f.q}</div>
              <div className="text-gray-700 font-medium">{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
