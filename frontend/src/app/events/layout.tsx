import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Corporate Event Games — AI-Powered Team Activities | Curriculate",
  description:
    "Interactive team games for corporate events, conferences, and offsites. Paste your event content and AI generates custom activities in 60 seconds. Attendees join on phones — no app needed.",
  keywords: [
    "corporate event games",
    "team building activities",
    "conference games",
    "corporate icebreakers",
    "interactive event activities",
    "team building games",
    "conference breakout activities",
    "corporate training games",
    "offsite team games",
    "company event ideas",
    "employee engagement games",
    "conference engagement tools",
    "interactive team activities",
    "corporate trivia games",
    "event gamification",
    "onboarding games",
    "quarterly kickoff activities",
    "sales kickoff games",
    "phone-based team games",
    "no app event games",
    "AI event planning",
    "corporate retreat activities",
    "large group games",
    "audience engagement tools",
    "professional icebreakers",
  ],
  openGraph: {
    title: "Corporate Event Games — AI-Powered Team Activities",
    description:
      "Paste your event content. AI builds interactive team games in 60 seconds. Attendees join on phones — no app needed.",
    type: "website",
    url: "https://curriculate.net/events",
    siteName: "Curriculate",
  },
  twitter: {
    card: "summary_large_image",
    title: "Corporate Event Games — AI-Powered Team Activities | Curriculate",
    description:
      "AI generates custom team games from your conference content, training material, or company vocabulary. Works on any phone.",
  },
  alternates: {
    canonical: "https://curriculate.net/events",
  },
};

export default function EventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
