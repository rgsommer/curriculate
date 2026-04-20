import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact — Get in Touch",
  description:
    "Have questions about Curriculate? Reach out to our team for support, partnership inquiries, or feedback about station-based learning and AI grading tools.",
  openGraph: {
    title: "Contact — Curriculate",
    description: "Get in touch with the Curriculate team.",
    url: "https://curriculate.net/contact",
    siteName: "Curriculate",
    type: "website",
    images: [
      {
        url: "https://curriculate.net/images/og/og-contact.png",
        width: 1200,
        height: 630,
        alt: "Contact Curriculate",
      },
    ],
  },
  alternates: {
    canonical: "https://curriculate.net/contact",
  },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
