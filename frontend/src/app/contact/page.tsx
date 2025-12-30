// frontend/src/app/contact/page.tsx
export default function ContactPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Contact</h1>
        <p className="text-xl text-gray-700 font-medium mb-10">
          For School plans, onboarding, or partnerships — send a message and we’ll respond promptly.
        </p>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <form className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-2">Name</label>
              <input className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-medium" placeholder="Your name" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-2">Email</label>
              <input className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-medium" placeholder="you@school.org" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-2">Message</label>
              <textarea
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-medium min-h-[140px]"
                placeholder="Tell us what you’re looking for…"
              />
            </div>

            <button
              type="button"
              className="w-full rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              Send Message
            </button>

            <p className="text-sm text-gray-500 font-medium">
              (Hook this up to your preferred email/CRM later — this is a clean UI stub.)
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
