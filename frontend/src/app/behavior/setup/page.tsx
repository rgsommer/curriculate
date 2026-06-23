"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, API_BASE, type Me } from "../_lib/api";

// School-approved consequences shown by default (admins can edit). The AI coach
// only ever suggests from this list, filling in specifics (line text, word
// count, verses) by occurrence.
const RECOMMENDED_CONSEQUENCES = [
  "Lines (10×/20×/30× by occurrence) — give the exact line, e.g. \"From now on, I will arrive on time and ready to learn.\"",
  "Essay (150 / 200 / 350 words by occurrence) on a relevant topic, e.g. \"Why it is important for me to complete assignments on time.\"",
  "Apology letter — clearly state what happened, what you wish you had done differently, and what you will do to prevent it happening again.",
  "Reflection on what happened in class today, using 3 relevant Bible verses.",
  "Detention",
  "In-school suspension",
  "At-home suspension",
  "Meeting with the parents and the Principal (or VP)",
  "White slip",
];

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
  if (!isAdmin) return <ReadOnlySettings me={me} />;

  return (
    <div className="space-y-5">
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <ConfigSection config={me.config} />
      <Card>
        <h2 className="font-semibold">Behaviours (division list)</h2>
        <p className="mt-1 text-sm text-slate-500">Add/edit offenses, their trigger mode, consequence and follow-up.</p>
        <Link href="/behavior/behaviours" className="mt-2 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          Manage behaviours →
        </Link>
      </Card>
      <HousesSection config={me.config} />
      <HomeworkSettings config={me.config} />
      <RecommendedActionsSettings config={me.config} />
      <AdminDigestSettings config={me.config} myEmail={me.membership?.email || ""} />
      <EdsbySection edsby={me.config?.edsby} />
      <InviteSection domain={me.school?.emailDomain || ""} isOriginator={me.membership.role === "originator"} />
      <RosterSection />
      <AddStudentSection />
      <TestToolsSection email={me.membership.email} />
    </div>
  );
}

function ReadOnlySettings({ me }: { me: Me }) {
  const c = me.config || {};
  const admins = (me.admins || []).filter((a) => a.email);
  const Row = ({ label, val }: { label: string; val: any }) => (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{val || "—"}</span>
    </div>
  );
  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-xl font-semibold">Settings (view only)</h1>
        <p className="mt-1 text-sm text-slate-600">
          These shared settings are managed by an admin. To discuss changes, contact{" "}
          {admins.length
            ? admins.map((a) => `${a.name || a.email}${a.email ? ` (${a.email})` : ""}`).join(", ")
            : "your administrator"}
          .
        </p>
      </Card>
      <Card>
        <h2 className="font-semibold">Division settings</h2>
        <div className="mt-2 divide-y divide-slate-100">
          <Row label="Trigger count" val={c.triggerCount ?? 3} />
          <Row label="Fade window (days)" val={c.fadeWindowDays ?? 30} />
          <Row label="VP" val={c.vp?.name ? `${c.vp.name}${c.vp.email ? ` (${c.vp.email})` : ""}` : ""} />
          <Row label="Parent channel" val={[c.channels?.edsby && "Edsby", c.channels?.emailToParents && "email parents ⚠"].filter(Boolean).join(", ") || "none set"} />
          <Row label="AI send mode" val={c.aiSendMode === "draft" ? "Draft (one-tap send)" : "Automatic on trigger"} />
          <Row label="Morning reminder time" val={c.reminderTime || "07:30"} />
        </div>
        <Link href="/behavior/behaviours" className="mt-3 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          View behaviours →
        </Link>
      </Card>
      <MyEdsbyCard />
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
    vpEdsbyId: config?.vp?.edsbyId ?? "",
    schoolName: config?.branding?.schoolName ?? "",
    signatureBlock: config?.branding?.signatureBlock ?? "",
    edsby: config?.channels?.edsby ?? true,
    emailToParents: config?.channels?.emailToParents ?? false,
    teacherDraft: config?.teacherDraft ?? true,
    vpNotify: config?.vpNotify ?? "second",
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
          vp: { name: c.vpName, email: c.vpEmail, edsbyId: c.vpEdsbyId },
          branding: { schoolName: c.schoolName, signatureBlock: c.signatureBlock },
          channels: { edsby: c.edsby, emailToParents: c.emailToParents, email: false },
          teacherDraft: c.teacherDraft,
          vpNotify: c.vpNotify,
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
        <Field label="Trigger count" hint="How many active strikes a student needs before a notice home is prepared (e.g. 3).">
          <input type="number" min={1} value={c.triggerCount}
            onChange={(e) => setC({ ...c, triggerCount: e.target.value as any })} className={inputCls} />
        </Field>
        <Field label="Fade window (days)" hint="How long a strike keeps counting toward the trigger. After this many days an incident stops counting toward the next notice — it stays in the student's history for context, but no longer adds to the active strike total. So a student isn't punished forever for an old, one-off incident.">
          <input type="number" min={1} value={c.fadeWindowDays}
            onChange={(e) => setC({ ...c, fadeWindowDays: e.target.value as any })} className={inputCls} />
        </Field>
        <Field label="VP name">
          <input value={c.vpName} onChange={(e) => setC({ ...c, vpName: e.target.value })} className={inputCls} />
        </Field>
        <Field label="VP name (CC on 2nd+ notice)">
          <input value={c.vpEmail} onChange={(e) => setC({ ...c, vpEmail: e.target.value })} className={inputCls} placeholder="VP email (only used if email is enabled below)" />
        </Field>
        <Field label="VP Edsby id (so the CC reaches them on Edsby)">
          <input value={c.vpEdsbyId} onChange={(e) => setC({ ...c, vpEdsbyId: e.target.value })} className={inputCls} placeholder="e.g. 7571466" />
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
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">How parents &amp; the VP are contacted</p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={c.edsby} onChange={(e) => setC({ ...c, edsby: e.target.checked })} />
          Edsby <span className="text-slate-400">(recommended — parents see who it&apos;s from)</span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={c.emailToParents} onChange={(e) => setC({ ...c, emailToParents: e.target.checked })} className="mt-0.5" />
          <span>
            <span className="font-medium text-red-700">Email parents directly</span> — off by default.
            {c.emailToParents && (
              <span className="mt-1 block rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                ⚠ With this on, notices are emailed to parents from a curriculate.net address. Parents who don&apos;t recognise it may be alarmed. Leave it OFF and use Edsby unless your division has explicitly agreed to email.
              </span>
            )}
          </span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={c.teacherDraft} onChange={(e) => setC({ ...c, teacherDraft: e.target.checked })} className="mt-0.5" />
          <span>Email the logging teacher a <span className="font-medium">suggested note</span> to review, edit and send (they can CC the VP).</span>
        </label>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-slate-600">Copy the VP on:</span>
          <select value={c.vpNotify} onChange={(e) => setC({ ...c, vpNotify: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
            <option value="off">Never</option>
            <option value="first">1st notice and after</option>
            <option value="second">2nd notice and after</option>
          </select>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          The VP is reached over the same channel (Edsby via their Edsby id, or email if enabled). Only an admin can change these settings.
        </p>
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
  const [busy, setBusy] = useState(false);

  async function send() {
    setErr(null);
    setResult(null);
    setBusy(true);
    // Extract real addresses — handles "Name <email>", commas, spaces, etc.
    const list = (emails.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || []).map((e) => e.toLowerCase());
    try {
      const r = await api("/invite", { body: { emails: list, role } });
      setResult(r);
      setEmails("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 id="invite" className="font-semibold">Invite teachers</h2>
      <p className="mt-1 text-sm text-slate-500">
        Each invite email makes the case — especially to rotary teachers — for one shared, cross-teacher picture of every student,
        logging in seconds, positives &amp; houses, and teacher-reviewed (never auto-sent) notes home. Only
        <span className="font-medium"> @{domain}</span> addresses can be invited.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <textarea value={emails} onChange={(e) => setEmails(e.target.value)}
        rows={2} placeholder="emails, or 'Name <email>' — commas, spaces or new lines" className={`mt-2 ${inputCls}`} />
      {(() => {
        const parsed: string[] = emails.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || [];
        if (!parsed.length) return null;
        const ok = parsed.filter((e) => e.toLowerCase().split("@")[1] === domain.toLowerCase());
        const outside = parsed.filter((e) => e.toLowerCase().split("@")[1] !== domain.toLowerCase());
        return (
          <p className="mt-1 text-xs text-slate-500">
            <span className="text-green-700">{ok.length} valid</span>
            {outside.length > 0 && <span className="text-red-600"> · {outside.length} outside @{domain}: {outside.join(", ")}</span>}
          </p>
        );
      })()}
      <div className="mt-2 flex items-center gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
          <option value="teacher">Teacher</option>
          <option value="principal">Principal (read-only)</option>
          {isOriginator && <option value="admin">Admin</option>}
        </select>
        <button onClick={send} disabled={busy || !emails.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40">
          {busy ? "Sending…" : "Invite"}
        </button>
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

  // Generate the template in-browser so it always matches the columns the
  // importer accepts (including House). Quotes any cell with a comma.
  function downloadTemplate() {
    const headers = [
      "Last name", "First name", "Common/preferred name", "Gender", "Class/Group", "Grade", "House", "DOB",
      "Parent 1 name", "Parent 1 email", "Parent 1 Edsby ID",
      "Parent 2 name", "Parent 2 email", "Parent 2 Edsby ID",
    ];
    const rows = [
      ["Smith", "Jonathan", "Jon", "M", "7A", "7", "Phoenix", "2013-04-01", "Jane Smith", "jane.smith@example.org", "", "John Smith", "john.smith@example.org", ""],
      ["Patel", "Aisha", "", "F", "7A", "7", "Dragon", "2013-09-12", "Raj Patel", "raj.patel@example.org", "", "", "", ""],
    ];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "behaviours-roster-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <h2 id="roster" className="font-semibold">Import roster (CSV or XLSX)</h2>
      <p className="mt-1 text-sm text-slate-500">
        Columns: Last name, First name, Common/preferred name, Gender, Class/Group, Grade, House, DOB,
        Parent 1/2 name + email + Edsby ID. Only Last/First name are required; House matches or creates a
        house. The ethnicity field is dropped automatically.
      </p>
      <button
        type="button"
        onClick={downloadTemplate}
        className="mt-2 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
      >
        ⬇ Download template (CSV)
      </button>
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
            Imported {result.imported}, updated {result.updated}, skipped {result.skipped?.length || 0}
            {result.housesCreated ? `, created ${result.housesCreated} house${result.housesCreated === 1 ? "" : "s"}` : ""}.
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

// A ready-to-adapt userscript (Tampermonkey/Violentmonkey) that reads the page's
// Edsby identifiers and POSTs them to the ingest endpoint. The cookie line uses
// document.cookie — swap in your own accessor if your cookie is HttpOnly.
function ingestSnippet(apiBase: string, token: string) {
  return `// ==UserScript==
// @name         Push Edsby creds → Behaviours
// @match        https://*.edsby.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==
(function () {
  var cf = window._cf || {};
  var payload = {
    cookie:  document.cookie,                              // ← replace with your cookie accessor
    formkey: cf.formkey || "",
    userNid: (cf.user && cf.user.nid) || "",
    jver:    cf.jver || (document.documentElement.outerHTML.match(/_i=([A-Za-z0-9._-]+)/) || [])[1] || "",
    cver:    cf.cver || ""
  };
  GM_xmlhttpRequest({
    method: "POST",
    url: "${apiBase}/api/behavior/edsby/ingest",
    headers: { "Content-Type": "application/json", "x-ingest-token": "${token}" },
    data: JSON.stringify(payload),
    onload: function (r) { console.log("Behaviours ingest:", r.status, r.responseText); }
  });
})();`;
}

function AdminDigestSettings({ config, myEmail }: { config: any; myEmail: string }) {
  const d = config?.adminDigest || {};
  const [enabled, setEnabled] = useState<boolean>(!!d.enabled);
  const [recipient, setRecipient] = useState<string>(d.recipientEmail || "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveCfg(next: { enabled?: boolean; recipientEmail?: string }) {
    const adminDigest = { enabled, recipientEmail: recipient, ...next };
    setEnabled(adminDigest.enabled);
    setRecipient(adminDigest.recipientEmail);
    try { await api("/config", { method: "PUT", body: { adminDigest } }); } catch (e: any) { setMsg(`✗ ${e.message}`); }
  }
  async function sendNow() {
    setBusy(true); setMsg("");
    try {
      const r = await api<{ ok: boolean; to?: string[]; error?: string }>("/admin-digest", { body: { recipientEmail: recipient } });
      setMsg(r.ok ? `✓ Sent to ${(r.to || []).join(", ")}.` : `✗ ${r.error || "Failed"}`);
    } catch (e: any) { setMsg(`✗ ${e.message}`); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Weekly admin digest</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={enabled} onChange={(e) => saveCfg({ enabled: e.target.checked })} />
          {enabled ? "On" : "Off"}
        </label>
      </div>
      <p className="mt-1 text-sm text-slate-500">A Monday email to leadership: the week&apos;s offences/positives/notices, who&apos;s at or nearing a notice, students to get ahead of, and gentle suggestions for supporting staff.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} onBlur={(e) => saveCfg({ recipientEmail: e.target.value })}
          placeholder={`Send to (defaults to admins${myEmail ? `, e.g. ${myEmail}` : ""})`} className={`${inputCls} flex-1`} />
        <button onClick={sendNow} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {busy ? "Sending…" : "Send now"}
        </button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</p>}
    </Card>
  );
}

function RecommendedActionsSettings({ config }: { config: any }) {
  const [ladder, setLadder] = useState<{ noticeNumber: number; action: string }[]>(
    (config?.consequenceLadder || []).map((l: any) => ({ noticeNumber: l.noticeNumber, action: l.action }))
  );
  // Pre-fill the approved list with the recommended defaults when the school
  // hasn't set its own yet, so it's present without typing.
  const [whitelistText, setWhitelistText] = useState<string>(
    (config?.consequenceWhitelist && config.consequenceWhitelist.length ? config.consequenceWhitelist : RECOMMENDED_CONSEQUENCES).join("\n")
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Mark unsaved changes (skip the initial render).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setDirty(true);
    setSaved(false);
  }, [ladder, whitelistText]);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const clean = ladder.filter((l) => l.noticeNumber && l.action.trim()).map((l) => ({ noticeNumber: Number(l.noticeNumber), action: l.action.trim() }));
      const whitelist = whitelistText.split("\n").map((s) => s.trim()).filter(Boolean);
      await api("/config", { method: "PUT", body: { consequenceLadder: clean, consequenceWhitelist: whitelist } });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Recommended actions (consequences)</h2>
      <p className="mt-1 text-sm text-slate-500">An objective ladder by notice number, plus the approved list the AI coach may suggest from. The AI never proposes anything outside this list.</p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      <p className="mt-3 text-sm font-medium text-slate-700">Escalation ladder</p>
      <div className="mt-1 space-y-1.5">
        {ladder.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Notice</span>
            <input type="number" min={1} value={l.noticeNumber} onChange={(e) => setLadder((p) => p.map((x, j) => (j === i ? { ...x, noticeNumber: Number(e.target.value) } : x)))} className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
            <span className="text-sm text-slate-400">→</span>
            <input value={l.action} onChange={(e) => setLadder((p) => p.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))} placeholder="e.g. White slip" className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
            <button onClick={() => setLadder((p) => p.filter((_, j) => j !== i))} className="text-xs text-red-600">remove</button>
          </div>
        ))}
        <button onClick={() => setLadder((p) => [...p, { noticeNumber: (p[p.length - 1]?.noticeNumber || 1) + 1, action: "" }])} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">+ add step</button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Approved consequences (the AI coach picks only from these)</p>
        <button onClick={() => setWhitelistText(RECOMMENDED_CONSEQUENCES.join("\n"))} className="shrink-0 text-xs text-slate-500 underline">Load recommended list</button>
      </div>
      <p className="text-xs text-slate-400">One per line. You don&apos;t need to say what merits each — the coach matches them to the behaviour. Where a line invites specifics (the line text + how many times, an essay word-count + topic, a reflection&apos;s verses), the coach fills those in by occurrence.</p>
      <textarea
        value={whitelistText}
        onChange={(e) => setWhitelistText(e.target.value)}
        rows={9}
        className={`${inputCls} mt-1 font-sans`}
        placeholder={"Lines (10×/20×/30×) — specify the line…\nEssay (150/200/350 words) on a relevant topic…\nApology letter…\nDetention\nWhite slip"}
      />

      <button
        onClick={save}
        disabled={busy || (!dirty && !saved)}
        className={`mt-3 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
          saved ? "bg-green-600" : dirty ? "bg-amber-600" : "bg-slate-900"
        }`}
      >
        {busy ? "Saving…" : saved ? "Saved ✓" : dirty ? "Save changes" : "Saved"}
      </button>
    </Card>
  );
}

function HomeworkSettings({ config }: { config: any }) {
  const hw = config?.homework || {};
  const dstr = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const [terms, setTerms] = useState<string[]>([dstr(hw.termStarts?.[0]), dstr(hw.termStarts?.[1]), dstr(hw.termStarts?.[2])]);
  const [currentTerm, setCurrentTerm] = useState<number>(hw.currentTerm ?? 0);
  const [lateWeeks, setLateWeeks] = useState<number>(hw.lateWeeks ?? 3);
  const [cooldown, setCooldown] = useState<number>(hw.messageCooldownDays ?? 7);
  const [below, setBelow] = useState<number>(hw.outstandingBelow ?? 6);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    try {
      const termStarts = terms.filter((t) => t).map((t) => new Date(t).toISOString());
      await api("/config", {
        method: "PUT",
        body: { homework: { ...hw, termStarts, currentTerm: Number(currentTerm), lateWeeks: Number(lateWeeks), messageCooldownDays: Number(cooldown), outstandingBelow: Number(below) } },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <Card>
      <h2 className="font-semibold">Homework</h2>
      <p className="mt-1 text-sm text-slate-500">Term dates power outstanding-work reminders (only the current + previous term show) and CSV export. Subjects are added from the Homework tab.</p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Field key={i} label={`Term ${i + 1} start`}>
            <input type="date" value={terms[i]} onChange={(e) => setTerms((t) => t.map((v, j) => (j === i ? e.target.value : v)))} className={inputCls} />
          </Field>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Field label="Current term">
          <select value={currentTerm} onChange={(e) => setCurrentTerm(Number(e.target.value))} className={inputCls}>
            <option value={0}>Term 1</option><option value={1}>Term 2</option><option value={2}>Term 3</option>
          </select>
        </Field>
        <Field label="“Older than” weeks → 6.2">
          <input type="number" min={1} value={lateWeeks} onChange={(e) => setLateWeeks(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Resend cooldown (days)">
          <input type="number" min={1} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="“Outstanding” if below (/10)">
          <input type="number" min={1} max={10} value={below} onChange={(e) => setBelow(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>
      <button onClick={save} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">{saved ? "Saved ✓" : "Save homework settings"}</button>
    </Card>
  );
}

function EdsbySection({ edsby }: { edsby: any }) {
  const [baseUrl, setBaseUrl] = useState(edsby?.baseUrl || "");
  const [userNid, setUserNid] = useState(edsby?.userNid || "");
  const [jver, setJver] = useState(edsby?.jver || "");
  const [cver, setCver] = useState(edsby?.cver || "");
  const [zoomId, setZoomId] = useState(edsby?.zoomId || "");
  const [cookie, setCookie] = useState("");
  const [formkey, setFormkey] = useState("");
  const [enabled, setEnabled] = useState(!!edsby?.enabled);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testToNid, setTestToNid] = useState("");
  const [testStudentNid, setTestStudentNid] = useState("");
  // Reflect "stored ✓" immediately after a save without needing a reload.
  const [cookieStored, setCookieStored] = useState(!!edsby?.cookieConfigured);
  const [formkeyStored, setFormkeyStored] = useState(!!edsby?.formkeyConfigured);
  const [detectMsg, setDetectMsg] = useState("");
  const [detectBusy, setDetectBusy] = useState(false);
  const [ingestToken, setIngestToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const ingestTokenSet = !!edsby?.ingestTokenSet || !!ingestToken;
  const cookieSet = cookieStored;
  const formkeySet = formkeyStored;

  // Collapsed by default (it's a long, set-once block). Auto-open when linked
  // to directly (e.g. /behavior/setup#edsby from the Avgs "Connect Edsby" CTA).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#edsby") setOpen(true);
  }, []);

  async function genIngestToken() {
    if (ingestTokenSet && !window.confirm("Generate a new token? Your existing script's token will stop working until you update it.")) return;
    setTokenBusy(true);
    try {
      const r = await api<{ token: string }>("/edsby/ingest-token", { body: {} });
      setIngestToken(r.token);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setTokenBusy(false);
    }
  }

  // One tap: auto-detect jver/cver and (if the cookie is stored) refresh the
  // formkey — pulling whatever is missing/stale.
  async function refreshEdsby() {
    setDetectBusy(true);
    setDetectMsg("");
    try {
      const r = await api<{
        ok: boolean; jver?: string; cver?: string; updated?: string[];
        formkeyOk?: boolean | null; formkeyError?: string; notes?: string[]; error?: string;
      }>("/edsby/refresh", { body: { baseUrl: baseUrl.trim() } });
      if (!r.ok) { setDetectMsg(`✗ ${r.error || "Refresh failed"}`); return; }
      if (r.jver) setJver(r.jver);
      if (r.cver) setCver(r.cver);
      if (r.updated?.includes("formkey")) setFormkeyStored(true);
      const parts: string[] = [];
      if (r.updated?.length) parts.push(`Updated: ${r.updated.join(", ")}`);
      if (r.formkeyOk === false && r.formkeyError) parts.push(`formkey: ${r.formkeyError}`);
      if (r.notes?.length) parts.push(r.notes.join("; "));
      const good = (r.updated?.length || 0) > 0 && r.formkeyOk !== false;
      setDetectMsg(`${good ? "✓" : "•"} ${parts.join(" · ") || "Nothing to update."}`);
    } catch (e: any) {
      setDetectMsg(`✗ ${e.message}`);
    } finally {
      setDetectBusy(false);
    }
  }

  async function testEdsby() {
    setTestBusy(true);
    setTestMsg("");
    try {
      const r = await api<{ ok: boolean; message?: string; error?: string }>("/test-edsby", { body: {} });
      setTestMsg(r.ok ? `✓ ${r.message || "Connected."}` : `✗ ${r.error || "Failed"}`);
    } catch (e: any) {
      setTestMsg(`✗ ${e.message}`);
    } finally {
      setTestBusy(false);
    }
  }

  async function testEdsbySend() {
    setTestBusy(true);
    setTestMsg("");
    try {
      const body: any = {};
      if (testToNid.trim()) body.toNid = testToNid.trim();
      if (testStudentNid.trim()) body.studentNid = testStudentNid.trim();
      const r = await api<{ ok: boolean; error?: string }>("/test-edsby-send", { body });
      setTestMsg(r.ok ? "✓ Test broadcast posted — check Edsby messages." : `✗ ${r.error || "Failed"}`);
    } catch (e: any) {
      setTestMsg(`✗ ${e.message}`);
    } finally {
      setTestBusy(false);
    }
  }

  async function save() {
    setErr(null);
    try {
      const body: any = { baseUrl: baseUrl.trim(), userNid: userNid.trim(), jver: jver.trim(), cver: cver.trim(), zoomId: zoomId.trim(), enabled };
      const sentCookie = !!cookie.trim();
      const sentFormkey = !!formkey.trim();
      if (sentCookie) body.cookie = cookie.trim();
      if (sentFormkey) body.formkey = formkey.trim();
      await api("/config/edsby", { method: "PUT", body });
      setCookie("");
      setFormkey("");
      if (sentCookie) setCookieStored(true);
      if (sentFormkey) setFormkeyStored(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
        <h2 id="edsby" className="scroll-mt-20 font-semibold">Edsby connection</h2>
        <span className="flex items-center gap-2 text-sm text-slate-400">
          <span className={`rounded-full px-2 py-0.5 text-xs ${enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{enabled ? "on" : "off"}</span>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {!open && <p className="mt-1 text-sm text-slate-400">Post notices over your school&apos;s Edsby session. Tap to configure.</p>}
      {open && (<>
      <p className="mt-1 text-sm text-slate-500">
        Edsby has no public API, so notices are posted using your school&apos;s signed-in session — each
        parent messaged separately via their Edsby nid. The cookie + formkey are stored <span className="font-medium">encrypted</span> and never shown again.
        Set the base URL, paste the cookie once, then hit <span className="font-medium">Refresh from Edsby</span> — it pulls
        jver/cver and refreshes the formkey. The cookie itself can&apos;t be fetched for you (browsers block reading another
        site&apos;s session), so it stays a manual paste.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Edsby base URL">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://yourschool.edsby.com" className={inputCls} />
        </Field>
        <Field label="Your Edsby user nid (the sender)">
          <input value={userNid} onChange={(e) => setUserNid(e.target.value)} placeholder="your own nid — notices are sent as you" className={inputCls} />
        </Field>
        <Field label="jver (bundle compiled hash)">
          <input value={jver} onChange={(e) => setJver(e.target.value)} className={inputCls} />
        </Field>
        <Field label="cver (bundle version)">
          <input value={cver} onChange={(e) => setCver(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Zoom/class id (for formkey refresh)">
          <input value={zoomId} onChange={(e) => setZoomId(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={refreshEdsby} disabled={detectBusy || !baseUrl.trim()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40">
          {detectBusy ? "Refreshing…" : "Refresh from Edsby (jver/cver + formkey)"}
        </button>
        {detectMsg && <span className={`text-xs ${detectMsg.startsWith("✓") ? "text-green-700" : detectMsg.startsWith("✗") ? "text-red-600" : "text-slate-500"}`}>{detectMsg}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Can&apos;t find jver/cver by hand? In DevTools → Network, click any{" "}
        <code className="rounded bg-slate-100 px-1">?xds=Panorama</code> request → <span className="font-medium">Headers → Request Headers</span>
        {" "}→ copy <code className="rounded bg-slate-100 px-1">x-xds-jver</code> and <code className="rounded bg-slate-100 px-1">x-xds-cver</code>. (jver is also the
        {" "}<code className="rounded bg-slate-100 px-1">_i=</code> hash on engine.min.js.)
      </p>
      <Field label={`Session cookie ${cookieSet ? "(stored ✓ — blank keeps it)" : ""}`}>
        <textarea value={cookie} onChange={(e) => setCookie(e.target.value)} rows={2}
          placeholder={cookieSet ? "•••••••• (already saved)" : "paste the Edsby session cookie"} className={inputCls} />
      </Field>
      <details className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">How to copy the session cookie from DevTools</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Sign in to <span className="font-medium">Edsby</span> in a browser tab.</li>
          <li>Open DevTools (<span className="font-mono">F12</span>, or <span className="font-mono">⌥⌘I</span> on Mac) → <span className="font-medium">Network</span> tab.</li>
          <li>Reload the page; in the filter box type <code className="rounded bg-slate-100 px-1">xds</code>, then click any <code className="rounded bg-slate-100 px-1">?xds=Panorama</code> request.</li>
          <li>Open <span className="font-medium">Headers → Request Headers</span> and find the <code className="rounded bg-slate-100 px-1">Cookie:</code> line.</li>
          <li>Copy <span className="font-medium">everything after</span> <code className="rounded bg-slate-100 px-1">Cookie:</code> and paste it above, then <span className="font-medium">Save</span>.</li>
        </ol>
        <p className="mt-2 text-slate-400">
          The app can&apos;t grab this for you — browsers block one site from reading another&apos;s session cookie. You only
          need to redo it when sends start failing over to email (the cookie expires every so often).
        </p>
      </details>

      <details className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">Keep the cookie fresh automatically (recommended)</summary>
        <p className="mt-2">
          Install our small browser extension and it pushes a fresh Edsby cookie to the app on every login/refresh —
          no more DevTools, no expiry surprises. Works in Chrome, Edge, and Vivaldi.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={genIngestToken} disabled={tokenBusy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-40">
            {tokenBusy ? "Generating…" : ingestTokenSet ? "Regenerate token" : "1. Generate token"}
          </button>
          {ingestToken && <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{ingestToken}</code>}
          {!ingestToken && ingestTokenSet && <span className="text-slate-400">A token already exists (hidden) — regenerate to see a new one.</span>}
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Generate the token above and copy it.</li>
          <li><a href="/behaviours-edsby-cookie-sync.zip" download className="text-slate-700 underline">Download the extension</a>, unzip it (you&apos;ll get a <code className="rounded bg-slate-100 px-1">behaviours-edsby-cookie-sync</code> folder), then in <code className="rounded bg-slate-100 px-1">chrome://extensions</code> turn on Developer mode → <span className="font-medium">Load unpacked</span> → pick that folder.</li>
          <li>Open the extension&apos;s Options, enter <span className="font-medium">your Edsby host</span> and paste the token, then <span className="font-medium">Push current cookie now</span>.</li>
        </ol>
        <p className="mt-2 text-slate-400">The token is the credential — keep it secret. Regenerating it here revokes the old one (update the extension afterwards).</p>
      </details>

      <details className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">Push from your own script instead (advanced)</summary>
        <p className="mt-2">
          Prefer your own userscript? Generate the token above, then POST the creds to the endpoint below. The token is
          the auth (header <code className="rounded bg-slate-100 px-1">x-ingest-token</code>); it accepts any of cookie, formkey, jver, cver, userNid, zoomId, baseUrl.
        </p>
        {ingestToken && (
          <>
            <p className="mt-2">Endpoint: <code className="rounded bg-slate-100 px-1">{API_BASE}/api/behavior/edsby/ingest</code></p>
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{ingestSnippet(API_BASE, ingestToken)}</pre>
            <button type="button" onClick={() => navigator.clipboard?.writeText(ingestSnippet(API_BASE, ingestToken))}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-1 text-xs">Copy script</button>
          </>
        )}
        <p className="mt-2 text-slate-400">
          The app only reads what you POST — any of cookie, formkey, jver, cver, userNid, zoomId, baseUrl. Send the cookie
          using your script&apos;s own accessor (replace the <code className="rounded bg-slate-100 px-1">document.cookie</code> line).
        </p>
      </details>
      <Field label={`Formkey (CSRF) ${formkeySet ? "(stored ✓ — blank keeps it)" : ""}`}>
        <input value={formkey} onChange={(e) => setFormkey(e.target.value)}
          placeholder={formkeySet ? "•••••••• (already saved)" : "the _formkey from a logged-in page"} className={inputCls} />
      </Field>
      <label className="mt-1 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Send notices via Edsby
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={save} className="rounded-lg bg-slate-900 px-4 py-2 text-white">
          {saved ? "Saved ✓" : "Save Edsby connection"}
        </button>
        <button onClick={testEdsby} disabled={testBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {testBusy ? "Testing…" : "Test connection"}
        </button>
        <button onClick={testEdsbySend} disabled={testBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {testBusy ? "…" : "Send test broadcast"}
        </button>
      </div>
      {testMsg && <p className={`mt-2 text-sm ${testMsg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{testMsg}</p>}
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-medium text-slate-700">Test recipient</p>
        <p className="mt-0.5">
          Sends the test <span className="font-medium">to</span> this person (you can delete it after). A colleague&apos;s Edsby ID works
          for a quick check; a real parent notice uses the parent&apos;s nid with the student&apos;s nid as context. Leave the colleague
          field blank to send to yourself — Edsby returns 1042 “Cannot link nodes” for self-sends, which is expected, not a fault.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input value={testToNid} onChange={(e) => setTestToNid(e.target.value)} placeholder="Colleague's (or parent's) Edsby ID" className={inputCls} />
          <input value={testStudentNid} onChange={(e) => setTestStudentNid(e.target.value)} placeholder="Student nid (context, optional)" className={inputCls} />
        </div>
      </div>
      <p className="mt-2 text-xs text-amber-700">
        The cookie + formkey expire periodically — when Edsby sends start failing over to email, re-paste them.
        Parent Edsby nids still need harvesting from Edsby (next step).
      </p>
      <MyEdsbyCard embedded />
      </>)}
    </Card>
  );
}

function HousesSection({ config }: { config?: any }) {
  const [enabled, setEnabled] = useState(!!config?.housesEnabled);
  const [houses, setHouses] = useState<any[] | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0f172a");
  const [err, setErr] = useState<string | null>(null);

  async function toggleEnabled(on: boolean) {
    setEnabled(on);
    try {
      await api("/config", { method: "PUT", body: { housesEnabled: on } });
      if (on) load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  // House standings report (opt-in).
  const [reportOn, setReportOn] = useState(!!config?.houseReport?.enabled);
  const [recipient, setRecipient] = useState(config?.houseReport?.recipientEmail || "");
  const [reportMsg, setReportMsg] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  // Balanced auto-assign.
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState("");

  // Student portal code.
  const [portalCode, setPortalCode] = useState(config?.housePortalCode || "");
  const [portalInput, setPortalInput] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalMsg, setPortalMsg] = useState("");

  async function setPortalCodeTo(custom?: string) {
    if (portalCode && !custom && !window.confirm("Generate a new random code? The current one will stop working for students.")) return;
    setPortalBusy(true);
    setPortalMsg("");
    try {
      const r = await api<{ code: string }>("/houses/portal-code", { body: custom ? { code: custom } : {} });
      setPortalCode(r.code);
      setPortalInput("");
      setEnabled(true);
    } catch (e: any) {
      setPortalMsg(e.message);
    } finally {
      setPortalBusy(false);
    }
  }

  // Term reset (only points after this date count toward standings).
  const [resetAt, setResetAt] = useState<string | null>(config?.housePointsResetAt || null);
  const [resetBusy, setResetBusy] = useState(false);

  // Captains: full roster so we can pick per-house leaders.
  const [roster, setRoster] = useState<any[] | null>(null);
  function loadRoster() {
    api<{ students: any[] }>("/students").then((d) => setRoster(d.students || [])).catch(() => setRoster([]));
  }

  async function setCaptain(studentId: string, on: boolean) {
    setRoster((prev) => (prev || []).map((s) => (s._id === studentId ? { ...s, houseCaptain: on } : s)));
    try { await api(`/students/${studentId}`, { method: "PATCH", body: { houseCaptain: on } }); }
    catch (e: any) { setErr(e.message); loadRoster(); }
  }

  async function startNewTerm() {
    if (!window.confirm("Start a new term? House standings reset to zero from now — earlier points are kept in history but stop counting toward the leaderboard and competitions.")) return;
    setResetBusy(true);
    try {
      const now = new Date().toISOString();
      await api("/config", { method: "PUT", body: { housePointsResetAt: now } });
      setResetAt(now);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setResetBusy(false); }
  }
  async function clearTermReset() {
    if (!window.confirm("Count ALL house points again (since the start)? This undoes the term reset.")) return;
    setResetBusy(true);
    try {
      await api("/config", { method: "PUT", body: { housePointsResetAt: null } });
      setResetAt(null);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setResetBusy(false); }
  }

  function load() {
    api<{ houses: any[] }>("/houses").then((d) => setHouses(d.houses || [])).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); loadRoster(); }, []);

  async function backfill(mode: "full" | "unassigned") {
    const confirmMsg = mode === "unassigned"
      ? "Assign only students who don't have a house yet, fitting them into the existing houses (siblings join their family's house)? Current assignments stay."
      : "Create Alpha/Beta/Delta/Gamma and assign ALL active students into a balanced mix (siblings by last name stay together)? This replaces any current house assignments and turns Houses on.";
    if (!window.confirm(confirmMsg)) return;
    setBackfillBusy(true);
    setBackfillMsg("");
    try {
      const r = await api<{ assigned: number; skipped: number; houses: { name: string; total: number; byGrade: Record<string, number>; byGender: Record<string, number> }[] }>(
        "/houses/backfill", { body: mode === "unassigned" ? { mode: "unassigned" } : {} }
      );
      setEnabled(true);
      const lines = r.houses.map((h) => {
        const g = Object.entries(h.byGender).map(([k, v]) => `${k}:${v}`).join(" ");
        return `${h.name}: ${h.total} (${g})`;
      });
      const head = mode === "unassigned" ? `Placed ${r.assigned} new students (${r.skipped} already assigned)` : `Assigned ${r.assigned} students`;
      setBackfillMsg(`✓ ${head} — ${lines.join(" · ")}`);
      load();
    } catch (e: any) {
      setBackfillMsg(`✗ ${e.message}`);
    } finally {
      setBackfillBusy(false);
    }
  }

  async function saveReportConfig(next: { enabled?: boolean; recipientEmail?: string }) {
    const houseReport = { enabled: reportOn, recipientEmail: recipient, ...next };
    setReportOn(houseReport.enabled);
    setRecipient(houseReport.recipientEmail);
    try { await api("/config", { method: "PUT", body: { houseReport } }); } catch (e: any) { setErr(e.message); }
  }
  async function sendReport() {
    setReportBusy(true);
    setReportMsg("");
    try {
      const r = await api<{ emailed: boolean; emailError?: string; report: any[] }>("/house-report", { body: { email: true } });
      setReportMsg(r.emailed ? `Sent to ${recipient || "you"}.` : `Send failed: ${r.emailError || "check email settings"}`);
    } catch (e: any) {
      setReportMsg(e.message);
    } finally {
      setReportBusy(false);
    }
  }

  async function add() {
    if (!name.trim()) return;
    try {
      await api("/houses", { body: { name: name.trim(), color } });
      setName("");
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function save(h: any, patch: any) {
    try { await api(`/houses/${h._id}`, { method: "PUT", body: patch }); load(); } catch (e: any) { setErr(e.message); }
  }
  async function remove(h: any) {
    if (!window.confirm(`Remove house "${h.name}"? (students keep their assignment; points are hidden)`)) return;
    try { await api(`/houses/${h._id}`, { method: "DELETE" }); load(); } catch (e: any) { setErr(e.message); }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Houses</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
          {enabled ? "On" : "Off"}
        </label>
      </div>
      {!enabled && (
        <p className="mt-1 text-sm text-slate-500">
          Houses are off. Turn them on to define houses, set point values on behaviours, assign students, and show the
          leaderboard. While off, the whole House aspect is hidden across the app.
        </p>
      )}
      {enabled && (
        <>
      <p className="mt-1 text-sm text-slate-500">Define houses, then assign students (below) and set point values per behaviour. Points show on the dashboard leaderboard.</p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 space-y-2">
        {houses?.map((h) => (
          <div key={h._id} className="flex items-center gap-2">
            <input type="color" defaultValue={h.color} onBlur={(e) => save(h, { color: e.target.value })} className="h-8 w-10 rounded border border-slate-300" />
            <input defaultValue={h.name} onBlur={(e) => e.target.value.trim() && save(h, { name: e.target.value })} className={`${inputCls} flex-1`} />
            <span className="w-24 text-right text-xs text-slate-400">{h.members} students · {h.points} pts</span>
            <button onClick={() => remove(h)} className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700">Remove</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 rounded border border-slate-300" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New house name…" className={`${inputCls} flex-1`} />
        <button onClick={add} disabled={!name.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">Add house</button>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">Quick start: balanced auto-assign</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Creates Alpha / Beta / Delta / Gamma and sorts all students into a balanced mix of grade and gender, keeping
          same-last-name students (siblings) together. Replaces current assignments — you can hand-tune after.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => backfill("full")} disabled={backfillBusy}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40">
            {backfillBusy ? "Working…" : "Auto-assign all students to 4 houses"}
          </button>
          <button onClick={() => backfill("unassigned")} disabled={backfillBusy}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40">
            Rebalance only unassigned
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">Use “Rebalance only unassigned” after a mid-year roster import to slot new students into the existing houses without reshuffling everyone.</p>
        {backfillMsg && <p className={`mt-2 text-xs ${backfillMsg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{backfillMsg}</p>}
      </div>

      {/* Student portal code */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">Student leaderboard portal</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Students see live standings at <span className="font-mono">curriculate.net/houses</span> by entering this code (house
          totals only — no student names). Share it; rotate it any time.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {portalCode && <span className="rounded-lg bg-white px-3 py-1.5 font-mono text-lg tracking-widest">{portalCode}</span>}
          <button onClick={() => setPortalCodeTo()} disabled={portalBusy} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40">
            {portalBusy ? "…" : portalCode ? "Random" : "Generate code"}
          </button>
          {portalCode && <a href="/houses" target="_blank" rel="noreferrer" className="text-xs text-slate-500 underline">open the portal ↗</a>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={portalInput}
            onChange={(e) => setPortalInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="set your own (e.g. 1977)"
            className="w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button onClick={() => setPortalCodeTo(portalInput)} disabled={portalBusy || portalInput.length < 3}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">
            Set code
          </button>
          {portalMsg && <span className="text-xs text-red-600">{portalMsg}</span>}
        </div>
      </div>

      {/* House captains */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">House captains</p>
        <p className="mt-0.5 text-xs text-slate-500">Mark a student leader for each house. Captains show on the standings report and the student portal (first name + last initial only).</p>
        {roster === null ? (
          <p className="mt-2 text-xs text-slate-400">Loading roster…</p>
        ) : (
          <div className="mt-2 space-y-3">
            {(houses || []).map((h) => {
              const members = roster.filter((s) => String(s.houseId) === String(h._id));
              const caps = members.filter((s) => s.houseCaptain);
              const nonCaps = members.filter((s) => !s.houseCaptain);
              return (
                <div key={h._id}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: h.color || "#0f172a" }} />
                    {h.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {caps.map((s) => (
                      <button key={s._id} onClick={() => setCaptain(s._id, false)}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
                        © {s.preferredName || s.firstName} {s.lastName} <span className="text-slate-400">✕</span>
                      </button>
                    ))}
                    {caps.length === 0 && <span className="text-xs text-slate-400">No captains yet.</span>}
                    {nonCaps.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) setCaptain(e.target.value, true); }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-xs"
                      >
                        <option value="">+ add captain…</option>
                        {nonCaps
                          .slice()
                          .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
                          .map((s) => (
                            <option key={s._id} value={s._id}>{s.lastName}, {s.firstName}{s.preferredName ? ` (${s.preferredName})` : ""}</option>
                          ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
            {(houses || []).length === 0 && <p className="text-xs text-slate-400">Define houses first.</p>}
          </div>
        )}
      </div>

      {/* Term / seasonal reset */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">Term standings</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {resetAt
            ? <>Standings count points earned since <span className="font-medium">{new Date(resetAt).toLocaleDateString()}</span>. Earlier points are kept in history.</>
            : "All points since the start currently count toward the leaderboard."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={startNewTerm} disabled={resetBusy}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40">
            {resetBusy ? "…" : "Start a new term (reset standings)"}
          </button>
          {resetAt && (
            <button onClick={clearTermReset} disabled={resetBusy}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40">
              Count all points again
            </button>
          )}
        </div>
      </div>

      {/* House standings report */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={reportOn} onChange={(e) => saveReportConfig({ enabled: e.target.checked })} className="mt-0.5" />
          <span>
            <span className="font-medium">House standings report</span> — an email with each house&apos;s total and its
            top&nbsp;3 contributing students. Send it on demand below.
          </span>
        </label>
        {reportOn && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onBlur={(e) => saveReportConfig({ recipientEmail: e.target.value })}
              placeholder="Send to (defaults to you)"
              className={`${inputCls} flex-1`}
            />
            <button onClick={sendReport} disabled={reportBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
              {reportBusy ? "Sending…" : "Send report now"}
            </button>
          </div>
        )}
        {reportMsg && <p className="mt-2 text-sm text-green-700">{reportMsg}</p>}
      </div>
        </>
      )}
    </Card>
  );
}

function AddStudentSection() {
  const [f, setF] = useState({ firstName: "", lastName: "", preferredName: "", classGroup: "", grade: "", p1: "", p2: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!f.firstName.trim() && !f.lastName.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg("");
    try {
      const parents = [f.p1, f.p2].filter((e) => e.trim()).map((email) => ({ email: email.trim() }));
      await api("/students", {
        body: {
          firstName: f.firstName.trim(), lastName: f.lastName.trim(), preferredName: f.preferredName.trim(),
          classGroup: f.classGroup.trim(), grade: f.grade.trim() || f.classGroup.replace(/[^0-9]/g, ""), parents,
        },
      });
      setMsg(`Added ${f.firstName} ${f.lastName}.`);
      setF({ firstName: "", lastName: "", preferredName: "", classGroup: "", grade: "", p1: "", p2: "" });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Add a student (mid-year)</h2>
      <p className="mt-1 text-sm text-slate-500">
        For one-off additions. For the new year, just re-import the whole roster — it updates each student&apos;s grade/class
        and adds anyone new (it won&apos;t remove students who left; delete those below).
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} placeholder="First name" className={inputCls} />
        <input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder="Last name" className={inputCls} />
        <input value={f.preferredName} onChange={(e) => setF({ ...f, preferredName: e.target.value })} placeholder="Preferred name (optional)" className={inputCls} />
        <input value={f.classGroup} onChange={(e) => setF({ ...f, classGroup: e.target.value })} placeholder="Class (e.g. 7A)" className={inputCls} />
        <input value={f.p1} onChange={(e) => setF({ ...f, p1: e.target.value })} placeholder="Parent 1 email" className={inputCls} />
        <input value={f.p2} onChange={(e) => setF({ ...f, p2: e.target.value })} placeholder="Parent 2 email (optional)" className={inputCls} />
      </div>
      <button onClick={add} disabled={busy || (!f.firstName.trim() && !f.lastName.trim())}
        className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40">
        {busy ? "Adding…" : "Add student"}
      </button>
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
  const [houses, setHouses] = useState<any[]>([]);
  const [testEmailMsg, setTestEmailMsg] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [sampleHtml, setSampleHtml] = useState("");
  const [sampleKind, setSampleKind] = useState<"negative" | "positive">("negative");
  const [sampleMsg, setSampleMsg] = useState("");
  const [sampleBusy, setSampleBusy] = useState(false);

  useEffect(() => { api<{ houses: any[] }>("/houses").then((d) => setHouses(d.houses || [])).catch(() => {}); }, []);

  async function previewSample(kind: "negative" | "positive", email = false) {
    setSampleBusy(true);
    setSampleMsg("");
    setSampleKind(kind);
    try {
      const r = await api<{ html: string; emailed: boolean; emailError?: string }>("/test-notice", { body: { kind, email } });
      setSampleHtml(r.html || "");
      if (email) setSampleMsg(r.emailed ? "✓ Sample emailed to you — check your inbox." : `✗ ${r.emailError || "send failed"}`);
    } catch (e: any) {
      setSampleMsg(`✗ ${e.message}`);
    } finally {
      setSampleBusy(false);
    }
  }

  async function setHouse(s: any, houseId: string) {
    try {
      await api(`/students/${s._id}`, { method: "PATCH", body: { houseId: houseId || null } });
      setResults(results.map((x) => (x._id === s._id ? { ...x, houseId: houseId || null } : x)));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function sendTestEmail() {
    setTestBusy(true);
    setTestEmailMsg("");
    try {
      const r = await api<{ ok: boolean; to: string; error?: string; fromConfigured: boolean }>("/test-email", { body: { to: email } });
      setTestEmailMsg(
        r.ok
          ? `✓ Sent to ${r.to} — check your inbox (and spam).`
          : `✗ Failed: ${r.error}${r.fromConfigured ? "" : " (no SMTP sender configured on the server)"}`
      );
    } catch (e: any) {
      setTestEmailMsg(`✗ ${e.message}`);
    } finally {
      setTestBusy(false);
    }
  }

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
      // includeInactive so deactivated students show up (to reactivate them).
      const d = await api<{ students: any[] }>(`/students?includeInactive=1&query=${encodeURIComponent(q.trim())}`);
      setResults(d.students || []);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function setActive(s: any, active: boolean) {
    try {
      await api(`/students/${s._id}`, { method: "PATCH", body: { active } });
      setResults(results.map((x) => (x._id === s._id ? { ...x, active } : x)));
      setMsg(`${active ? "Reactivated" : "Deactivated"} ${s.firstName} ${s.lastName}.`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function del(s: any) {
    if (!window.confirm(`PERMANENTLY delete ${s.firstName} ${s.lastName} and ALL their incidents/notices? This cannot be undone. (To just remove a student who left, use Deactivate instead.)`)) return;
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
        <p className="text-sm font-medium text-slate-700">Email delivery</p>
        <button onClick={sendTestEmail} disabled={testBusy}
          className="mt-2 rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40">
          {testBusy ? "Sending…" : `Send test email to ${email}`}
        </button>
        {testEmailMsg && <p className={`mt-2 text-sm ${testEmailMsg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{testEmailMsg}</p>}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-sm font-medium text-slate-700">Preview a sample notice</p>
        <p className="mt-0.5 text-xs text-slate-500">See exactly what a family receives, with your branding &amp; signature. Nothing is logged or sent to a parent.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => previewSample("negative")} disabled={sampleBusy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
            {sampleBusy && sampleKind === "negative" ? "…" : "Preview notice"}
          </button>
          <button onClick={() => previewSample("positive")} disabled={sampleBusy}
            className="rounded-lg border border-green-300 px-3 py-1.5 text-sm text-green-700 disabled:opacity-40">
            {sampleBusy && sampleKind === "positive" ? "…" : "Preview good-news note"}
          </button>
          {sampleHtml && (
            <button onClick={() => previewSample(sampleKind, true)} disabled={sampleBusy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
              Email this sample to me
            </button>
          )}
        </div>
        {sampleMsg && <p className={`mt-2 text-sm ${sampleMsg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{sampleMsg}</p>}
        {sampleHtml && (
          <iframe
            title="Sample notice preview"
            srcDoc={sampleHtml}
            className="mt-3 h-[460px] w-full rounded-lg border border-slate-200 bg-white"
          />
        )}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-sm font-medium text-slate-700">Manage / remove a student</p>
        <p className="text-xs text-slate-400">Deactivate hides a student who left (keeps their history). Delete is permanent.</p>
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
            <li key={s._id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {s.lastName}, {s.firstName} <span className="text-slate-400">{[s.classGroup, s.grade].filter(Boolean).join(" · ")}</span>
                {s.active === false && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-500">deactivated</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {houses.length > 0 && (
                  <select value={s.houseId || ""} onChange={(e) => setHouse(s, e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
                    <option value="">No house</option>
                    {houses.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
                  </select>
                )}
                {s.active === false ? (
                  <button onClick={() => setActive(s, true)} className="rounded-lg border border-green-300 px-3 py-1 text-xs text-green-700">Reactivate</button>
                ) : (
                  <button onClick={() => setActive(s, false)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">Deactivate</button>
                )}
                <button onClick={() => del(s)} className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700">Delete</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
        {label}
        {hint && (
          <span title={hint} className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">i</span>
        )}
      </span>
      {children}
    </label>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}

// Every member (teachers included) can set their OWN Edsby identity so notices
// post AS them. They enter their Edsby user nid + paste their session cookie;
// jver/cver/base URL come from the school connection an admin set up.
function MyEdsbyCard({ embedded = false }: { embedded?: boolean }) {
  const [state, setState] = useState<{ userNid: string; hasCookie: boolean; baseUrl: string; edsbyEnabled: boolean } | null>(null);
  const [userNid, setUserNid] = useState("");
  const [cookie, setCookie] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ userNid: string; hasCookie: boolean; baseUrl: string; edsbyEnabled: boolean }>("/my-edsby")
      .then((d) => { setState(d); setUserNid(d.userNid || ""); })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body: any = { userNid };
      if (cookie.trim()) body.cookie = cookie.trim();
      const r = await api<{ userNid: string; hasCookie: boolean }>("/my-edsby", { method: "PUT", body });
      setState((s) => s && { ...s, userNid: r.userNid, hasCookie: r.hasCookie });
      setCookie("");
      setMsg("Saved ✓");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/my-edsby", { method: "PUT", body: { clear: true } });
      setState((s) => s && { ...s, userNid: "", hasCookie: false });
      setUserNid("");
      setCookie("");
      setMsg("Disconnected — your notices will use the school connection.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const Wrap = embedded
    ? ({ children }: { children: React.ReactNode }) => <div className="mt-4 border-t border-slate-200 pt-4">{children}</div>
    : Card;

  return (
    <Wrap>
      <h2 className="font-semibold">My Edsby (post as me)</h2>
      <p className="mt-1 text-sm text-slate-500">
        So your notices home post from <em>your</em> Edsby account. Enter your Edsby user nid and paste your
        session cookie. The base URL and version headers come from the school connection.
        {!state.edsbyEnabled && " (Edsby sending isn't enabled for your school yet — an admin sets that up.)"}
        {" "}Leave this blank to send through the school's shared Edsby account instead.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Your Edsby user nid (the sender)">
          <input value={userNid} onChange={(e) => setUserNid(e.target.value)} inputMode="numeric" placeholder="e.g. 25582870"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </Field>
        <Field label={`Session cookie ${state.hasCookie ? "(saved — blank keeps it)" : ""}`}>
          <input type="password" value={cookie} onChange={(e) => setCookie(e.target.value)}
            placeholder={state.hasCookie ? "•••••••• (already saved)" : "paste your Edsby cookie"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {busy ? "Saving…" : "Save my Edsby"}
        </button>
        {(state.userNid || state.hasCookie) && (
          <button onClick={disconnect} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
            Disconnect
          </button>
        )}
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">How to find your nid &amp; cookie</summary>
        <p className="mt-1">
          In Edsby, open DevTools (F12) → Network, click any <code className="rounded bg-slate-100 px-1">?xds=</code> request →
          Request Headers. Your <code className="rounded bg-slate-100 px-1">Cookie:</code> line is the session cookie (copy everything after
          <code className="rounded bg-slate-100 px-1">Cookie:</code>). Your user nid is the number in your own profile URL
          (<code className="rounded bg-slate-100 px-1">/p/Panorama/&lt;nid&gt;</code> or the <code className="rounded bg-slate-100 px-1">create/&lt;nid&gt;</code> in a broadcast).
        </p>
      </details>
    </Wrap>
  );
}
