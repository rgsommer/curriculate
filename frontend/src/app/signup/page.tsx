"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function SignupRedirect() {
  const params = useSearchParams();

  useEffect(() => {
    // preserve any handoff / returnTo / stripe params
    const qs = params?.toString();
    window.location.replace(qs ? `/pricing?${qs}` : "/pricing");
  }, [params]);

  return (
    <main style={{ padding: 32 }}>
      Redirecting…
    </main>
  );
}
