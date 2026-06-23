"use client";

/**
 * /orders — School supply ordering for teachers.
 *
 * If already signed in elsewhere on curriculate.net (e.g. Behaviours), the page
 * signs you in automatically; otherwise it sends a 6-digit code to your email.
 * Then type a quantity beside any items you want from the catalog. On submit you
 * get an email confirmation and finance gets your order (non-zero lines only).
 * Prices/totals are recomputed server-side from the authoritative catalog.
 */

import { useMemo, useState, useEffect } from "react";
import { CATALOG as BUNDLED } from "./_catalog";
import { getStoredSession, storeSession, clearSession, trySso, refreshAdmin } from "./_session";

const money = (n) => "$" + (Math.round((n || 0) * 100) / 100).toFixed(2);

// Emoji icon fallback by category keyword, when an item has no image URL.
const ICONS = [
  [/batter/i, "🔋"], [/dry.?erase|marker|sharpie|expo/i, "🖊️"], [/crayon/i, "🖍️"],
  [/pencil/i, "✏️"], [/\bpens?\b/i, "🖊️"], [/highlighter/i, "🖍️"],
  [/paper|construction|bristol|cartridge|tissue|newsprint|foolscap|chart|easel|manilla|poster/i, "📄"],
  [/scissor/i, "✂️"], [/binder|duotang|report cover|folder|index/i, "📒"], [/glue/i, "🧴"],
  [/tape/i, "🩹"], [/calculator/i, "🧮"], [/clip|fastener|stapl/i, "📎"], [/envelope/i, "✉️"],
  [/ruler|protractor/i, "📐"], [/paint|tempera/i, "🎨"], [/clock/i, "🕐"], [/cord|power|extension/i, "🔌"],
  [/label/i, "🏷️"], [/note|post.?it/i, "🗒️"], [/eraser/i, "🧽"], [/board/i, "📋"],
  [/punch/i, "🕳️"], [/clay|model/i, "🧱"], [/chalk/i, "🪧"], [/tote|box|storage|bag/i, "📦"], [/exercise/i, "📓"],
];
function iconFor(category = "") {
  for (const [re, ic] of ICONS) if (re.test(category)) return ic;
  return "📦";
}

function ItemThumb({ item }) {
  const [err, setErr] = useState(false);
  if (item.image && !err) {
    return (
      <img src={item.image} alt="" loading="lazy" onError={() => setErr(true)}
        className="w-10 h-10 shrink-0 object-contain rounded bg-white border border-slate-200" />
    );
  }
  return (
    <div className="w-10 h-10 shrink-0 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-lg" aria-hidden="true">
      {iconFor(item.category)}
    </div>
  );
}

// Format a YYYY-MM-DD due date in local time (avoids the UTC off-by-one).
const fmtDue = (d) => {
  if (!d) return "";
  const [y, m, day] = String(d).split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
};

// Build supplier -> [{category, items[]}] from an item list, preserving order.
function buildGroups(items) {
  const bySup = new Map();
  const supPo = new Map();
  for (const it of items) {
    if (!bySup.has(it.supplier)) { bySup.set(it.supplier, new Map()); supPo.set(it.supplier, it.po); }
    const cats = bySup.get(it.supplier);
    if (!cats.has(it.category)) cats.set(it.category, []);
    cats.get(it.category).push(it);
  }
  return Array.from(bySup, ([supplier, cats]) => ({
    supplier,
    po: supPo.get(supplier),
    categories: Array.from(cats, ([category, its]) => ({ category, items: its })),
  }));
}

export default function OrdersPage() {
  // ---- auth ----
  const [stage, setStage] = useState("checking"); // checking | email | code | order | done
  const [email, setEmail] = useState("");
  const [codeToken, setCodeToken] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [devCode, setDevCode] = useState("");

  // ---- order ----
  const [catalog, setCatalog] = useState(BUNDLED);
  const [teacherName, setTeacherName] = useState("");
  const [qty, setQty] = useState({}); // { [id]: number }
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [result, setResult] = useState(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [amending, setAmending] = useState(null); // current submitted order being edited, or null
  const [dueDate, setDueDate] = useState(""); // "orders due by" date set by finance, or ""

  const groups = useMemo(() => buildGroups(catalog), [catalog]);

  // Sign in: stored session, else single-sign-on from an existing curriculate login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = getStoredSession();
      if (stored) {
        setSession(stored.session); setEmail(stored.email); setIsAdmin(stored.isAdmin);
        if (stored.name) setTeacherName(stored.name);
        setStage("order");
        // Refresh live: update Setup/Summary links, and if the session expired send to sign-in.
        refreshAdmin(stored.session).then((f) => {
          if (cancelled || !f) return;
          if (f.valid === false) { clearSession(); setSession(""); setIsAdmin(false); setStage("email"); return; }
          setIsAdmin(f.isAdmin);
        });
        return;
      }
      const sso = await trySso();
      if (cancelled) return;
      if (sso) {
        setSession(sso.session); setEmail(sso.email); setIsAdmin(sso.isAdmin);
        if (sso.name) setTeacherName(sso.name);
        setStage("order");
      } else {
        setStage("email");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load the active catalog (finance may have uploaded a newer one).
  useEffect(() => {
    fetch("/api/orders/catalog")
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j.items) && j.items.length) setCatalog(j.items); if (j && "dueDate" in j) setDueDate(j.dueDate || ""); })
      .catch(() => {});
  }, []);

  // Load this teacher's saved draft (cross-device) once signed in.
  useEffect(() => {
    if (!session || stage !== "order" || draftLoaded) return;
    let cancelled = false;
    fetch("/api/orders/draft?session=" + encodeURIComponent(session))
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        // An in-progress draft wins; otherwise seed from the current submitted order
        // so the teacher can amend (add/change/remove) and resubmit to replace it.
        const source = Array.isArray(j.items) && j.items.length ? j.items : (j.submitted?.items || []);
        if (source.length) {
          const m = {};
          for (const it of source) if (it?.id && it?.qty > 0) m[it.id] = it.qty;
          setQty(m);
        }
        if (j.submitted) setAmending(j.submitted);
        if (j.teacherName) setTeacherName((cur) => cur || j.teacherName);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDraftLoaded(true); });
    return () => { cancelled = true; };
  }, [session, stage, draftLoaded]);

  // Autosave the draft (debounced) so it follows the teacher across devices.
  useEffect(() => {
    if (!session || stage !== "order" || !draftLoaded) return;
    const items = Object.keys(qty)
      .map((id) => ({ id, sku: byId.get(id)?.sku || "", qty: qty[id] }))
      .filter((x) => x.qty > 0);
    const t = setTimeout(() => {
      fetch("/api/orders/draft", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, items, teacherName: teacherName.trim() }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [qty, teacherName, session, stage, draftLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestCode(e) {
    e?.preventDefault();
    setErr(""); setDevCode("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr("Please enter a valid email address."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/orders/auth/request-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not send a code.");
      setCodeToken(j.token);
      if (j.devCode) setDevCode(j.devCode);
      setStage("code");
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function verifyCode(e) {
    e?.preventDefault();
    setErr("");
    if (!/^\d{6}$/.test(code.trim())) { setErr("Enter the 6-digit code."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/orders/auth/verify-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token: codeToken, code: code.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Invalid code.");
      setSession(j.session); setIsAdmin(!!j.isAdmin); setStage("order");
      storeSession({ session: j.session, email: j.email, isAdmin: j.isAdmin });
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  function signOut() {
    clearSession();
    setSession(""); setIsAdmin(false); setStage("email");
    setCode(""); setCodeToken(""); setQty({}); setResult(null);
  }

  function setItemQty(id, val) {
    setQty((q) => {
      const n = Math.max(0, Math.floor(Number(val) || 0));
      const next = { ...q };
      if (n <= 0) delete next[id]; else next[id] = n;
      return next;
    });
  }

  const byId = useMemo(() => new Map(catalog.map((it) => [it.id, it])), [catalog]);

  const selected = useMemo(() => {
    return Object.keys(qty)
      .map((id) => ({ item: byId.get(id), qty: qty[id] }))
      .filter((x) => x.item && x.qty > 0)
      .map((x) => ({ ...x.item, qty: x.qty, lineTotal: Math.round(x.item.price * x.qty * 100) / 100 }));
  }, [qty, byId]);

  const runningTotal = useMemo(
    () => Math.round(selected.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
    [selected]
  );

  const q = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        categories: g.categories
          .map((c) => ({
            ...c,
            items: c.items.filter(
              (it) =>
                it.description.toLowerCase().includes(q) ||
                it.sku.toLowerCase().includes(q) ||
                it.category.toLowerCase().includes(q)
            ),
          }))
          .filter((c) => c.items.length > 0),
      }))
      .filter((g) => g.categories.length > 0);
  }, [q, groups]);

  function toggleCat(key) {
    setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  async function submitOrder() {
    setErr("");
    if (!teacherName.trim()) { setErr("Please enter your name so finance knows who ordered."); return; }
    if (selected.length === 0) { setErr("Add a quantity to at least one item."); return; }
    setBusy(true);
    try {
      try { localStorage.setItem("orders_name", teacherName.trim()); } catch {}
      const r = await fetch("/api/orders/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session, teacherName: teacherName.trim(),
          items: selected.map((l) => ({ id: l.id, sku: l.sku, qty: l.qty })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not submit your order.");
      setResult(j); setStage("done");
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function clearMyOrder() {
    if (!window.confirm("Clear your whole order and start over? This removes everything you've added and any order you've already submitted. This can't be undone.")) return;
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/orders/clear", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not clear your order.");
      setQty({}); setAmending(null); setResult(null); setQuery("");
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  // ---------------- render ----------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Supply Ordering</h1>
            <p className="text-sm text-slate-500">Classroom &amp; office supplies</p>
          </div>
          <div className="text-right">
            <nav className="flex gap-3 justify-end text-sm">
              <a className="text-indigo-600 hover:underline" href="/orders/features">Features</a>
              <a className="text-indigo-600 hover:underline" href="/orders/guide">Guide</a>
              {isAdmin && <a className="text-indigo-600 hover:underline" href="/orders/summary">School summary</a>}
              {isAdmin && <a className="text-indigo-600 hover:underline" href="/orders/setup">Setup</a>}
              {session && <button className="text-slate-500 hover:underline" onClick={signOut}>Sign out</button>}
            </nav>
            {session && <div className="text-xs text-slate-400 mt-0.5">{email}</div>}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{err}</div>}

        {stage === "checking" && (
          <p className="text-center text-sm text-slate-400 mt-16">Signing you in…</p>
        )}

        {/* ---- LOGIN: email ---- */}
        {stage === "email" && (
          <form onSubmit={requestCode} className="max-w-md mx-auto mt-10 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-1">Sign in</h2>
            <p className="text-sm text-slate-500 mb-4">Enter your school email and we'll send you a 6-digit code. If you're already signed in to Behaviours, you won't need one.</p>
            <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@bramptoncs.org"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <button disabled={busy} className="w-full rounded-lg bg-indigo-600 text-white py-2 font-medium hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </form>
        )}

        {/* ---- LOGIN: code ---- */}
        {stage === "code" && (
          <form onSubmit={verifyCode} className="max-w-md mx-auto mt-10 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-1">Enter your code</h2>
            <p className="text-sm text-slate-500 mb-4">We sent a 6-digit code to <strong>{email}</strong>.</p>
            {devCode && <div className="mb-3 text-xs rounded bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2">Dev mode (email not configured): your code is <strong>{devCode}</strong></div>}
            <input inputMode="numeric" autoFocus value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456"
              className="w-full text-center text-2xl tracking-[0.4em] rounded-lg border border-slate-300 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            <button disabled={busy} className="w-full rounded-lg bg-indigo-600 text-white py-2 font-medium hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button type="button" onClick={() => { setStage("email"); setCode(""); setErr(""); }} className="w-full text-sm text-slate-500 mt-3 hover:underline">
              Use a different email
            </button>
          </form>
        )}

        {/* ---- DONE ---- */}
        {stage === "done" && result && (
          <div className="max-w-2xl mx-auto mt-8 bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-green-700 mb-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
              <h2 className="text-lg font-semibold">{result.updated ? "Order updated" : "Order sent"}</h2>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Thanks, {teacherName}. Your order of <strong>{result.lineCount}</strong> item{result.lineCount === 1 ? "" : "s"} totalling <strong>{money(result.total)}</strong> was {result.updated ? "updated and re-sent" : "sent"} to finance, and a {result.updated ? "copy" : "confirmation"} is on its way to {email}. {result.updated ? "It replaces your previous order." : ""}
              {result.emailed && !result.emailed.teacher && (
                <span className="block mt-1 text-amber-600">(Email delivery is not configured in this environment, but your order was recorded.)</span>
              )}
            </p>
            <p className="text-xs text-slate-500 mb-4">Need to fix something? You can re-open and change your order anytime — resubmitting always replaces it.</p>
            <button onClick={() => { setResult(null); setQuery(""); setDraftLoaded(false); setStage("order"); }}
              className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700">
              Back to my order
            </button>
          </div>
        )}

        {/* ---- ORDER ---- */}
        {stage === "order" && (
          <div>
            {dueDate && (
              <div className="mb-4 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-2 text-sm font-medium flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                Orders due by {fmtDue(dueDate)}
              </div>
            )}
            {amending && (
              <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 text-sm">
                You have an order already submitted{amending.updatedAt ? ` on ${new Date(amending.updatedAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}` : ""}{amending.revision > 1 ? ` (revision ${amending.revision})` : ""}. It's loaded below — change quantities, add or remove items, then <strong>Update order</strong> to replace it.
              </div>
            )}
            <div className="grid md:grid-cols-[1fr_320px] gap-6 items-start">
            <div>
              <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-sm sticky top-0 z-10">
                <input value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search items by name, SKU, or category…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>

              {filteredGroups.map((g) => (
                <div key={g.supplier} className="mb-6">
                  <div className="flex items-baseline justify-between mb-2">
                    <h2 className="text-base font-bold text-slate-800">{g.supplier}</h2>
                    {g.po && <span className="text-xs text-slate-400">Blanket PO {g.po}</span>}
                  </div>
                  {g.categories.map((c) => {
                    const key = g.supplier + "|" + c.category;
                    const isOpen = !!q || open.has(key);
                    const catCount = c.items.reduce((n, it) => n + (qty[it.id] ? 1 : 0), 0);
                    return (
                      <div key={key} className="bg-white rounded-lg border border-slate-200 mb-2 overflow-hidden">
                        <button onClick={() => !q && toggleCat(key)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50">
                          <span className="font-medium text-sm text-slate-700">
                            {c.category}
                            <span className="text-slate-400 font-normal"> · {c.items.length}</span>
                            {catCount > 0 && <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">{catCount} added</span>}
                          </span>
                          {!q && <svg className={`transition-transform ${isOpen ? "rotate-180" : ""}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>}
                        </button>
                        {isOpen && (
                          <div className="divide-y divide-slate-100">
                            {c.items.map((it) => (
                              <div key={it.id} className="flex items-center gap-3 px-3 py-2">
                                <input type="number" min="0" value={qty[it.id] ?? ""}
                                  onChange={(e) => setItemQty(it.id, e.target.value)} placeholder="0"
                                  className={`w-16 shrink-0 rounded border px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${qty[it.id] ? "border-indigo-400 bg-indigo-50 font-semibold" : "border-slate-300"}`} />
                                <ItemThumb item={it} />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-slate-800 leading-snug">{it.description}</div>
                                  <div className="text-xs text-slate-400">{it.sku} · {it.uom}</div>
                                </div>
                                <div className="text-sm text-slate-600 whitespace-nowrap">{money(it.price)}<span className="text-slate-400">/{String(it.uom).replace(/^1 /, "")}</span></div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {filteredGroups.length === 0 && (
                <div className="text-sm text-slate-500 bg-white rounded-lg border border-slate-200 p-4">No items match “{query}”.</div>
              )}
            </div>

            <aside className="md:sticky md:top-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <label className="block text-sm font-medium text-slate-700 mb-1">Your name</label>
              <input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="e.g. Jane Smith"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />

              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-semibold text-slate-800">Your order</h3>
                <span className="text-xs text-slate-400">{selected.length} item{selected.length === 1 ? "" : "s"}</span>
              </div>

              {selected.length === 0 ? (
                <p className="text-sm text-slate-400 mb-4">Type a quantity beside any item to add it here.</p>
              ) : (
                <ul className="mb-3 max-h-72 overflow-auto divide-y divide-slate-100">
                  {selected.map((l) => (
                    <li key={l.id} className="py-2 flex items-start gap-2 text-sm">
                      <span className="font-semibold text-indigo-700 w-7 shrink-0">{l.qty}×</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-slate-700 leading-snug truncate" title={l.description}>{l.description}</span>
                        <span className="text-xs text-slate-400">{money(l.price)} · {l.uom}</span>
                      </span>
                      <span className="whitespace-nowrap text-slate-700">{money(l.lineTotal)}</span>
                      <button onClick={() => setItemQty(l.id, 0)} className="text-slate-300 hover:text-red-500" title="Remove">×</button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-between border-t border-slate-200 pt-3 mb-3">
                <span className="font-semibold">Total</span>
                <span className="text-lg font-bold">{money(runningTotal)}</span>
              </div>
              <button disabled={busy || selected.length === 0} onClick={submitOrder}
                className="w-full rounded-lg bg-indigo-600 text-white py-2.5 font-medium hover:bg-indigo-700 disabled:opacity-50">
                {busy ? (amending ? "Updating…" : "Sending…") : (amending ? "Update order" : "Send order")}
              </button>
              <p className="text-xs text-slate-400 mt-2 text-center">{amending ? "Replaces your current order. " : ""}Finance and you both get an email copy.</p>
              {(amending || selected.length > 0) && (
                <button disabled={busy} onClick={clearMyOrder}
                  className="w-full mt-3 text-sm text-slate-500 hover:text-red-600 disabled:opacity-50">
                  Clear my order &amp; start over
                </button>
              )}
            </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
