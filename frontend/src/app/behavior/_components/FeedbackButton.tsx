"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { api, getToken } from "../_lib/api";

// A floating "Feedback" button on every Behaviours page. Opens a small panel so
// teachers can request revisions / report issues; it emails the school's admins
// (and copies the sender). Hidden when signed out.
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const pathname = usePathname();

  if (typeof window !== "undefined" && !getToken()) return null;

  async function send() {
    if (!message.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await api<{ ok: boolean; error?: string }>("/feedback", { body: { message: message.trim(), page: pathname } });
      if (r.ok) { setMsg("✓ Thanks — sent to the admins."); setMessage(""); setTimeout(() => { setOpen(false); setMsg(""); }, 1600); }
      else setMsg(`✗ ${r.error || "Could not send."}`);
    } catch (e: any) { setMsg(`✗ ${e.message}`); } finally { setBusy(false); }
  }

  return (
    <div className="no-print fixed bottom-4 right-4 z-20">
      {open ? (
        <div className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Feedback &amp; requests</h3>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
          </div>
          <p className="mt-1 text-xs text-slate-400">Bugs, ideas, anything you&apos;d like changed. Goes to your admins; you&apos;re copied.</p>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} autoFocus
            placeholder="What would make this better?"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <div className="mt-2 flex items-center justify-between gap-2">
            {msg ? <span className={`text-xs ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</span> : <span />}
            <button onClick={send} disabled={busy || !message.trim()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-md hover:bg-slate-50">
          💬 Feedback
        </button>
      )}
    </div>
  );
}
