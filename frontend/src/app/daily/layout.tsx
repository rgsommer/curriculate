// /daily — the classroom day board. Projected all day in Mr. Sommer's room,
// driven by the DisplayAI tab of the planning spreadsheet via /api/daily.
//
// It is a kiosk page, not a Curriculate page: no site header, no footer, no
// Curriculate branding. The body gets a `daily-kiosk` class before first paint
// (same pattern as the TeebeePay shell) and globals.css hides the chrome.
import type { Metadata } from "next";
import Script from "next/script";
import { Caveat, Lexend, Merriweather } from "next/font/google";
import "./daily.css";

const caveat = Caveat({ subsets: ["latin"], weight: ["600"], variable: "--font-caveat" });
const lexend = Lexend({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-lexend" });
const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-merriweather",
});

export const metadata: Metadata = {
  title: { absolute: "Daily Board" },
  description: "Classroom day board.",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function DailyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="daily-kiosk" strategy="beforeInteractive">
        {`document.body.classList.add('daily-kiosk');`}
      </Script>
      <div className={`daily-root ${caveat.variable} ${lexend.variable} ${merriweather.variable}`}>{children}</div>
    </>
  );
}
