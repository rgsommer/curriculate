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
      <HousesSection />
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
          <Row label="Notice channels" val={[c.channels?.email && "email", c.channels?.edsby && "Edsby"].filter(Boolean).join(", ")} />
          <Row label="AI send mode" val={c.aiSendMode === "draft" ? "Draft (one-tap send)" : "Automatic on trigger"} />
          <Row label="Morning reminder time" val={c.reminderTime || "07:30"} />
        </div>
        <Link href="/behavior/behaviours" className="mt-3 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          View behaviours →
        </Link>
      </Card>
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
        Only <span className="font-medium">@{domain}</span> addresses can be invited.
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
  const cookieSet = !!edsby?.cookieConfigured;
  const formkeySet = !!edsby?.formkeyConfigured;

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
      const r = await api<{ ok: boolean; error?: string }>("/test-edsby-send", { body: {} });
      setTestMsg(r.ok ? "✓ Test broadcast posted — check your Edsby messages." : `✗ ${r.error || "Failed"}`);
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
      if (cookie.trim()) body.cookie = cookie.trim();
      if (formkey.trim()) body.formkey = formkey.trim();
      await api("/config/edsby", { method: "PUT", body });
      setCookie("");
      setFormkey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Edsby connection</h2>
      <p className="mt-1 text-sm text-slate-500">
        Edsby has no public API, so notices are posted using your school&apos;s signed-in session — each
        parent messaged separately via their Edsby nid. The cookie + formkey are stored <span className="font-medium">encrypted</span> and never shown again.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Edsby base URL">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://yourschool.edsby.com" className={inputCls} />
        </Field>
        <Field label="Your Edsby user nid">
          <input value={userNid} onChange={(e) => setUserNid(e.target.value)} placeholder="window._cf.user.nid" className={inputCls} />
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
      <Field label={`Session cookie ${cookieSet ? "(stored ✓ — blank keeps it)" : ""}`}>
        <textarea value={cookie} onChange={(e) => setCookie(e.target.value)} rows={2}
          placeholder={cookieSet ? "•••••••• (already saved)" : "paste the Edsby session cookie"} className={inputCls} />
      </Field>
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
          {testBusy ? "…" : "Send test broadcast to me"}
        </button>
      </div>
      {testMsg && <p className={`mt-2 text-sm ${testMsg.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>{testMsg}</p>}
      <p className="mt-2 text-xs text-amber-700">
        The cookie + formkey expire periodically — when Edsby sends start failing over to email, re-paste them.
        Parent Edsby nids still need harvesting from Edsby (next step).
      </p>
    </Card>
  );
}

function HousesSection() {
  const [houses, setHouses] = useState<any[] | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0f172a");
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api<{ houses: any[] }>("/houses").then((d) => setHouses(d.houses || [])).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

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
      <h2 className="font-semibold">Houses</h2>
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

  useEffect(() => { api<{ houses: any[] }>("/houses").then((d) => setHouses(d.houses || [])).catch(() => {}); }, []);

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
