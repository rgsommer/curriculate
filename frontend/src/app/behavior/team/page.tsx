"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref } from "../_lib/api";

type TeamRow = {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: "pending" | "accepted";
  joinedAt: string | null;
  incidents: number;
  notices: number;
  lastActiveAt: string | null;
};
type Pending = { email: string; role: string; invitedBy: string; invitedAt: string };
type Stats = { members: number; pending: number; activeLast30: number; totalIncidents: number; totalNotices: number };

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
  const [data, setData] = useState<{ teachers: TeamRow[]; pending: Pending[]; stats: Stats } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noteByEmail, setNoteByEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!getToken()) return;
    api<{ teachers: TeamRow[]; pending: Pending[]; stats: Stats }>("/team")
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  async function resendInvite(email: string) {
    setNoteByEmail((n) => ({ ...n, [email]: "Sending…" }));
    try {
      const r = await api<{ emailed: boolean; emailError?: string }>("/invites/resend", { body: { email } });
      setNoteByEmail((n) => ({ ...n, [email]: r.emailed ? "Reminder sent ✓" : `Failed: ${r.emailError || "email error"}` }));
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
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Members ({accepted.length})</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3">Teacher</th>
                <th className="py-1.5 pr-3">Role</th>
                <th className="py-1.5 pr-3">Joined</th>
                <th className="py-1.5 pr-3">Last active</th>
                <th className="py-1.5 pr-3 text-right">Incidents</th>
                <th className="py-1.5 text-right">Notices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teachers.map((t) => (
                <tr key={t._id} className={t.status === "pending" ? "text-slate-400" : ""}>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{t.name || t.email.split("@")[0]}</div>
                    <div className="text-xs text-slate-400">{t.email}</div>
                  </td>
                  <td className="py-2 pr-3 capitalize">{t.role}</td>
                  <td className="py-2 pr-3">{shortDate(t.joinedAt)}</td>
                  <td className="py-2 pr-3">
                    {t.status === "pending" ? (
                      <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-700">invited — not joined</span>
                    ) : (
                      <span title={t.lastActiveAt ? new Date(t.lastActiveAt).toLocaleString() : ""}>{ago(t.lastActiveAt)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.incidents}</td>
                  <td className="py-2 text-right tabular-nums">{t.notices}</td>
                </tr>
              ))}
              {teachers.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-slate-400">No members yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending invites */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Pending invites ({pending.length})</h2>
          <Link href="/behavior/setup#invite" className="text-sm text-slate-500 underline">invite more →</Link>
        </div>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Everyone invited has joined 🎉</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {pending.map((p) => (
              <li key={p.email} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.email}</div>
                  <div className="text-xs text-slate-400">
                    {p.role} · invited {ago(p.invitedAt)}{p.invitedBy ? ` by ${p.invitedBy}` : ""}
                    {noteByEmail[p.email] ? <span className="ml-2 text-green-700">{noteByEmail[p.email]}</span> : null}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => resendInvite(p.email)} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs">Resend</button>
                  <button onClick={() => revokeInvite(p.email)} className="rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-700">Revoke</button>
                </span>
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
