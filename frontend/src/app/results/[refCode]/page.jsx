// app/results/[refCode]/page.jsx
import ResultsPage from "../page.jsx";

function normalizeCode(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
}

export default function Page({ params }) {
  const initialCode = normalizeCode(params?.refCode);
  return <ResultsPage initialCode={initialCode} autoLookup={true} />;
}