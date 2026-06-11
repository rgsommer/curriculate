"use client";

/** /orders/setup — finance configures recipients, updates the catalog, and invites teachers. */

import { useEffect, useRef, useState } from "react";
import AdminGate from "../_AdminGate";
import { buildInviteEmail } from "../_invite";

const ORDER_URL = "https://www.curriculate.net/orders";

function Section({ title, children }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-6 max-w-2xl">
      <h2 className="font-semibold text-slate-800 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function SetupForm({ session }) {
  const [financeEmail, setFinanceEmail] = useState("");
  const [financeName, setFinanceName] = useState("");
  const [financeEmail2, setFinanceEmail2] = useState("");
  const [financeName2, setFinanceName2] = useState("");
  const [financeNotify, setFinanceNotify] = useState(true);
  const [financeNotify2, setFinanceNotify2] = useState(true);
  const [schoolName, setSchoolName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // catalog state
  const [catalogInfo, setCatalogInfo] = useState(null); // { count, source, updatedAt }
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // invite state
  const [copied, setCopied] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  // new-year reset state
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearMsg, setClearMsg] = useState("");
  const [clearErr, setClearErr] = useState("");

  useEffect(() => {
    fetch("/api/orders/config").then((r) => r.json()).then((j) => {
      setFinanceEmail(j.financeEmail || ""); setFinanceName(j.financeName || "");
      setFinanceEmail2(j.financeEmail2 || ""); setFinanceName2(j.financeName2 || "");
      setFinanceNotify(j.financeNotify !== false); setFinanceNotify2(j.financeNotify2 !== false);
      setSchoolName(j.schoolName || ""); setLoaded(true);
    }).catch(() => setLoaded(true));
    loadCatalogInfo();
  }, []);

  function loadCatalogInfo() {
    fetch("/api/orders/catalog").then((r) => r.json()).then((j) => {
      setCatalogInfo({ count: (j.items || []).length, source: j.source, updatedAt: j.updatedAt });
    }).catch(() => {});
  }

  async function save(e) {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await fetch("/api/orders/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, financeEmail: financeEmail.trim(), financeName: financeName.trim(), financeEmail2: financeEmail2.trim(), financeName2: financeName2.trim(), financeNotify, financeNotify2, schoolName: schoolName.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save.");
      setMsg("Saved."); if (j.financeEmail) setFinanceEmail(j.financeEmail);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function uploadCatalog(file) {
    setUploadErr(""); setUploadMsg(""); setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const dataB64 = btoa(binary);
      const r = await fetch("/api/orders/catalog", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, dataB64, filename: file.name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed.");
      setUploadMsg(`Catalog updated — ${j.count} items live${j.skipped ? `, ${j.skipped} rows skipped` : ""}.${j.persisted ? "" : " (not persisted — no database in this environment)"}`);
      loadCatalogInfo();
    } catch (e2) { setUploadErr(e2.message); } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function downloadCurrentCsv() {
    const j = await fetch("/api/orders/catalog").then((r) => r.json());
    const rows = [["supplier", "po", "category", "sku", "description", "uom", "price"]];
    for (const it of j.items || []) rows.push([it.supplier, it.po, it.category, it.sku, it.description, it.uom, it.price]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "supply-catalog.csv"; a.click();
  }

  async function copyInvite() {
    const { html, text } = buildInviteEmail({ schoolName, financeName, url: ORDER_URL });
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
        setCopied("rich");
      } else {
        await navigator.clipboard.writeText(text);
        setCopied("text");
      }
    } catch {
      try { await navigator.clipboard.writeText(text); setCopied("text"); } catch { setCopied("fail"); }
    }
    setTimeout(() => setCopied(""), 4000);
  }

  async function clearAllOrders() {
    setClearErr(""); setClearMsg(""); setClearBusy(true);
    try {
      const r = await fetch("/api/orders/clear", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, all: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not clear orders.");
      setClearMsg(`Cleared ${j.removed} order${j.removed === 1 ? "" : "s"}. Everyone starts fresh.${j.persisted === false ? " (no database in this environment)" : ""}`);
      setClearConfirm(false);
    } catch (e2) { setClearErr(e2.message); } finally { setClearBusy(false); }
  }

  if (!loaded) return <p className="text-sm text-slate-400">Loading settings…</p>;

  const invitePreview = buildInviteEmail({ schoolName, financeName, url: ORDER_URL });

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-6">
        <a href="/orders/summary" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">School order summary →</a>
        <a href="/orders/guide?role=finance" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Finance guide</a>
      </div>

      {/* Recipients */}
      <Section title="Who receives orders">
        <form onSubmit={save}>
          {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{err}</div>}
          {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">{msg}</div>}

          <label className="block text-sm font-medium text-slate-700 mb-1">Finance name</label>
          <input value={financeName} onChange={(e) => setFinanceName(e.target.value)} placeholder="Evelyn McBride"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 mb-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <label className="flex items-center gap-2 text-sm text-slate-600 mb-4 select-none cursor-pointer">
            <input type="checkbox" checked={financeNotify} onChange={(e) => setFinanceNotify(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
            Receives the order emails
          </label>

          <label className="block text-sm font-medium text-slate-700 mb-1">Finance email (receives every order + the school summary)</label>
          <input type="email" value={financeEmail} onChange={(e) => setFinanceEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />

          <div className="border-t border-slate-100 pt-4 mt-1 mb-4">
            <p className="text-xs text-slate-500 mb-3">Optional — a second finance person. They get the same admin access (Setup, summary, settings) and also receive every order email. Leave blank for none.</p>
            <label className="block text-sm font-medium text-slate-700 mb-1">Second finance name</label>
            <input value={financeName2} onChange={(e) => setFinanceName2(e.target.value)} placeholder="(optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 mb-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <label className="flex items-center gap-2 text-sm text-slate-600 mb-3 select-none cursor-pointer">
              <input type="checkbox" checked={financeNotify2} onChange={(e) => setFinanceNotify2(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
              Receives the order emails
            </label>
            <label className="block text-sm font-medium text-slate-700 mb-1">Second finance email</label>
            <input type="email" value={financeEmail2} onChange={(e) => setFinanceEmail2(e.target.value)} placeholder="(optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          <label className="block text-sm font-medium text-slate-700 mb-1">School name (shown in emails)</label>
          <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />

          <button disabled={busy} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Saving…" : "Save settings"}
          </button>
          <p className="text-xs text-slate-400 mt-3">The finance email is the only account that can open Setup and the school summary. Changing it hands admin access to that address.</p>
        </form>
      </Section>

      {/* Catalog */}
      <Section title="Items & prices (catalog)">
        {catalogInfo && (
          <p className="text-sm text-slate-500 mb-3">
            Currently <strong>{catalogInfo.count}</strong> items
            {catalogInfo.source === "uploaded"
              ? <> from an uploaded file{catalogInfo.updatedAt ? ` (updated ${new Date(catalogInfo.updatedAt).toLocaleDateString("en-CA", { dateStyle: "medium" })})` : ""}.</>
              : <> from the built-in default list.</>}
          </p>
        )}
        <p className="text-sm text-slate-600 mb-3">
          To refresh for a new year: download the current catalog, edit prices/items in Excel, save as CSV (or keep .xlsx), then upload it here. Required columns: <span className="font-mono text-xs">supplier, po, category, sku, description, uom, price</span>.
        </p>
        {uploadErr && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{uploadErr}</div>}
        {uploadMsg && <div className="mb-3 rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">{uploadMsg}</div>}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={downloadCurrentCsv} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">Download current catalog (CSV)</button>
          <label className={`rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-indigo-700 ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            {uploading ? "Uploading…" : "Upload new catalog"}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCatalog(f); }} />
          </label>
        </div>
      </Section>

      {/* Invite */}
      <Section title="Invite teachers">
        <p className="text-sm text-slate-600 mb-3">
          Copy a ready-to-send email explaining what the tool is, how to use it, and what happens — then paste it into Outlook or Gmail and send to staff.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={copyInvite} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700">
            Copy invite email
          </button>
          <button onClick={() => setShowInvite((v) => !v)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            {showInvite ? "Hide preview" : "Preview"}
          </button>
          <a
            href={`mailto:?subject=${encodeURIComponent(invitePreview.subject)}&body=${encodeURIComponent(invitePreview.text)}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >Open in email app</a>
          {copied === "rich" && <span className="text-sm text-green-600">Copied — paste into your email.</span>}
          {copied === "text" && <span className="text-sm text-green-600">Copied as plain text.</span>}
          {copied === "fail" && <span className="text-sm text-red-600">Couldn't copy — use “Open in email app”.</span>}
        </div>
        <p className="text-xs text-slate-400 mt-2">Subject: {invitePreview.subject}</p>
        {showInvite && (
          <div className="mt-4 border border-slate-200 rounded-lg p-4 bg-slate-50">
            <div dangerouslySetInnerHTML={{ __html: invitePreview.html }} />
          </div>
        )}
      </Section>

      {/* New year reset */}
      <section className="bg-white rounded-xl border border-red-200 p-6 shadow-sm mb-6 max-w-2xl">
        <h2 className="font-semibold text-red-700 mb-3">Start a new year</h2>
        <p className="text-sm text-slate-600 mb-3">
          Clears <strong>every teacher's</strong> submitted orders and in-progress drafts so the school starts the new ordering year from zero. The item catalog and these settings are kept — update the catalog separately above. This can't be undone.
        </p>
        {clearErr && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{clearErr}</div>}
        {clearMsg && <div className="mb-3 rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">{clearMsg}</div>}
        {!clearConfirm ? (
          <button onClick={() => { setClearConfirm(true); setClearMsg(""); setClearErr(""); }}
            className="rounded-lg border border-red-300 text-red-700 bg-white px-4 py-2 text-sm font-medium hover:bg-red-50">
            Clear all orders…
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-red-700">Delete every teacher's order — are you sure?</span>
            <button disabled={clearBusy} onClick={clearAllOrders}
              className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
              {clearBusy ? "Clearing…" : "Yes, clear everything"}
            </button>
            <button disabled={clearBusy} onClick={() => setClearConfirm(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function SetupPage() {
  return <AdminGate title="Ordering · Setup">{(ctx) => <SetupForm {...ctx} />}</AdminGate>;
}
