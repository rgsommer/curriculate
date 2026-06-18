import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Campfire",
  description:
    "The terms that govern your use of Campfire, the group-engagement service from Curriculate.",
  alternates: { canonical: "https://www.curriculate.net/campfire/terms" },
};

const CONTACT = "admin@curriculate.net";

export default function CampfireTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-700">
      <Link
        href="/campfirelive"
        className="text-sm text-orange-600 hover:text-orange-700"
      >
        ← Back to Campfire
      </Link>

      <h1 className="mt-4 text-4xl font-bold text-slate-900">Campfire Terms of Service</h1>
      <p className="mt-2 text-slate-500">Last updated: June 17, 2026</p>

      <section className="mt-8 space-y-6 leading-relaxed">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of Campfire
          (&quot;Campfire,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), a
          group-engagement service operated as part of Curriculate and available at{" "}
          <strong>www.curriculate.net/campfirelive</strong>. By creating an account,
          joining an activity, or otherwise using Campfire, you agree to these Terms. If
          you do not agree, do not use the service.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">1. The service</h2>
        <p>
          Campfire lets a host create activities — such as polls, games, check-ins,
          superlatives, group cards, sign-ups, and fundraisers — that a group responds to,
          with responses typically kept sealed until they are revealed to the group. We
          may add, change, or remove features at any time.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">2. Eligibility &amp; accounts</h2>
        <p>
          You must be able to form a binding contract to create an account, and you are
          responsible for the accuracy of your account information and for keeping your
          login secure. You are responsible for all activity under your account. Guests
          may join a single activity with a display name only, without an account.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">3. Sign in with Google</h2>
        <p>
          If you sign in with Google, you authorize us to receive your basic Google profile
          (name, email address, and profile picture) to create and authenticate your
          account, as described in our{" "}
          <Link href="/campfire/privacy" className="text-orange-600 hover:underline">
            Privacy Policy
          </Link>
          . We do not access any other Google data. You can revoke this access at any time
          from your Google account permissions.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">4. Acceptable use</h2>
        <p>You agree not to use Campfire to:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            post or share content that is unlawful, harassing, hateful, threatening,
            defamatory, or that infringes others&rsquo; rights;
          </li>
          <li>
            harvest others&rsquo; data, impersonate anyone, or invite people who have not
            consented to participate;
          </li>
          <li>
            upload malware, attempt to disrupt or gain unauthorized access to the service,
            or circumvent its security or access controls;
          </li>
          <li>use the service for spam or for any illegal purpose.</li>
        </ul>
        <p>
          Hosts are responsible for the activities they create and the people they invite,
          and for using features like superlatives and awards responsibly and kindly.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">5. Your content</h2>
        <p>
          You retain ownership of the content you submit. You grant us a non-exclusive,
          worldwide license to host, store, display, and share that content as needed to
          operate the service — for example, revealing your responses to your group. You
          are responsible for the content you submit and confirm you have the rights to
          share it. We may remove content that violates these Terms.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">
          6. Group gifts, raffles &amp; fundraisers
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Contributions to group gifts, raffles, and pledge drives are processed by{" "}
            <strong>Stripe</strong>; gift cards are delivered by <strong>Tremendous</strong>.
            By contributing, you also agree to those providers&rsquo; terms.
          </li>
          <li>
            Campfire is a tool for organizing collections; the host — not Campfire — is
            responsible for the purpose of a collection, for choosing recipients, and for
            running any raffle, draw, or fundraiser in compliance with applicable laws
            (including any licensing, charitable, or gaming rules in their jurisdiction).
          </li>
          <li>
            Contributions are generally non-refundable once a gift, prize, or pledge has
            been issued. If an engagement is cancelled before funds are disbursed, eligible
            contributions may be refunded through Stripe. Platform or processing fees may
            apply and may be non-refundable.
          </li>
          <li>
            We do not guarantee any particular outcome of a vote, draw, or fundraiser.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold text-slate-900">7. Email &amp; notifications</h2>
        <p>
          Using Campfire involves transactional email (invitations, reminders, and result
          notifications) sent on your or a host&rsquo;s behalf. By inviting someone, you
          confirm you have a reasonable basis to contact them about the activity.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">8. Disclaimers</h2>
        <p>
          Campfire is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
          warranties of any kind, whether express or implied, including merchantability,
          fitness for a particular purpose, and non-infringement. We do not warrant that
          the service will be uninterrupted, error-free, or secure.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">9. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Campfire and its operators will not be
          liable for any indirect, incidental, special, consequential, or punitive
          damages, or for any loss of data, goodwill, or profits, arising from your use of
          the service. Our total liability for any claim relating to the service will not
          exceed the greater of the amounts you paid us in the twelve months before the
          claim or CAD $100.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">10. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Campfire and its operators from claims
          arising out of your content, your use of the service, or your violation of these
          Terms or of any law or third-party right.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">11. Termination</h2>
        <p>
          You may stop using Campfire and request deletion of your account at any time. We
          may suspend or terminate access if you violate these Terms or to protect the
          service or its users. Sections that by their nature should survive termination
          will survive.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">12. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. When we make material changes, we
          will update the &ldquo;Last updated&rdquo; date above. Continued use of Campfire
          after changes means you accept the updated Terms.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">13. Governing law</h2>
        <p>
          These Terms are governed by the laws of the Province of Ontario and the federal
          laws of Canada applicable therein, without regard to conflict-of-laws principles.
          You agree to the exclusive jurisdiction of the courts located in Ontario, Canada
          for any dispute, except where prohibited by applicable law.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">14. Contact</h2>
        <p>
          Questions about these Terms? Email{" "}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </section>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-400">
        <Link href="/campfire/privacy" className="hover:text-slate-600">
          Privacy Policy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/campfirelive" className="hover:text-slate-600">
          Campfire
        </Link>
      </footer>
    </main>
  );
}
