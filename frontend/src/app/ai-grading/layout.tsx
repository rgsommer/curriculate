import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Grading for Teachers — Photo, Paste, Batch & Voice",
  description:
    "AI grading for handwritten work, typed responses, batch PDFs, audio performances, and video. Pulse Grading by Curriculate follows your rubric, writes feedback in your voice, and exports straight to Edsby.",
  keywords: [
    "AI grading",
    "AI grader for teachers",
    "auto grade handwriting",
    "batch PDF grading",
    "essay AI grading",
    "Pulse Grading",
    "Edsby gradebook export",
    "rubric-based AI feedback",
  ],
  openGraph: {
    title: "AI Grading for Teachers — Pulse Grading by Curriculate",
    description:
      "Grade photos, typed work, batch PDFs, audio, and video with rubric-matched feedback. Export to Edsby in one click.",
    url: "https://curriculate.net/ai-grading",
    images: [
      {
        url: "https://curriculate.net/images/og/og-home.png",
        width: 1200,
        height: 630,
        alt: "Curriculate Pulse Grading",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Grading for Teachers — Pulse Grading by Curriculate",
    description:
      "Grade handwriting, typed work, audio, and video with rubric-matched feedback. Edsby export included.",
  },
  alternates: { canonical: "https://curriculate.net/ai-grading" },
};

export default function AiGradingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
