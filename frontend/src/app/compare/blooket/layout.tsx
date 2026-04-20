import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Curriculate vs Blooket — Side-by-Side Comparison",
  description:
    "Compare Curriculate and Blooket side by side. Curriculate offers station-based movement, 65+ task types, team collaboration, and off-screen learning. Blooket excels at gamified quiz review with creative game modes.",
  keywords: [
    "Curriculate vs Blooket",
    "Blooket alternative",
    "Blooket alternative for teachers",
    "classroom game comparison",
    "station rotation vs quiz games",
    "screen-free classroom learning",
    "collaborative classroom tool",
  ],
  openGraph: {
    title: "Curriculate vs Blooket — Side-by-Side Comparison",
    description:
      "Station-based collaboration and off-screen learning vs gamified quiz review. See how they compare.",
    url: "https://curriculate.net/compare/blooket",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-compare-blooket.png",
        width: 1200,
        height: 630,
        alt: "Curriculate vs Blooket",
      },
    ],
  },
  alternates: {
    canonical: "https://curriculate.net/compare/blooket",
  },
};

export default function CompareBlooketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
