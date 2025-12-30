export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-gray-600 mb-8">Last updated: January 2025</p>

      <section className="space-y-6 text-gray-700">
        <p>
          Curriculate respects the privacy of teachers, students, and schools. This policy
          explains what information we collect and how it is used.
        </p>

        <h2 className="text-2xl font-semibold">Information We Collect</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>Teacher account details (name, email)</li>
          <li>Session data and task responses</li>
          <li>Usage analytics to improve the platform</li>
        </ul>

        <h2 className="text-2xl font-semibold">How We Use Information</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>To provide session reports and analytics</li>
          <li>To improve task generation and platform reliability</li>
          <li>To support billing and account management</li>
        </ul>

        <h2 className="text-2xl font-semibold">Student Data</h2>
        <p>
          Curriculate is designed for classroom use. Student identifiers are minimal and
          controlled by teachers. We do not sell or share student data.
        </p>

        <h2 className="text-2xl font-semibold">Contact</h2>
        <p>
          Questions about privacy can be sent to{" "}
          <a href="mailto:admin@curriculate.net" className="text-blue-600 underline">
            admin@curriculate.net
          </a>
          .
        </p>
      </section>
    </main>
  );
}
