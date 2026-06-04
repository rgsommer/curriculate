"use client";

/**
 * curriculate.net/subs/features — marketing / explainer for principals.
 *
 * Reframed around the real problem administrators describe: finding a
 * substitute is the single most stressful part of the morning. Each
 * feature card maps to a concrete challenge from the field.
 */

import React from "react";

const wrap = { maxWidth: 920, margin: "0 auto", padding: "32px 20px 80px", fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif", color: "#0f172a" };
const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, marginTop: 22 };

const FEATURES = [
  ["🌅", "Built for the 5–7 a.m. scramble", "A mobile morning dashboard shows every open absence at a glance — sorted by urgency and time-to-bell, with a live countdown and fill status. Post an absence in seconds from your phone."],
  ["📞", "Calls your subs for you, in order", "Rank your preferred subs per grade. The system contacts them one at a time — 5-minute steps when it's same-day urgent, longer for planned absences — until one accepts. First yes wins; the rest stop. It keeps going even if nobody replies."],
  ["🎯", "Only offers jobs to qualified subs", "Match on what actually matters: subject certification (French, HS math, chemistry…), role type (teacher vs EA vs specialist vs tech), and grade comfort. Unqualified subs are never offered the job — and you're warned the moment a posting has zero qualified candidates."],
  ["📲", "Subs choose how they're reached", "Email, text, or both. A sub registered with several schools gets a clear text — \"BCS: teach Gr5 on Jun 5\" — and taps Accept or Skip, and can send themselves a test to confirm it works. One login shows them every school they serve."],
  ["📋", "Lesson plans travel with the job", "Attach the plan, materials links, classroom routines, and system logins. Passwords are encrypted at rest and revealed only to the sub who accepts. Subs can see how complete a plan is — and you can pre-stage templates for surprise absences."],
  ["🤝", "Internal coverage when no sub is found", "Out of subs? Record split-class, admin, EA-reassignment, or prep coverage in one tap. The system tracks how often each staff member gets pulled — so you can spot burnout and share the load fairly."],
  ["⭐", "Remembers who's great", "Acceptance rate, on-time record, and your private post-assignment ratings build a quality profile — \"strong in primary,\" \"great with junior high.\" It informs your ranking without ever overriding your judgment."],
  ["✝️", "Mission fit, when it matters", "Optionally require or prefer subs who align with your statement of faith, are comfortable leading devotions, or share your school's values. Fully configurable — non-faith schools simply leave it off."],
  ["📍", "Fair to hard-to-staff schools", "Store sub and school locations and let subs set a travel limit and preferred schools, so proximity factors into ranking and chronically under-filled schools aren't left starved."],
  ["💵", "Keeps an eye on the budget", "Track per-sub day rates and your coverage budget, see running spend, and distinguish paid external coverage from internal — so a tight month doesn't surprise you."],
  ["🤒", "Teachers report their own absences", "A sick teacher opens the app and submits 'I need a sub' — date, reason, and whether it's a whole day, half day (AM/PM), or specific times like 9–11am. It lands in your approvals queue; approve and the contacting starts automatically."],
  ["🎙️", "Hear it for yourself (optional)", "If you're someone who likes to know a teacher is genuinely under the weather, you can require a short voice note on sick-day requests — play it right from the approval. If a teacher's mic won't cooperate, they're never blocked; it just flags that recording failed."],
  ["🔗", "One link onboards all staff", "Send every teacher a single sign-up link (we even copy a ready-to-send email to your clipboard). They enter their name and the grade they teach — so the system already knows their VP. No roster to build by hand."],
  ["✅", "Approve in a tap — or let your VP", "Teacher-reported absences wait for approval so nothing goes out without your say-so. You decide how much authority your VP has: nothing, sick days only, or everything — and the right VP is looped in automatically."],
  ["📨", "The right people, automatically", "When a sub accepts, the system notifies the substitute, the appropriate VP (who handles lesson plans), finance, and the absent teacher — who can reply-all with their plans, VP cc'd. You're done."],
  ["📊", "Absence records & reports", "Every absence is logged per teacher. See a breakdown by reason on screen or email yourself a report on demand. Teachers can see their own record too."],
  ["🔄", "Plans change? It re-fills itself", "If a sub who accepted has to back out, they cancel in a tap — the request reopens and the system automatically resumes contacting the next available subs. You're notified, and so is the next person in line."],
  ["🗺️", "Directions, one tap", "When a sub accepts, their confirmation email and screen include a Google Maps link straight to the school — handy for someone covering a building they don't usually work in."],
];

export default function SubsFeaturesPage() {
  return (
    <div style={wrap}>
      <a href="/subs" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
        ← Back to sign in
      </a>
      <h1 style={{ fontSize: 32, fontWeight: 800, margin: "18px 0 8px" }}>Finding a sub shouldn't be the worst part of your day</h1>
      <p style={{ fontSize: 18, color: "#475569", lineHeight: 1.55, maxWidth: 680 }}>
        Principals tell us the same thing: when a teacher calls in sick at 6 a.m., the frantic round of phone calls is the most
        stressful part of the job. Curriculate Subs does the calling — matching the right people, in your order, until the class is
        covered — so you can focus on the rest of your morning.
      </p>

      <div style={grid}>
        {FEATURES.map(([icon, title, body]) => (
          <div key={title} style={card}>
            <div style={{ fontSize: 26 }}>{icon}</div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "8px 0 6px" }}>{title}</h3>
            <p style={{ color: "#475569", fontSize: 14, lineHeight: 1.5, margin: 0 }}>{body}</p>
          </div>
        ))}
      </div>

      <div style={{ ...card, marginTop: 26, textAlign: "center", background: "#0f172a", color: "#fff", border: 0 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>Ready to cover tomorrow's absences in minutes?</h2>
        <p style={{ color: "#cbd5e1", margin: "0 0 18px" }}>Set up your school, rank your subs, and post your first request.</p>
        <a href="/subs" style={{ background: "#2563eb", color: "#fff", padding: "12px 26px", borderRadius: 10, textDecoration: "none", fontWeight: 700, display: "inline-block" }}>
          Get started
        </a>
      </div>
    </div>
  );
}
