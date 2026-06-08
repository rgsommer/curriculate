"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, getToken, loginHref } from "../_lib/api";

function AcceptInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState<"loading" | "need-login" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Missing invitation token.");
      return;
    }
    if (!getToken()) {
      setState("need-login");
      return;
    }
    api("/invite/accept", { body: { token } })
      .then(() => setState("ok"))
      .catch((e) => {
        setState("error");
        setMessage(e.message);
      });
  }, [token]);

  if (state === "loading") return <p className="text-slate-500">Accepting your invitation…</p>;

  if (state === "need-login") {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Accept your invitation</h1>
        <p className="mt-2 text-slate-600">
          First, sign in or create your password. You&apos;ll come straight back here to finish.
        </p>
        <Link
          href={loginHref(`/behavior/accept?token=${encodeURIComponent(token)}`)}
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white"
        >
          Sign in / set password
        </Link>
      </Card>
    );
  }

  if (state === "ok") {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-green-700">You&apos;re in ✓</h1>
        <p className="mt-2 text-slate-600">Your account is now linked to the school.</p>
        <Link href="/behavior" className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white">
          Go to dashboard
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold text-red-700">Couldn&apos;t accept invitation</h1>
      <p className="mt-2 text-slate-600">{message}</p>
      <Link href="/behavior" className="mt-4 inline-block underline">Go to dashboard</Link>
    </Card>
  );
}

export default function AcceptPage() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <AcceptInner />
    </Suspense>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
