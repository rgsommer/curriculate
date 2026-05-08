import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up — Free Teacher Account",
  description:
    "Create a free Curriculate teacher account. AI lesson planning, live station-based gameplay, and AI grading — no credit card required to start.",
  openGraph: {
    title: "Sign Up — Curriculate (Free Teacher Account)",
    description: "Free teacher account. AI lesson planning + AI grading. No credit card.",
    url: "https://curriculate.net/signup",
    images: [
      { url: "https://curriculate.net/images/og/og-home.png", width: 1200, height: 630 },
    ],
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "https://curriculate.net/signup" },
  robots: { index: true, follow: true },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
