"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, issueWhiteSlip, completeConsequence, homeroomFollowup, type Me, type StudentSummary } from "./_lib/api";
import { Markdown } from "./_lib/Markdown";
import SendNoticeModal from "./_components/SendNoticeModal";
import { Card, Button } from "./_components/ui";

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
        <h1 className="text-xl font-semibold">Sign in to Compass</h1>
        <p className="mt-2 text-slate-600">
          Compass uses your Curriculate account. Please sign in to continue.
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
          You don&apos;t belong to a Compass school yet. If you&apos;re setting one up for your
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

      {(!membership.name?.trim() || !membership.courtesyName?.trim()) && (
        <SetMyName
          name={membership.name || ""}
          courtesyName={membership.courtesyName || ""}
          onSaved={(n, c) => setMe((m) => (m && m.membership ? { ...m, membership: { ...m.membership, name: n, courtesyName: c } } : m))}
        />
      )}

      {canLog && (
        <Link
          href="/behavior/log"
          className="block rounded-xl bg-slate-900 px-5 py-4 text-center text-lg font-semibold text-white shadow-sm"
        >
          Quick Action — Log an incident
        </Link>
      )}

      {canLog && <PositiveNudge />}

      <Link
        href="/behavior/students"
        className="block rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700"
      >
        🔍 Find a student &amp; view history
      </Link>

      {canLog && <PendingDecisions
        autoSend={!!me.config?.edsby?.enabled || !!me.config?.channels?.emailToParents}
        channelLabel={me.config?.edsby?.enabled ? "Edsby" : me.config?.channels?.emailToParents ? "email" : ""}
      />}

      {canLog && <ReminderToday firstName={(membership.name || "").trim().split(" ")[0]} />}

      {canLog && <ProbationWatch ladder={me.config?.consequenceLadder || []} myHomeroom={membership.homeroom || ""} />}

      {canLog && <StudentsToWatch fadeDays={me.config?.fadeWindowDays} myHomeroom={membership.homeroom || ""} />}

      {canLog && <DailyMovers housesOn={housesOn} />}

      {housesOn && <HousesCard canLog={canLog} isAdmin={isAdmin} portalCode={me.config?.housePortalCode || ""} events={me.config?.houseEvents || []} />}

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
            {housesOn && (
              <Link href="/behavior/food-drive" className="rounded-lg border border-slate-300 px-3 py-1.5">
                Tally import
              </Link>
            )}
          </div>
          <ReferColleague canInviteAdmin />
        </Card>
      )}

      {/* Non-admin teachers can still tell a colleague about Compass. */}
      {!isAdmin && canLog && (
        <Card>
          <h2 className="font-semibold">Tell a colleague</h2>
          <p className="mt-0.5 text-xs text-slate-500">Know a teacher who&apos;d find this useful? Send them an intro (you&apos;re cc&apos;d).</p>
          <div className="mt-2"><ReferColleague standalone /></div>
        </Card>
      )}
    </div>
  );
}

// Periodic, one-tap "recognize a student for good behaviour" nudge. Shows a
// green box on the dashboard (throttled via localStorage so it doesn't nag):
// type a name → tap a positive → it logs immediately. Snoozes after use.
function PositiveNudge() {
  const SNOOZE_KEY = "compass_posnudge_snooze";
  const [show, setShow] = useState(false);
  const [students, setStudents] = useState<StudentSummary[] | null>(null);
  const [positives, setPositives] = useState<{ _id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<StudentSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState("");

  useEffect(() => {
    try { if (Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0)) return; } catch { /* ignore */ }
    setShow(true);
  }, []);

  useEffect(() => {
    if (!show) return;
    api<{ students: StudentSummary[] }>("/students").then((d) => setStudents(d.students || [])).catch(() => setStudents([]));
    api<{ behaviors: any[] }>("/behaviors")
      .then((d) => setPositives((d.behaviors || []).filter((b) => b.kind === "positive" && b.active !== false).map((b) => ({ _id: b._id, name: b.name }))))
      .catch(() => { /* ignore */ });
  }, [show]);

  function snooze(hours: number) {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 3600 * 1000)); } catch { /* ignore */ }
    setShow(false);
  }

  const matches = q.trim().length >= 1 && !picked
    ? (students || []).filter((s) => `${s.preferredName || s.firstName} ${s.lastName || ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];

  async function logPositive(behaviorId: string) {
    if (!picked) return;
    setBusyId(behaviorId);
    try {
      await api("/incidents", { body: { studentId: picked._id, behaviorIds: [behaviorId] } });
      setDoneMsg(`✓ Nice! Recognized ${picked.preferredName || picked.firstName}.`);
      try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 20 * 3600 * 1000)); } catch { /* ignore */ }
      setTimeout(() => setShow(false), 1600);
    } catch (e: any) {
      setDoneMsg(`✗ ${e.message}`);
      setBusyId(null);
    }
  }

  if (!show) return null;
  return (
    <div className="rounded-xl border border-green-300 bg-green-50 p-4">
      {doneMsg ? (
        <p className="text-sm font-medium text-green-800">{doneMsg}</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-green-900">🌟 Catch someone being good?</p>
              <p className="text-xs text-green-700">Recognizing effort and character takes a few seconds — and it goes a long way.</p>
            </div>
            <button onClick={() => snooze(6)} className="shrink-0 text-green-700/70 hover:text-green-900" aria-label="Dismiss">✕</button>
          </div>

          {!picked ? (
            <div className="relative mt-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Start typing a student's name…"
                className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm"
              />
              {matches.length > 0 && (
                <ul className="mt-1 divide-y divide-green-100 overflow-hidden rounded-lg border border-green-200 bg-white">
                  {matches.map((s) => (
                    <li key={s._id}>
                      <button onClick={() => { setPicked(s); setQ(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-green-50">
                        {s.preferredName || s.firstName} {s.lastName}
                        {s.grade ? <span className="ml-1 text-xs text-slate-500">Gr {s.grade}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-green-900">{picked.preferredName || picked.firstName} {picked.lastName}</p>
                <button onClick={() => setPicked(null)} className="text-xs text-green-700 underline">change</button>
              </div>
              <p className="mt-1 text-xs text-green-700">Tap what they did well — it logs right away:</p>
              <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {positives.map((b) => (
                  <button key={b._id} onClick={() => logPositive(b._id)} disabled={!!busyId}
                    className="rounded-full border border-green-300 bg-white px-2.5 py-1 text-xs text-green-800 hover:bg-green-100 disabled:opacity-40">
                    {busyId === b._id ? "…" : b.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-2">
            <button onClick={() => snooze(20)} className="text-xs text-green-700/80 underline">Not now</button>
          </div>
        </>
      )}
    </div>
  );
}

// First sign-in prompt: capture the teacher's full name (friendly/internal) AND
// their official parent-facing name. Appears until both are set.
function SetMyName({ name: name0, courtesyName: courtesy0, onSaved }: { name?: string; courtesyName?: string; onSaved: (name: string, courtesyName: string) => void }) {
  const [name, setName] = useState(name0 || "");
  const [courtesyName, setCourtesyName] = useState(courtesy0 || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!name.trim()) { setErr("Please enter your first and last name."); return; }
    setBusy(true); setErr("");
    try {
      await api("/my-name", { method: "PUT", body: { name: name.trim(), courtesyName: courtesyName.trim() } });
      onSaved(name.trim(), courtesyName.trim());
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Card>
      <h2 className="font-semibold">Welcome — let&apos;s set your name</h2>
      <p className="mt-0.5 text-sm text-slate-500">Two quick things, so notices and logs read correctly. You can change these later, or an admin can.</p>
      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Your name</span>
          <span className="block text-xs text-slate-500">How you&apos;re shown to staff in Compass (e.g. &ldquo;logged by …&rdquo;).</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Richard Sommer" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" autoFocus />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Your official (parent-facing) name</span>
          <span className="block text-xs text-slate-500">Used in messages home and on notices (e.g. &ldquo;Mr. Sommer&rdquo;, &ldquo;Miss Lau&rdquo;).</span>
          <input value={courtesyName} onChange={(e) => setCourtesyName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="e.g. Mr. Sommer" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <Button onClick={save} disabled={busy || !name.trim()} className="mt-3">
        {busy ? "Saving…" : "Save"}
      </Button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function ReferColleague({ canInviteAdmin = false, standalone = false }: { canInviteAdmin?: boolean; standalone?: boolean }) {
  const [kind, setKind] = useState<"" | "colleague" | "admin">("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send() {
    // Accept several recipients at once, with or without display names:
    //   "a@b.com, c@d.com"  or  "Jane Doe <jane@b.com>, vp@c.ca"
    const chunks = email.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    const emails: string[] = [];
    const invalid: string[] = [];
    for (const c of chunks) {
      const m = c.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
      if (m) emails.push(m[0]); else invalid.push(c);
    }
    if (!emails.length) { setMsg("✗ Enter a valid email address."); return; }
    if (invalid.length) { setMsg(`✗ Couldn't read an address in: ${invalid.join(", ")}`); return; }
    if (emails.length > 10) { setMsg("✗ Up to 10 recipients at a time."); return; }
    setBusy(true);
    setMsg("");
    try {
      const path = kind === "admin" ? "/invite-admin" : "/refer";
      const r = await api<{ sent: string[]; failed: { email: string }[] }>(path, { body: { emails, note: note.trim() } });
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
    <div className={standalone ? "" : "mt-3 border-t border-slate-100 pt-3"}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Spread the word — you&apos;ll be cc&apos;d on whatever you send.</p>
        <div className="flex shrink-0 gap-1.5">
          <button onClick={() => { setKind(kind === "colleague" ? "" : "colleague"); setMsg(""); }} className={`rounded-lg border px-2.5 py-1.5 text-xs ${kind === "colleague" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>Tell a teacher</button>
          {canInviteAdmin && (
            <button onClick={() => { setKind(kind === "admin" ? "" : "admin"); setMsg(""); }} className={`rounded-lg border px-2.5 py-1.5 text-xs ${kind === "admin" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>Invite an admin</button>
          )}
        </div>
      </div>
      {kind && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="text" inputMode="email"
            placeholder={kind === "admin" ? "principal / VP email(s) — comma-separated" : "their email(s) — comma-separated"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional personal note…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <p className="text-xs text-slate-500">
            {kind === "admin"
              ? "Sends a leadership-focused pitch (burnout, consistency, documentation, trends, coaching) with a link — no account created. You're cc'd."
              : "Sends an info email about Compass with a link to try it — no account created. You're cc'd."}
          </p>
          <Button onClick={send} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : kind === "admin" ? "Send admin pitch" : "Send info email"}
          </Button>
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</p>}
    </div>
  );
}

function DailyMovers({ housesOn }: { housesOn: boolean }) {
  const [movers, setMovers] = useState<any[] | null>(null);
  useEffect(() => { api<{ movers: any[] }>("/daily-movers").then((d) => setMovers(d.movers || [])).catch(() => setMovers([])); }, []);
  if (!movers || movers.length === 0) return null;
  return (
    <Card>
      <h2 className="font-semibold">Daily Movers</h2>
      <p className="text-xs text-slate-500">Most behaviour movement today — points and logs since this morning.</p>
      <ul className="mt-2 divide-y divide-slate-100">
        {movers.map((m, i) => {
          const featured = i === 0 && housesOn && !!m.house;
          return (
            <li key={m.studentId}
              className={`flex items-center gap-2 py-1.5 text-sm ${featured ? "rounded-lg border-l-4 pl-2" : ""}`}
              style={featured ? { borderColor: m.color, background: `${m.color}14` } : undefined}>
              {housesOn && m.house ? <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.color }} title={m.house} /> : null}
              <Link href={`/behavior/student/${m.studentId}`} className="truncate font-medium hover:underline">{m.name}</Link>
              {featured ? <span className="shrink-0 rounded-full px-1.5 text-[10px] font-semibold" style={{ background: `${m.color}26`, color: m.color }}>⭐ {m.house}</span> : m.classGroup ? <span className="shrink-0 text-xs text-slate-500">{m.classGroup}</span> : null}
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {m.net ? <span className={`tabular-nums font-semibold ${m.net > 0 ? "text-green-600" : "text-red-600"}`}>{m.net > 0 ? `+${m.net}` : m.net} pts</span> : null}
                {m.incidents ? <span className="text-xs text-slate-500">{m.incidents} log{m.incidents === 1 ? "" : "s"}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function HousesCard({ canLog, isAdmin, portalCode, events = [] }: { canLog: boolean; isAdmin: boolean; portalCode: string; events?: { name: string; points: number }[] }) {
  const [houses, setHouses] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [houseId, setHouseId] = useState("");
  const [points, setPoints] = useState<number | string>(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Tap a house → composite breakdown (staff view: full, incl. conduct), same as /houses.
  const [openHouse, setOpenHouse] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, any>>({});
  const [detailBusy, setDetailBusy] = useState(false);

  function load() {
    api<{ houses: any[] }>("/houses").then((d) => setHouses(d.houses || [])).catch(() => setHouses([]));
  }
  useEffect(load, []);

  async function toggleHouse(id: string) {
    if (openHouse === id) { setOpenHouse(null); return; }
    setOpenHouse(id);
    if (!detailById[id]) {
      setDetailBusy(true);
      try { const d = await api<any>(`/houses/detail?houseId=${encodeURIComponent(id)}`); setDetailById((p) => ({ ...p, [id]: d })); }
      catch { /* leave undefined → shows nothing */ }
      finally { setDetailBusy(false); }
    }
  }

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

  // Bar length reflects STANDING, not magnitude: the leader (highest total) gets
  // the longest bar and the lowest the shortest — normalized across the real
  // [low, high] range (0 always included). This stops negative totals from
  // looking like they're "ahead". Negative bars are also faded as a cue.
  const ptVals = houses.map((h) => h.points || 0);
  const hiPts = Math.max(0, ...ptVals);
  const loPts = Math.min(0, ...ptVals);
  const ptSpan = Math.max(1, hiPts - loPts);
  const barPct = (p: number) => Math.max(3, Math.round((((p || 0) - loPts) / ptSpan) * 100));

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
          <Button onClick={() => { setOpen((o) => !o); setHouseId(houses[0]?._id || ""); }} variant="secondary" size="sm">
            {open ? "Cancel" : "Give points"}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {events.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {events.map((ev, i) => (
                <button key={i} type="button" onClick={() => { setPoints(ev.points); setReason(ev.name); }}
                  className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-100">
                  {ev.name} <span className="font-semibold">{ev.points > 0 ? `+${ev.points}` : ev.points}</span>
                </button>
              ))}
            </div>
          )}
          <select value={houseId} onChange={(e) => setHouseId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {houses.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <Button onClick={award} disabled={busy || !houseId || !Number(points)}>
            {busy ? "Saving…" : "Award to house"}
          </Button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}

      <ul className="mt-3 space-y-2">
        {houses.map((h) => {
          const d = detailById[h._id];
          const isOpen = openHouse === h._id;
          return (
          <li key={h._id}>
            <button type="button" onClick={() => toggleHouse(h._id)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-50">
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: h.color || "#0f172a" }} />
              <span className="w-28 shrink-0 text-sm font-medium">{h.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${barPct(h.points)}%`, background: h.color || "#0f172a", opacity: (h.points || 0) < 0 ? 0.45 : 1 }} />
              </div>
              <span className="w-12 shrink-0 text-right text-sm tabular-nums font-semibold">{h.points || 0}</span>
              <span className="w-3 shrink-0 text-xs text-slate-500">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="mt-1 ml-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                {!d ? (
                  <p className="text-slate-500">{detailBusy ? "Loading…" : "No details."}</p>
                ) : (
                  <>
                    {d.individual?.negative < 0 && (
                      <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700">👁 Staff view: students don&apos;t see the conduct (negative) details below.</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-white p-2">
                        <div className="text-xs text-slate-500">Individual Compass points</div>
                        <div className="font-bold tabular-nums">{d.individual?.total > 0 ? `+${d.individual.total}` : d.individual?.total ?? 0}</div>
                        <div className="text-[11px] text-slate-500">+{d.individual?.positive ?? 0} good{d.individual?.negative ? ` · ${d.individual.negative} conduct` : ""}</div>
                      </div>
                      <div className="rounded-lg bg-white p-2">
                        <div className="text-xs text-slate-500">Team &amp; house events</div>
                        <div className="font-bold tabular-nums">{d.team?.total > 0 ? `+${d.team.total}` : d.team?.total ?? 0}</div>
                      </div>
                    </div>
                    {(d.individual?.items || []).length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-slate-600">Individual Compass points</div>
                        <ul className="mt-1 divide-y divide-slate-100">
                          {d.individual.items.map((it: any, i: number) => (
                            <li key={i} className="flex items-center justify-between gap-2 py-1">
                              <span className="min-w-0 truncate text-slate-600">{it.reason} <span className="text-slate-500">×{it.count}</span></span>
                              <span className={`shrink-0 tabular-nums font-medium ${it.points < 0 ? "text-red-600" : "text-green-600"}`}>{it.points > 0 ? `+${it.points}` : it.points}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(d.team?.items || []).length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-slate-600">Team &amp; house events</div>
                        <ul className="mt-1 divide-y divide-slate-100">
                          {d.team.items.map((it: any, i: number) => (
                            <li key={i} className="flex items-center justify-between gap-2 py-1">
                              <span className="min-w-0 truncate text-slate-600">{it.reason} <span className="text-slate-500">×{it.count}</span></span>
                              <span className={`shrink-0 tabular-nums font-medium ${it.points < 0 ? "text-red-600" : "text-green-600"}`}>{it.points > 0 ? `+${it.points}` : it.points}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(d.individual?.items || []).length === 0 && (d.team?.items || []).length === 0 && (
                      <p className="text-slate-500">No points yet.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        {houses.reduce((n, h) => n + (h.members || 0), 0)} students assigned · positive = awards, negative = incident deductions ·{" "}
        <a href="/houses" target="_blank" rel="noreferrer" className="underline">student board ↗</a>
      </p>
    </Card>
  );
}

// Students who've already had a notice home AND are back at/near the trigger —
// heading for a further (VP-CC'd) notice. Shows the objective rule-based next
// consequence (from the admin ladder); per-student AI coaching is on their page.
// A one-click "homeroom follow-up" nudge: logs a supportive relational check-in
// (homeroom teacher to steer the student) as a documented interaction. Green so
// it reads as encouragement, not punishment. Sits beside a watch-list row.
function HrButton({ studentId, done }: { studentId: string; done?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done">(done ? "done" : "idle");
  async function click() {
    if (state === "busy") return;
    setState("busy");
    try { await homeroomFollowup(studentId); setState("done"); }
    catch { setState(done ? "done" : "idle"); }
  }
  const isDone = state === "done";
  return (
    <button type="button" disabled={state === "busy" || isDone}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); click(); }}
      aria-label={isDone ? "Homeroom follow-up already logged this week" : "Log a homeroom follow-up (supportive check-in)"}
      title={isDone
        ? "Homeroom follow-up already logged this week. It resets each week."
        : "Homeroom follow-up: flag that the homeroom teacher will talk with this student to steer them in the right direction. Logged as a supportive check-in — not a strike, nothing sent home."}
      className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold ${isDone
        ? "border border-green-300 bg-green-50 text-green-700"
        : "bg-slate-700 text-white hover:bg-slate-800"}`}>
      {isDone ? "HR ✓" : state === "busy" ? "…" : "HR"}
    </button>
  );
}

function ProbationWatch({ ladder, myHomeroom }: { ladder: { noticeNumber: number; action: string }[]; myHomeroom?: string }) {
  const [rows, setRows] = useState<StudentSummary[] | null>(null);
  const [trigger, setTrigger] = useState(3);
  const [othersOpen, setOthersOpen] = useState(false);

  useEffect(() => {
    api<{ students: StudentSummary[]; triggerCount: number }>("/students")
      .then((d) => {
        const t = d.triggerCount || 3;
        setTrigger(t);
        // Include students at/near the trigger after a notice, PLUS anyone with a
        // recommended white slip awaiting confirmation (so it can be acted on here
        // even if they're not otherwise on probation-watch).
        const watch = (d.students || [])
          .filter((s) => s.pendingWhiteSlipId || (s.pendingConsequences && s.pendingConsequences.length > 0) || ((s.noticesHomeCount || 0) >= 1 && (s.activeCount || 0) >= t - 1))
          // Grouped by homeroom (classGroup), then most-urgent first within a homeroom.
          .sort((a, b) => (a.classGroup || "").localeCompare(b.classGroup || "") || (b.pendingWhiteSlipId ? 1 : 0) - (a.pendingWhiteSlipId ? 1 : 0) || (b.noticesHomeCount || 0) - (a.noticesHomeCount || 0) || (b.activeCount || 0) - (a.activeCount || 0));
        setRows(watch);
      })
      .catch(() => setRows([]));
  }, []);

  // Confirm / resolve a recommended white slip. Once the action is taken the
  // student drops off this list; on failure the row is restored. Any teacher can
  // do it — the first click registers it server-side.
  async function resolveSlip(s: StudentSummary, other?: string) {
    const id = s.pendingWhiteSlipId;
    if (!id) return;
    setRows((list) => (list || []).filter((x) => x._id !== s._id));
    try { await issueWhiteSlip(id, other); }
    catch { setRows((list) => [...(list || []), s]); }
  }

  // Mark a given consequence done. Optimistically drop it from the student's
  // to-do list; if that leaves the student with nothing else to action, they fall
  // off the watch list on the next load.
  async function markDone(s: StudentSummary, consId: string) {
    setRows((list) => (list || []).map((x) => x._id === s._id
      ? { ...x, pendingConsequences: (x.pendingConsequences || []).filter((c) => c.id !== consId) }
      : x));
    try { await completeConsequence(consId, true); }
    catch { setRows((list) => (list || []).map((x) => x._id === s._id ? s : x)); }
  }

  if (!rows || rows.length === 0) return null;
  // The consequence the next notice would carry = ladder step for (notices + 1).
  const nextAction = (notices: number) => ladder.find((l) => l.noticeNumber === notices + 1)?.action || null;

  // "Your homeroom first": a homeroom teacher sees their own students up top;
  // the rest stay here (not hidden, just collapsed) so nothing slips through the
  // cracks while adoption is still growing.
  const mine = myHomeroom ? rows.filter((s) => (s.classGroup || "") === myHomeroom) : [];
  const others = myHomeroom ? rows.filter((s) => (s.classGroup || "") !== myHomeroom) : rows;
  const showOthers = !myHomeroom || mine.length === 0 || othersOpen;

  const renderRow = (s: StudentSummary, showHeader: boolean) => {
    // Prefer the handbook-ladder recommendation (white-slip count / notices
    // this term) when the backend provides it; else the admin ladder step.
    const action = s.recommendedConsequence || nextAction(s.noticesHomeCount || 0);
    return (
      <Fragment key={s._id}>
        {showHeader && (
          <li className="!border-t-0 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.classGroup || "No homeroom"}</li>
        )}
        <li className="py-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <Link href={`/behavior/student/${s._id}`} className="min-w-0 hover:text-slate-600">
                <span className="font-medium">{s.lastName}, {s.firstName}</span> <span className="text-slate-500">{s.classGroup}</span>
                {s.pendingWhiteSlipId
                  ? <span className="mt-0.5 block text-xs text-red-700">Next: White slip recommended</span>
                  : action && <span className="mt-0.5 block text-xs text-red-700">Next: {action}</span>}
              </Link>
              <HrButton studentId={s._id} done={s.hrFollowedUpThisWeek} />
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-slate-500">{s.noticesHomeCount} notice{(s.noticesHomeCount || 0) === 1 ? "" : "s"}</span>
              <span className={`font-semibold tabular-nums ${(s.activeCount || 0) >= trigger ? "text-red-600" : "text-orange-500"}`}>
                {s.activeCount}/{trigger} →
              </span>
            </span>
          </div>
          {s.pendingWhiteSlipId && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Confirm the consequence given:</span>
              <Button type="button" onClick={() => resolveSlip(s)}
                variant="warning" size="sm">Issued</Button>
              <Button type="button"
                onClick={() => { const t = window.prompt("What consequence was given instead of the white slip? (e.g. Work detention, Call home)"); if (t && t.trim()) resolveSlip(s, t.trim()); }}
                variant="secondary" size="sm">Other…</Button>
            </div>
          )}
          {(s.pendingConsequences || []).map((c) => (
            <div key={c.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Consequence: <span className="font-medium text-slate-700">{c.type}</span></span>
              <button type="button" onClick={() => markDone(s, c.id)}
                title="The student has carried this out (e.g. handed in the lines)"
                className="rounded-md border border-green-300 px-3 py-1.5 font-semibold text-green-700 hover:bg-green-50">✓ Mark completed</button>
            </div>
          ))}
        </li>
      </Fragment>
    );
  };

  return (
    <Card>
      <h2 className="font-semibold text-red-800">Needs a decision</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Already had a notice home and back at or near the {trigger}-strike trigger. The next notice carries the rule-based consequence below; open a student for AI coaching suggestions too.
      </p>
      <ul className="mt-2 divide-y divide-slate-100">
        {myHomeroom && mine.length > 0 && (
          <>
            <li className="!border-t-0 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Your homeroom · {myHomeroom}</li>
            {mine.map((s) => renderRow(s, false))}
          </>
        )}
        {others.length > 0 && (
          showOthers ? (
            <>
              {myHomeroom && mine.length > 0 && (
                <li className="!border-t-0 pt-3 pb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Other homerooms</li>
              )}
              {others.map((s, i) => renderRow(s, i === 0 || (others[i - 1].classGroup || "") !== (s.classGroup || "")))}
            </>
          ) : (
            <li className="!border-t-0 pt-2">
              <button type="button" onClick={() => setOthersOpen(true)}
                className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800">
                Show other homerooms ({others.length})
              </button>
            </li>
          )
        )}
      </ul>
    </Card>
  );
}

type Occ = { date: string; name: string; detail?: string; teacher?: string };
function StudentsToWatch({ fadeDays, myHomeroom }: { fadeDays?: number; myHomeroom?: string }) {
  const [rows, setRows] = useState<StudentSummary[] | null>(null);
  const [trigger, setTrigger] = useState(3);
  const [openId, setOpenId] = useState<string | null>(null);
  const [occById, setOccById] = useState<Record<string, Occ[] | "loading">>({});
  const [othersOpen, setOthersOpen] = useState(false);

  async function toggleOcc(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (occById[id] && occById[id] !== "loading") return;
    setOccById((m) => ({ ...m, [id]: "loading" }));
    try {
      const d = await api<{ incidents: Array<{ behaviorSnapshot: { name: string; kind?: string }; detailText?: string; teacherName?: string; timestamp: string }> }>(`/students/${id}`);
      const occ: Occ[] = (d.incidents || [])
        .filter((inc) => inc.behaviorSnapshot?.kind !== "positive")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 12)
        .map((inc) => ({ date: inc.timestamp, name: inc.behaviorSnapshot?.name || "Offence", detail: inc.detailText || "", teacher: inc.teacherName || "" }));
      setOccById((m) => ({ ...m, [id]: occ }));
    } catch { setOccById((m) => ({ ...m, [id]: [] })); }
  }

  useEffect(() => {
    api<{ students: StudentSummary[]; triggerCount: number }>("/students")
      .then((d) => {
        const t = d.triggerCount || 3;
        setTrigger(t);
        const watch = (d.students || [])
          .filter((s) => (s.activeCount || 0) >= t - 1)
          // Grouped by homeroom (classGroup), then most strikes first within a homeroom.
          .sort((a, b) => (a.classGroup || "").localeCompare(b.classGroup || "") || (b.activeCount || 0) - (a.activeCount || 0));
        setRows(watch);
      })
      .catch(() => setRows([]));
  }, []);

  if (!rows || rows.length === 0) return null;

  // "Your homeroom first": own students up top; the rest collapsed but reachable.
  const mine = myHomeroom ? rows.filter((s) => (s.classGroup || "") === myHomeroom) : [];
  const others = myHomeroom ? rows.filter((s) => (s.classGroup || "") !== myHomeroom) : rows;
  const showOthers = !myHomeroom || mine.length === 0 || othersOpen;

  const renderRow = (s: StudentSummary, showHeader: boolean) => (
    <Fragment key={s._id}>
      {showHeader && (
        <li className="!border-t-0 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.classGroup || "No homeroom"}</li>
      )}
      <li className="flex items-center justify-between gap-2 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <button onClick={() => toggleOcc(s._id)} aria-label={openId === s._id ? "Hide occurrences" : "Show occurrences"} aria-expanded={openId === s._id} className="-m-1 shrink-0 p-1 text-slate-500 hover:text-slate-700">{openId === s._id ? "▾" : "▸"}</button>
          <Link href={`/behavior/student/${s._id}`} className="min-w-0 truncate font-medium hover:text-slate-600">
            {s.lastName}, {s.firstName} <span className="text-slate-500">{s.classGroup}</span>
          </Link>
          <HrButton studentId={s._id} done={s.hrFollowedUpThisWeek} />
        </span>
        <span className={`shrink-0 font-semibold tabular-nums ${(s.activeCount || 0) >= trigger ? "text-red-600" : "text-orange-500"}`}>
          {s.activeCount}/{trigger} →
        </span>
      </li>
      {openId === s._id && (
        <li className="!border-t-0 pb-2 pl-6 text-xs text-slate-600">
          {occById[s._id] === "loading" ? (
            <span className="text-slate-500">Loading…</span>
          ) : (occById[s._id] as Occ[])?.length ? (
            <ul className="space-y-0.5">
              {(occById[s._id] as Occ[]).map((o, k) => (
                <li key={k}>
                  <span className="text-slate-500">{new Date(o.date).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>
                  {" · "}<span className="font-medium">{o.name}</span>
                  {o.detail ? <span className="text-slate-500"> — {o.detail}</span> : null}
                  {o.teacher ? <span className="text-slate-500"> ({o.teacher})</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-slate-500">No recent occurrences.</span>
          )}
        </li>
      )}
    </Fragment>
  );

  return (
    <Card>
      <h2 className="font-semibold">Students to encourage</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        At or one away from the {trigger}-strike trigger — a good moment for a positive word or a check-in before the next incident.
        {fadeDays ? ` Strikes fade after ${fadeDays} days, so the trend can still turn around.` : ""}
      </p>
      <ul className="mt-2 divide-y divide-slate-100">
        {myHomeroom && mine.length > 0 && (
          <>
            <li className="!border-t-0 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Your homeroom · {myHomeroom}</li>
            {mine.map((s) => renderRow(s, false))}
          </>
        )}
        {others.length > 0 && (
          showOthers ? (
            <>
              {myHomeroom && mine.length > 0 && (
                <li className="!border-t-0 pt-3 pb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Other homerooms</li>
              )}
              {others.map((s, i) => renderRow(s, i === 0 || (others[i - 1].classGroup || "") !== (s.classGroup || "")))}
            </>
          ) : (
            <li className="!border-t-0 pt-2">
              <button type="button" onClick={() => setOthersOpen(true)}
                className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800">
                Show other homerooms ({others.length})
              </button>
            </li>
          )
        )}
      </ul>
    </Card>
  );
}

function ExecutiveSummaryCard() {
  const [months, setMonths] = useState<number | "year">("year");
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
        <select value={months} onChange={(e) => setMonths(e.target.value === "year" ? "year" : Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="year">This school year</option>
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
        </select>
        <Button onClick={() => gen("me")} disabled={!!busy} variant="secondary">
          {busy === "me" ? "Generating…" : "My interactions"}
        </Button>
        <Button onClick={() => gen("all")} disabled={!!busy} variant="secondary">
          {busy === "all" ? "Generating…" : "Whole division"}
        </Button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</p>}
      {summary && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={emailIt} disabled={!!busy} variant="secondary" size="sm">
              {busy === "email" ? "Emailing…" : "Email it to me (with chart)"}
            </Button>
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

type Pending = { _id: string; studentId: string; studentName: string; classGroup?: string; reason?: string; ccVp?: boolean; count?: number; evidenceCount?: number; createdAt: string; renderedText?: string; sequenceNo?: number };

function PendingDecisions({ autoSend, channelLabel }: { autoSend: boolean; channelLabel?: string }) {
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
      await api(`/notices/${id}/send`, { body: { requestMeeting: !!meetingFor[id], includeEvidence: !!evidenceFor[id], recordOnly: !autoSend } });
      setRows((p) => (p || []).filter((n) => n._id !== id));
      setConfirmRow(null);
      setMsg(autoSend ? "Sent to the parent ✓" : "Recorded as sent ✓ — remember to send your copy to the parent.");
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
                <span className="ml-2 text-xs text-slate-500">
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
            {(n.sequenceNo || 1) >= 2 && (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={!!meetingFor[n._id]} onChange={(e) => setMeetingFor((m) => ({ ...m, [n._id]: e.target.checked }))} />
                Also request a meeting with the parents <span className="text-slate-500">(notice #{n.sequenceNo} — a note has already gone home)</span>
              </label>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => setConfirmRow(n)} disabled={!!busy} variant="warning" size="sm">
                {busy === n._id ? "…" : autoSend ? "Send to parent" : "Mark as sent to parent"}
              </Button>
              <Button onClick={() => notNow(n._id)} disabled={!!busy} variant="secondary" size="sm">
                Not this time
              </Button>
              <Link href={`/behavior/student/${n.studentId}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Review / edit</Link>
            </div>
          </li>
        ))}
      </ul>
      <SendNoticeModal
        open={!!confirmRow}
        studentName={confirmRow?.studentName}
        channelLabel={channelLabel}
        recordOnly={!autoSend}
        showMeeting={(confirmRow?.sequenceNo || 1) >= 2}
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

function ReminderToday({ firstName }: { firstName?: string }) {
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
      <h2 className="font-semibold">{firstName ? `Reminders for ${firstName} today` : "Reminder for today"}</h2>
      <p className="mt-0.5 text-xs text-slate-500">Consequences from offences you logged — for you to follow up on.</p>
      {msg && <p className="mt-1 text-sm text-amber-700">{msg}</p>}
      {items === null && <p className="mt-1 text-sm text-slate-500">Loading…</p>}
      {items && items.length === 0 && <p className="mt-1 text-sm text-slate-500">Nothing due today 🎉</p>}
      <ul className="mt-2 space-y-2">
        {items?.map((f) => {
          const s = f.student;
          const name = s ? `${s.preferredName || s.firstName} ${s.lastName}` : "student";
          return (
            <li key={f._id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">
                {name} <span className="text-slate-500">{s?.classGroup}</span>
                {f.multiplier > 1 && <span className="ml-2 text-xs text-red-600">×{f.multiplier}</span>}
                {(f.incidentAt || f.createdAt) && (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    · incident {new Date(f.incidentAt || f.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  </span>
                )}
              </p>
              <p className="text-sm text-slate-600">
                {f.behaviorName}: {f.consequenceText}
              </p>
              <p className="mt-1 text-xs text-slate-500">Did the student complete this? (About the task itself — not the parent message.)</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => resolve(f._id, "done")} title="The student completed the task (e.g. handed in the lines)" className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white">
                  Completed
                </button>
                <button onClick={() => resolve(f._id, "not_done")} title="Not completed — re-issues/escalates" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white">
                  Not done
                </button>
                <Button onClick={() => resolve(f._id, "waived")} title="Cancel this task — no penalty" variant="secondary" size="xs">
                  Waive
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

