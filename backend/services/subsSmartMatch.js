// backend/services/subsSmartMatch.js
//
// AI-assisted matching — ADVISORY ONLY. The deterministic eligibility
// filter (subsMatching.isEligible) remains the hard gate on the escalation
// hot path; this is for the admin to lean on when a request is hard to fill
// (e.g. zero strictly-qualified candidates). It suggests the closest subs
// with a short reason, handling synonyms the exact-match filter can't
// ("HS Math" ≈ "Senior Math" ≈ "Math 11").
//
// Falls back to a deterministic heuristic (matchScore) when OPENAI_API_KEY
// isn't set, so it works in dev and never blocks.

import { isEligible, eligibilityReasons, matchScore } from "./subsMatching.js";

function heuristic(request, candidates) {
  return candidates
    .map((c) => {
      const eligible = isEligible(c, request);
      const score = matchScore(c, request);
      const reasons = eligibilityReasons(c, request);
      return {
        teacherId: String(c._id),
        name: c.name || c.email,
        eligible,
        fit: Math.round((eligible ? 0.6 + score * 0.4 : score * 0.6) * 100),
        reason: eligible ? "Meets all requirements." : `Close, but ${reasons.join(", ")}.`,
      };
    })
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 8);
}

function buildPrompt(request, gradeName, candidates) {
  const req = {
    grade: gradeName,
    requiredRole: request.requiredRole || "teacher",
    requiredQualifications: request.requiredQualifications || [],
    requiredFaithFit: request.requiredFaithFit || [],
    date: request.date,
  };
  const subs = candidates.map((c) => ({
    teacherId: String(c._id),
    name: c.name || c.email,
    roleTypes: c.roleTypes || ["teacher"],
    qualifications: c.qualifications || [],
    gradeComfort: c.gradeComfort || [],
    adminRating: c.reliability?.adminRating ?? null,
    tags: c.reliability?.tags || [],
  }));
  return (
    `A school needs a substitute. Rank the candidates by how well they fit, treating subject names flexibly ` +
    `(e.g. "HS Math" ≈ "Senior Math" ≈ "Math 11"; "SpEd" ≈ "Special Education"). Required role/qualifications are ` +
    `strong signals but use judgement for near-misses. Return JSON: {"suggestions":[{"teacherId","fit":0-100,"reason":"one short sentence"}]}, ` +
    `best first, at most 8.\n\nREQUEST:\n${JSON.stringify(req)}\n\nCANDIDATES:\n${JSON.stringify(subs)}`
  );
}

export async function smartMatch({ request, gradeName, candidates }) {
  if (!candidates?.length) return [];
  const key = process.env.OPENAI_API_KEY;
  if (!key) return heuristic(request, candidates);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "gpt-4.1-mini",
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: "You match substitute teachers to assignments. Output ONLY valid JSON." },
          { role: "user", content: buildPrompt(request, gradeName, candidates) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const byId = new Map(candidates.map((c) => [String(c._id), c]));
    const out = (parsed.suggestions || [])
      .map((s) => {
        const c = byId.get(String(s.teacherId));
        if (!c) return null;
        return { teacherId: String(c._id), name: c.name || c.email, eligible: isEligible(c, request), fit: Math.max(0, Math.min(100, Number(s.fit) || 0)), reason: String(s.reason || "").slice(0, 200) };
      })
      .filter(Boolean);
    return out.length ? out : heuristic(request, candidates);
  } catch (e) {
    console.warn("[subs] smartMatch fell back to heuristic:", e?.message || e);
    return heuristic(request, candidates);
  }
}
