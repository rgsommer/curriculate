export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold mb-6">Terms of Service</h1>
      <p className="text-gray-600 mb-8">Effective January 2025</p>

      <section className="space-y-6 text-gray-700">
        <p>
          By using Curriculate, you agree to the following terms. These terms apply to all
          teachers, schools, and organizations using the platform.
        </p>

        <h2 className="text-2xl font-semibold">Use of the Platform</h2>
        <p>
          Curriculate is provided for educational purposes. Users agree not to misuse the
          platform or attempt to disrupt service integrity.
        </p>

        <h2 className="text-2xl font-semibold">Accounts</h2>
        <p>
          Teachers are responsible for maintaining the security of their accounts and for
          activity that occurs during sessions they launch.
        </p>

        <h2 className="text-2xl font-semibold">Subscriptions & Billing</h2>
        <p>
          Paid plans renew automatically unless cancelled. Pricing and plan features are
          described on the Pricing page.
        </p>

        <h2 className="text-2xl font-semibold">Limitation of Liability</h2>
        <p>
          Curriculate is provided “as is.” We are not liable for instructional outcomes or
          data loss resulting from misuse or external service interruptions.
        </p>

        <h2 className="text-2xl font-semibold">Contact</h2>
        <p>
          Questions about these terms may be sent to{" "}
          <a href="mailto:admin@curriculate.net" className="text-blue-600 underline">
            admin@curriculate.net
          </a>
          .
        </p>
      </section>
    </main>
  );
}
