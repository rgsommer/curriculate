// frontend/src/app/teebeepay/app/layout.tsx
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "TeebeePay — Sign in",
  description: "Sign in to TeebeePay — multi-tenant payroll for PNG.",
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="teebeepay-app-host" strategy="beforeInteractive">
        {`document.body.classList.add('teebopay-host');`}
      </Script>
      {children}
    </>
  );
}
