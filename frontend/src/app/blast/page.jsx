// frontend/src/app/blast/page.jsx
//
// Admin-only "Blast" tool. Lives at https://www.curriculate.net/blast .
// Gated client-side by the same x-admin-token pattern used in /admin.
//
// Three tabs: New Campaign / Campaigns / Contacts.
// CSV upload appends contacts to the master list and queues 50 sends/day
// during teacher-friendly hours (Tue/Wed/Thu 7:30–8:30 ET by default).

"use client";

import React, { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

const PRODUCTS = [
  { key: "curriculate", label: "Curriculate (scavenger hunts)" },
  { key: "pulse",       label: "Pulse Grading" },
  { key: "fieldday",    label: "Field Day" },
];

// ── tiny CSV parser (handles quoted fields, commas inside quotes, CRLF) ──
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === "\r") { /* skip */ }
      else { cell += ch; }
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length && r.some(c => c.trim() !== "")).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}

function H({ children }) { return <h2 className="text-lg font-semibold text-white mb-3">{children}</h2>; }
function L({ children }) { return <label className="block text-xs uppercase tracking-wide text-white/60 mb-1">{children}</label>; }
function Btn({ children, onClick, disabled, variant = "primary", className = "" }) {
  const base = "px-3 py-1.5 rounded-md text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white",
    ghost:   "bg-white/5 hover:bg-white/10 text-white border border-white/10",
    danger:  "bg-red-600/80 hover:bg-red-500 text-white",
  };
  return <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>{children}</button>;
}
function Pill({ children, color = "slate" }) {
  const colors = {
    slate:  "bg-slate-700 text-slate-200",
    blue:   "bg-blue-700 text-blue-100",
    green:  "bg-emerald-700 text-emerald-100",
    amber:  "bg-amber-700 text-amber-100",
    red:    "bg-red-700 text-red-100",
    purple: "bg-purple-700 text-purple-100",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[color] || colors.slate}`}>{children}</span>;
}

const TOKEN_STORAGE_KEY = "blastAdminToken";

export default function BlastAdminPage() {
  const [adminToken, setAdminToken] = useState("");
  const [tab, setTab] = useState("new");
  const [defaults, setDefaults] = useState(null);
  const [defaultsError, setDefaultsError] = useState("");

  // Hydrate token from localStorage so the gate doesn't show every visit.
  // Sign out clears it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved) setAdminToken(saved);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (adminToken) window.localStorage.setItem(TOKEN_STORAGE_KEY, adminToken);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }, [adminToken]);

  // Load templates once admin token is provided. If the saved token is stale,
  // /templates will return 401; clear the cached token so the gate shows again.
  // On network/route errors, surface a diagnostic banner so the user knows
  // it's a backend-reachability problem rather than a missing template.
  useEffect(() => {
    if (!adminToken) return;
    setDefaultsError("");
    fetch(`${API}/admin/blast/templates`, { headers: { "x-admin-token": adminToken } })
      .then(async r => {
        if (r.status === 401) { setAdminToken(""); return null; }
        if (!r.ok) {
          setDefaultsError(`Templates endpoint returned ${r.status}. The backend may not have the new /admin/blast routes deployed yet (commit a8e4d794+).`);
          return null;
        }
        return r.json();
      })
      .then(j => { if (j) setDefaults(j.templates || {}); })
      .catch((e) => {
        setDefaultsError(`Failed to reach ${API}/admin/blast/templates (${e.message || "network error"}). Likely causes: backend not deployed with new routes, NEXT_PUBLIC_BACKEND_URL pointed somewhere wrong, or CORS misconfigured.`);
      });
  }, [adminToken]);

  if (!adminToken) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <h1 className="text-2xl font-bold mb-1">Curriculate Blast</h1>
          <p className="text-sm text-white/60 mb-6">Admin-only — paste your admin token to continue.</p>
          <input type="password" autoFocus
            placeholder="x-admin-token"
            className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white"
            onKeyDown={(e) => { if (e.key === "Enter") setAdminToken(e.currentTarget.value); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white px-4 sm:px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Curriculate Blast</h1>
            <p className="text-sm text-white/60">CSV-driven outbound. 50 sends/day max, Tue/Wed/Thu 7:30–8:30 ET. Resend-backed.</p>
          </div>
          <Btn variant="ghost" onClick={() => setAdminToken("")}>Sign out</Btn>
        </div>

        <div className="flex gap-2 mb-4 border-b border-white/10 pb-2 flex-wrap">
          <Btn variant={tab === "new" ? "primary" : "ghost"} onClick={() => setTab("new")}>New Campaign</Btn>
          <Btn variant={tab === "campaigns" ? "primary" : "ghost"} onClick={() => setTab("campaigns")}>Campaigns</Btn>
          <Btn variant={tab === "contacts" ? "primary" : "ghost"} onClick={() => setTab("contacts")}>Contacts</Btn>
          <Btn variant={tab === "research" ? "primary" : "ghost"} onClick={() => setTab("research")}>Research</Btn>
        </div>

        {defaultsError && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            <div className="font-semibold mb-1">⚠ Backend unreachable</div>
            <div className="text-red-200/90">{defaultsError}</div>
          </div>
        )}

        {tab === "new" && <NewCampaign adminToken={adminToken} defaults={defaults} onCreated={() => setTab("campaigns")} />}
        {tab === "campaigns" && <CampaignList adminToken={adminToken} />}
        {tab === "contacts" && <Contacts adminToken={adminToken} />}
        {tab === "research" && <Research adminToken={adminToken} />}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* NEW CAMPAIGN                                                            */
/* ────────────────────────────────────────────────────────────────────── */
function NewCampaign({ adminToken, defaults, onCreated }) {
  const [name, setName] = useState("");
  // Multi-product: each recipient receives ONE email per selected product.
  // Campaigns are launched sequentially so the same person doesn't get all
  // emails in the same week.
  const [products, setProducts] = useState(["curriculate"]);
  // Which product's template is currently being edited in the right pane
  const [editProduct, setEditProduct] = useState("curriculate");
  // Per-product template state: { [productKey]: { subjectEn, bodyEn, subjectFr, bodyFr } }
  const [templates, setTemplates] = useState({});
  const [recipients, setRecipients] = useState([]);
  const [csvName, setCsvName] = useState("");

  const [dailyCap, setDailyCap] = useState(50);
  const [startInDays, setStartInDays] = useState(0);
  const [sendDays, setSendDays] = useState([2, 3, 4]);
  const [enabledMonths, setEnabledMonths] = useState([]); // empty = always active
  const [startHour, setStartHour] = useState(7);
  const [startMin,  setStartMin]  = useState(30);
  const [endHour,   setEndHour]   = useState(8);
  const [endMin,    setEndMin]    = useState(30);

  const [filters, setFilters] = useState({ board: "", role: "", level: "" });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testMsg, setTestMsg] = useState("");

  // Initialize templates for each product from the server defaults when
  // defaults arrive. Subsequent edits to a product's template are preserved
  // even if the user toggles the product off and back on.
  useEffect(() => {
    if (!defaults) return;
    setTemplates(prev => {
      const next = { ...prev };
      for (const key of Object.keys(defaults)) {
        if (!next[key]) next[key] = { ...defaults[key] };
      }
      return next;
    });
  }, [defaults]);

  function toggleProduct(key) {
    setProducts(arr => {
      const has = arr.includes(key);
      const next = has ? arr.filter(p => p !== key) : [...arr, key];
      // Keep at least one selected
      if (next.length === 0) return arr;
      // If the currently-edited product was just removed, focus the first
      if (has && editProduct === key) setEditProduct(next[0]);
      // If we're enabling something new, switch focus to it
      if (!has) setEditProduct(key);
      return next;
    });
  }

  function patchTemplate(key, patch) {
    setTemplates(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function handleCsv(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setCsvName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result || ""));
        // Keep only rows with an Email column populated
        const cleaned = rows.filter(r => (r.Email || r.email || "").trim()).map(r => ({
          email:     r.Email     || r.email     || "",
          firstName: r.FirstName || r.firstName || "",
          lastName:  r.LastName  || r.lastName  || "",
          school:    r.School    || r.school    || "",
          board:     r.Board     || r.board     || "",
          role:      r.Role      || r.role      || "",
          level:     r.Level     || r.level     || "",
        }));
        setRecipients(cleaned);
      } catch (err) {
        alert("CSV parse failed: " + err.message);
      }
    };
    reader.readAsText(f);
  }

  // Filter dropdown options derived from the uploaded CSV
  const opts = useMemo(() => {
    const boards = new Set(), roles = new Set(), levels = new Set();
    for (const r of recipients) {
      if (r.board) boards.add(r.board);
      if (r.role)  roles.add(r.role);
      if (r.level) levels.add(r.level);
    }
    return {
      boards: [...boards].sort(),
      roles:  [...roles].sort(),
      levels: [...levels].sort(),
    };
  }, [recipients]);

  const filtered = useMemo(() => recipients.filter(r =>
    (!filters.board || r.board === filters.board) &&
    (!filters.role  || r.role  === filters.role)  &&
    (!filters.level || r.level === filters.level)
  ), [recipients, filters]);

  const langSummary = useMemo(() => {
    let en = 0, fr = 0;
    for (const r of filtered) {
      const b = (r.board || "").toLowerCase();
      if (b === "viamonde" || b === "monavenir") fr++; else en++;
    }
    return { en, fr };
  }, [filtered]);

  function toggleSendDay(d) {
    setSendDays(arr => arr.includes(d) ? arr.filter(x => x !== d) : [...arr, d].sort());
  }
  function toggleMonth(m) {
    setEnabledMonths(arr => arr.includes(m) ? arr.filter(x => x !== m) : [...arr, m].sort((a,b) => a-b));
  }

  // Estimate how many calendar days one product's campaign occupies — used
  // to stagger sequential campaigns so the same person doesn't get hit twice
  // in close succession.
  function estimateDurationDays(recipientCount) {
    if (!recipientCount) return 0;
    const sendingDays = Math.ceil(recipientCount / Math.max(1, dailyCap));
    const weeks = Math.ceil(sendingDays / Math.max(1, sendDays.length));
    return weeks * 7;
  }

  async function sendTest() {
    if (!testEmail) return;
    const t = templates[editProduct];
    if (!t || !t.subjectEn) {
      setTestMsg("Templates haven't loaded — the backend's /admin/blast routes may not be deployed yet. Check the red banner at the top of the page for details.");
      return;
    }
    setTestMsg("Sending…");
    try {
      // Create a far-future tiny draft so we can use /test, then clean up.
      const res = await fetch(`${API}/admin/blast/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify({
          name: `[TEST DRAFT] ${name || "untitled"} — ${editProduct}`,
          product: editProduct,
          subjectEn: t.subjectEn, bodyEn: t.bodyEn,
          subjectFr: t.subjectFr, bodyFr: t.bodyFr,
          recipients: [{ email: testEmail, firstName: "Test", school: "Sample School", board: "HWDSB", role: "Principal" }],
          dailyCap: 1,
          startInDays: 365,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "create failed");
      const cid = j.campaign._id;
      const tres = await fetch(`${API}/admin/blast/campaigns/${cid}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify({ toEmail: testEmail, language: "en" }),
      });
      const tj = await tres.json();
      await fetch(`${API}/admin/blast/campaigns/${cid}/cancel`, { method: "POST", headers: { "x-admin-token": adminToken } });
      await fetch(`${API}/admin/blast/campaigns/${cid}`, { method: "DELETE", headers: { "x-admin-token": adminToken } });
      setTestMsg(tj.ok ? `✓ Test sent (${editProduct}) to ${testEmail}` : `✗ ${tj.error}`);
    } catch (e) {
      setTestMsg(`✗ ${e.message}`);
    }
  }

  async function createCampaign() {
    if (!name.trim()) { setCreateMsg("Name the campaign first."); return; }
    if (!filtered.length) { setCreateMsg("Upload a CSV with at least one valid email."); return; }
    if (!products.length) { setCreateMsg("Pick at least one product."); return; }
    setCreating(true);
    setCreateMsg("");

    const orderedProducts = ["curriculate", "pulse", "fieldday"].filter(p => products.includes(p));
    const perDuration = estimateDurationDays(filtered.length);
    const created = [];
    const errors = [];

    try {
      for (let i = 0; i < orderedProducts.length; i++) {
        const prod = orderedProducts[i];
        const t = templates[prod] || defaults?.[prod] || {};
        // Stagger: product N starts after product N-1 would finish (+ 1 day buffer)
        const offset = startInDays + (i === 0 ? 0 : i * (perDuration + 1));
        const res = await fetch(`${API}/admin/blast/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
          body: JSON.stringify({
            name: orderedProducts.length === 1 ? name : `${name} — ${prod}`,
            product: prod,
            subjectEn: t.subjectEn, bodyEn: t.bodyEn,
            subjectFr: t.subjectFr, bodyFr: t.bodyFr,
            recipients: filtered,
            dailyCap,
            startInDays: offset,
            sendDays,
            enabledMonths,
            sendStartHour: startHour, sendStartMinute: startMin,
            sendEndHour:   endHour,   sendEndMinute:   endMin,
          }),
        });
        const j = await res.json();
        if (j.ok) {
          created.push({ product: prod, firstSendAt: j.firstSendAt, lastSendAt: j.lastSendAt });
        } else {
          errors.push(`${prod}: ${j.error}`);
        }
      }
      if (errors.length) {
        setCreateMsg(`Created ${created.length}/${orderedProducts.length} campaigns. Errors: ${errors.join("; ")}`);
      } else {
        const lines = created.map(c =>
          `• ${c.product}: ${new Date(c.firstSendAt).toLocaleDateString()} → ${new Date(c.lastSendAt).toLocaleDateString()}`
        ).join("\n");
        setCreateMsg(`✓ Created ${created.length} campaign${created.length > 1 ? "s" : ""}:\n${lines}`);
      }
      if (created.length) setTimeout(() => onCreated?.(), 2200);
    } catch (e) {
      setCreateMsg(`✗ ${e.message}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* LEFT: setup */}
      <div className="space-y-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <H>1. Campaign basics</H>
          <L>Campaign name</L>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. FieldDay May 2026 — Hamilton/Halton principals"
            className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 mb-3" />

          <L>Products (each selected = one separate email to every recipient)</L>
          <div className="flex gap-2 flex-wrap">
            {PRODUCTS.map(p => {
              const on = products.includes(p.key);
              return (
                <Btn key={p.key} variant={on ? "primary" : "ghost"} onClick={() => toggleProduct(p.key)}>
                  {on ? "✓ " : ""}{p.label}
                </Btn>
              );
            })}
          </div>
          {products.length > 1 && (
            <p className="mt-2 text-xs text-amber-300/80">
              {products.length} products selected → {products.length} campaigns will be created, launched sequentially
              so each recipient receives one email at a time (≈{estimateDurationDays(filtered.length || 100)} days apart).
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <H>2. Recipient CSV</H>
          <p className="text-xs text-white/60 mb-2">
            Expected columns: <code className="bg-black/30 px-1">Email, FirstName, LastName, School, Board, Role, Level</code>.
            French language is auto-applied to <code>Viamonde</code> and <code>MonAvenir</code> rows.
          </p>
          <input type="file" accept=".csv" onChange={handleCsv}
            className="block w-full text-sm text-white/80 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white" />
          {csvName && <div className="mt-2 text-xs text-white/60">Loaded {csvName} — {recipients.length} rows</div>}

          {recipients.length > 0 && (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <L>Filter board</L>
                  <select value={filters.board} onChange={(e) => setFilters(f => ({ ...f, board: e.target.value }))}
                    className="w-full px-2 py-1 rounded bg-white/5 border border-white/10">
                    <option value="">All</option>
                    {opts.boards.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <L>Filter role</L>
                  <select value={filters.role} onChange={(e) => setFilters(f => ({ ...f, role: e.target.value }))}
                    className="w-full px-2 py-1 rounded bg-white/5 border border-white/10">
                    <option value="">All</option>
                    {opts.roles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <L>Filter level</L>
                  <select value={filters.level} onChange={(e) => setFilters(f => ({ ...f, level: e.target.value }))}
                    className="w-full px-2 py-1 rounded bg-white/5 border border-white/10">
                    <option value="">All</option>
                    {opts.levels.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3 text-xs text-white/70">
                <Pill color="blue">Selected: {filtered.length}</Pill>{" "}
                <Pill>EN {langSummary.en}</Pill>{" "}
                <Pill color="purple">FR {langSummary.fr}</Pill>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <H>3. Schedule</H>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <L>Daily cap (max sends/day)</L>
              <input type="number" min={1} max={100} value={dailyCap} onChange={(e) => setDailyCap(parseInt(e.target.value, 10) || 50)}
                className="w-full px-2 py-1 rounded bg-white/5 border border-white/10" />
            </div>
            <div>
              <L>Start in (days from now)</L>
              <input type="number" min={0} max={60} value={startInDays} onChange={(e) => setStartInDays(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1 rounded bg-white/5 border border-white/10" />
            </div>
          </div>

          <div className="mt-3">
            <L>Send days (Tue/Wed/Thu recommended for teachers)</L>
            <div className="flex gap-2 flex-wrap">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                <Btn key={d} variant={sendDays.includes(i) ? "primary" : "ghost"} onClick={() => toggleSendDay(i)}>{d}</Btn>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <L>Active months {enabledMonths.length === 0 ? "(all months — always active)" : `(${enabledMonths.length} selected; outside these months sends are paused)`}</L>
            <div className="flex gap-1 flex-wrap">
              {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                <button key={m} onClick={() => toggleMonth(i+1)}
                  className={`px-2 py-1 text-xs rounded ${enabledMonths.includes(i+1) ? "bg-blue-600 text-white" : "bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"}`}>
                  {m}
                </button>
              ))}
            </div>
            {products.includes("fieldday") && enabledMonths.length === 0 && (
              <p className="mt-2 text-xs text-amber-300/80">Tip: Field Day is seasonal — consider selecting Apr/May/Jun only so the worker never sends outside relevance.</p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <L>Window start (ET)</L>
              <div className="flex gap-1">
                <input type="number" min={0} max={23} value={startHour} onChange={(e) => setStartHour(+e.target.value)} className="w-20 px-2 py-1 rounded bg-white/5 border border-white/10" />
                <input type="number" min={0} max={59} value={startMin}  onChange={(e) => setStartMin(+e.target.value)}  className="w-20 px-2 py-1 rounded bg-white/5 border border-white/10" />
              </div>
            </div>
            <div>
              <L>Window end (ET)</L>
              <div className="flex gap-1">
                <input type="number" min={0} max={23} value={endHour} onChange={(e) => setEndHour(+e.target.value)} className="w-20 px-2 py-1 rounded bg-white/5 border border-white/10" />
                <input type="number" min={0} max={59} value={endMin}  onChange={(e) => setEndMin(+e.target.value)}  className="w-20 px-2 py-1 rounded bg-white/5 border border-white/10" />
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-white/60">
            With {filtered.length} recipients × {dailyCap}/day on {sendDays.length} day(s)/week, this will finish in
            ≈ <strong className="text-white/90">{Math.ceil(filtered.length / Math.max(1, dailyCap)) /
            Math.max(1, sendDays.length) * 7 | 0} days</strong>.
          </p>
        </div>
      </div>

      {/* RIGHT: templates + actions */}
      <div className="space-y-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <H>4. Email templates <span className="text-xs font-normal text-emerald-300 ml-1">(optional — already configured)</span></H>
          <p className="text-xs text-white/60 mb-3">
            Templates are <strong>pre-loaded</strong> with the current default copy (teacher-voice opener, role-specific pitch, Christian overlay for OACS/ACSI schools, etc). You don't need to edit anything — just expand below if you want to customize the subject or body for this specific campaign.
          </p>

          {/* Tabs — one per selected product */}
          <div className="flex gap-1 mb-3 border-b border-white/10">
            {products.map(p => (
              <button key={p} onClick={() => setEditProduct(p)}
                className={`px-3 py-1.5 text-sm rounded-t-md ${editProduct === p ? "bg-white/10 text-white" : "text-white/60 hover:text-white"}`}>
                {p}
              </button>
            ))}
          </div>

          {(() => {
            const t = templates[editProduct] || { subjectEn: "", bodyEn: "", subjectFr: "", bodyFr: "" };
            const loaded = !!(t.subjectEn || t.bodyEn);
            return (
              <>
                {loaded ? (
                  <div className="mb-3 text-xs text-emerald-300/80 flex items-start gap-2">
                    <span>✓</span>
                    <div>
                      <div><strong>Loaded:</strong> "{t.subjectEn}"</div>
                      <div className="text-white/40">{(t.bodyEn || "").replace(/<[^>]+>/g, "").trim().slice(0, 110)}…</div>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 text-xs text-amber-300">Loading default template…</div>
                )}

                <details className="mb-3">
                  <summary className="cursor-pointer text-sm font-semibold text-white/70 hover:text-white">▸ Customize English template</summary>
                  <L>Subject (EN)</L>
                  <input value={t.subjectEn} onChange={(e) => patchTemplate(editProduct, { subjectEn: e.target.value })}
                    className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 mb-2" />
                  <L>HTML body (EN)</L>
                  <textarea value={t.bodyEn} onChange={(e) => patchTemplate(editProduct, { bodyEn: e.target.value })}
                    rows={10} className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 font-mono text-xs" />
                  <p className="text-xs text-white/50 mt-2">Variables: <code>{"{{firstName}}"}</code> <code>{"{{school}}"}</code> <code>{"{{board}}"}</code> <code>{"{{role}}"}</code> <code>{"{{salutation}}"}</code> <code>{"{{role_pitch}}"}</code> <code>{"{{credential_intro}}"}</code> <code>{"{{christian_perspective}}"}</code></p>
                </details>

                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-white/70 hover:text-white">▸ Customize French template (auto-applied to Viamonde + MonAvenir)</summary>
                  <L>Sujet (FR)</L>
                  <input value={t.subjectFr} onChange={(e) => patchTemplate(editProduct, { subjectFr: e.target.value })}
                    className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 mb-2" />
                  <L>Corps HTML (FR)</L>
                  <textarea value={t.bodyFr} onChange={(e) => patchTemplate(editProduct, { bodyFr: e.target.value })}
                    rows={10} className="w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 font-mono text-xs" />
                </details>
              </>
            );
          })()}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <H>5. Test send</H>
          <div className="flex gap-2">
            <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@curriculate.net"
              className="flex-1 px-3 py-2 rounded-md bg-white/5 border border-white/10" />
            <Btn variant="ghost" onClick={sendTest} disabled={!testEmail}>Send test</Btn>
          </div>
          {testMsg && <div className="mt-2 text-xs text-white/70">{testMsg}</div>}
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <H>6. Launch</H>
          <p className="text-xs text-white/70 mb-3">
            {products.length === 1
              ? `Creates 1 campaign queuing all ${filtered.length || 0} recipients into the master contact list and schedules them across the next eligible mornings.`
              : `Creates ${products.length} sequential campaigns — every recipient receives ${products.length} emails total (one per product), spaced ≈${estimateDurationDays(filtered.length || 0)} days apart so they're not bombarded.`}
            {" "}The trickle worker takes it from there — you can pause anytime.
          </p>
          <Btn onClick={createCampaign} disabled={creating || !filtered.length || !name.trim() || !products.length}>
            {creating
              ? "Creating…"
              : products.length === 1
                ? `Create campaign (${filtered.length})`
                : `Create ${products.length} campaigns (${filtered.length} × ${products.length} = ${filtered.length * products.length} emails)`}
          </Btn>
          {createMsg && <pre className="mt-3 text-sm whitespace-pre-wrap font-sans">{createMsg}</pre>}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* CAMPAIGN LIST                                                            */
/* ────────────────────────────────────────────────────────────────────── */
function CampaignList({ adminToken }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const j = await fetch(`${API}/admin/blast/campaigns`, { headers: { "x-admin-token": adminToken } }).then(r => r.json());
      setItems(j.campaigns || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(id, action) {
    await fetch(`${API}/admin/blast/campaigns/${id}/${action}`, { method: "POST", headers: { "x-admin-token": adminToken } });
    load();
  }
  async function del(id) {
    if (!confirm("Delete this campaign and all its recipients? This cannot be undone.")) return;
    await fetch(`${API}/admin/blast/campaigns/${id}`, { method: "DELETE", headers: { "x-admin-token": adminToken } });
    load();
  }

  if (loading) return <div className="text-white/60">Loading…</div>;
  if (!items.length) return <div className="text-white/60">No campaigns yet — create one in the New Campaign tab.</div>;

  return (
    <div className="space-y-3">
      {items.map(c => {
        const total = c.totalRecipients || 1;
        const sent  = c.counts?.sent || 0;
        const pct = Math.round((sent / total) * 100);
        const statusColor = c.status === "running" ? "green" : c.status === "paused" ? "amber" : c.status === "cancelled" ? "red" : c.status === "completed" ? "blue" : "slate";
        return (
          <div key={c._id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">{c.name}</h3>
                  <Pill color={statusColor}>{c.status}</Pill>
                  <Pill color="purple">{c.product}</Pill>
                </div>
                <div className="text-xs text-white/60">
                  {sent}/{total} sent · {c.counts?.queued || 0} queued · {c.counts?.failed || 0} failed
                  · {c.dailyCap}/day · created {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex gap-1">
                {c.status === "running" || c.status === "scheduled" ? (
                  <Btn variant="ghost" onClick={() => act(c._id, "pause")}>Pause</Btn>
                ) : c.status === "paused" ? (
                  <Btn variant="primary" onClick={() => act(c._id, "resume")}>Resume</Btn>
                ) : null}
                {c.status !== "cancelled" && c.status !== "completed" && (
                  <Btn variant="ghost" onClick={() => act(c._id, "cancel")}>Cancel</Btn>
                )}
                <Btn variant="danger" onClick={() => del(c._id)}>Delete</Btn>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* RESEARCH — queue + presets + xlsx auto-import + pending review          */
/* ────────────────────────────────────────────────────────────────────── */
const PRESET_REGIONS = [
  { name: "Toronto District School Board",        board: "TDSB",   url: "https://www.tdsb.on.ca/Find-your/School" },
  { name: "Toronto Catholic District School Board", board: "TCDSB", url: "https://www.tcdsb.org/schools/Pages/default.aspx" },
  { name: "Peel District School Board",            board: "PDSB",   url: "https://www.peelschools.org/schools/find-a-school" },
  { name: "Dufferin-Peel Catholic DSB",            board: "DPCDSB", url: "https://www3.dpcdsb.org/schools" },
  { name: "York Region District School Board",     board: "YRDSB",  url: "https://www2.yrdsb.ca/schools" },
  { name: "York Catholic District School Board",   board: "YCDSB",  url: "https://www.ycdsb.ca/our-schools/" },
  { name: "Ottawa-Carleton DSB",                   board: "OCDSB",  url: "https://ocdsb.ca/our_schools" },
  { name: "Ottawa Catholic School Board",          board: "OCSB",   url: "https://www.ocsb.ca/our-schools/" },
  { name: "Waterloo Region DSB",                   board: "WRDSB",  url: "https://www.wrdsb.ca/schools/" },
  { name: "Waterloo Catholic DSB",                 board: "WCDSB",  url: "https://www.wcdsb.ca/our-schools/" },
  { name: "Thames Valley DSB (London area)",       board: "TVDSB",  url: "https://www.tvdsb.ca/en/our-schools/" },
  { name: "Durham DSB",                            board: "DDSB",   url: "https://www.ddsb.ca/en/our-schools/" },
  { name: "Limestone DSB (Kingston area)",         board: "LDSB",   url: "https://www.limestone.on.ca/our_schools" },
  { name: "Upper Grand DSB (Guelph area)",         board: "UGDSB",  url: "https://www.ugdsb.ca/schools/" },
];

function Research({ adminToken }) {
  const [jobs, setJobs] = useState([]);
  const [pending, setPending] = useState([]);
  const [form, setForm] = useState({ name: "", boardName: "", indexUrl: "", maxSchools: 30 });
  const [msg, setMsg] = useState("");
  // Scan state: { status: idle|scanning|done|error, elapsed?, result? }
  const [scan, setScan] = useState({ status: "idle" });

  async function loadJobs() {
    const j = await fetch(`${API}/admin/blast/research`, { headers: { "x-admin-token": adminToken } }).then(r => r.json());
    setJobs(j.jobs || []);
  }
  async function loadPending() {
    const j = await fetch(`${API}/admin/blast/contacts/pending`, { headers: { "x-admin-token": adminToken } }).then(r => r.json());
    setPending(j.contacts || []);
  }
  useEffect(() => { loadJobs(); loadPending(); }, []);

  async function addJob() {
    if (!form.name || !form.indexUrl) { setMsg("Name + index URL required"); return; }
    setMsg("Adding…");
    const res = await fetch(`${API}/admin/blast/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify(form),
    });
    const j = await res.json();
    setMsg(j.ok ? "✓ Queued" : `✗ ${j.error}`);
    if (j.ok) { setForm({ name: "", boardName: "", indexUrl: "", maxSchools: 30 }); loadJobs(); }
  }

  async function addPreset(p) {
    await fetch(`${API}/admin/blast/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ name: p.name, boardName: p.board, indexUrl: p.url, maxSchools: 30 }),
    });
    loadJobs();
  }

  async function runNow(id) {
    await fetch(`${API}/admin/blast/research/${id}/run`, { method: "POST", headers: { "x-admin-token": adminToken } });
    setTimeout(() => { loadJobs(); loadPending(); }, 2000);
  }
  async function delJob(id) {
    if (!confirm("Remove this research job?")) return;
    await fetch(`${API}/admin/blast/research/${id}`, { method: "DELETE", headers: { "x-admin-token": adminToken } });
    loadJobs();
  }

  async function scanFolder() {
    const startedAt = Date.now();
    setScan({ status: "scanning", startedAt });
    // Tick the elapsed counter every 250ms so the user sees it isn't frozen
    const tickInt = setInterval(() => {
      setScan(s => s.status === "scanning" ? { ...s, elapsed: Math.floor((Date.now() - startedAt) / 100) / 10 } : s);
    }, 250);
    try {
      const res = await fetch(`${API}/admin/blast/import-folder`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": adminToken }, body: "{}",
      });
      const j = await res.json();
      clearInterval(tickInt);
      const totalMs = Date.now() - startedAt;
      if (j.ok) {
        setScan({ status: "done", result: j, totalMs });
        // refresh the pending list in case research-discovered contacts were affected
        loadPending();
      } else {
        setScan({ status: "error", error: j.error || "Unknown error", totalMs });
      }
    } catch (e) {
      clearInterval(tickInt);
      setScan({ status: "error", error: e.message, totalMs: Date.now() - startedAt });
    }
  }

  async function approvePending(emails) {
    await fetch(`${API}/admin/blast/contacts/approve`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ emails }),
    });
    loadPending();
  }
  async function rejectPending(emails) {
    if (!confirm(`Delete ${emails.length} pending contact(s)?`)) return;
    await fetch(`${API}/admin/blast/contacts/reject`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ emails }),
    });
    loadPending();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <H>Add a region to the research queue</H>
          <p className="text-xs text-white/60 mb-3">
            The worker picks up one job per calendar day (configurable via <code>BLAST_RESEARCH_JOBS_PER_DAY</code>),
            fetches the index URL, extracts up to <code>maxSchools</code> school links, and uses OpenAI to pull
            principal/VP/AD names + emails. Findings land in Contacts as <Pill color="amber">pendingReview</Pill> until you approve.
          </p>

          <L>Quick-add: Ontario boards</L>
          <div className="flex gap-1 flex-wrap mb-4">
            {PRESET_REGIONS.map(p => (
              <button key={p.board} onClick={() => addPreset(p)}
                className="px-2 py-1 text-xs rounded bg-white/5 border border-white/10 hover:bg-white/10">
                + {p.board}
              </button>
            ))}
          </div>

          <L>Custom region</L>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <input placeholder="Name (e.g. TDSB schools)" value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              className="px-2 py-1 rounded bg-white/5 border border-white/10" />
            <input placeholder="Board tag (e.g. TDSB)" value={form.boardName}
              onChange={(e) => setForm(f => ({ ...f, boardName: e.target.value }))}
              className="px-2 py-1 rounded bg-white/5 border border-white/10" />
            <input placeholder="Index URL (https://...)" value={form.indexUrl}
              onChange={(e) => setForm(f => ({ ...f, indexUrl: e.target.value }))}
              className="px-2 py-1 rounded bg-white/5 border border-white/10 col-span-2" />
            <input type="number" min={1} max={100} placeholder="Max schools" value={form.maxSchools}
              onChange={(e) => setForm(f => ({ ...f, maxSchools: parseInt(e.target.value, 10) || 30 }))}
              className="px-2 py-1 rounded bg-white/5 border border-white/10" />
            <Btn onClick={addJob}>Queue job</Btn>
          </div>
          {msg && <div className="mt-2 text-xs">{msg}</div>}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <H>Auto-import xlsx</H>
          <p className="text-xs text-white/60 mb-3">
            Scans the workspace folder for <code>*-school-admins.xlsx</code> and <code>*-schools.xlsx</code>
            and adds every row to the master Contacts list. Runs automatically at server boot — click below to re-run now.
          </p>
          <Btn variant="ghost" onClick={scanFolder} disabled={scan.status === "scanning"}>
            {scan.status === "scanning" ? "Scanning…" : "Scan workspace folder"}
          </Btn>

          {scan.status === "scanning" && (
            <div className="mt-3 flex items-center gap-2 text-xs text-white/70">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-white/30 border-t-blue-400 animate-spin" />
              Scanning xlsx files… <span className="text-white/40">({(scan.elapsed ?? 0).toFixed(1)}s)</span>
            </div>
          )}

          {scan.status === "done" && (
            <div className="mt-3 text-xs">
              <div className="text-emerald-300 font-semibold mb-2">
                ✓ {scan.result.inserted || 0} new, {scan.result.updated || 0} updated, {scan.result.skipped || 0} skipped — in {(scan.totalMs / 1000).toFixed(1)}s
              </div>
              {scan.result.files && scan.result.files.length > 0 && (
                <table className="w-full text-[11px] border border-white/10 rounded">
                  <thead className="bg-white/5 text-white/50">
                    <tr>
                      <th className="text-left px-2 py-1">File</th>
                      <th className="text-right px-2 py-1">Rows</th>
                      <th className="text-right px-2 py-1">New</th>
                      <th className="text-right px-2 py-1">Updated</th>
                      <th className="text-right px-2 py-1">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.result.files.map(f => (
                      <tr key={f.file} className="border-t border-white/5">
                        <td className="px-2 py-1 text-white/80">{f.file}</td>
                        <td className="px-2 py-1 text-right text-white/60">{f.rows ?? "—"}</td>
                        <td className="px-2 py-1 text-right text-emerald-400">{f.inserted ?? "—"}</td>
                        <td className="px-2 py-1 text-right text-white/60">{f.updated ?? "—"}</td>
                        <td className="px-2 py-1 text-right text-white/40">{f.ms ? `${f.ms}ms` : f.error ? <span className="text-red-300">{f.error}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="text-white/40 mt-2">Folder: <code>{scan.result.folder}</code></div>
            </div>
          )}

          {scan.status === "error" && (
            <div className="mt-3 text-xs text-red-300">✗ {scan.error}</div>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <H>Queued / completed jobs</H>
          {jobs.length === 0 && <div className="text-white/60 text-sm">No research jobs yet.</div>}
          <div className="space-y-2">
            {jobs.map(j => {
              const color = j.status === "running" ? "amber" : j.status === "done" ? "green" : j.status === "failed" ? "red" : "slate";
              return (
                <div key={j._id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="font-semibold">{j.name}</div>
                    <Pill color={color}>{j.status}</Pill>
                  </div>
                  <div className="text-xs text-white/60 break-all">{j.boardName} · {j.indexUrl}</div>
                  <div className="text-xs text-white/60 mt-1">
                    {j.schoolsAttempted || 0}/{j.maxSchools} schools attempted · {j.contactsAdded || 0} contacts added
                    {j.lastRunAt && ` · last run ${new Date(j.lastRunAt).toLocaleString()}`}
                  </div>
                  {j.lastError && <div className="text-xs text-red-300 mt-1">{j.lastError}</div>}
                  <div className="flex gap-1 mt-2">
                    <Btn variant="ghost" onClick={() => runNow(j._id)}>Run now</Btn>
                    <Btn variant="danger" onClick={() => delJob(j._id)}>Remove</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <H>Pending review ({pending.length})</H>
          <p className="text-xs text-white/60 mb-3">
            Research-discovered contacts land here until you approve them. Approved contacts become available in the
            main Contacts list and can be selected for campaigns.
          </p>
          {pending.length === 0 && <div className="text-white/60 text-sm">Nothing pending.</div>}
          {pending.length > 0 && (
            <>
              <div className="flex gap-2 mb-2">
                <Btn onClick={() => approvePending(pending.map(c => c.email))}>Approve all</Btn>
                <Btn variant="danger" onClick={() => rejectPending(pending.map(c => c.email))}>Reject all</Btn>
              </div>
              <div className="max-h-96 overflow-y-auto text-xs">
                {pending.map(c => (
                  <div key={c.email} className="flex items-center justify-between gap-2 py-1 border-b border-white/5">
                    <div>
                      <div>{c.firstName} {c.lastName} <span className="text-white/40">({c.role})</span></div>
                      <div className="text-white/50">{c.email} · {c.school} / {c.board}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => approvePending([c.email])} className="px-2 py-0.5 rounded bg-emerald-700 text-emerald-100">✓</button>
                      <button onClick={() => rejectPending([c.email])} className="px-2 py-0.5 rounded bg-red-700 text-red-100">✗</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* CONTACTS                                                                 */
/* ────────────────────────────────────────────────────────────────────── */
function Contacts({ adminToken }) {
  const [contacts, setContacts] = useState([]);
  const [stats, setStats] = useState(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [filters, setFilters] = useState({ board: "", role: "", q: "", status: "" });
  const limit = 100;

  async function load() {
    const params = new URLSearchParams({ limit, skip });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const j = await fetch(`${API}/admin/blast/contacts?${params}`, { headers: { "x-admin-token": adminToken } }).then(r => r.json());
    setContacts(j.contacts || []);
    setTotal(j.total || 0);
  }
  async function loadStats() {
    const j = await fetch(`${API}/admin/blast/contacts/stats`, { headers: { "x-admin-token": adminToken } }).then(r => r.json());
    setStats(j);
  }
  useEffect(() => { load(); loadStats(); /* eslint-disable-next-line */ }, [skip, filters]);

  return (
    <div className="space-y-4">
      {stats && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <div className="flex flex-wrap gap-4 items-center">
            <div><span className="text-white/60">Total:</span> <strong>{stats.total}</strong></div>
            <div><span className="text-white/60">Contacted:</span> <strong className="text-emerald-400">{stats.contacted}</strong></div>
            <div><span className="text-white/60">Never contacted:</span> <strong className="text-amber-400">{stats.neverContacted}</strong></div>
          </div>
          <div className="mt-2 text-xs text-white/60">
            By board: {stats.byBoard?.map(b => `${b._id || "?"} ${b.contacted}/${b.n}`).join("  ·  ")}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <input placeholder="Search name/email/school" value={filters.q}
          onChange={(e) => { setSkip(0); setFilters(f => ({ ...f, q: e.target.value })); }}
          className="px-2 py-1 rounded bg-white/5 border border-white/10" />
        <input placeholder="Board (HWDSB, HDSB…)" value={filters.board}
          onChange={(e) => { setSkip(0); setFilters(f => ({ ...f, board: e.target.value })); }}
          className="px-2 py-1 rounded bg-white/5 border border-white/10" />
        <input placeholder="Role (Principal…)" value={filters.role}
          onChange={(e) => { setSkip(0); setFilters(f => ({ ...f, role: e.target.value })); }}
          className="px-2 py-1 rounded bg-white/5 border border-white/10" />
        <select value={filters.status}
          onChange={(e) => { setSkip(0); setFilters(f => ({ ...f, status: e.target.value })); }}
          className="px-2 py-1 rounded bg-white/5 border border-white/10">
          <option value="">All status</option>
          <option value="contacted">Contacted</option>
          <option value="never">Never contacted</option>
        </select>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">School / Board</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">Last contacted</th>
              <th className="text-left px-3 py-2">Campaigns</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.email} className="border-t border-white/5">
                <td className="px-3 py-2">{c.firstName} {c.lastName}</td>
                <td className="px-3 py-2 text-white/70">{c.email}</td>
                <td className="px-3 py-2 text-white/70">{c.school} <span className="text-white/40">/ {c.board}</span></td>
                <td className="px-3 py-2 text-white/70">{c.role}</td>
                <td className="px-3 py-2">
                  {c.lastContactedAt
                    ? <span className="text-emerald-400">{new Date(c.lastContactedAt).toLocaleDateString()} · {c.lastProduct}</span>
                    : <span className="text-amber-400">never</span>}
                </td>
                <td className="px-3 py-2">{c.totalCampaigns} <span className="text-white/40">({c.sentCount} sent)</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center text-sm">
        <span className="text-white/60">{total} contacts · showing {skip + 1}–{Math.min(skip + limit, total)}</span>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => setSkip(Math.max(0, skip - limit))} disabled={skip === 0}>Prev</Btn>
          <Btn variant="ghost" onClick={() => setSkip(skip + limit)} disabled={skip + limit >= total}>Next</Btn>
        </div>
      </div>
    </div>
  );
}
