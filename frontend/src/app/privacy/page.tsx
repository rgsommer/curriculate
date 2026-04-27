export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-gray-600 mb-8">Last updated: April 2026</p>

      <section className="space-y-6 text-gray-700">
        <p>
          Curriculate (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) operates the Curriculate website
          (curriculate.net), the Curriculate Pulse mobile application, and related
          services (collectively, the &quot;Service&quot;). This Privacy Policy explains what
          information we collect, how we use it, and your choices.
        </p>

        <h2 className="text-2xl font-semibold">Information We Collect</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Account information</strong> — teacher name, email address, and
            school affiliation when you create an account.
          </li>
          <li>
            <strong>Grading submissions</strong> — photos, pasted text, uploaded PDFs,
            linked documents, audio, and video submitted for AI grading. These are
            processed in real time and are <strong>not</strong> permanently stored on
            our servers after grading is complete.
          </li>
          <li>
            <strong>Rubric and session data</strong> — rubric overrides, grading
            sessions, feedback voice preferences, and result reference codes.
          </li>
          <li>
            <strong>Class rosters</strong> — student names, student IDs, and class
            names uploaded by teachers for grade-matching and Edsby export.
          </li>
          <li>
            <strong>Device information</strong> — device type, operating system, and
            app version (collected automatically via analytics).
          </li>
          <li>
            <strong>Push notification tokens</strong> — if you opt in to push
            notifications in the Pulse mobile app, we store a device token to deliver
            grade alerts.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold">How We Use Information</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>To grade student work using AI and return feedback to teachers.</li>
          <li>To generate session reports, email summaries, and Edsby CSV exports.</li>
          <li>To send push notifications for grade alerts and weekly digests (Pulse app).</li>
          <li>To improve grading accuracy, task generation, and platform reliability.</li>
          <li>To support billing and account management.</li>
        </ul>

        <h2 className="text-2xl font-semibold">Camera and Photo Access</h2>
        <p>
          The Curriculate Pulse mobile app requests camera access solely to photograph
          student work for AI grading. Photos are transmitted to our server for
          processing and are not stored permanently. We do not access your photo library
          unless you explicitly choose to upload an image from it.
        </p>

        <h2 className="text-2xl font-semibold">Student Data</h2>
        <p>
          Curriculate is designed for classroom use. We are committed to student
          privacy:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Student identifiers (names, IDs) are uploaded by and controlled entirely
            by teachers.
          </li>
          <li>We do not sell, rent, or share student data with third parties.</li>
          <li>
            Student work submitted for grading is processed in real time and is not
            retained on our servers after the grading result is delivered.
          </li>
          <li>
            Teachers may delete roster data and session history at any time.
          </li>
          <li>We do not serve advertising of any kind.</li>
        </ul>

        <h2 className="text-2xl font-semibold">Data Sharing</h2>
        <p>
          We do not sell your personal information. We may share data only in these
          limited circumstances:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>AI processing</strong> — submitted work is sent to our AI
            provider (Anthropic) for grading. Their data handling is governed by their
            own privacy policy.
          </li>
          <li>
            <strong>Service providers</strong> — hosting, email delivery, and
            analytics providers who process data on our behalf under strict
            confidentiality agreements.
          </li>
          <li>
            <strong>Legal requirements</strong> — if required by law or to protect
            the rights, property, or safety of our users.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold">Data Retention</h2>
        <p>
          Grading submissions (photos, text, documents) are processed in real time and
          are not permanently stored. Session metadata and result codes are retained to
          allow teachers to access grading history. Teachers may request deletion of
          their account and associated data at any time by contacting us.
        </p>

        <h2 className="text-2xl font-semibold">Children&apos;s Privacy</h2>
        <p>
          Curriculate is a tool for teachers. We do not knowingly collect personal
          information directly from children under 13. Student work is submitted by
          teachers on behalf of students and is processed solely for grading purposes.
        </p>

        <h2 className="text-2xl font-semibold">Your Choices</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>You may decline camera or push notification permissions in the Pulse app.</li>
          <li>You may delete your account and data by contacting us.</li>
          <li>You may opt out of email notifications at any time.</li>
        </ul>

        <h2 className="text-2xl font-semibold">Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. We will notify users of
          material changes via email or an in-app notice.
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
