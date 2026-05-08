import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Curriculate's privacy policy: what data we collect from teachers, students, and parents; how we store it; and how we comply with FERPA, COPPA, and GDPR.",
  openGraph: {
    title: "Privacy Policy — Curriculate",
    description: "How Curriculate handles teacher, student, and parent data. FERPA / COPPA / GDPR compliant.",
    url: "https://curriculate.net/privacy",
  },
  twitter: { card: "summary" },
  alternates: { canonical: "https://curriculate.net/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
