// frontend/src/app/page.tsx
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-100">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
              Welcome to <span className="text-blue-600">Curriculate.net</span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              Build interactive quizzes and tasksets in seconds. Perfect for teachers, classrooms, and instant learning.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-6">
              <Link
                href="/dashboard"
                className="rounded-md bg-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                Get Started Free
              </Link>
              <Link href="/features" className="text-sm font-semibold text-gray-900">
                Learn More <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          {/* Placeholder Hero Image */}
          <div className="mt-16 flex justify-center">
            <div className="relative h-80 w-full max-w-2xl rounded-lg bg-gray-100 p-8">
              <p className="text-center text-gray-500">📚 Quiz Builder Preview Here</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Why Choose Curriculate?
            </h2>
            <p className="mt-4 text-lg leading-8 text-gray-600">
              From CSV uploads to live sessions — everything you need in one place.
            </p>
          </div>
          <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-4xl">
            <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-10 lg:max-w-none lg:grid-cols-3 lg:gap-y-16">
              {[
                { title: "CSV to Quiz Magic", desc: "Upload any spreadsheet and auto-generate interactive tasks." },
                { title: "Station Posters", desc: "Print QR-coded posters for classroom rotations." },
                { title: "Live Sessions", desc: "Real-time scoring for groups — no setup required." },
              ].map((feature, i) => (
                <div key={i} className="text-center">
                  <dt className="text-5xl font-bold text-blue-600 mb-4">{['📊', '🖨️', '🎯'][i]}</dt>
                  <dd className="text-lg font-semibold text-gray-900">{feature.title}</dd>
                  <dd className="mt-2 text-base text-gray-600">{feature.desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center text-sm text-gray-400">
            <p>&copy; 2025 Curriculate.net. Built with ❤️ for educators.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}