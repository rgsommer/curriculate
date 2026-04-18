import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compare — Curriculate vs Kahoot, Quizlet, Blooket & More",
  description:
    "See how Curriculate compares to Kahoot, Quizlet, Blooket, and other classroom tools. More depth, movement, collaboration, and evidence-rich reporting than quiz-based alternatives.",
  keywords: [
    "Curriculate vs Kahoot",
    "Curriculate vs Quizlet",
    "Curriculate vs Blooket",
    "Blooket alternative",
    "classroom tool comparison",
    "best station rotation tool",
    "Kahoot alternative",
    "Quizlet alternative for teachers",
    "Blooket alternative for teachers",
    "interactive classroom tools comparison",
    "screen-free classroom learning",
  ],
  openGraph: {
    title: "Compare — Curriculate vs Kahoot, Quizlet, Blooket & More",
    description:
      "More depth, movement, and reporting than quiz-based tools. See side-by-side comparisons.",
    url: "https://curriculate.net/compare",
    siteName: "Curriculate",
    type: "website",
  },
  alternates: {
    canonical: "https://curriculate.net/compare",
  },
};

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
