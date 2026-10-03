"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// A nav link that highlights the current route (with aria-current) so a teacher
// can tell where they are in the horizontally-scrolling nav.
export default function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // Dashboard is the base route, so match it exactly; others match by prefix.
  const active = href === "/behavior" ? pathname === "/behavior" : !!pathname?.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={active ? "font-semibold text-slate-900 underline decoration-2 underline-offset-4" : "text-slate-600 hover:text-slate-900"}
    >
      {children}
    </Link>
  );
}
