// app/results/[refCode]/page.jsx

"use client";

import ResultsPage from "../page.js";

function normalizeCode(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

export default function Page({ params }) {
  const initialCode = normalizeCode(params?.refCode); // ✅ matches [refCode]
  return <ResultsPage initialCode={initialCode} autoLookup={true} />;
}