import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try the Demo — 65+ Task Types, One Platform | Curriculate",
  description:
    "Experience Curriculate's 65+ AI-generated task types: multiple choice, fill-in-the-blank, live AI interviews, peer editing, teach-back explanations, storytelling, debates, physical challenges, and more. Try the interactive demo — no sign-up needed.",
  keywords: [
    "Curriculate demo",
    "try station rotation",
    "classroom demo",
    "interactive learning demo",
    "free classroom tool demo",
    "65 task types classroom",
    "AI lesson planning demo",
    "station rotation demo",
    "screen-free classroom technology",
    "Kahoot alternative demo",
    "Blooket alternative demo",
  ],
  openGraph: {
    title: "65+ Task Types — Try the Curriculate Demo",
    description:
      "AI-generated station-based lessons with 65+ task types. Fill-in-the-blank, live AI interviews, peer editing, teach-back, debates, photo evidence, and more. Try it now — no sign-up required.",
    url: "https://curriculate.net/demo",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-demo.png",
        width: 1200,
        height: 630,
        alt: "Curriculate Demo — 65+ Task Types",
      },
    ],
  },
  alternates: {
    canonical: "https://curriculate.net/demo",
  },
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
