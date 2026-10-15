import type { Metadata } from "next";

// /campfire and its public pages (privacy, terms, support, get…). The interactive
// prototype lives at /campfire/demo with its own "demo" banner — never here, so the
// privacy/terms pages the app stores link to don't read as sample data.
export const metadata: Metadata = {
  title: { absolute: "Campfire — sign a card together, ask your group anything" },
  description:
    "Campfire is a free app for families, churches, classes and teams: everyone signs one surprise card from a single link, or answers a poll, photo contest or check-in that opens for everyone at once. Signers need no account.",
  openGraph: {
    title: "Campfire — sign a card together 🔥",
    description:
      "Everyone signs one surprise card from a single link, and it opens on the day. Polls, photo contests and sign-ups too. Free; signers need no account.",
    url: "https://curriculate.net/campfire",
    siteName: "Campfire",
    type: "website",
    images: [{ url: "https://curriculate.net/images/og/og-campfire.png", width: 1200, height: 630, alt: "Campfire" }],
  },
  alternates: { canonical: "https://curriculate.net/campfire" },
};

export default function CampfireLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
