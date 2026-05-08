import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Curriculate vs. Worksheets — Beyond Paper Drills",
  description:
    "Worksheets are static and solo. Curriculate runs interactive station-based scavenger hunts with movement, collaboration, instant feedback, and gradebook-ready AI reports.",
  keywords: [
    "alternatives to worksheets",
    "Curriculate vs worksheets",
    "active learning alternatives",
    "movement-based classroom",
  ],
  openGraph: {
    title: "Curriculate vs. Worksheets — Active Over Static",
    description:
      "Move your worksheet practice into station-based, team-based, AI-graded scavenger hunts.",
    url: "https://curriculate.net/compare/worksheets",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/compare/worksheets" },
};

export default function CompareWorksheetsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
