"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref } from "../_lib/api";
import { cardCls, Button } from "../_components/ui";
import { toast } from "../_components/toast";

type TeamRow = {
  _id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  housesCommittee?: boolean;
  homeroom?: string;
  courtesyName?: string;
  monthlySummary?: boolean;
  status: "pending" | "accepted";
  joinedAt: string | null;
  incidents: number;
  legacyOffences?: number;
  notices: number;
  lastActiveAt: string | null;
};
type Pending = { email: string; role: string; invitedBy: string; invitedAt: string; lastSentAt?: string; homeroom?: string };
type Stats = { members: number; pending: number; activeLast30: number; totalIncidents: number; totalNotices: number };
type TeamResp = { teachers: TeamRow[]; pending: Pending[]; stats: Stats; viewerRole: string; viewerUserId: string };

function ago(d: string | null) {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  const day = 86400000;
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < day) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * day) return `${Math.floor(ms / day)}d ago`;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function shortDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export default function TeamPage() {
  const [data, setData] = useState<TeamResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noteByEmail, setNoteByEmail] = useState<Record<string, string>>({});
  const [savingSetup, setSavingSetup] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api<TeamResp>("/team")
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  async function renameMember(userId: string, currentName: string) {
    const name = window.prompt("Name to show for this member in Compass:", currentName || "");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, name: trimmed } : t)) });
    try { await api("/team/name", { method: "PUT", body: { userId, name: trimmed } }); toast(); }
    catch (e: any) { setErr(e.message); toast(e.message, "error"); }
  }

  async function setSetupAccess(userId: string, canEditSetup: boolean) {
    setSavingSetup(userId);
    // optimistic
    setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, role: canEditSetup ? "admin" : "teacher" } : t)) });
    try {
      await api("/team/role", { method: "PUT", body: { userId, canEditSetup } });
      toast();
    } catch (e: any) {
      setErr(e.message);
      toast(e.message, "error");
      // revert on failure
      setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, role: canEditSetup ? "teacher" : "admin" } : t)) });
    } finally {
      setSavingSetup(null);
    }
  }

  async function saveHomeroomMember(userId: string, value: string) {
    const v = value.trim();
    setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, homeroom: v } : t)) });
    try { await api("/team/homeroom", { method: "PUT", body: { userId, homeroom: v } }); toast(); }
    catch (e: any) { setErr(e.message); toast(e.message, "error"); }
  }
  async function saveHomeroomInvite(email: string, value: string) {
    const v = value.trim();
    setData((d) => d && { ...d, pending: d.pending.map((p) => (p.email === email ? { ...p, homeroom: v } : p)) });
    try { await api("/team/homeroom", { method: "PUT", body: { email, homeroom: v } }); toast(); }
    catch (e: any) { setErr(e.message); toast(e.message, "error"); }
  }
  async function saveCourtesy(userId: string, value: string) {
    const v = value.trim();
    setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, courtesyName: v } : t)) });
    try { await api("/team/courtesy", { method: "PUT", body: { userId, courtesyName: v } }); toast(); }
    catch (e: any) { setErr(e.message); toast(e.message, "error"); }
  }

  async function setMonthlySummary(userId: string, on: boolean) {
    setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, monthlySummary: on } : t)) });
    try { await api("/team/monthly-summary", { method: "PUT", body: { userId, on } }); toast(); }
    catch (e: any) { setErr(e.message); toast(e.message, "error"); setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, monthlySummary: !on } : t)) }); }
  }

  async function setCommittee(userId: string, on: boolean) {
    setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, housesCommittee: on } : t)) });
    try {
      await api("/team/houses-committee", { method: "PUT", body: { userId, on } });
      toast();
    } catch (e: any) {
      setErr(e.message);
      toast(e.message, "error");
      setData((d) => d && { ...d, teachers: d.teachers.map((t) => (t.userId === userId ? { ...t, housesCommittee: !on } : t)) });
    }
  }

  async function resendInvite(email: string) {
    setNoteByEmail((n) => ({ ...n, [email]: "Sending…" }));
    try {
      const r = await api<{ emailed: boolean; emailError?: string; lastSentAt?: string }>("/invites/resend", { body: { email } });
      setNoteByEmail((n) => ({ ...n, [email]: r.emailed ? "Reminder sent ✓" : `Failed: ${r.emailError || "email error"}` }));
      if (r.emailed) {
        const when = r.lastSentAt || new Date().toISOString();
        setData((d) => d && { ...d, pending: d.pending.map((p) => (p.email === email ? { ...p, lastSentAt: when } : p)) });
      }
    } catch (e: any) {
      setNoteByEmail((n) => ({ ...n, [email]: e.message }));
    }
  }
  async function revokeInvite(email: string) {
    if (!window.confirm(`Revoke the invite for ${email}? They won't be able to use their link.`)) return;
    try {
      await api("/invites/revoke", { body: { email } });
      setData((d) => d && { ...d, pending: d.pending.filter((p) => p.email !== email), stats: { ...d.stats, pending: d.stats.pending - 1 } });
    } catch (e: any) {
      setNoteByEmail((n) => ({ ...n, [email]: e.message }));
    }
  }

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior/team")}>sign in</Link>.</p>;
  if (err) return <p className="text-red-600">{err}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const { teachers, pending, stats } = data;
  const accepted = teachers.filter((t) => t.status === "accepted");
  const isOriginator = data.viewerRole === "originator";
  const isAdmin = isOriginator || data.viewerRole === "admin";

  return (
    <div className="space-y-5">
      <div>
        <Link href="/behavior" className="text-sm text-slate-500 underline">← dashboard</Link>
        <h1 className="mt-1 text-xl font-semibold">Team &amp; usage</h1>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Members joined" value={stats.members} />
        <Stat label="Active (30d)" value={stats.activeLast30} />
        <Stat label="Pending invites" value={stats.pending} />
        <Stat label="Incidents logged" value={stats.totalIncidents} />
      </div>

      {/* Members */}
      <section className={cardCls}>
        <h2 className="font-semibold">Members ({accepted.length})</h2>

        {/* A card per member at every width — Compass's ~768px column can't fit an
            11-column table (it clipped the right-hand columns even on desktop). */}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {teachers.map((t) => (
            <div key={t._id} className={`rounded-lg border border-slate-200 p-3 ${t.status === "pending" ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {t.name || <span className="italic text-slate-500">{t.email.split("@")[0]} (no name)</span>}
                    {isAdmin && t.status !== "pending" && (
                      <button onClick={() => renameMember(t.userId, t.name || "")} className="ml-2 text-xs font-normal text-slate-500 underline">edit</button>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-500">{t.email}</div>
                  <div className="mt-0.5 text-xs capitalize text-slate-500">{t.role}{t.status === "pending" ? " · invited, not joined" : ""}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-500">
                  <div className="tabular-nums" title={t.legacyOffences ? `incl. ${t.legacyOffences} earlier offence(s) imported from past records` : undefined}>
                    {t.incidents} inc{t.legacyOffences ? "*" : ""} · {t.notices} notices
                  </div>
                  <div>{t.status === "pending" ? "—" : t.lastActiveAt ? `active ${ago(t.lastActiveAt)}` : "not active yet"}</div>
                  <div>joined {shortDate(t.joinedAt)}</div>
                </div>
              </div>
              {isAdmin && t.status !== "pending" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">Official name
                    <input defaultValue={t.courtesyName || ""} onBlur={(e) => { if (e.target.value.trim() !== (t.courtesyName || "")) saveCourtesy(t.userId, e.target.value); }}
                      placeholder="e.g. Mrs. Smith" className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </label>
                  <label className="text-xs text-slate-500">Homeroom
                    <input defaultValue={t.homeroom || ""} onBlur={(e) => { if (e.target.value.trim() !== (t.homeroom || "")) saveHomeroomMember(t.userId, e.target.value); }}
                      placeholder="e.g. 7A" className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                  </label>
                </div>
              )}
              {t.status !== "pending" && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-700">
                  {t.role !== "originator" && t.role !== "principal" && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-slate-900 disabled:opacity-40" checked={t.role === "admin"}
                        disabled={!isOriginator || savingSetup === t.userId} onChange={(e) => setSetupAccess(t.userId, e.target.checked)} />
                      Edit setup
                    </label>
                  )}
                  {t.role !== "principal" && t.role !== "originator" && t.role !== "admin" && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-slate-900 disabled:opacity-40" checked={!!t.housesCommittee}
                        disabled={!isAdmin} onChange={(e) => setCommittee(t.userId, e.target.checked)} />
                      Houses cmte
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-slate-900 disabled:opacity-40" checked={t.monthlySummary !== false}
                      disabled={!isAdmin} onChange={(e) => setMonthlySummary(t.userId, e.target.checked)} />
                    Monthly email
                  </label>
                </div>
              )}
            </div>
          ))}
          {teachers.length === 0 && <p className="text-slate-500">No members yet.</p>}
        </div>

        {teachers.some((t) => t.legacyOffences) && (
          <p className="mt-2 text-xs text-slate-500">
            * Incidents include earlier offences imported from past records. Those historical offences may also appear among the notices home, so the two columns aren&apos;t additive.
          </p>
        )}
      </section>

      {/* Pending invites */}
      <section className={cardCls}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Pending invites ({pending.length})</h2>
          <Link href="/behavior/setup#invite" className="text-sm text-slate-500 underline">invite more →</Link>
        </div>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Everyone invited has joined 🎉</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {pending.map((p) => (
              // Stacks on phones (details, then controls on their own row); side by
              // side from sm up. The controls used to squeeze the details into a
              // one-word-wide column on a phone.
              <li key={p.email} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="break-all font-medium">{p.email}</div>
                  <div className="text-xs text-slate-500">
                    <span className="capitalize">{p.role}</span> · invited {ago(p.invitedAt)}{p.lastSentAt && new Date(p.lastSentAt).getTime() - new Date(p.invitedAt).getTime() > 60000 ? `, resent ${ago(p.lastSentAt)}` : ""}{p.invitedBy ? ` by ${p.invitedBy.split("@")[0]}` : ""}
                    {noteByEmail[p.email] ? <span className="ml-2 text-green-700">{noteByEmail[p.email]}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">Homeroom
                    <input defaultValue={p.homeroom || ""} onBlur={(e) => { if (e.target.value.trim() !== (p.homeroom || "")) saveHomeroomInvite(p.email, e.target.value); }}
                      placeholder="e.g. 7A" aria-label={`Homeroom for ${p.email}`} className="w-16 rounded border border-slate-300 px-2 py-1 text-sm" />
                  </label>
                  <Button onClick={() => resendInvite(p.email)} variant="secondary" size="xs">Resend</Button>
                  <Button onClick={() => revokeInvite(p.email)} variant="secondary" size="xs" className="!border-red-300 !text-red-700 hover:!bg-red-50">Revoke</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}
