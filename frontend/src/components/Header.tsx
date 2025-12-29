// frontend/src/components/Header.tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const nav = [
  { href: "/features", label: "Features" },
  { href: "/pedagogy", label: "Pedagogy" },
  { href: "/pricing", label: "Pricing" },
  { href: "/reports", label: "Reports" },
  { href: "/referrals", label: "Referrals" },
  { href: "/compare", label: "Compare" },
  { href: "/faq", label: "FAQ" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-black text-gray-900">
            Curriculate<span className="text-blue-600">.net</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-5">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-sm font-semibold text-gray-700 hover:text-gray-900"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-blue-700"
          >
            Get Started Free <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
