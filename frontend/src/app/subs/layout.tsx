// frontend/src/app/subs/layout.tsx
//
// Layout + metadata for the /subs substitute-teacher staffing app.
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.curriculate.net"),
  title: "Curriculate Subs — Substitute Teacher Staffing",
  description:
    "Schools rank preferred substitute teachers per grade level and post sub requests. Curriculate Subs contacts substitutes in order — escalating automatically until one accepts — by email and SMS.",
  alternates: { canonical: "https://www.curriculate.net/subs" },
  robots: { index: false, follow: false },
};

export default function SubsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
