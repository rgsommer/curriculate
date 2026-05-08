import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Session Reports — Gradebook-Ready Output",
  description:
    "Every Curriculate session ends with an AI-generated report: per-student grades, trend column (Pro), parent note, and an Edsby-import CSV — emailed to your inbox automatically.",
  openGraph: {
    title: "Curriculate Session Reports — Gradebook-Ready Output",
    description:
      "AI session reports: per-student grades, trend column, parent note, Edsby CSV — emailed automatically.",
    url: "https://curriculate.net/reports",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/reports" },
  // The reports page is the teacher's authenticated reports list — index lightly.
  robots: { index: false, follow: true },
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
