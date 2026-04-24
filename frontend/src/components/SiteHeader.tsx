"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="hover:text-gray-900" href={href}>
      {children}
    </Link>
  );
}

function DropdownItem({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc?: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl px-3 py-2 transition hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
    >
      <div className="text-sm font-semibold text-gray-900 group-hover:text-gray-900">
        {title}
      </div>
      {desc ? <div className="text-xs text-gray-600">{desc}</div> : null}
    </Link>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const isGrading = pathname?.startsWith("/grading");

  return (
    <header className="sticky top-0 z-50 border-b bg-white/75 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-extrabold tracking-tight"
        >
          <span className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-600 via-violet-500 to-emerald-400 shadow-sm" />
          <span>Curriculate</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-5 text-sm font-semibold text-gray-700 md:flex">
          <NavLink href="/features">Features</NavLink>

          {/* How it Works dropdown */}
          <div className="relative group">
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-gray-900 focus:outline-none"
              aria-haspopup="menu"
            >
              <span>How it Works</span>
              <svg
                className="h-4 w-4 opacity-70 transition group-hover:rotate-180"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Hover bridge: prevents the dropdown from collapsing in the "gap" */}
            <div
              className="
                invisible absolute left-0 top-full h-3 w-full
                group-hover:visible group-focus-within:visible
              "
              aria-hidden="true"
            />

            {/* Menu panel */}
            <div
              className="
                invisible opacity-0 translate-y-1
                absolute left-0 top-full mt-3 w-[380px] z-50
                rounded-2xl border border-gray-200 bg-white shadow-xl
                p-3
                transition
                group-hover:visible group-hover:opacity-100 group-hover:translate-y-0
                group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0
              "
              role="menu"
            >
              <div className="px-2 pb-2">
                <div className="text-xs font-extrabold text-gray-500 uppercase tracking-wide">
                  How it Works
                </div>
              </div>

              <div className="grid gap-1">
                <DropdownItem
                  href="/how-it-works"
                  title="Overview"
                  desc="Plan a time-fit scavenger hunt → run → capture evidence → report."
                />
                <DropdownItem
                  href="/preview"
                  title="Preview"
                  desc="See the scavenger-hunt experience before you sign up."
                />
                <DropdownItem
                  href="/reports"
                  title="Reports"
                  desc="Teacher + student reports with evidence-rich detail."
                />
                <DropdownItem
                  href="/compare"
                  title="Compare"
                  desc="How Curriculate stacks up vs other tools."
                />
              </div>

              <div className="mt-2 border-t border-gray-100 pt-2">
                <div className="grid grid-cols-2 gap-1">
                  <DropdownItem
                    href="/compare/kahoot"
                    title="vs Kahoot"
                    desc="More pacing, depth + reporting."
                  />
                  <DropdownItem
                    href="/compare/quizlet"
                    title="vs Quizlet"
                    desc="More interaction + evidence."
                  />
                </div>
              </div>
            </div>
          </div>

          <NavLink href="/prism">Prism</NavLink>
          <NavLink href="/parties">Parties</NavLink>
          <NavLink href="/events">Events</NavLink>
          <NavLink href="/pricing">Pricing</NavLink>

          {/* More dropdown — keeps nav clean */}
          <div className="relative group">
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-gray-900 focus:outline-none"
              aria-haspopup="menu"
            >
              <span>More</span>
              <svg
                className="h-4 w-4 opacity-70 transition group-hover:rotate-180"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <div
              className="
                invisible absolute left-0 top-full h-3 w-full
                group-hover:visible group-focus-within:visible
              "
              aria-hidden="true"
            />

            <div
              className="
                invisible opacity-0 translate-y-1
                absolute right-0 top-full mt-3 w-[200px] z-50
                rounded-2xl border border-gray-200 bg-white shadow-xl
                p-2
                transition
                group-hover:visible group-hover:opacity-100 group-hover:translate-y-0
                group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0
              "
              role="menu"
            >
              <div className="grid gap-1">
                <DropdownItem href="/about" title="About" />
                <DropdownItem href="/faq" title="FAQ" />
                <DropdownItem href="/contact" title="Contact" />
                <DropdownItem href="/pedagogy" title="Pedagogy" />
              </div>
            </div>
          </div>
        </nav>

        <div className="flex items-center gap-3">
          {isGrading ? (
            <>
              <span className="hidden sm:inline text-xs text-gray-400">
                Grading is free &mdash; no sign-up
              </span>
              <Link
                href="/features"
                className="hidden lg:inline text-sm font-semibold text-gray-600 hover:text-gray-900"
              >
                See Curriculate
              </Link>
              <Link
                href="/freetrial"
                className="rounded-full bg-gradient-to-br from-blue-600 to-violet-600 px-4 py-2 text-sm font-bold text-white hover:opacity-95"
              >
                Try Curriculate Free
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/demo"
                className="hidden lg:inline text-sm font-semibold text-gray-600 hover:text-gray-900"
              >
                Demo
              </Link>
              <Link
                href="/freetrial"
                className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50"
              >
                Free Trial
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-gradient-to-br from-blue-600 to-violet-600 px-4 py-2 text-sm font-bold text-white hover:opacity-95"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
