import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="border-t bg-white/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-extrabold tracking-tight">
            <span className="h-3 w-3 rounded-full bg-gradient-to-br from-blue-600 via-violet-500 to-emerald-400 shadow-sm" />
            <span>Curriculate</span>
          </div>
          <p className="mt-2 text-sm text-gray-500">© {new Date().getFullYear()} Curriculate. All rights reserved.</p>
        </div>

        <div className="flex flex-wrap gap-5 text-sm font-semibold text-gray-700">
          <Link className="hover:text-gray-900" href="/privacy">Privacy</Link>
          <Link className="hover:text-gray-900" href="/termsofservice">Terms</Link>
          <Link className="hover:text-gray-900" href="/contact">Contact</Link>
        </div>
      </div>
    </footer>
  );
}
