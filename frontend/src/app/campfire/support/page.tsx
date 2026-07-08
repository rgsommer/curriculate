import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support — Campfire",
  description:
    "Get help with Campfire: how to start, invite your group, respond and reveal, manage your account, and contact us.",
  alternates: { canonical: "https://www.curriculate.net/campfire/support" },
};

const CONTACT = "admin@curriculate.net";

function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-slate-900">{q}</h3>
      <p className="mt-1 text-slate-700">{children}</p>
    </div>
  );
}

export default function CampfireSupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-700">
      <Link href="/campfirelive" className="text-sm text-orange-600 hover:text-orange-700">
        ← Back to Campfire
      </Link>

      <h1 className="mt-4 text-4xl font-bold text-slate-900">Campfire Support</h1>
      <p className="mt-2 text-slate-500">
        We&rsquo;re here to help. Most questions are answered below — and you can always
        email a real person.
      </p>

      {/* Contact — first, prominent */}
      <div className="mt-8 rounded-2xl border border-orange-200 bg-orange-50/60 p-5">
        <h2 className="text-xl font-semibold text-slate-900">Contact us</h2>
        <p className="mt-1">
          Email{" "}
          <a className="font-semibold text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>{" "}
          with any question, problem, or feedback. We read every message and typically reply
          within one business day.
        </p>
      </div>

      <section className="mt-10 space-y-6">
        <h2 className="text-2xl font-semibold text-slate-900">Getting started</h2>
        <QA q="How do I start?">
          Create a group, pick a first activity (the one-tap starters fill it in for you), then
          share the invite link with your people. That&rsquo;s it.
        </QA>
        <QA q="Do the people I invite need an account?">
          No. Guests can join a group straight from your invite link by entering just their name
          — no email or account required. Hosts can sign in with Apple, Google, or email.
        </QA>
        <QA q="How does the “reveal” work?">
          Everyone answers privately. Nobody sees anyone else&rsquo;s response until the group is
          in — then it all reveals together, either automatically or when you choose.
        </QA>

        <h2 className="text-2xl font-semibold text-slate-900">Your account</h2>
        <QA q="How do I delete my account?">
          Open <strong>Settings</strong> (tap your name, top right) and scroll to{" "}
          <strong>Delete account</strong>. This permanently deletes your account, your profile,
          and the groups you host, along with their data. It can&rsquo;t be undone.
        </QA>
        <QA q="How is my data handled?">
          See our{" "}
          <Link className="text-orange-600 hover:underline" href="/campfire/privacy">
            Privacy Policy
          </Link>
          . In short: we collect your name and email to run your account, keep your group&rsquo;s
          moments private to your group, and never sell your data or use it for ad tracking.
        </QA>

        <h2 className="text-2xl font-semibold text-slate-900">Troubleshooting</h2>
        <QA q="An invite link isn’t working">
          Make sure you&rsquo;re opening the most recent link, and that you&rsquo;re signed in (or
          entering your name as a guest). If it still fails, email us the link and we&rsquo;ll
          sort it out.
        </QA>
        <QA q="I didn’t get a notification email">
          Check your spam folder and confirm the email on your account is correct in Settings.
          You can also manage notifications per group from the group card.
        </QA>
      </section>

      <p className="mt-12 text-sm text-slate-400">
        Campfire is operated by 10323594 Canada Corp. Still stuck? Email{" "}
        <a className="text-orange-600 hover:underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
        .
      </p>
    </main>
  );
}
