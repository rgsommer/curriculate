import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Curriculate's terms of service: acceptable use, billing, intellectual property, and the rules that govern teacher and school subscriptions.",
  openGraph: {
    title: "Terms of Service — Curriculate",
    description: "Acceptable use, billing, intellectual property, and subscription terms.",
    url: "https://curriculate.net/terms",
  },
  twitter: { card: "summary" },
  alternates: { canonical: "https://curriculate.net/terms" },
  robots: { index: true, follow: true },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
