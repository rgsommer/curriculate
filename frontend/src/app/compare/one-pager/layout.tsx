import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Curriculate One-Pager — At-a-Glance Comparison",
  description:
    "A printable one-page summary of how Curriculate compares to Kahoot, Quizlet, Blooket, and worksheets — and where it fits in your existing classroom workflow.",
  openGraph: {
    title: "Curriculate One-Pager — At-a-Glance Comparison",
    description:
      "Printable one-page summary comparing Curriculate to Kahoot, Quizlet, Blooket, and worksheets.",
    url: "https://curriculate.net/compare/one-pager",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/compare/one-pager" },
};

export default function CompareOnePagerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
