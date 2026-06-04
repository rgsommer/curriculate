// backend/services/subsVp.js
//
// Resolve the "appropriate VP" for a grade. Precedence:
//   1. the grade's own vpEmail override (rare)
//   2. the VP of the division (grade range) the grade belongs to
//   3. the school's default vpEmail
// Shared by notification routing, the approvals scoping, and /me's VP check
// so they all agree on who a grade's VP is.

// The division a grade belongs to — by explicit grade membership, falling
// back to the legacy name link. The grade IS the routing key; the division
// name is just a label.
export function divisionForGrade(gradeLevel, school) {
  if (!gradeLevel || !school?.divisions?.length) return null;
  const byMembership = school.divisions.find((d) => (d.gradeLevelIds || []).some((id) => String(id) === String(gradeLevel._id)));
  if (byMembership) return byMembership;
  if (gradeLevel.division) return school.divisions.find((d) => d.name === gradeLevel.division) || null;
  return null;
}

export function divisionNameForGrade(gradeLevel, school) {
  return divisionForGrade(gradeLevel, school)?.name || gradeLevel?.division || "";
}

// Full contact for the appropriate VP: { email, name, phone }.
export function gradeVpContact(gradeLevel, school) {
  if (gradeLevel?.vpEmail) return { email: gradeLevel.vpEmail, name: "", phone: "" };
  const d = divisionForGrade(gradeLevel, school);
  if (d?.vpEmail) return { email: d.vpEmail, name: d.vpName || "", phone: d.vpPhone || "" };
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
