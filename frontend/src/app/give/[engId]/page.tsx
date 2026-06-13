"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Summary = {
  id: string;
  title: string;
  type: string;
  currency: string;
  isRaffle: boolean;
  isDraw: boolean;
  isPledge: boolean;
  recipientName: string | null;
  groupName: string | null;
  groupEmoji: string | null;
  potCents: number;
  closed: boolean;
};

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

// PUBLIC, no-login contribute page reached by a QR at an event. Anonymous donor / chip-in.
export default function GivePage() {
  const params = useParams();
  const engId = String(params?.engId || "");
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    if (!engId) return;
    // Confirm a returning payment (?cs=) so anonymous contributions count.
    const qs = new URLSearchParams(window.location.search);
    const cs = qs.get("cs");
    if (cs) {
      fetch("/api/campfire/gift/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: cs }),
      }).finally(() => setThanks(true));
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetch(`/api/campfire/engagement/public-summary?eid=${encodeURIComponent(engId)}`)
      .then((r) => r.json())
      .then((d) => (d?.ok ? setS(d) : setErr(d?.error || "Not found.")))
      .catch(() => setErr("Couldn't load this."));
  }, [engId]);

  const give = async (amountCents: number) => {
    if (busy || !s) return;
    setBusy(true);
    try {
      const res = await fetch("/api/campfire/gift/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId: engId,
          amountCents,
          contributorName: name.trim() || null,
          email: email.trim() || undefined,
          userId: null,
          origin: window.location.origin,
          returnUrl: `${window.location.origin}/give/${engId}`,
        }),
      });
      const d = await res.json();
      if (d?.url) window.location.href = d.url as string;
      else {
        alert(d?.error || "Couldn't start checkout.");
        setBusy(false);
      }
    } catch {
      alert("Couldn't start checkout.");
      setBusy(false);
    }
  };

  const wrap = (inner: React.ReactNode) => (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-orange-50 px-5 py-10">
      <div className="mx-auto max-w-md">{inner}</div>
    </main>
  );

  if (err) return wrap(<p className="text-center text-slate-500">{err}</p>);
  if (thanks)
    return wrap(
      <div className="rounded-3xl bg-white border border-fuchsia-200 p-8 text-center shadow-xl">
        <div className="text-5xl mb-2">🎉</div>
        <h1 className="text-2xl font-black text-slate-900">Thank you!</h1>
        <p className="mt-2 text-slate-600">Your contribution is in. You can close this page.</p>
      </div>
    );
  if (!s) return wrap(<p className="text-center text-slate-400">Loading…</p>);

  const verb = s.isPledge ? "Donate" : s.isDraw ? "Add to the raffle" : "Chip in";
  const lead = s.isPledge
    ? `Support ${s.recipientName || "this challenge"} — give in good faith, any amount.`
    : s.isDraw
    ? "Chip in for a chance to win the pot — a winner is drawn at the end."
    : "Chip in toward the pot.";
  const amounts = [500, 1000, 2000, 5000];

  return wrap(
    <div className="rounded-3xl bg-white border border-fuchsia-200 p-7 shadow-xl">
      <div className="text-4xl mb-1">{s.groupEmoji || "🔥"}</div>
      <h1 className="text-2xl font-black text-slate-900 leading-tight">{s.title}</h1>
      {s.groupName && (
        <p className="mt-0.5 text-sm text-slate-500">{s.groupName}</p>
      )}
      <p className="mt-3 text-sm text-slate-600">{lead}</p>
      {s.potCents > 0 && (
        <p className="mt-1 text-sm font-bold text-fuchsia-700">
          {money(s.potCents, s.currency)} in the pot so far
        </p>
      )}

      {s.closed ? (
        <p className="mt-5 rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-500">
          This one&apos;s closed — thanks for your interest!
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {amounts.map((c) => (
              <button
                key={c}
                onClick={() => give(c)}
                disabled={busy}
                className="rounded-xl border-2 border-fuchsia-300 bg-white px-4 py-3 text-lg font-black text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-50"
              >
                {money(c, s.currency)}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const v = window.prompt(`${verb} how much? (${s.currency.toUpperCase()})`);
              const n = v ? Math.round(parseFloat(v) * 100) : 0;
              if (n >= 100) give(n);
              else if (v) alert("Minimum is 1.");
            }}
            disabled={busy}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Other amount…
          </button>

          <div className="mt-4 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-fuchsia-500"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email for a receipt (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-fuchsia-500"
            />
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            {busy
              ? "Opening secure checkout…"
              : "Secure card payment via Stripe. A small processing fee is added so the pot stays whole. Operated by 10323594 Canada Corp."}
          </p>
        </>
      )}
    </div>
  );
}
