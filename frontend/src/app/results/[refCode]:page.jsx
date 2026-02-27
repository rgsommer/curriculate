// app/results/[refCode]/page.jsx

import ResultsPage from "../page";

export default function ResultsByCode({ params }) {
  const initialCode = (params?.refCode || "").toUpperCase();
  return <ResultsPage initialCode={initialCode} autoLookup />;
}