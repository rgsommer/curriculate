// /teebee-tax — Tee Bee Accountants taxation workspace.
// Standalone shell, mirrors /audit.
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.curriculate.net"),
  title: {
    template: "%s · Tee Bee Tax",
    default: "Tee Bee Tax — PNG tax compliance workspace",
  },
  description:
    "Prepare, review and file PNG tax returns from one workspace. Company income tax, individual income tax and GST computations with a preparer → reviewer → filing workflow. IRC rates built in.",
  keywords: [
    "PNG tax", "Papua New Guinea tax return", "company income tax PNG",
    "GST return PNG", "IRC PNG", "SWT PNG", "Tee Bee Accountants tax",
    "tax computation PNG", "tax software PNG", "Port Moresby tax agent",
  ],
  authors: [{ name: "Tee Bee Accountants Ltd", url: "https://www.curriculate.net/teebee" }],
  creator: "Tee Bee Accountants Ltd",
  publisher: "Tee Bee Accountants Ltd",
  alternates: { canonical: "https://www.curriculate.net/teebee-tax" },
  robots: { index: true, follow: true },
  category: "Business Software",
};

export default function TeebeeTaxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="tax-host" strategy="beforeInteractive">
        {`document.body.classList.add('teebeepay-host');`}
      </Script>
      {children}
    </>
  );
}
