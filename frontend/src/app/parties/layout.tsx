import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Birthday Party Games — AI-Powered Party Activities | Curriculate",
  description:
    "Turn any birthday party into an epic game show with Curriculate. Pick a theme, add personal touches, and AI generates interactive team games that run on phones. No app needed — works for ages 5 to 15+.",
  keywords: [
    "birthday party games",
    "party games for kids",
    "birthday party activities",
    "kids party ideas",
    "interactive party games",
    "team party games",
    "phone party games",
    "birthday party entertainment",
    "party game show",
    "kids birthday party",
    "tween party games",
    "teen party games",
    "no app party games",
    "CurricQR code party games",
    "themed birthday party",
    "dinosaur party games",
    "space party games",
    "superhero party games",
    "trivia party games",
    "party scavenger hunt",
    "party charades",
    "party pictionary",
    "group party games",
    "indoor party games",
    "birthday party planner",
    "AI party games",
    "free party games",
    "party games no download",
  ],
  openGraph: {
    title: "Birthday Party Games — AI-Powered Party Activities",
    description:
      "Pick a theme. Add the birthday kid's name. AI builds a full set of interactive party games in 60 seconds. Kids join on phones — no app needed.",
    type: "website",
    url: "https://curriculate.net/parties",
    siteName: "Curriculate",
    images: [
      {
        url: "https://curriculate.net/images/og/og-parties.png",
        width: 1200,
        height: 630,
        alt: "Birthday Party Games",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Birthday Party Games — AI-Powered Party Activities | Curriculate",
    description:
      "AI generates themed party games for birthdays. Flashcards Race, Musical Chairs, Speed Draw, Treasure Runner — all on phones, no app needed.",
    images: ["https://curriculate.net/images/og/og-parties.png"],
  },
  alternates: {
    canonical: "https://curriculate.net/parties",
  },
};

export default function PartiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
