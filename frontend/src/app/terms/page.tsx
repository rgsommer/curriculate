// frontend/src/app/terms/page.tsx
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Terms</h1>
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10 space-y-4 text-gray-700 font-medium">
          <p>By using Curriculate, you agree to use the platform for educational purposes and to follow applicable school policies and laws.</p>
          <p>Teachers are responsible for supervising students during station-based activities and for reviewing submissions as needed.</p>
          <p>Plan features and limits are defined in-app and may evolve as the product improves.</p>
        </div>
      </div>
    </div>
  );
}
