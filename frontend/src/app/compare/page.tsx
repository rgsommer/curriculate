import Link from "next/link";

export default function ComparePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-4xl font-bold mb-6">Compare Curriculate</h1>
      <p className="text-lg text-gray-600 mb-10">
        See how Curriculate compares to traditional station learning tools and static worksheets.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border border-gray-200 rounded-xl overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-4 text-left">Feature</th>
              <th className="p-4 text-left">Curriculate</th>
              <th className="p-4 text-left">Traditional Stations</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="p-4">AI-generated tasks</td>
              <td className="p-4 font-semibold">✔ Yes</td>
              <td className="p-4">✖ No</td>
            </tr>
            <tr>
              <td className="p-4">Live teacher pacing</td>
              <td className="p-4 font-semibold">✔ Yes</td>
              <td className="p-4">✖ No</td>
            </tr>
            <tr>
              <td className="p-4">Student engagement tracking</td>
              <td className="p-4 font-semibold">✔ Built-in</td>
              <td className="p-4">✖ Manual</td>
            </tr>
            <tr>
              <td className="p-4">Reports & transcripts</td>
              <td className="p-4 font-semibold">✔ Automatic</td>
              <td className="p-4">✖ None</td>
            </tr>
            <tr>
              <td className="p-4">Setup time</td>
              <td className="p-4 font-semibold">&lt; 3 minutes</td>
              <td className="p-4">30–60 minutes</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-12 flex gap-4">
        <Link
          href="/demo"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-700"
        >
          Try the Demo
        </Link>
        <Link
          href="/pricing"
          className="rounded-lg border px-6 py-3 font-semibold hover:bg-gray-50"
        >
          View Pricing
        </Link>
      </div>
    </main>
  );
}
