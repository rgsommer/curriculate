// frontend/src/app/reports/page.tsx
import Link from "next/link";
import { Download, ArrowRight, FileText, GraduationCap, ClipboardList } from "lucide-react";

const docs = [
  {
    title: "Student Report Sample (Grade 5)",
    file: "/pdfs/Curriculate-Student-Report-SampleGr5.pdf",
    downloadName: "Curriculate-Student-Report-SampleGr5.pdf",
    icon: <GraduationCap className="w-6 h-6 text-blue-600" />,
    bullets: [
      "Encouraging, grade-appropriate language",
      "Participation + task highlights",
      "Strengths + growth focus",
      "Optional reflection bonus (“What I learned”)",
    ],
  },
  {
    title: "Student Report Sample (Grade 7)",
    file: "/pdfs/Curriculate-Student-Report-SampleGr7.pdf",
    downloadName: "Curriculate-Student-Report-SampleGr7.pdf",
    icon: <GraduationCap className="w-6 h-6 text-purple-600" />,
    bullets: [
      "Clear, readable by students + parents",
      "Specific task evidence (not vague praise)",
      "Targets for improvement without discouragement",
      "Great for conferencing and home communication",
    ],
  },
  {
    title: "Teacher Session Report",
    file: "/pdfs/Curriculate-Teacher-Report-Sample.pdf",
    downloadName: "Curriculate-Teacher-Report-Sample.pdf",
    icon: <ClipboardList className="w-6 h-6 text-emerald-600" />,
    bullets: [
      "Session overview + team performance snapshot",
      "Task-by-task analysis and misconceptions",
      "Engagement highlights and next-lesson targets",
      "Actionable, not spreadsheet overload",
    ],
  },
];

export default function ReportsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Sample Reports</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Reports aren’t just scores — they’re evidence. Clear enough for parents, actionable enough for teachers.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {docs.map((d) => (
            <div key={d.title} className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
                  {d.icon}
                </div>
                <h2 className="text-xl font-extrabold text-gray-900">{d.title}</h2>
              </div>

              <ul className="mt-4 space-y-2 text-gray-800 font-medium">
                {d.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <span className="mt-2 w-2 h-2 rounded-full bg-blue-600" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex flex-col gap-3">
                <a
                  href={d.file}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-white text-base font-black shadow-xl hover:bg-blue-700"
                >
                  <Download className="w-5 h-5" /> Open PDF
                </a>
                <a
                  href={d.file}
                  download={d.downloadName}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-gray-900 text-base font-black shadow-xl border border-gray-200 hover:bg-gray-50"
                >
                  <FileText className="w-5 h-5" /> Download
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-3">Why reports matter</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Readable</div>
              <div className="text-gray-700 font-medium">Not spreadsheets. Clear takeaways teachers, students, and parents understand.</div>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Actionable</div>
              <div className="text-gray-700 font-medium">Highlights misconceptions and next targets so your next lesson is obvious.</div>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6">
              <div className="font-black text-gray-900 mb-2">Immediate</div>
              <div className="text-gray-700 font-medium">Generated right after the session — no “I’ll get to it later” grading pile.</div>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              See Plans <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/features"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              Explore Features
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
