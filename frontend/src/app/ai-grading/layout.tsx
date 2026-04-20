import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Grading Tool — Grade Papers in Minutes, Not Hours",
  description:
    "AI-powered grading for teachers. Snap a photo of student work, choose from 11 feedback voices, and get rubric-aligned grades with personalized feedback in seconds.",
  keywords: [
    "AI grading",
    "AI grading tool",
    "grade papers with AI",
    "AI essay grader",
    "teacher grading tool",
    "automated grading",
    "AI feedback for students",
    "handwriting grading AI",
    "rubric grading AI",
    "free grading tool for teachers",
    "AI paper grader",
    "grade student work",
    "AI teacher assistant",
  ],
  openGraph: {
    title: "AI Grading Tool — Grade Papers in Minutes | Curriculate",
    description:
      "AI grading for teachers. Photo-first workflow reads handwriting, follows your rubric, and writes personalized feedback in 11 different voices.",
    url: "https://curriculate.net/ai-grading",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-ai-grading.png",
        width: 1200,
        height: 630,
        alt: "Curriculate AI Grading Tool — Grade a stack of papers in minutes",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Grading Tool — Grade Papers in Minutes | Curriculate",
    description:
      "AI grading for teachers. Reads handwriting, follows your rubric, 11 feedback voices.",
    images: ["https://curriculate.net/images/og/og-ai-grading.png"],
  },
  alternates: {
    canonical: "https://curriculate.net/ai-grading",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Curriculate AI Grading Tool",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  description:
    "AI-powered grading tool for teachers. Reads handwriting, follows rubrics, and provides personalized student feedback in 11 different voices.",
  url: "https://curriculate.net/ai-grading",
  featureList: [
    "Photo-first workflow — snap handwritten or typed work",
    "11 feedback voices from encouraging to rigorous",
    "Sticky rubric detection across grading sessions",
    "Session summaries with class-wide trend analysis",
    "No sign-up or account required",
  ],
};

export default function AIGradingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  );
}
