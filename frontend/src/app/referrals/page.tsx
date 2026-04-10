// frontend/src/app/referrals/page.tsx
"use client";
import React from "react";
import Link from "next/link";
import { ArrowRight, Gift, Link2, Users, CheckCircle, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api.curriculate.net";

const steps = [
  { icon: <Link2 className="w-6 h-6 text-blue-600" />, title: "Share your code", desc: "Send your personal referral code to teachers and schools." },
  { icon: <Users className="w-6 h-6 text-purple-600" />, title: "They subscribe", desc: "They enter your code at checkout and get started with Curriculate." },
  { icon: <Gift className="w-6 h-6 text-emerald-600" />, title: "You earn commission", desc: "Earn a percentage on every subscription tied to your code." },
];

function ApplicationForm() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [organization, setOrganization] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "submitting" | "success" | "already" | "error">("idle");
  const [errorMsg, setErrorMsg] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch(`${API_BASE}/api/admin/referral-applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          organization: organization.trim(),
          message: message.trim(),
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      if (data?.alreadyApplied) {
        setStatus("already");
      } else {
        setStatus("success");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-600" />
        </div>
        <h3 className="text-2xl font-extrabold text-gray-900 mb-2">Application received!</h3>
        <p className="text-gray-600 font-medium max-w-md mx-auto">
          Check your email for a confirmation. We&apos;ll review your application and send you your
          personal referral code within 24 hours.
        </p>
      </div>
    );
  }

  if (status === "already") {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
          <CheckCircle className="w-8 h-8 text-blue-600" />
        </div>
        <h3 className="text-2xl font-extrabold text-gray-900 mb-2">You&apos;ve already applied!</h3>
        <p className="text-gray-600 font-medium max-w-md mx-auto">
          We have your application on file. If you haven&apos;t heard back yet, we&apos;ll be in touch soon.
          Check your email for updates.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">
          Organization <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          placeholder="School, district, or company"
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">
          Tell us about yourself <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="How do you plan to promote Curriculate? (e.g., teacher networks, PD events, social media)"
          rows={3}
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition resize-none"
        />
      </div>

      {status === "error" && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-medium">
          {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={status === "submitting" || !name.trim() || !email.trim()}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {status === "submitting" ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            Apply Now <ArrowRight className="w-5 h-5" />
          </>
        )}
      </button>
    </form>
  );
}

export default function ReferralsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-6 py-14">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-5xl sm:text-6xl font-black text-gray-900 mb-4">Referral Program</h1>
        <p className="text-xl text-gray-700 font-medium max-w-3xl mb-10">
          Earn commission by sharing Curriculate with teachers and schools. Apply below to get your personal referral code.
        </p>

        {/* How it works */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div key={s.title} className="bg-white rounded-3xl shadow-2xl border border-gray-200 p-8">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mb-4">
                {s.icon}
              </div>
              <h2 className="text-2xl font-extrabold text-gray-900 mb-2">{s.title}</h2>
              <p className="text-gray-700 font-medium">{s.desc}</p>
            </div>
          ))}
        </div>

        {/* Commission details */}
        <div className="mt-10 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-3">How commissions work</h3>
          <div className="space-y-2 text-gray-800 font-medium">
            {[
              "Earn a percentage of every subscription tied to your referral code.",
              "Commissions are tracked automatically — you can check your stats any time.",
              "Your referrals can also receive a discount on their first payment.",
              "Payouts are handled directly by the Curriculate team.",
              "No limits on how many teachers or schools you can refer.",
            ].map((x) => (
              <div key={x} className="flex items-start gap-3">
                <span className="mt-2 w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span>{x}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Application form */}
        <div className="mt-10 bg-white rounded-3xl shadow-2xl border border-gray-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-2">Apply to become a referral partner</h3>
          <p className="text-gray-600 font-medium mb-6">
            Fill in your details below. We&apos;ll review your application and send you your personal referral code and commission details via email.
          </p>
          <ApplicationForm />
        </div>

        {/* Already have a code? */}
        <div className="mt-10 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-3xl border border-emerald-200 p-10">
          <h3 className="text-2xl font-extrabold text-gray-900 mb-3">Already have a referral code?</h3>
          <p className="text-gray-700 font-medium mb-6">
            Share these links with your prospects along with your code. Teachers enter the code at checkout.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-blue-700"
            >
              curriculate.net <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/ai-grading"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-white text-lg font-black shadow-xl hover:bg-emerald-700"
            >
              Free AI Grading Tool <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-gray-900 text-lg font-black shadow-xl border border-gray-200 hover:bg-gray-50"
            >
              Pricing Page
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
