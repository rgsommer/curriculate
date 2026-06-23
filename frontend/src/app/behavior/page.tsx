"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me, type StudentSummary } from "./_lib/api";
import { Markdown } from "./_lib/Markdown";
import SendNoticeModal from "./_components/SendNoticeModal";

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
  const housesOn = !!me.config?.housesEnabled;

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

      <Link
        href="/behavior/students"
        className="block rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700"
      >
        🔍 Find a student &amp; view history
      </Link>

      {canLog && <PendingDecisions />}

      {canLog && <ReminderToday />}

      {canLog && <ProbationWatch ladder={me.config?.consequenceLadder || []} />}

      {canLog && <StudentsToWatch fadeDays={me.config?.fadeWindowDays} />}

      {housesOn && <HousesCard canLog={canLog} isAdmin={isAdmin} portalCode={me.config?.housePortalCode || ""} />}

      <ExecutiveSummaryCard />

      {isAdmin && (
        <Card>
          <h2 className="font-semibold">Admin</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Link href="/behavior/intervention" className="rounded-lg border border-slate-300 px-3 py-1.5">
              School insights
            </Link>
            <Link href="/behavior/setup" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Division setup
            </Link>
            <Link href="/behavior/setup#roster" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Import roster
            </Link>
            <Link href="/behavior/setup#invite" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Invite teachers
            </Link>
            <Link href="/behavior/team" className="rounded-lg border border-slate-300 px-3 py-1.5">
              Team &amp; usage
            </Link>
            {housesOn && (
              <Link href="/behavior/competitions" className="rounded-lg border border-slate-300 px-3 py-1.5">
                House competitions
              </Link>
            )}
          </div>
          <ReferColleague />
        </Card>
      )}
    </div>
  );
}

function ReferColleague() {
  const [kind, setKind] = useState<"" | "colleague" | "admin">("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    const to = email.trim();
    if (!/^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(to)) { setMsg("✗ Enter a valid email address."); return; }
    setBusy(true);
    setMsg("");
    try {
      const path = kind === "admin" ? "/invite-admin" : "/refer";
      const r = await api<{ sent: string[]; failed: { email: string }[] }>(path, { body: { email: to, note: note.trim() } });
      if (r.sent?.length) {
        setMsg(`✓ Sent to ${r.sent.join(", ")} (copied to you).`);
        setEmail(""); setNote("");
        setKind("");
      } else {
        setMsg(`✗ Could not send${r.failed?.[0] ? ` (${r.failed[0].email})` : ""} — check email settings.`);
      }
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Spread the word — you&apos;ll be cc&apos;d on whatever you send.</p>
        <div className="flex shrink-0 gap-1.5">
          <button onClick={() => { setKind(kind === "colleague" ? "" : "colleague"); setMsg(""); }} className={`rounded-lg border px-2.5 py-1.5 text-xs ${kind === "colleague" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>Tell a teacher</button>
          <button onClick={() => { setKind(kind === "admin" ? "" : "admin"); setMsg(""); }} className={`rounded-lg border px-2.5 py-1.5 text-xs ${kind === "admin" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>Invite an admin</button>
        </div>
      </div>
      {kind && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email"
            placeholder={kind === "admin" ? "principal / VP email address" : "their email address"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional personal note…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <p className="text-xs text-slate-400">
            {kind === "admin"
              ? "Sends a leadership-focused pitch (burnout, consistency, documentation, trends, coaching) with a link — no account created. You're cc'd."
              : "Sends an info email about Behaviours with a link to try it — no account created. You're cc'd."}
          </p>
          <button onClick={send} disabled={busy || !email.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
            {busy ? "Sending…" : kind === "admin" ? "Send admin pitch" : "Send info email"}
          </button>
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</p>}
    </div>
  );
}

function HousesCard({ canLog, isAdmin, portalCode }: { canLog: boolean; isAdmin: boolean; portalCode: string }) {
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
      {/* Student portal code — prominent so it can be shared/posted easily. */}
      {portalCode ? (
        <a href="/houses" target="_blank" rel="noreferrer" className="mb-3 flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-300">Student leaderboard · curriculate.net/houses</div>
            <div className="text-xs text-slate-400">Students enter this code once per device</div>
          </div>
          <div className="font-mono text-3xl font-bold tracking-[0.25em]">{portalCode}</div>
        </a>
      ) : isAdmin ? (
        <Link href="/behavior/setup#roster" className="mb-3 block rounded-xl border border-dashed border-slate-300 px-4 py-3 text-center text-sm text-slate-500">
          Generate a student portal code in Setup → Houses to share the live leaderboard at <span className="font-medium">curriculate.net/houses</span>
        </Link>
      ) : null}

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
      <p className="mt-2 text-xs text-slate-400">
        {houses.reduce((n, h) => n + (h.members || 0), 0)} students assigned · positive = awards, negative = incident deductions ·{" "}
        <a href="/houses" target="_blank" rel="noreferrer" className="underline">student board ↗</a>
      </p>
    </Card>
  );
}

// Students who've already had a notice home AND are back at/near the trigger —
// heading for a further (VP-CC'd) notice. Shows the objective rule-based next
// consequence (from the admin ladder); per-student AI coaching is on their page.
function ProbationWatch({ ladder }: { ladder: { noticeNumber: number; action: string }[] }) {
  const [rows, setRows] = useState<StudentSummary[] | null>(null);
  const [trigger, setTrigger] = useState(3);

  useEffect(() => {
    api<{ students: StudentSummary[]; triggerCount: number }>("/students")
      .then((d) => {
        const t = d.triggerCount || 3;
        setTrigger(t);
        const watch = (d.students || [])
          .filter((s) => (s.noticesHomeCount || 0) >= 1 && (s.activeCount || 0) >= t - 1)
          .sort((a, b) => (b.noticesHomeCount || 0) - (a.noticesHomeCount || 0) || (b.activeCount || 0) - (a.activeCount || 0));
        setRows(watch);
      })
      .catch(() => setRows([]));
  }, []);

  if (!rows || rows.length === 0) return null;
  // The consequence the next notice would carry = ladder step for (notices + 1).
  const nextAction = (notices: number) => ladder.find((l) => l.noticeNumber === notices + 1)?.action || null;

  return (
    <Card>
      <h2 className="font-semibold text-red-800">Recommended actions</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Already had a notice home and back at or near the {trigger}-strike trigger. The next notice carries the rule-based consequence below; open a student for AI coaching suggestions too.
      </p>
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map((s) => {
          const action = nextAction(s.noticesHomeCount || 0);
          return (
            <li key={s._id}>
              <Link href={`/behavior/student/${s._id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-slate-600">
                <span className="min-w-0">
                  <span className="font-medium">{s.lastName}, {s.firstName}</span> <span className="text-slate-400">{s.classGroup}</span>
                  {action && <span className="mt-0.5 block text-xs text-red-700">Next: {action}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">{s.noticesHomeCount} notice{(s.noticesHomeCount || 0) === 1 ? "" : "s"}</span>
                  <span className={`font-semibold tabular-nums ${(s.activeCount || 0) >= trigger ? "text-red-600" : "text-orange-500"}`}>
                    {s.activeCount}/{trigger} →
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function StudentsToWatch({ fadeDays }: { fadeDays?: number }) {
  const [rows, setRows] = useState<StudentSummary[] | null>(null);
  const [trigger, setTrigger] = useState(3);

  useEffect(() => {
    api<{ students: StudentSummary[]; triggerCount: number }>("/students")
      .then((d) => {
        const t = d.triggerCount || 3;
        setTrigger(t);
        const watch = (d.students || [])
          .filter((s) => (s.activeCount || 0) >= t - 1)
          .sort((a, b) => (b.activeCount || 0) - (a.activeCount || 0));
        setRows(watch);
      })
      .catch(() => setRows([]));
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <h2 className="font-semibold">Students to encourage</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        At or one away from the {trigger}-strike trigger — a good moment for a positive word or a check-in before the next incident.
        {fadeDays ? ` Strikes fade after ${fadeDays} days, so the trend can still turn around.` : ""}
      </p>
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map((s) => (
          <li key={s._id}>
            <Link href={`/behavior/student/${s._id}`} className="flex items-center justify-between py-2 text-sm hover:text-slate-600">
              <span className="font-medium">
                {s.lastName}, {s.firstName} <span className="text-slate-400">{s.classGroup}</span>
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${(s.activeCount || 0) >= trigger ? "text-red-600" : "text-orange-500"}`}>
                {s.activeCount}/{trigger} →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ExecutiveSummaryCard() {
  const [months, setMonths] = useState(12);
  const [summary, setSummary] = useState("");
  const [scope, setScope] = useState<"me" | "all">("me");
  const [msg, setMsg] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [busy, setBusy] = useState<"" | "me" | "all" | "email">("");

  async function gen(s: "me" | "all") {
    setBusy(s);
    setMsg("");
    setSummary("");
    setScope(s);
    try {
      const r = await api<{ summary: string; aiUsed: boolean }>("/executive-summary", { body: { scope: s, months }, timeoutMs: 45000 });
      setSummary(r.summary);
      // Copy WITHOUT awaiting — a hung clipboard write must not block the
      // busy-state reset (that left the button stuck on "Generating…").
      navigator.clipboard?.writeText(r.summary).then(
        () => setMsg(`Copied to clipboard${r.aiUsed ? "" : " (template — no AI key set)"}.`),
        () => setMsg("Generated below (clipboard blocked — copy manually)."),
      );
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy("");
    }
  }

  async function emailIt() {
    setBusy("email");
    setMsg("");
    try {
      const r = await api<{ emailed: boolean; emailError?: string }>("/executive-summary", {
        body: { scope, months, email: true, summaryText: summary, to: emailTo.trim() },
        timeoutMs: 45000,
      });
      setMsg(r.emailed ? `✓ Emailed to you${emailTo.trim() ? ` + ${emailTo.trim()}` : ""} (with the red/green chart).` : `✗ Email failed: ${r.emailError || "check email settings"}`);
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy("");
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
        <button onClick={() => gen("me")} disabled={!!busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {busy === "me" ? "Generating…" : "My interactions"}
        </button>
        <button onClick={() => gen("all")} disabled={!!busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {busy === "all" ? "Generating…" : "Whole division"}
        </button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</p>}
      {summary && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={emailIt} disabled={!!busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
              {busy === "email" ? "Emailing…" : "Email it to me (with chart)"}
            </button>
            <input
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder="also email to (optional), e.g. admin's address"
              className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
            <Markdown text={summary} />
          </div>
        </>
      )}
    </Card>
  );
}

type Pending = { _id: string; studentId: string; studentName: string; classGroup?: string; reason?: string; ccVp?: boolean; count?: number; evidenceCount?: number; createdAt: string; renderedText?: string };

function PendingDecisions() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [meetingFor, setMeetingFor] = useState<Record<string, boolean>>({});
  const [evidenceFor, setEvidenceFor] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [confirmRow, setConfirmRow] = useState<Pending | null>(null);

  function load() {
    api<{ notices: Pending[] }>("/notices/pending").then((d) => setRows(d.notices || [])).catch(() => setRows([]));
  }
  useEffect(load, []);

  async function send(id: string) {
    setBusy(id);
    setMsg("");
    try {
      await api(`/notices/${id}/send`, { body: { requestMeeting: !!meetingFor[id], includeEvidence: !!evidenceFor[id] } });
      setRows((p) => (p || []).filter((n) => n._id !== id));
      setConfirmRow(null);
      setMsg("Sent to the parent ✓");
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy("");
    }
  }
  async function notNow(id: string) {
    setBusy(id);
    setMsg("");
    try {
      await api(`/notices/${id}/cancel`, { body: {} });
      setRows((p) => (p || []).filter((n) => n._id !== id));
      setMsg("Not sent — the strikes stay, so it'll come up again next time.");
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy("");
    }
  }

  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <h2 className="font-semibold text-amber-900">Notices awaiting your decision</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        These reached the trigger and are ready — <span className="font-medium">nothing is sent</span> until you choose. “Not this time” keeps the strikes so it comes up again on the next incident.
      </p>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</p>}
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map((n) => (
          <li key={n._id} className="py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{n.studentName}</span>
                <span className="ml-2 text-xs text-slate-400">
                  {[n.classGroup, n.count ? `${n.count} strike${n.count === 1 ? "" : "s"}` : "", n.ccVp ? "VP CC" : ""].filter(Boolean).join(" · ")}
                </span>
              </div>
              <button onClick={() => setOpenId(openId === n._id ? null : n._id)} className="shrink-0 text-xs text-slate-500 underline">
                {openId === n._id ? "hide" : "preview"}
              </button>
            </div>
            {openId === n._id && n.renderedText && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs text-slate-700">{n.renderedText}</pre>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={!!meetingFor[n._id]} onChange={(e) => setMeetingFor((m) => ({ ...m, [n._id]: e.target.checked }))} />
              Also request a meeting with the parents
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => setConfirmRow(n)} disabled={!!busy} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                {busy === n._id ? "…" : "Send to parent"}
              </button>
              <button onClick={() => notNow(n._id)} disabled={!!busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
                Not this time
              </button>
              <Link href={`/behavior/student/${n.studentId}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Review / edit</Link>
            </div>
          </li>
        ))}
      </ul>
      <SendNoticeModal
        open={!!confirmRow}
        studentName={confirmRow?.studentName}
        channelLabel="Edsby"
        noteText={confirmRow?.renderedText || ""}
        requestMeeting={!!(confirmRow && meetingFor[confirmRow._id])}
        onToggleMeeting={(v) => confirmRow && setMeetingFor((m) => ({ ...m, [confirmRow._id]: v }))}
        evidenceCount={confirmRow?.evidenceCount || 0}
        includeEvidence={!!(confirmRow && evidenceFor[confirmRow._id])}
        onToggleEvidence={(v) => confirmRow && setEvidenceFor((m) => ({ ...m, [confirmRow._id]: v }))}
        busy={!!busy}
        onConfirm={() => confirmRow && send(confirmRow._id)}
        onClose={() => setConfirmRow(null)}
      />
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
