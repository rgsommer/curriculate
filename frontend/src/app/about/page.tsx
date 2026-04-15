// frontend/src/app/about/page.tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">About</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Built by educators who wanted movement without disorder, engagement without fluff, and assessment without a grading pile.
        </p>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-3">Curriculate is a classroom operating system for active learning.</h2>
          <p className="text-gray-700 font-medium mb-4">
            It helps teachers run structured station-based lessons where students collaborate, move purposefully, and generate real evidence of learning —
            while the teacher stays in control with live visibility and automatic reporting.
          </p>
          <p className="text-gray-700 font-medium">
            Curriculate doesn’t replace good teaching. It amplifies it — making high-engagement instruction practical on normal school days.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <Link
              href="/features"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Explore Features <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/reports"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              View Sample Reports
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
