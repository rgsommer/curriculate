// frontend/src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from 'next/font/google';
import "./globals.css";
import Script from "next/script";

//import Footer from "@/components/Footer";

// Replace the config
const inter = Inter({
  subsets: ['latin'],  // Add more subsets if needed (e.g., ['latin', 'cyrillic'])
  weight: ['400', '500', '700'],  // Adjust weights as needed
  variable: '--font-inter',  // Optional: CSS variable for use in globals.css
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
        <body className={inter.className}>
        {children}
        {/* <Footer /> */}
      </body>
    </html>
  );
}