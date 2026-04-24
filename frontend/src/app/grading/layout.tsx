import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prism — Grading Tool for Teachers | Curriculate",
  description:
    "Grade student papers instantly with Prism. Upload a photo of handwritten or typed work, set your rubric, and get detailed feedback in seconds.",
  keywords: [
    "Prism grading",
    "grade papers online",
    "AI essay grader free",
    "teacher grading assistant",
    "automated essay scoring",
    "handwriting recognition grading",
    "AI rubric grading",
    "free teacher tools",
  ],
  openGraph: {
    title: "Prism — Grading Tool for Teachers | Curriculate",
    description:
      "Grade student papers instantly with Prism. Photo-first workflow, 13 feedback voices, rubric-aligned scoring.",
    url: "https://curriculate.net/grading",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-grading.png",
        width: 1200,
        height: 630,
        alt: "Curriculate Prism — Grading Tool for Teachers",
      },
    ],
  },
  alternates: {
    canonical: "https://curriculate.net/grading",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function GradingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
