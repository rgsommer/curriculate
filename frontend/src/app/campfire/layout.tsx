import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Campfire Prototype — Interactive Group Engagement Demo",
  description:
    "Try the Campfire interactive prototype. Experience sealed polls, group challenges, accountability check-ins, and 12 engagement types designed for families, friends, churches, and communities.",
  keywords: [
    "campfire app",
    "group engagement app",
    "sealed polls",
    "group challenges",
    "family app",
    "church group app",
    "community engagement",
    "social engagement platform",
    "group activities app",
    "interactive group games",
  ],
  openGraph: {
    title: "Campfire — Try the Interactive Prototype",
    description:
      "Experience the group engagement app that seals results until everyone responds. Polls, challenges, games, and more for your group.",
    url: "https://curriculate.net/campfire",
    siteName: "Campfire",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Campfire — Interactive Group Engagement Prototype",
    description:
      "Sealed polls, group challenges, accountability — try the prototype for the app that brings groups to life.",
  },
  alternates: {
    canonical: "https://curriculate.net/campfire",
  },
};

export default function CampfirePrototypeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Campfire",
            applicationCategory: "SocialNetworkingApplication",
            operatingSystem: "iOS, Android, Web",
            description:
              "Campfire is a group engagement app featuring sealed polls, challenges, accountability check-ins, and 12 activity types. Results stay hidden until everyone responds.",
            url: "https://curriculate.net/campfire",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
              description: "Free 3-month trial, then $4.99/month premium",
            },
            featureList: [
              "Sealed results — nobody sees answers until everyone responds",
              "12 engagement types including polls, challenges, and games",
              "Blind/anonymous mode for honest responses",
              "Group streaks and milestone tracking",
              "Voice responses and photo/video challenges",
              "Recurring scheduled engagements",
              "Real-time nudges for stragglers",
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
