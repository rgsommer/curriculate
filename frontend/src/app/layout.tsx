// frontend/src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    template: "%s | Curriculate.net",
    default: "Curriculate.net – Instant Interactive Quizzes",
  },
  description: "Instant interactive quizzes from any text or CSV. Built for teachers, by teachers.",
  keywords: ["education", "quiz", "CSV", "classroom", "taskset", "interactive"],
  openGraph: {
    title: "Curriculate.net",
    description: "Instant interactive quizzes from any text or CSV",
    url: "https://curriculate.net",
    siteName: "Curriculate.net",
    images: ["/og-image.jpg"],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Curriculate.net",
    description: "Instant interactive quizzes from any text or CSV",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script src="/config/copy.js" strategy="beforeInteractive" />
      </head>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <SiteHeader />
        <div className="min-h-[70vh]">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
