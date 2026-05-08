import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Investors",
  description:
    "Curriculate is AI lesson orchestration for real classrooms — time-aware planning, intentional movement, station-based delivery, and AI grading. Investor materials, traction, and platform overview.",
  openGraph: {
    title: "Curriculate — Investor Information",
    description:
      "AI lesson orchestration + AI grading. Two-product platform with native Edsby integration. Investor overview.",
    url: "https://curriculate.net/investors",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/investors" },
};

export default function InvestorsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
