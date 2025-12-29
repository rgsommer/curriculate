// frontend/app/privacy/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Curriculate",
  description: "Curriculate privacy policy and data handling practices.",
};

const EFFECTIVE_DATE = "December 29, 2025"; // change anytime

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-neutral-600">
          Effective date: <span className="font-medium">{EFFECTIVE_DATE}</span>
        </p>
        <p className="mt-4 text-lg text-neutral-700">
          Curriculate is built for classrooms. We aim to collect the minimum data
          needed to provide the service and improve it over time.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">1) Who we are</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          “Curriculate,” “we,” and “us” refer to the Curriculate service operated
          by Richard Sommer&apos;s projects. If you have privacy questions, contact{" "}
          <a className="text-blue-600 hover:underline" href="mailto:privacy@curriculate.net">
            privacy@curriculate.net
          </a>
          .
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">2) What we collect</h2>

        <div className="mt-4 space-y-4 text-sm leading-6 text-neutral-700">
          <div>
            <div className="font-semibold">Account data</div>
            <p>
              Teacher name, email, school/organization (if provided), and basic
              authentication data needed to sign in.
            </p>
          </div>

          <div>
            <div className="font-semibold">Classroom/session data</div>
            <p>
              Taskset metadata, team progress, and teacher-generated reports/analytics.
              Depending on how you use Curriculate, this may include student
              identifiers you enter (e.g., first names or roster labels).
            </p>
          </div>

          <div>
            <div className="font-semibold">Usage and device data</div>
            <p>
              Basic telemetry such as page views, feature usage, and diagnostic logs
              to keep the service reliable and secure.
            </p>
          </div>

          <div>
            <div className="font-semibold">Payment data (subscriptions)</div>
            <p>
              If you upgrade, payment processing is handled by Stripe. We do not store
              full card numbers. We may store Stripe customer/subscription identifiers
              and billing status for account access.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">3) How we use information</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-neutral-700">
          <li>Provide and maintain the service (sessions, tasksets, reports).</li>
          <li>Improve product quality and user experience.</li>
          <li>Security, fraud prevention, and abuse detection.</li>
          <li>Customer support and communications you request.</li>
          <li>Billing and subscription management (if applicable).</li>
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">4) Sharing</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          We do not sell personal information. We share data only:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-neutral-700">
          <li>
            With service providers who help us run Curriculate (e.g., hosting,
            analytics, payment processing).
          </li>
          <li>
            If required by law, or to protect rights, safety, and integrity of the service.
          </li>
          <li>
            With your direction (for example, if you export or share reports).
          </li>
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">5) Data retention</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          We retain data for as long as needed to provide the service, meet legal
          obligations, resolve disputes, and enforce agreements. You can request
          deletion of your account data by emailing{" "}
          <a className="text-blue-600 hover:underline" href="mailto:privacy@curriculate.net">
            privacy@curriculate.net
          </a>
          .
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">6) Security</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          We use reasonable administrative, technical, and physical safeguards to
          protect information. No system is 100% secure, so we cannot guarantee
          absolute security.
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">7) Children and student data</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          Curriculate is intended for use by educators. If student information is
          entered by a school/teacher, the school remains responsible for ensuring
          appropriate consent and compliance with applicable student privacy laws.
          We encourage using minimal student identifiers (e.g., first name or team label).
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">8) Your choices</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-neutral-700">
          <li>Request access, correction, or deletion of your account data.</li>
          <li>Opt out of non-essential communications.</li>
          <li>Use a minimal student-identification approach whenever possible.</li>
        </ul>
      </section>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">9) Updates to this policy</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          We may update this policy periodically. Changes will be posted on this
          page with a new effective date.
        </p>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3 text-sm">
        <Link className="text-blue-600 hover:underline" href="/support">
          Need help? Visit Support
        </Link>
        <span className="text-neutral-400">•</span>
        <a className="text-blue-600 hover:underline" href="mailto:privacy@curriculate.net">
          privacy@curriculate.net
        </a>
      </div>
    </main>
  );
}
