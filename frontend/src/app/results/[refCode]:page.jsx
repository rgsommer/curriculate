// app/results/[refCode]/page.jsx

"use client";

import ResultsPage from "../page.jsx";

function normalizeCode(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

export default function ResultsCodeRoute({ params }) {
  const initialCode = normalizeCode(params?.code);
  return <ResultsPage initialCode={initialCode} autoLookup={true} />;
}