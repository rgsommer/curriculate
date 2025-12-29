// frontend/src/app/page.tsx
import Link from "next/link";
import { ArrowRight, Sparkles, Upload, Play, CheckCircle, Printer } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h1 className="text-5xl sm:text-7xl font-black text-gray-900 mb-6">
              Curriculate<span className="text-blue-600">.net</span>
            </h1>
            <p className="text-xl sm:text-2xl text-gray-700 mb-12 max-w-3xl mx-auto font-medium">
              Instant interactive quizzes from any text or CSV — ready in seconds.
            </p>

            <div className="flex flex-col sm:flex-row gap-6 justify-center mb-20">
              <Link
                href="/dashboard"
                className="group inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold py-5 px-10 rounded-2xl shadow-2xl transform hover:scale-105 transition-all"
              >
                Get Started Free
                <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition" />
              </Link>
              <Link
                href="/station-posters"
                className="inline-flex items-center gap-3 bg-purple-600 hover:bg-purple-700 text-white text-xl font-bold py-5 px-8 rounded-2xl shadow-2xl"
              >
                <Printer className="w-6 h-6" />
                Station Posters
              </Link>
            </div>
          </div>

          {/* LIVE QUIZ PREVIEW */}
          <div className="mx-auto max-w-5xl">
            <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-200">
              {/* Fake browser bar */}
              <div className="bg-gray-100 px-6 py-4 flex items-center gap-3 border-b">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                </div>
                <div className="ml-4 flex-1 bg-white rounded-lg px-4 py-1 text-sm text-gray-600">
                  curriculate.net/play/abcd1234
                </div>
              </div>

              {/* Quiz content */}
              <div className="p-10">
                <div className="flex items-center gap-3 mb-8">
                  <Sparkles className="w-10 h-10 text-yellow-500" />
                  <h2 className="text-4xl font-bold text-gray-900">Photosynthesis Review</h2>
                </div>

                <div className="space-y-8 max-w-3xl mx-auto">
                  {/* Question 1 */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-8 border-2 border-green-200">
                    <p className="text-2xl font-semibold mb-6">What is the primary source of energy for Earth's climate system?</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {["The Sun", "Geothermal heat", "Ocean currents", "Volcanic activity"].map((option, i) => (
                        <label key={i} className={`flex items-center gap-4 p-5 rounded-xl cursor-pointer transition-all ${i === 0 ? "bg-green-500 text-white shadow-lg" : "bg-white hover:bg-gray-50"}`}>
                          <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${i === 0 ? "border-white bg-white" : "border-gray-300"}`}>
                            {i === 0 && <CheckCircle className="w-5 h-5 text-green-600" />}
                          </div>
                          <span className="text-lg font-medium">{option}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-medium text-gray-600">Question 1 of 12</span>
                    <div className="flex items-center gap-3">
                      <div className="bg-gray-200 rounded-full h-3 w-96 overflow-hidden">
                        <div className="bg-blue-600 h-full rounded-full" style={{ width: "42%" }}></div>
                      </div>
                      <span className="text-lg font-bold text-blue-600">42%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-center mt-8 text-gray-500 font-medium">
              ↑ This is what your students see — live, beautiful, and instant
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}