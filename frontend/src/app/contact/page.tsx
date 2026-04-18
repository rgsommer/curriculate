"use client";

import React from "react";

export default function ContactPage() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [status, setStatus] = React.useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [error, setError] = React.useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name || !email || !message) {
      setStatus("error");
      setError("Please complete all fields.");
      return;
    }

    setStatus("sending");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Failed to send");
      }

      setStatus("sent");
      setName("");
      setEmail("");
      setMessage("");
    } catch (err: any) {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">
          Contact
        </h1>
        <p className="text-xl text-gray-700 font-medium mb-10">
          For school plans, onboarding, or partnerships — send a message and we’ll
          respond promptly.
        </p>

        <div className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <form className="space-y-5" onSubmit={onSubmit}>
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-2">
                Name
              </label>
              <input
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-medium"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-800 mb-2">
                Email
              </label>
              <input
                type="email"
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-medium"
                placeholder="you@school.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-800 mb-2">
                Message
              </label>
              <textarea
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-medium min-h-[140px]"
                placeholder="Tell us what you’re looking for…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={status === "sending"}
              className={`w-full rounded-2xl px-6 py-4 text-white text-lg font-black shadow-xl transition
                ${
                  status === "sending"
                    ? "bg-blue-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
            >
              {status === "sending" ? "Sending…" : "Send Message"}
            </button>

            {status === "sent" && (
              <p className="text-sm font-bold text-emerald-700">
                Thanks! Your message has been sent.
              </p>
            )}

            {status === "error" && (
              <p className="text-sm font-bold text-rose-700">
                {error}
              </p>
            )}
          </form>
        </div>

        <div className="mt-10 text-center">
          <p className="text-sm font-bold text-gray-800 mb-4">Follow us</p>
          <div className="flex justify-center gap-6 text-sm font-semibold text-gray-600">
            <a className="hover:text-blue-600 transition" href="https://x.com/CurriculateNet" target="_blank" rel="noopener noreferrer">
              X / Twitter
            </a>
            <a className="hover:text-pink-600 transition" href="https://instagram.com/curriculategrading" target="_blank" rel="noopener noreferrer">
              Instagram
            </a>
            <a className="hover:text-gray-900 transition" href="https://tiktok.com/@curriculate_grading" target="_blank" rel="noopener noreferrer">
              TikTok
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
