"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function SignupRedirectInner() {
  const params = useSearchParams();

  useEffect(() => {
    const qs = params?.toString();
    window.location.replace(qs ? `/pricing?${qs}` : "/pricing");
  }, [params]);

  return <main style={{ padding: 32 }}>Redirecting…</main>;
}

export default function SignupRedirectPage() {
  return (
    <Suspense fallback={<main style={{ padding: 32 }}>Redirecting…</main>}>
      <SignupRedirectInner />
    </Suspense>
  );
}
