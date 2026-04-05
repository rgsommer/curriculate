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
