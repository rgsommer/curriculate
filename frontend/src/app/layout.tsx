// frontend/src/app/layout.tsx
import type { Metadata } from "next";
import { GeistSans, GeistMono } from "next/font/google"; // ← fixed import names
import "./globals.css";
import Script from "next/script";

import Footer from "@/components/Footer";

const geistSans = GeistSans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = GeistMono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    images: ["/og-image.jpg"], // add this file later if you want
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Curriculate.net",
    description: "Instant interactive quizzes from any text or CSV",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Loads your public/config/copy.js so window.COPY is available everywhere */}
        <Script src="/config/copy.js" strategy="beforeInteractive" />
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50`}
      >
        {children}
        <Footer />
      </body>
    </html>
  );
}