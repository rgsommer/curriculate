import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Curriculate vs. Quizlet — How They Compare",
  description:
    "Quizlet is for self-study with flashcards. Curriculate plans lessons and runs station-based, team-based classroom activities with AI-generated tasks and gradebook-ready reporting.",
  keywords: [
    "Quizlet alternative",
    "Curriculate vs Quizlet",
    "classroom team learning",
    "flashcard alternatives",
  ],
  openGraph: {
    title: "Curriculate vs. Quizlet — Classroom Engagement vs. Solo Flashcards",
    description:
      "Quizlet is solo flashcards. Curriculate is a live classroom engagement platform with AI lesson planning.",
    url: "https://curriculate.net/compare/quizlet",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/compare/quizlet" },
};

export default function CompareQuizletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
