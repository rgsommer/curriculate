// backend/services/subsVp.js
//
// Resolve the "appropriate VP" for a grade. Precedence:
//   1. the grade's own vpEmail override (rare)
//   2. the VP of the division (grade range) the grade belongs to
//   3. the school's default vpEmail
// Shared by notification routing, the approvals scoping, and /me's VP check
// so they all agree on who a grade's VP is.

export function gradeVp(gradeLevel, school) {
  if (gradeLevel?.vpEmail) return gradeLevel.vpEmail;
  if (gradeLevel?.division && school?.divisions?.length) {
    const d = school.divisions.find((x) => x.name === gradeLevel.division);
    if (d?.vpEmail) return d.vpEmail;
  }
  return school?.vpEmail || "";
}
