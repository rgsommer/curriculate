// frontend/src/app/termsofservice/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | Curriculate",
  description: "Terms of Service governing use of the Curriculate platform.",
};

const EFFECTIVE_DATE = "December 29, 2025"; // update as needed

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight">
          Terms of Service
        </h1>
        <p className="mt-3 text-neutral-600">
          Effective date: <span className="font-medium">{EFFECTIVE_DATE}</span>
        </p>
        <p className="mt-4 text-lg text-neutral-700">
          These Terms of Service govern your access to and use of Curriculate.
          By using the service, you agree to these terms.
        </p>
      </header>

      <Section title="1. The Service">
        Curriculate is a web-based educational platform designed to help
        educators run station-based, movement-focused learning activities,
        manage teams, and generate classroom reports.
      </Section>

      <Section title="2. Who May Use Curriculate">
        Curriculate is intended for use by teachers, schools, and educational
        organizations. You are responsible for ensuring that your use complies
        with all applicable school, district, and legal requirements.
      </Section>

      <Section title="3. Accounts and Access">
        You are responsible for maintaining the confidentiality of your account
        credentials and for all activity that occurs under your account. You
        must provide accurate information when creating and maintaining your
        account.
      </Section>

      <Section title="4. Student Data">
        Curriculate is designed to minimize the collection of student data.
        Any student information entered into the platform is provided by the
        teacher or school. Schools and teachers remain responsible for obtaining
        any required consents and for compliance with applicable student privacy
        laws.
      </Section>

      <Section title="5. Subscriptions and Billing">
        Certain features require a paid subscription. Subscriptions are billed
        on a recurring basis as described at checkout. Payments are processed by
        third-party providers (such as Stripe). Fees are non-refundable except
        where required by law.
      </Section>

      <Section title="6. Acceptable Use">
        You agree not to misuse the service, interfere with its operation, or
        attempt to access it using unauthorized means. We reserve the right to
        suspend or terminate accounts that violate these terms.
      </Section>

      <Section title="7. Intellectual Property">
        Curriculate and its content, features, and design are owned by or
        licensed to Curriculate and are protected by applicable intellectual
        property laws. You may not copy, modify, or redistribute the service
        except as permitted by law.
      </Section>

      <Section title="8. Termination">
        You may stop using Curriculate at any time. We may suspend or terminate
        access to the service if these terms are violated or if required for
        security or legal reasons.
      </Section>

      <Section title="9. Disclaimer">
        Curriculate is provided “as is” without warranties of any kind. We do not
        guarantee that the service will be uninterrupted or error-free.
      </Section>

      <Section title="10. Limitation of Liability">
        To the extent permitted by law, Curriculate will not be liable for any
        indirect, incidental, or consequential damages arising from your use of
        the service.
      </Section>

      <Section title="11. Changes to These Terms">
        We may update these Terms of Service from time to time. Changes will be
        posted on this page with an updated effective date.
      </Section>

      <Section title="12. Contact">
        If you have questions about these terms, contact us at{" "}
        <a
          className="text-blue-600 hover:underline"
          href="mailto:support@curriculate.net"
        >
          support@curriculate.net
        </a>
        .
      </Section>

      <div className="mt-10 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/privacy" className="text-blue-600 hover:underline">
          Privacy Policy
        </Link>
        <span className="text-neutral-400">•</span>
        <Link href="/support" className="text-blue-600 hover:underline">
          Support
        </Link>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-700">{children}</p>
    </section>
  );
}
