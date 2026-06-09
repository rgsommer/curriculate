"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "./_lib/api";

export default function BehaviorDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<Me>("/me")
      .then(setMe)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-500">Loading…</p>;

  if (!getToken()) {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Sign in to Behaviours</h1>
        <p className="mt-2 text-slate-600">
          Behaviours uses your Curriculate account. Please sign in to continue.
        </p>
        <Link
          href={loginHref("/behavior")}
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white"
        >
          Sign in
        </Link>
      </Card>
    );
  }

  if (error) return <Card><p className="text-red-600">{error}</p></Card>;

  // Signed in but no school yet → originator setup CTA.
  if (!me?.membership) {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Set up your school</h1>
        <p className="mt-2 text-slate-600">
          You don&apos;t belong to a Behaviours school yet. If you&apos;re setting one up for your
          division, create it here. Otherwise, ask your admin to invite you.
        </p>
        <Link
          href="/behavior/setup"
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-white"
        >
          Create a school
        </Link>
      </Card>
    );
  }

  const { membership, school } = me;
  const isAdmin = membership.role === "originator" || membership.role === "admin";
  const canLog = membership.role !== "principal";

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-500">{school?.name}</p>
        <h1 className="text-xl font-semibold">
          Hi{membership.name ? `, ${membership.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-slate-500 capitalize">Role: {membership.role}</p>
      </Card>

      {canLog && (
        <Link
          href="/behavior/log"
          className="block rounded-xl bg-slate-900 px-5 py-4 text-center text-lg font-semibold text-white shadow-sm"
        >
          + Log an incident
        </Link>
      )}

      {canLog && <ReminderToday />}

      <HousesCard canLog={canLog} />

      <ExecutiveSummaryCard />

      {isAdmin && (
        <Card>
          <h2 className="font-semibold">Admin</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Link href="/behavior/setup" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Division setup
            </Link>
            <Link href="/behavior/setup#roster" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Import roster
            </Link>
            <Link href="/behavior/setup#invite" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Invite teachers
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function HousesCard({ canLog }: { canLog: boolean }) {
  const [houses, setHouses] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [houseId, setHouseId] = useState("");
  const [points, setPoints] = useState<number | string>(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    api<{ houses: any[] }>("/houses").then((d) => setHouses(d.houses || [])).catch(() => setHouses([]));
  }
  useEffect(load, []);

  async function award() {
    if (!houseId || !Number(points)) return;
    setBusy(true);
    setMsg("");
    try {
      await api("/house-points", { body: { houseId, points: Number(points), reason } });
      setReason("");
      setMsg("Points recorded.");
      setOpen(false);
      load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Hide the card entirely until houses are defined in Setup.
  if (houses === null || houses.length === 0) return null;

  const max = Math.max(1, ...houses.map((h) => Math.abs(h.points || 0)));

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">House points</h2>
        {canLog && (
          <button onClick={() => { setOpen((o) => !o); setHouseId(houses[0]?._id || ""); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            {open ? "Cancel" : "Give points"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <select value={houseId} onChange={(e) => setHouseId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {houses.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <button onClick={award} disabled={busy || !houseId || !Number(points)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "Saving…" : "Award to house"}
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}

      <ul className="mt-3 space-y-2">
        {houses.map((h) => (
          <li key={h._id} className="flex items-center gap-3">
            <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: h.color || "#0f172a" }} />
            <span className="w-28 shrink-0 text-sm font-medium">{h.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (Math.abs(h.points || 0) / max) * 100)}%`, background: h.color || "#0f172a" }} />
            </div>
            <span className="w-12 shrink-0 text-right text-sm tabular-nums font-semibold">{h.points || 0}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">{houses.reduce((n, h) => n + (h.members || 0), 0)} students assigned · positive = awards, negative = incident deductions.</p>
    </Card>
  );
}

function ExecutiveSummaryCard() {
  const [months, setMonths] = useState(12);
  const [summary, setSummary] = useState("");
  const [scope, setScope] = useState<"me" | "all">("me");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function gen(s: "me" | "all") {
    setBusy(true);
    setMsg("");
    setSummary("");
    setScope(s);
    try {
      const r = await api<{ summary: string; aiUsed: boolean }>("/executive-summary", { body: { scope: s, months } });
      setSummary(r.summary);
      try {
        await navigator.clipboard.writeText(r.summary);
        setMsg(`Copied to clipboard${r.aiUsed ? "" : " (template — no AI key set)"}.`);
      } catch {
        setMsg("Generated below (clipboard blocked — copy manually).");
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function emailIt() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ emailed: boolean; emailError?: string }>("/executive-summary", {
        body: { scope, months, email: true, summaryText: summary },
      });
      setMsg(r.emailed ? "Emailed to you (with a monthly-trend chart)." : `Email failed: ${r.emailError || "check SMTP"}`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Executive summary (AI)</h2>
      <p className="mt-1 text-sm text-slate-500">
        An overview of behaviour trends and your interactions over time — good for sharing with an administrator or year-end reflection. Copied to your clipboard.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
        </select>
        <button onClick={() => gen("me")} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {busy ? "Generating…" : "My interactions"}
        </button>
        <button onClick={() => gen("all")} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {busy ? "Generating…" : "Whole division"}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}
      {summary && (
        <>
          <button onClick={emailIt} disabled={busy} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
            Email it to me (with chart)
          </button>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{summary}</pre>
        </>
      )}
    </Card>
  );
}

function ReminderToday() {
  const [items, setItems] = useState<any[] | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api<{ followups: any[] }>("/followups?due=today&mine=1")
      .then((d) => setItems(d.followups || []))
      .catch(() => setItems([]));
  }, []);

  async function resolve(id: string, status: "done" | "not_done" | "waived") {
    try {
      const r = await api<{ escalation: any }>(`/followups/${id}/status`, { body: { status } });
      setItems((prev) => (prev || []).filter((f) => f._id !== id));
      if (status === "not_done" && r.escalation) {
        setMsg(`Missed consequence escalated — re-issued${r.escalation.ccVp ? " and the VP was notified" : " to parents"}.`);
      } else {
        setMsg("");
      }
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Reminder for today</h2>
      {msg && <p className="mt-1 text-sm text-amber-700">{msg}</p>}
      {items === null && <p className="mt-1 text-sm text-slate-400">Loading…</p>}
      {items && items.length === 0 && <p className="mt-1 text-sm text-slate-500">Nothing due today 🎉</p>}
      <ul className="mt-2 space-y-2">
        {items?.map((f) => {
          const s = f.student;
          const name = s ? `${s.preferredName || s.firstName} ${s.lastName}` : "student";
          return (
            <li key={f._id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">
                {name} <span className="text-slate-400">{s?.classGroup}</span>
                {f.multiplier > 1 && <span className="ml-2 text-xs text-red-600">×{f.multiplier}</span>}
              </p>
              <p className="text-sm text-slate-600">
                {f.behaviorName}: {f.consequenceText}
              </p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => resolve(f._id, "done")} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white">
                  Done
                </button>
                <button onClick={() => resolve(f._id, "not_done")} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white">
                  Not done
                </button>
                <button onClick={() => resolve(f._id, "waived")} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">
                  Waive
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
