import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Curriculate vs. Kahoot — How They Compare",
  description:
    "Side-by-side comparison: Kahoot is a quiz game; Curriculate is an AI lesson architect that runs station-based, team-based scavenger hunts with movement, collaboration, and gradebook-ready reports.",
  keywords: [
    "Kahoot alternative",
    "Curriculate vs Kahoot",
    "classroom quiz alternatives",
    "movement vs quiz classroom",
  ],
  openGraph: {
    title: "Curriculate vs. Kahoot — Beyond Quizzes",
    description:
      "Kahoot is quiz-only. Curriculate plans lessons, runs station rotations, and produces gradebook-ready reports.",
    url: "https://curriculate.net/compare/kahoot",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/compare/kahoot" },
};

export default function CompareKahootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
