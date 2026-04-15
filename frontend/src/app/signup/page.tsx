"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function SignupRedirectInner() {
  const params = useSearchParams();

  useEffect(() => {
    const qs = params?.toString();
    window.location.replace(qs ? `/pricing?${qs}` : "/pricing");
  }, [params]);

  return <div style={{ padding: 32 }}>Redirecting…</div>;
}

export default function SignupRedirectPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Redirecting…</div>}>
      <SignupRedirectInner />
    </Suspense>
  );
}
