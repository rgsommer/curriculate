// frontend/src/app/dashboard/page.tsx
import Link from "next/link";

export default function Dashboard() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Teacher Dashboard</h1>
      <div className="space-y-4">
        <Link href="/create" className="block p-4 bg-blue-600 text-white rounded hover:bg-blue-700">
          + New Taskset
        </Link>
        <button className="block p-4 bg-gray-200 rounded hover:bg-gray-300">
          Upload CSV
        </button>
        <button className="block p-4 bg-red-600 text-white rounded hover:bg-red-700">
          Sign Out
        </button>
      </div>
    </div>
  );
}