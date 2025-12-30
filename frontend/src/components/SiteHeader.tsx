import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-white/75 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight">
          <span className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-600 via-violet-500 to-emerald-400 shadow-sm" />
          <span>Curriculate</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-semibold text-gray-700 md:flex">
          <Link className="hover:text-gray-900" href="/features">Features</Link>
          <Link className="hover:text-gray-900" href="/pricing">Pricing</Link>
          <Link className="hover:text-gray-900" href="/about">About</Link>
          <Link className="hover:text-gray-900" href="/contact">Contact</Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/demo"
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50"
          >
            Try Demo
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-gradient-to-br from-blue-600 to-violet-600 px-4 py-2 text-sm font-bold text-white hover:opacity-95"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}
