import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Campfire",
  description:
    "How Campfire collects, uses, shares, and protects your information, including data from Sign in with Google.",
  alternates: { canonical: "https://www.curriculate.net/campfire/privacy" },
};

const CONTACT = "admin@curriculate.net";

export default function CampfirePrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-700">
      <Link
        href="/campfirelive"
        className="text-sm text-orange-600 hover:text-orange-700"
      >
        ← Back to Campfire
      </Link>

      <h1 className="mt-4 text-4xl font-bold text-slate-900">Campfire Privacy Policy</h1>
      <p className="mt-2 text-slate-500">Last updated: June 17, 2026</p>

      <section className="mt-8 space-y-6 leading-relaxed">
        <p>
          Campfire (&quot;Campfire,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a group-engagement
          service operated as part of Curriculate, available at{" "}
          <strong>www.curriculate.net/campfirelive</strong>. It lets a host create
          activities — polls, games, check-ins, superlatives, group cards, sign-ups, and
          fundraisers — that a group responds to, with responses kept sealed until the
          group is ready to reveal them. This Privacy Policy explains what information we
          collect, how we use and share it, and the choices you have.
        </p>
        <p>
          By using Campfire you agree to this Policy. If you do not agree, please do not
          use the service. Questions? Contact us at{" "}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">Information we collect</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Account information.</strong> When you create an account or sign in,
            we collect your name and email address. If you sign in with Google, we
            receive this from your Google profile (see &ldquo;Sign in with Google&rdquo;
            below).
          </li>
          <li>
            <strong>Profile &amp; group data.</strong> Group names, your membership in
            groups, and any per-group display name you choose (for example
            &ldquo;Coach&rdquo; or &ldquo;Mr. Sommer&rdquo;).
          </li>
          <li>
            <strong>Content you submit.</strong> The responses, votes, answers, photos,
            text, voice notes, comments, and reactions you add to an engagement, and any
            content a host creates (questions, awards, prompts, cards).
          </li>
          <li>
            <strong>Guest participation.</strong> People invited to a single activity can
            participate without an account by entering only a display name; we store that
            name and their responses for that activity.
          </li>
          <li>
            <strong>Payment information.</strong> If you chip in to a group gift, raffle,
            or fundraiser, payments are processed by <strong>Stripe</strong>. We do not
            collect or store your full card number — Stripe handles that. We retain a
            record of the contribution amount, status, and the email/name you provide.
          </li>
          <li>
            <strong>Automatic data.</strong> Basic technical information such as device
            and browser type and log data, used to operate and secure the service.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold text-slate-900">Sign in with Google</h2>
        <p>
          Campfire offers &ldquo;Sign in with Google&rdquo; as a convenient way to create
          and access your account. When you use it, Google shares a limited set of basic
          profile information with us:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>your name,</li>
          <li>your email address, and</li>
          <li>your profile picture (if available).</li>
        </ul>
        <p>
          We use this information <strong>only</strong> to create and authenticate your
          account and to display your name to your own groups. We request only basic
          profile and email scopes. <strong>We do not</strong> access your Gmail, Google
          Drive, Contacts, Calendar, or any other Google service or data.
        </p>
        <p>
          Campfire&rsquo;s use of information received from Google APIs adheres to the{" "}
          <a
            className="text-orange-600 hover:underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We do not sell Google user data, do
          not use it for advertising, and do not transfer it to others except as needed to
          provide the service, comply with law, or with your consent.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">How we use information</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>To create and operate your account and your groups.</li>
          <li>
            To run engagements — collecting responses, keeping them sealed, and revealing
            results to the group at the appropriate time.
          </li>
          <li>
            To send service email through our provider <strong>Resend</strong> —
            invitations, reminders, and result notifications related to your groups.
          </li>
          <li>
            To process group-gift, raffle, and fundraiser contributions and to issue gift
            cards (see below).
          </li>
          <li>To secure the service, prevent abuse, and provide support.</li>
        </ul>

        <h2 className="text-2xl font-semibold text-slate-900">How information is shared</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>With your group.</strong> The whole point of Campfire is shared
            reveals: your responses, votes, and contributions become visible to other
            members of that group when the engagement reveals (some answers can be marked
            private to the host or shared anonymously, where the activity offers it).
          </li>
          <li>
            <strong>With service providers</strong> who help us run Campfire:{" "}
            <strong>Supabase</strong> (database &amp; authentication),{" "}
            <strong>Vercel</strong> (hosting), <strong>Stripe</strong> (payments),{" "}
            <strong>Tremendous</strong> (gift-card delivery), and <strong>Resend</strong>{" "}
            (email). They process data only to provide their services to us.
          </li>
          <li>
            <strong>For legal reasons</strong> — to comply with law or protect the
            rights, safety, and property of users and the public.
          </li>
          <li>
            <strong>We do not sell your personal information</strong> and we do not use
            it for third-party advertising.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold text-slate-900">
          Payments &amp; gift cards
        </h2>
        <p>
          Group gifts, raffles, and pledge drives collect contributions through Stripe.
          When a gift card is awarded or sent, it is delivered by Tremendous to the
          recipient&rsquo;s email address. We share only the amount, recipient name, and
          recipient email needed to deliver the card. Raffles and fundraisers are
          organized by hosts; hosts are responsible for running them in line with
          applicable local laws.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">
          Guests, classrooms &amp; younger users
        </h2>
        <p>
          Campfire is designed for hosts (such as a family member, group leader, coach, or
          teacher) to run activities for their group. Guests can join a single activity
          with just a display name and no account. Campfire is not directed to children
          under 13, and we do not knowingly collect personal information from children
          under 13 without appropriate consent. Educators and group leaders are
          responsible for obtaining any consent required by their school or organization
          before inviting students or minors. If you believe a child has provided us
          personal information, contact us at{" "}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>{" "}
          and we will delete it.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">
          Data retention &amp; deletion
        </h2>
        <p>
          We keep your information for as long as your account is active or as needed to
          provide the service. You can request access to, correction of, or deletion of
          your personal information — including revoking Google sign-in and deleting your
          account and associated data — by emailing{" "}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          . You can also remove Campfire&rsquo;s access to your Google account at any time
          from your{" "}
          <a
            className="text-orange-600 hover:underline"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google account permissions
          </a>
          .
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">Security</h2>
        <p>
          We use industry-standard measures — encryption in transit, authenticated access,
          and per-row access controls — to protect your information. No method of
          transmission or storage is completely secure, but we work to safeguard your data
          and limit access to it.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">Changes to this policy</h2>
        <p>
          We may update this Policy from time to time. When we make material changes, we
          will update the &ldquo;Last updated&rdquo; date above and, where appropriate,
          notify you. Continued use of Campfire after changes means you accept the updated
          Policy.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">Contact</h2>
        <p>
          For any privacy question or request, email{" "}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </section>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-400">
        <Link href="/campfire/terms" className="hover:text-slate-600">
          Terms of Service
        </Link>
        <span className="mx-2">·</span>
        <Link href="/campfirelive" className="hover:text-slate-600">
          Campfire
        </Link>
      </footer>
    </main>
  );
}
