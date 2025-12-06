// frontend/src/app/dashboard/page.tsx
import Link from "next/link";
import Footer from "@/components/Footer";

// Tiny inline icons — no lucide-react needed ever again
const Plus = () => <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
const Upload = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const Printer = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>;
const LogOut = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>;

export default function Dashboard() {
  const myTasksets = [
    { id: 1, name: "Photosynthesis Review", tasks: 12, played: 47, lastUsed: "2 days ago" },
    { id: 2, name: "World War II Timeline", tasks: 8, played: 23, lastUsed: "1 week ago" },
    { id: 3, name: "Spanish Vocabulary – Food", tasks: 20, played: 112, lastUsed: "Yesterday" },
  ];

  const publicTasksets = [
    { id: 4, name: "Algebra Basics (Community)", author: "Ms. Chen", tasks: 15, played: 892 },
    { id: 5, name: "Cell Structure Quiz", author: "Mr. Patel", tasks: 10, played: 1204 },
  ];

  return (
    <>
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-sm shadow-sm border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-8">
                <h1 className="text-3xl font-bold text-blue-600">Curriculate</h1>
                <p className="hidden sm:block text-gray-600 font-medium">
                  Instant interactive quizzes from any text or CSV
                </p>
              </div>
              <button className="flex items-center gap-2 text-gray-600 hover:text-red-600 transition">
                <LogOut className="w-5 h-5" />
                <span className="hidden sm:inline font-medium">Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 pb-24">
          {/* Welcome + Big Actions */}
          <div className="text-center py-16">
            <h2 className="text-5xl font-extrabold text-gray-900 mb-4">
              Welcome back, Teacher!
            </h2>
            <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">
              Build something amazing today — your students are waiting.
            </p>

            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <Link
                href="/create"
                className="group flex items-center gap-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold text-xl py-5 px-10 rounded-2xl shadow-xl transform hover:scale-105 transition-all duration-200"
              >
                <Plus className="w-8 h-8 group-hover:rotate-90 transition-transform" />
                Create New Taskset
              </Link>

              <div className="flex gap-4">
                <Link
                  href="/upload-csv"
                  className="flex items-center gap-3 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transform hover:scale-105 transition"
                >
                  <Upload className="w-6 h-6" />
                  CSV Upload
                </Link>

                <Link
                  href="/station-posters"
                  className="flex items-center gap-3 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transform hover:scale-105 transition"
                >
                  <Printer className="w-6 h-6" />
                  Station Posters
                </Link>
              </div>
            </div>
          </div>

          {/* My Tasksets */}
          <section className="mb-16">
            <h3 className="text-3xl font-bold text-gray-900 mb-8">My Tasksets</h3>

            {myTasksets.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl shadow">
                <div className="text-6xl mb-4">Empty State</div>
                <p className="text-xl text-gray-500">
                  No tasksets yet. Click the big blue button above to create your first one!
                </p>
              </div>
            ) : (
              <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                {myTasksets.map((set) => (
                  <div
                    key={set.id}
                    className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-2xl transition-shadow border border-gray-100"
                  >
                    <h4 className="text-xl font-bold text-gray-900 mb-4">{set.name}</h4>
                    <div className="space-y-2 text-gray-600">
                      <p>{set.tasks} tasks</p>
                      <p>Played {set.played} times</p>
                      <p className="text-blue-600 font-medium">Last used: {set.lastUsed}</p>
                    </div>
                    <div className="mt-6 flex gap-3">
                      <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition">
                        Edit
                      </button>
                      <button className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition">
                        Play Now
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Community Tasksets */}
          <section>
            <h3 className="text-3xl font-bold text-gray-900 mb-8">
              Community Tasksets
            </h3>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {publicTasksets.map((set) => (
                <div
                  key={set.id}
                  className="bg-gradient-to-br from-indigo-50 to-white rounded-2xl p-8 border border-indigo-100 shadow-md hover:shadow-lg transition"
                >
                  <h4 className="text-xl font-bold text-gray-900 mb-2">{set.name}</h4>
                  <p className="text-sm text-indigo-600 mb-4">by {set.author}</p>
                  <p className="text-gray-600 mb-6">
                    {set.tasks} tasks • {set.played.toLocaleString()} plays
                  </p>
                  <button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold transition">
                    Copy & Use
                  </button>
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* Global Footer */}
        <Footer />
      </div>
    </>
  );
}