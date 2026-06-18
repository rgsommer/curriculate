// Shared builder: turn an honour-roll snapshot's students into a
// student × subject grid CSV (each subject's current/Final average), plus
// Weighted Avg and the change-since-last-run. Used by the honour-roll panel's
// "Subject grid" download and the one-click "Pull final grades → CSV" button.

// Map an Edsby class name to a subject column: strip the trailing section
// ("Geography - 08" → "Geography"), then normalize a few to common labels.
export function subjectOf(className) {
  let s = String(className || "").replace(/\s*[-–]\s*\d.*$/, "").trim();
  const n = s.toLowerCase();
  if (/^math/.test(n)) return "Math";
  if (/christian ed|^ce$|religion/.test(n)) return "CE";
  if (/language arts|^ela$|^language$/.test(n)) return "English";
  if (/phys.*ed|^pe$|gym/.test(n)) return "PE";
  return s || className;
}

const SKIP = /homeroom|learning skill|advisory|study hall/i;

export function buildSubjectGridCsv(students) {
  const subjects = new Set();
  const rows = (students || []).map((s) => {
    const cell = {};
    for (const c of s.courses || []) {
      if (SKIP.test(c.name)) continue;
      const subj = subjectOf(c.name);
      subjects.add(subj);
      if (c.pct !== null && c.pct !== undefined) cell[subj] = c.pct;
    }
    const [first, ...rest] = String(s.name || "").split(" ");
    return {
      last: rest.join(" "),
      first,
      grade: s.grade || "",
      cell,
      weighted: s.weightedAvg ?? "",
      improvement: typeof s.improvement === "number" ? s.improvement : "",
    };
  });
  const subjCols = [...subjects].sort();
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  // Column 3 is the full name as "First Last" (handy for lookups).
  const header = ["Last Name", "First Name", "Name", "Grade", ...subjCols, "Weighted Avg", "Change vs last run"];
  const lines = [header.map(esc).join(",")];
  rows
    .sort((a, b) => (a.grade + a.last).localeCompare(b.grade + b.last))
    .forEach((r) => {
      const fullName = `${r.first} ${r.last}`.trim();
      lines.push([r.last, r.first, fullName, r.grade, ...subjCols.map((s) => r.cell[s] ?? ""), r.weighted, r.improvement].map(esc).join(","));
    });
  return lines.join("\n");
}

export function downloadCsvString(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
