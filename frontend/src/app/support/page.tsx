// frontend/app/support/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support | Curriculate",
  description:
    "Get help with Curriculate: setup, stations, accounts, billing, and troubleshooting.",
};

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight">Support</h1>
        <p className="mt-3 text-lg text-neutral-600">
          We’ll help you get Curriculate running smoothly — from first setup to
          live sessions.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Contact</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 p-4">
            <div className="text-sm font-medium text-neutral-700">Email</div>
            <a
              className="mt-1 inline-block text-base font-semibold text-blue-600 hover:underline"
              href="mailto:support@curriculate.net"
            >
              support@curriculate.net
            </a>
            <div className="mt-2 text-sm text-neutral-600">
              Best for account, billing, and technical questions.
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4">
            <div className="text-sm font-medium text-neutral-700">Response time</div>
            <div className="mt-1 text-base font-semibold">Typically within 1 business day</div>
            <div className="mt-2 text-sm text-neutral-600">
              During school hours, we’re often faster.
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700">
          <span className="font-medium">Tip:</span> Include your school name,
          the page URL you’re on, and a screenshot (if possible). That usually
          cuts troubleshooting time in half.
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Quick help</h2>
        <div className="mt-4 grid gap-4">
          <FAQ
            q="Station Posters is giving me a 404."
            a={
              <>
                That usually means the route isn’t deployed or a link is pointing
                to an old path. Try refreshing the page, then confirm the route
                exists in the frontend build. If it persists, email{" "}
                <a className="text-blue-600 hover:underline" href="mailto:support@curriculate.net">
                  support@curriculate.net
                </a>{" "}
                with the exact URL and a screenshot.
              </>
            }
          />
          <FAQ
            q="I updated the site, but I don’t see the changes."
            a={
              <>
                Clear your browser cache (or open in a private window). If you’re
                using Vercel, confirm you’re viewing the correct domain and the
                latest Production deployment.
              </>
            }
          />
          <FAQ
            q="How do I get started fast?"
            a={
              <>
                Start with a single classroom rotation (teams of 3–4), put color
                station markers on the walls, and run a short taskset to practice
                the flow. Once that feels smooth, expand to multi-room mode.
              </>
            }
          />
          <FAQ
            q="Do you offer school-wide plans?"
            a={
              <>
                Yes. If you’re planning school-wide use, email us and we’ll set up
                a plan that fits your context.
              </>
            }
          />
        </div>
      </section>

      <section className="mt-12 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">Policies</h2>
        <p className="mt-2 text-neutral-600">
          Looking for privacy and data handling details?
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/privacy"
            className="inline-flex items-center rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50"
          >
            Privacy Policy
          </Link>
        </div>
      </section>
    </main>
  );
}

function FAQ({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <details className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <summary className="cursor-pointer select-none text-base font-semibold">
        {q}
      </summary>
      <div className="mt-3 text-sm leading-6 text-neutral-700">{a}</div>
    </details>
  );
}
