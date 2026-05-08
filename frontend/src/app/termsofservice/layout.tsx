import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Curriculate's terms of service: acceptable use, billing, intellectual property, and the rules that govern teacher and school subscriptions.",
  // Both /terms and /termsofservice serve the same content historically. Mark the canonical
  // as the shorter /terms URL so search engines consolidate ranking signals there.
  alternates: { canonical: "https://curriculate.net/terms" },
  robots: { index: false, follow: true },
};

export default function TermsOfServiceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
