import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try the Demo — 65+ Task Types, One Platform | Curriculate",
  description:
    "Experience Curriculate's 65+ AI-generated task types: multiple choice, storytelling, debates, physical challenges, photo evidence, and more. Try the interactive demo — no sign-up needed.",
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
      "AI-generated station-based lessons with 65+ task types. Multiple choice, storytelling, debates, photo evidence, and more. Try it now — no sign-up required.",
    url: "https://curriculate.net/demo",
    siteName: "Curriculate",
    type: "website",
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
