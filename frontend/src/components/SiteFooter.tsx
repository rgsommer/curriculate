import Link from "next/link";

function FooterCol({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-[160px]">
      <div className="text-sm font-extrabold text-gray-900">{title}</div>
      <div className="mt-3 flex flex-col gap-2 text-sm font-semibold text-gray-700">
        {children}
      </div>
    </div>
  );
}

export default function SiteFooter() {
  return (
    <footer className="border-t bg-white/60">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2 font-extrabold tracking-tight">
              <span className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-600 via-violet-500 to-emerald-400 shadow-sm" />
              <span>Curriculate</span>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              Station-based learning made simple — AI plans time-fit task sets, then generates tasks,
              with team play and evidence-rich reporting.
            </p>
            <p className="mt-4 text-sm text-gray-500">
              © {new Date().getFullYear()} Curriculate. All rights reserved.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <FooterCol title="Product">
              <Link href="/how-it-works">How it Works</Link>
              <Link href="/ai-grading">AI Grading</Link>
              <Link href="/preview">Preview</Link>
              <Link href="/reports">Reports</Link>
              <Link href="/compare">Compare</Link>
              <Link href="/compare/kahoot">vs Kahoot</Link>
              <Link href="/compare/quizlet">vs Quizlet</Link>
              <Link href="/station-posters">Station Posters</Link>
            </FooterCol>

            <FooterCol title="Get Started">
              <Link className="hover:text-gray-900" href="/freetrial">
                Free Trial
              </Link>
              <Link className="hover:text-gray-900" href="/demo">
                Try Demo
              </Link>
              <Link className="hover:text-gray-900" href="/pricing">
                Pricing
              </Link>
              <Link className="hover:text-gray-900" href="/signup">
                Sign Up
              </Link>
              <Link className="hover:text-gray-900" href="/referrals">
                Referral Program
              </Link>
            </FooterCol>

            <FooterCol title="Follow Us">
              <a className="hover:text-gray-900" href="https://x.com/CurriculateNet" target="_blank" rel="noopener noreferrer">
                X / Twitter
              </a>
              <a className="hover:text-gray-900" href="https://instagram.com/curriculategrading" target="_blank" rel="noopener noreferrer">
                Instagram
              </a>
              <a className="hover:text-gray-900" href="https://tiktok.com/@curriculate_grading" target="_blank" rel="noopener noreferrer">
                TikTok
              </a>
            </FooterCol>

            <FooterCol title="Company & Legal">
              <Link className="hover:text-gray-900" href="/about">
                About
              </Link>
              <Link className="hover:text-gray-900" href="/contact">
                Contact
              </Link>
              <Link className="hover:text-gray-900" href="/faq">
                FAQ
              </Link>
              <Link className="hover:text-gray-900" href="/privacy">
                Privacy
              </Link>
              <Link className="hover:text-gray-900" href="/termsofservice">
                Terms
              </Link>

              {/* Keep investors page unlinked by default */}
              {/* <Link className="hover:text-gray-900" href="/investors">Investors</Link> */}
            </FooterCol>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-4 text-xs font-semibold text-gray-500">
          {/* Optional direct downloads (uncomment if you store these under public/pdfs/) */}
          {/* <a className="hover:text-gray-700" href="/pdfs/task-catalog.pdf">Task Catalog (PDF)</a>
          <a className="hover:text-gray-700" href="/pdfs/Curriculate-Teacher-Report-Sample.pdf">Teacher Report (PDF)</a>
          <a className="hover:text-gray-700" href="/pdfs/Curriculate-Student-Report-Sample.pdf">Student Report (PDF)</a>
          <a className="hover:text-gray-700" href="/pdfs/Curriculate-Station-Posters.pdf">Station Posters (PDF)</a> */}
        </div>
      </div>
    </footer>
  );
}
