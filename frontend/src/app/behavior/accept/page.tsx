"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, getToken, loginHref, inviteInfo } from "../_lib/api";

function AcceptInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Missing invitation token.");
      return;
    }
    // Already signed in → accept and go to the dashboard.
    if (getToken()) {
      api("/invite/accept", { body: { token } })
        .then(() => { window.location.href = "/behavior"; })
        .catch((e) => { setState("error"); setMessage(e.message); });
      return;
    }
    // Not signed in → go STRAIGHT to setting a password, with the invited email
    // prefilled (it must match the invite), then come back here to finish.
    const returnTo = `/behavior/accept?token=${encodeURIComponent(token)}`;
    inviteInfo(token)
      .then((info) => {
        if (!info.ok) { setState("error"); setMessage(info.error || "Invite not found or already used."); return; }
        window.location.href = loginHref(returnTo, { mode: "signup", email: info.email });
      })
      .catch(() => { window.location.href = loginHref(returnTo, { mode: "signup" }); });
  }, [token]);

  if (state === "loading") return <p className="text-slate-500">Setting up your account…</p>;

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
