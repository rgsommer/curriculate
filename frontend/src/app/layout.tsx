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
    default: "Curriculate.net – AI-Powered Station-Based Learning",
  },
  description:
    "AI-powered lesson planning and station-based learning. Curriculate plans time-fit task sets, then generates interactive stations with movement, collaboration, and evidence-rich reporting.",
  keywords: [
    "education",
    "station rotation",
    "classroom activities",
    "AI lesson planning",
    "formative assessment",
    "interactive learning",
    "teacher tools",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
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
