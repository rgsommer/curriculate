// backend/services/subsGradeOrder.js
//
// Natural curriculum ordering for grade-level names, so grades always
// render JK → SK → Grade 1 … Grade 12 (not creation order). Unknown/custom
// names sort after the standard ladder, alphabetically.

const ORDER = [
  "pre-k", "pre k", "prek",
  "jk", "junior kindergarten",
  "sk", "senior kindergarten",
  "kindergarten", "k",
  ...Array.from({ length: 12 }, (_, i) => `grade ${i + 1}`),
];

const norm = (s) => String(s || "").trim().toLowerCase();

export function gradeIndex(name) {
  const i = ORDER.indexOf(norm(name));
  return i === -1 ? 999 : i;
}

export function sortGrades(grades) {
  return [...(grades || [])].sort(
    (a, b) => gradeIndex(a?.name) - gradeIndex(b?.name) || String(a?.name || "").localeCompare(String(b?.name || ""))
  );
}
