// frontend/src/app/privacy/page.tsx
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Privacy</h1>
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10 space-y-4 text-gray-700 font-medium">
          <p>Curriculate is designed to minimize student data. Students join sessions without individual accounts.</p>
          <p>
            Submissions (text, photos, drawings, audio) are used for instructional purposes inside the session and reports, visible
            to authorized educators.
          </p>
          <p>
            Schools and teachers control how Curriculate is used in their context. If you need a formal DPA or additional
            documentation, contact us.
          </p>
        </div>
      </div>
    </main>
  );
}
