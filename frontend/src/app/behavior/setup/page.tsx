"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../_lib/api";

export default function SetupPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    const data = await api<Me>("/me");
    setMe(data);
  }

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    refresh().catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  if (!getToken()) {
    return <p>Please <Link className="underline" href={loginHref("/behavior/setup")}>sign in</Link>.</p>;
  }
  if (loading) return <p className="text-slate-500">Loading…</p>;

  // No school yet → create one (this caller becomes the originator).
  if (!me?.membership) return <CreateSchool onCreated={refresh} />;

  const isAdmin = me.membership.role === "originator" || me.membership.role === "admin";
  if (!isAdmin) {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Division setup</h1>
        <p className="mt-2 text-slate-600">
          Only an admin can edit the shared division configuration. You can still log incidents and
          view student status.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <ConfigSection config={me.config} />
      <InviteSection domain={me.school?.emailDomain || ""} isOriginator={me.membership.role === "originator"} />
      <RosterSection />
      <TestToolsSection email={me.membership.email} />
    </div>
  );
}

function CreateSchool({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <h1 className="text-xl font-semibold">Create your school</h1>
      <p className="mt-1 text-sm text-slate-500">
        You&apos;ll be the originator — invites will be restricted to your email domain.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="School / division name"
        className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-2.5"
      />
      <button
        disabled={!name.trim() || busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await api("/setup", { body: { schoolName: name.trim() } });
            await onCreated();
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 rounded-lg bg-slate-900 px-4 py-2.5 text-white disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create school"}
      </button>
    </Card>
  );
}

function ConfigSection({ config }: { config: any }) {
  const [c, setC] = useState(() => ({
    triggerCount: config?.triggerCount ?? 3,
    fadeWindowDays: config?.fadeWindowDays ?? 30,
    vpName: config?.vp?.name ?? "",
    vpEmail: config?.vp?.email ?? "",
    schoolName: config?.branding?.schoolName ?? "",
    signatureBlock: config?.branding?.signatureBlock ?? "",
    email: config?.channels?.email ?? true,
    edsby: config?.channels?.edsby ?? false,
    aiSendMode: config?.aiSendMode ?? "auto",
    reminderTime: config?.reminderTime ?? "07:30",
  }));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    try {
      await api("/config", {
        method: "PUT",
        body: {
          triggerCount: Number(c.triggerCount),
          fadeWindowDays: Number(c.fadeWindowDays),
          vp: { name: c.vpName, email: c.vpEmail },
          branding: { schoolName: c.schoolName, signatureBlock: c.signatureBlock },
          channels: { email: c.email, edsby: c.edsby },
          aiSendMode: c.aiSendMode,
          reminderTime: c.reminderTime,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Division thresholds & branding</h2>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Trigger count">
          <input type="number" min={1} value={c.triggerCount}
            onChange={(e) => setC({ ...c, triggerCount: e.target.value as any })} className={inputCls} />
        </Field>
        <Field label="Fade window (days)">
          <input type="number" min={1} value={c.fadeWindowDays}
            onChange={(e) => setC({ ...c, fadeWindowDays: e.target.value as any })} className={inputCls} />
        </Field>
        <Field label="VP name">
          <input value={c.vpName} onChange={(e) => setC({ ...c, vpName: e.target.value })} className={inputCls} />
        </Field>
        <Field label="VP email (CC on 2nd+ notice)">
          <input value={c.vpEmail} onChange={(e) => setC({ ...c, vpEmail: e.target.value })} className={inputCls} />
        </Field>
        <Field label="School name (on notices)">
          <input value={c.schoolName} onChange={(e) => setC({ ...c, schoolName: e.target.value })} className={inputCls} />
        </Field>
        <Field label="AI send mode">
          <select value={c.aiSendMode} onChange={(e) => setC({ ...c, aiSendMode: e.target.value })} className={inputCls}>
            <option value="auto">Automatic on trigger</option>
            <option value="draft">Draft (one-tap send)</option>
          </select>
        </Field>
        <Field label="Morning reminder time">
          <input type="time" value={c.reminderTime}
            onChange={(e) => setC({ ...c, reminderTime: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <Field label="Default signature block">
        <textarea value={c.signatureBlock} onChange={(e) => setC({ ...c, signatureBlock: e.target.value })}
          rows={2} className={inputCls} />
      </Field>
      <div className="mt-3 flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.email} onChange={(e) => setC({ ...c, email: e.target.checked })} /> Email
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={c.edsby} onChange={(e) => setC({ ...c, edsby: e.target.checked })} /> Edsby (Phase 3)
        </label>
      </div>
      <button onClick={save} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white">
        {saved ? "Saved ✓" : "Save configuration"}
      </button>
    </Card>
  );
}

function InviteSection({ domain, isOriginator }: { domain: string; isOriginator: boolean }) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState("teacher");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setErr(null);
    setResult(null);
    const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    try {
      const r = await api("/invite", { body: { emails: list, role } });
      setResult(r);
      setEmails("");
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Card>
      <h2 id="invite" className="font-semibold">Invite teachers</h2>
      <p className="mt-1 text-sm text-slate-500">
        Only <span className="font-medium">@{domain}</span> addresses can be invited.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <textarea value={emails} onChange={(e) => setEmails(e.target.value)}
        rows={2} placeholder="emails, separated by commas or spaces" className={`mt-2 ${inputCls}`} />
      <div className="mt-2 flex items-center gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
          <option value="teacher">Teacher</option>
          <option value="principal">Principal (read-only)</option>
          {isOriginator && <option value="admin">Admin</option>}
        </select>
        <button onClick={send} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Invite</button>
      </div>
      {result && (
        <div className="mt-2 text-sm">
          <p className="text-green-700">Invited: {result.invited?.map((i: any) => i.email).join(", ") || "none"}</p>
          {result.rejected?.length > 0 && (
            <p className="text-red-600">
              Rejected: {result.rejected.map((r: any) => `${r.email} (${r.reason})`).join(", ")}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function RosterSection() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api("/roster/import", { body: fd });
      setResult(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 id="roster" className="font-semibold">Import roster (CSV or XLSX)</h2>
      <p className="mt-1 text-sm text-slate-500">
        Columns: Last name, First name, Common/preferred name, Gender, Class/Group, Grade, DOB,
        Parent 1/2 name + email + Edsby ID. The ethnicity field is dropped automatically.
      </p>
      <a
        href="/behavior-roster-template.csv"
        download
        className="mt-2 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
      >
        ⬇ Download template (CSV)
      </a>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <input
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="mt-2 block text-sm"
      />
      <button onClick={upload} disabled={!file || busy}
        className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40">
        {busy ? "Importing…" : "Import"}
      </button>
      {result && (
        <div className="mt-3 text-sm">
          <p className="text-green-700">
            Imported {result.imported}, updated {result.updated}, skipped {result.skipped?.length || 0}.
          </p>
          {result.skipped?.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-slate-500">
              {result.skipped.slice(0, 10).map((s: any, i: number) => (
                <li key={i}>Row {s.row}: {s.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function TestToolsSection({ email }: { email: string }) {
  const [created, setCreated] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [msg, setMsg] = useState("");

  // Build a "+alias" of the signed-in admin's email so test notices land in
  // their own inbox (Google Workspace delivers +tags to the base address).
  function alias(tag: string) {
    const at = email.indexOf("@");
    return at === -1 ? email : `${email.slice(0, at)}+${tag}${email.slice(at)}`;
  }

  async function addTestStudent() {
    setBusy(true);
    setErr(null);
    setCreated(null);
    try {
      const r = await api("/students", {
        body: {
          lastName: "ZTEST",
          firstName: "Alpha",
          preferredName: "Al",
          gender: "M",
          classGroup: "ZTEST",
          grade: "7",
          dob: "2013-01-01",
          parents: [
            { name: "Test Mom (you)", email: alias("mom") },
            { name: "Test Dad (you)", email: alias("dad") },
          ],
          test: true,
        },
      });
      setCreated(r.student);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    setErr(null);
    try {
      const d = await api<{ students: any[] }>(`/students?query=${encodeURIComponent(q.trim())}`);
      setResults(d.students || []);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function del(s: any) {
    if (!window.confirm(`Delete ${s.firstName} ${s.lastName} and ALL their incidents/notices? This cannot be undone.`)) return;
    try {
      const r = await api<{ incidentsRemoved: number; noticesRemoved: number }>(`/students/${s._id}`, { method: "DELETE" });
      setResults(results.filter((x) => x._id !== s._id));
      setMsg(`Deleted ${s.firstName} ${s.lastName} — removed ${r.incidentsRemoved} incident(s), ${r.noticesRemoved} notice(s).`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Test &amp; cleanup</h2>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      <div className="mt-3">
        <button onClick={addTestStudent} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40">
          {busy ? "Adding…" : "Add test student"}
        </button>
        <p className="mt-1 text-xs text-slate-500">
          Creates “ZTEST Alpha” whose parent emails route to <span className="font-mono">{alias("mom")}</span> /{" "}
          <span className="font-mono">{alias("dad")}</span> — so test notices come to you, never a real parent.
        </p>
        {created && (
          <p className="mt-1 text-sm text-green-700">
            Added {created.firstName} {created.lastName}.{" "}
            <Link href="/behavior/log" className="underline">Log an incident →</Link>
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-sm font-medium text-slate-700">Remove a student</p>
        {msg && <p className="mt-1 text-sm text-green-700">{msg}</p>}
        <div className="mt-2 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search by name…"
            className={inputCls}
          />
          <button onClick={search} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Search</button>
        </div>
        <ul className="mt-2 divide-y divide-slate-100">
          {results.map((s) => (
            <li key={s._id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {s.lastName}, {s.firstName} <span className="text-slate-400">{[s.classGroup, s.grade].filter(Boolean).join(" · ")}</span>
              </span>
              <button onClick={() => del(s)} className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700">
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
