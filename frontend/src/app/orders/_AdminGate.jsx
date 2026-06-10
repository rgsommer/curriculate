"use client";

/**
 * Shared admin gate for /orders/setup and /orders/summary. Signs the user in the
 * same way as the main page (existing curriculate login via SSO, else emailed
 * code), then checks the signed-in email against the configured finance email.
 * Renders children({ session, email }) only for the finance account.
 */

import { useEffect, useState } from "react";
import { getStoredSession, storeSession, clearSession, trySso, refreshAdmin } from "./_session";

export default function AdminGate({ title, children }) {
  const [stage, setStage] = useState("loading"); // loading | email | code | denied | ok
  const [email, setEmail] = useState("");
  const [codeToken, setCodeToken] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [devCode, setDevCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = getStoredSession();
      if (stored) {
        setSession(stored.session); setEmail(stored.email);
        // Re-check admin live so a just-added 2nd finance person isn't denied by a stale cache.
        const fresh = await refreshAdmin(stored.session);
        if (cancelled) return;
        const admin = fresh ? fresh.isAdmin : stored.isAdmin;
        setStage(admin ? "ok" : "denied"); return;
      }
      const sso = await trySso();
      if (cancelled) return;
      if (sso) {
        setSession(sso.session); setEmail(sso.email);
        setStage(sso.isAdmin ? "ok" : "denied");
      } else {
        setStage("email");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function requestCode(e) {
    e?.preventDefault(); setErr(""); setDevCode("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr("Enter a valid email."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/orders/auth/request-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not send a code.");
      setCodeToken(j.token); if (j.devCode) setDevCode(j.devCode); setStage("code");
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  async function verifyCode(e) {
    e?.preventDefault(); setErr("");
    if (!/^\d{6}$/.test(code.trim())) { setErr("Enter the 6-digit code."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/orders/auth/verify-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token: codeToken, code: code.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Invalid code.");
      storeSession({ session: j.session, email: j.email, isAdmin: j.isAdmin });
      setSession(j.session); setEmail(j.email);
      setStage(j.isAdmin ? "ok" : "denied");
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  function signOut() {
    clearSession();
    setSession(""); setCode(""); setCodeToken(""); setStage("email");
  }

  const shell = (inner) => (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">{title}</h1>
          <a href="/orders" className="text-sm text-indigo-600 hover:underline">← Ordering</a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{inner}</main>
    </div>
  );

  if (stage === "loading") return shell(<p className="text-sm text-slate-400">Loading…</p>);

  if (stage === "ok") {
    return shell(
      <>
        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">Signed in as {email}</span>
          <button onClick={signOut} className="text-slate-500 hover:underline">Sign out</button>
        </div>
        {children({ session, email })}
      </>
    );
  }

  if (stage === "denied") {
    return shell(
      <div className="max-w-md bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-semibold mb-1">Finance access only</h2>
        <p className="text-sm text-slate-500 mb-4">
          This page is for the finance account. You're signed in as <strong>{email}</strong>, which isn't the configured finance email.
        </p>
        <button onClick={signOut} className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700">
          Sign in with a different email
        </button>
      </div>
    );
  }

  // email / code login
  return shell(
    <div className="max-w-md mx-auto mt-6">
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{err}</div>}
      {stage === "email" && (
        <form onSubmit={requestCode} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">Finance sign in</h2>
          <p className="text-sm text-slate-500 mb-4">Enter the finance email to receive a 6-digit code.</p>
          <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="emcbride@bramptoncs.org"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 text-white py-2 font-medium hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      )}
      {stage === "code" && (
        <form onSubmit={verifyCode} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">Enter your code</h2>
          <p className="text-sm text-slate-500 mb-4">Sent to <strong>{email}</strong>.</p>
          {devCode && <div className="mb-3 text-xs rounded bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2">Dev code: <strong>{devCode}</strong></div>}
          <input inputMode="numeric" autoFocus value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456"
            className="w-full text-center text-2xl tracking-[0.4em] rounded-lg border border-slate-300 px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 text-white py-2 font-medium hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Verifying…" : "Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
