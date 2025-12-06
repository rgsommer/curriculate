// frontend/src/app/dashboard/page.tsx
import Link from "next/link";
import { Plus, Upload, Printer, Search, LogOut } from "lucide-react";

export default function Dashboard() {
  // In real app you'd fetch this from your backend
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-blue-600">Curriculate</h1>
              <span className="ml-3 text-sm text-gray-500">Teacher Dashboard</span>
            </div>
            <button className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
              <LogOut className="w-5 h-5" />
              <span className="hidden sm:inline ml-1">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Actions */}
        <div className="mb-12 text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Welcome back, Teacher!
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            Create a new quiz or jump into an existing one
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/create"
              className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transform hover:scale-105 transition"
            >
              <Plus className="w-6 h-6" />
              Create New Taskset
            </Link>

            <Link
              href="/upload-csv"
              className="inline-flex items-center gap-3 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transform hover:scale-105 transition"
            >
              <Upload className="w-6 h-6" />
              Upload from CSV
            </Link>

            <Link
              href="/station-posters"
              className="inline-flex items-center gap-3 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg transform hover:scale-105 transition"
            >
              <Printer className="w-6 h-6" />
              Station Posters
            </Link>
          </div>
        </div>

        {/* My Tasksets */}
        <section className="mb-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">My Tasksets</h3>
          {myTasksets.length === 0 ? (
            <p className="text-gray-500 text-center py-12">No tasksets yet — create your first one above!</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {myTasksets.map((set) => (
                <div key={set.id} className="bg-white rounded-xl shadow-md p-6 hover:shadow-xl transition">
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">{set.name}</h4>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>{set.tasks} tasks</p>
                    <p>Played {set.played} times</p>
                    <p className="text-blue-600">Last used: {set.lastUsed}</p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700">
                      Edit
                    </button>
                    <button className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">
                      Play Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Public / Community Tasksets */}
        <section>
          <h3 className="text-2xl font-bold text-gray-900 mb-6">Explore Community Tasksets</h3>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {publicTasksets.map((set) => (
              <div key={set.id} className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
                <h4 className="text-lg font-semibold text-gray-900 mb-1">{set.name}</h4>
                <p className="text-sm text-gray-600 mb-3">by {set.author}</p>
                <div className="text-sm text-gray-600">
                  <p>{set.tasks} tasks • {set.played} plays</p>
                </div>
                <button className="mt-4 w-full bg-indigo-100 text-indigo-700 py-2 rounded-lg hover:bg-indigo-200 font-medium">
                  Copy & Use
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}