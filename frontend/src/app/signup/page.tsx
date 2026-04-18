"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function SignupRedirectInner() {
  const params = useSearchParams();

  useEffect(() => {
    const qs = params?.toString();
    // Redirect to the login/signup page (which has a Sign Up tab)
    window.location.replace(qs ? `/login?${qs}` : "/login");
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
