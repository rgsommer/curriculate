"use client";

import { useEffect, useState } from "react";

// Public self-service unsubscribe. The List-Unsubscribe header + email footer link here
// with ?e=<email> prefilled. A confirm click (not auto-on-load) avoids false unsubscribes
// from mail-client link prefetching.
export default function CampfireUnsubscribePage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const e = new URLSearchParams(window.location.search).get("e");
      if (e) setEmail(e);
    } catch {
      /* ignore */
    }
  }, []);

  const submit = async () => {
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/campfire/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setState("done");
      else {
        setState("error");
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setState("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center text-slate-700">
      <div className="text-5xl mb-4">🔥</div>
      {state === "done" ? (
        <>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re unsubscribed</h1>
          <p className="text-slate-600">
            <strong>{email}</strong> won&apos;t receive Campfire emails anymore. If this was a
            mistake, just ask whoever invited you to add you again.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Unsubscribe from Campfire</h1>
          <p className="text-slate-600 mb-6">
            Stop receiving Campfire emails at this address. You can always be re-invited later.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3 outline-none focus:border-orange-500"
          />
          <button
            onClick={submit}
            disabled={state === "sending" || !email}
            className="w-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-6 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {state === "sending" ? "Unsubscribing…" : "Unsubscribe"}
          </button>
          {state === "error" && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      )}
    </main>
  );
}
