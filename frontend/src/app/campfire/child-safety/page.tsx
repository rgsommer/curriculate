import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Child Safety Standards — Campfire",
  description:
    "Campfire's standards and practices against child sexual abuse and exploitation (CSAE), including prevention, reporting, and compliance.",
  alternates: { canonical: "https://www.curriculate.net/campfire/child-safety" },
};

const CONTACT = "admin@curriculate.net";

export default function CampfireChildSafetyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-700">
      <Link
        href="/campfirelive"
        className="text-sm text-orange-600 hover:text-orange-700"
      >
        ← Back to Campfire
      </Link>

      <h1 className="mt-4 text-4xl font-bold text-slate-900">
        Campfire Child Safety Standards
      </h1>
      <p className="mt-2 text-slate-500">Last updated: July 1, 2026</p>

      <section className="mt-8 space-y-6 leading-relaxed">
        <p>
          Campfire, operated as part of Curriculate by 10323594 Canada Corp., is a
          private group-connection service. We have <strong>zero tolerance</strong> for
          child sexual abuse and exploitation (CSAE) and for child sexual abuse material
          (CSAM). This page describes our standards and the practices we use to prevent,
          detect, and respond to CSAE, in line with Google Play&rsquo;s child safety
          standards policy.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">Our commitment</h2>
        <p>
          CSAE and CSAM are strictly prohibited on Campfire. Any content, conduct, or
          account that sexualizes, endangers, or exploits a child is not tolerated and
          will be removed, and the responsible account terminated. We prohibit the
          creation, upload, sharing, solicitation, or facilitation of CSAM, as well as
          grooming, sextortion, trafficking, and any other form of child exploitation.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">
          How we prevent and reduce risk
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Private, invite-only groups.</strong> Campfire is not a public social
            network. There is no public discovery, no open feed, and no way to contact
            strangers — people participate only in groups they were invited to by a host.
          </li>
          <li>
            <strong>Host moderation.</strong> Group hosts can remove members and guests,
            and delete any response or uploaded content from their group.
          </li>
          <li>
            <strong>Reporting.</strong> Any participant can report a response or piece of
            content in-app. Reports are reviewed and acted on, including removing content
            and terminating offending accounts.
          </li>
          <li>
            <strong>Blocking &amp; removal.</strong> Hosts can remove and block users from
            a group, cutting off their access and contributions immediately.
          </li>
          <li>
            <strong>Not directed to children.</strong> Campfire is intended for adults
            (e.g. teachers, coaches, families organizing activities). It is not designed
            for or directed to children under 13, and accounts require agreement to our
            Terms.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold text-slate-900">
          Reporting CSAE to us
        </h2>
        <p>
          If you encounter content or behavior that may involve the sexual abuse or
          exploitation of a child, report it immediately using the in-app report control,
          or contact us directly at{" "}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          . We review such reports as a priority and act promptly.
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">
          Compliance and reporting to authorities
        </h2>
        <p>
          We comply with applicable child-safety laws in the jurisdictions where we
          operate. When we become aware of apparent CSAM, we remove it, preserve relevant
          information as required, and report it to the appropriate authorities — including
          the National Center for Missing &amp; Exploited Children (NCMEC) in the United
          States and/or the Canadian Centre for Child Protection (Cybertip.ca) in Canada,
          and law enforcement as applicable. You can also report child sexual exploitation
          directly to NCMEC at{" "}
          <a
            className="text-orange-600 hover:underline"
            href="https://report.cybertip.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            report.cybertip.org
          </a>
          .
        </p>

        <h2 className="text-2xl font-semibold text-slate-900">Point of contact</h2>
        <p>
          Our designated child-safety point of contact can be reached at{" "}
          <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          {" "}and is able to speak to our CSAM prevention practices and compliance.
        </p>
      </section>
    </main>
  );
}
