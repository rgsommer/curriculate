import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pulse — Grade Papers in Minutes, Not Hours | Curriculate",
  description:
    "Pulse by Curriculate. Snap a photo of student work, choose from 13 feedback voices, and get rubric-aligned grades with personalized feedback in seconds. Batch grading, parent portal, email notifications, and CurricQR-coded PDF reports.",
  keywords: [
    "Pulse grading",
    "Curriculate Pulse",
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
    "batch grading",
    "parent portal",
    "grade notifications",
    "CurricQR code reports",
    "student progress tracking",
    "Pulse for teachers",
    "gradebook export",
  ],
  openGraph: {
    title: "Pulse — Grade Papers in Minutes | Curriculate",
    description:
      "Pulse by Curriculate. Photo-first workflow reads handwriting, follows your rubric, and writes personalized feedback in 13 different voices. Batch grading, parent portal, and email notifications.",
    url: "https://curriculate.net/pulse",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-ai-grading.png",
        width: 1200,
        height: 630,
        alt: "Curriculate Pulse — Grade a stack of papers in minutes",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulse — Grade Papers in Minutes | Curriculate",
    description:
      "Pulse by Curriculate. Reads handwriting, follows your rubric, 13 feedback voices. Batch grading, parent portal, email notifications.",
    images: ["https://curriculate.net/images/og/og-ai-grading.png"],
  },
  alternates: {
    canonical: "https://curriculate.net/pulse",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Curriculate Pulse",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  description:
    "Pulse by Curriculate. Reads handwriting, follows rubrics, and provides personalized student feedback in 13 different voices.",
  url: "https://curriculate.net/pulse",
  featureList: [
    "Photo-first workflow — snap handwritten or typed work",
    "13 feedback voices from encouraging to rigorous",
    "Sticky rubric detection across grading sessions",
    "Batch grading — upload a whole class as PDF",
    "Per-student strictness adjustment",
    "CurricQR-coded PDF reports with 5-character result codes",
    "Student & parent progress portal with grade tracking",
    "Email notifications — instant or weekly digest",
    "Grade review requests from students and parents",
    "Gradebook CSV export for Edsby and other systems",
    "Session summaries with class-wide trend analysis",
    "Video and audio performance grading",
    "Class roster support — Edsby CSV or manual entry",
    "No sign-up or account required",
  ],
};

export default function PulseLayout({
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
