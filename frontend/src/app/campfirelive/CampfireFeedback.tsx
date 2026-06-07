"use client";

import { useState } from "react";

function anonId() {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem("campfire_anon");
    if (!id) {
      id = "cf_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("campfire_anon", id);
    }
    return id;
  } catch {
    return "";
  }
}

// Floating feedback / ideas widget — posts to the shared /api/feedback pipeline
// (the same one the other Curriculate products use), tagged as campfire.
export default function CampfireFeedback() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anonId: anonId(),
          message: message.trim(),
          meta: {
            source: "campfire-feedback",
            product: "campfire",
            page: typeof window !== "undefined" ? window.location.pathname : "",
            email: email.trim() || undefined,
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Failed"));
      setDone(true);
      setMessage("");
      setEmail("");
    } catch {
      setError("Couldn't send — please try again.");
    }
    setSending(false);
  };

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setDone(false);
          setError("");
        }}
        title="Share feedback or an idea"
        className="fixed bottom-4 right-4 z-40 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:opacity-90"
      >
        💡 Feedback
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-2">🎉</div>
                <h3 className="font-bold text-slate-900">Thanks!</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Your idea is in — we read every one.
                </p>
                <button
                  onClick={() => setOpen(false)}
                  className="mt-4 rounded-full bg-slate-100 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-slate-900">💡 Feedback &amp; ideas</h3>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  What would make Campfire better? Bugs, ideas, anything. Leave your
                  email and a real person will get back to you. 💬
                </p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Your feedback or idea…"
                  autoFocus
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none resize-none"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email (we'll reply here)"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none"
                />
                {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
                <button
                  onClick={send}
                  disabled={sending || !message.trim()}
                  className="mt-3 w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
