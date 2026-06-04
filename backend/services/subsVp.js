// backend/services/subsVp.js
//
// Resolve the "appropriate VP" for a grade. Precedence:
//   1. the grade's own vpEmail override (rare)
//   2. the VP of the division (grade range) the grade belongs to
//   3. the school's default vpEmail
// Shared by notification routing, the approvals scoping, and /me's VP check
// so they all agree on who a grade's VP is.

// Full contact for the appropriate VP: { email, name, phone }.
export function gradeVpContact(gradeLevel, school) {
  if (gradeLevel?.vpEmail) return { email: gradeLevel.vpEmail, name: "", phone: "" };
  if (gradeLevel?.division && school?.divisions?.length) {
    const d = school.divisions.find((x) => x.name === gradeLevel.division);
    if (d?.vpEmail) return { email: d.vpEmail, name: d.vpName || "", phone: d.vpPhone || "" };
  }
  return { email: school?.vpEmail || "", name: school?.vpName || "", phone: school?.vpPhone || "" };
}

export function gradeVp(gradeLevel, school) {
  return gradeVpContact(gradeLevel, school).email;
}

// Does the school's VP-approval policy let the VP approve this request?
export function vpCanApprove(school, request) {
  const policy = school?.vpApproval || "none";
  if (policy === "all") return true;
  if (policy === "sick_only") return /sick/i.test(request?.reason || "");
  return false;
}
