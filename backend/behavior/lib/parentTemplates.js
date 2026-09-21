// backend/behavior/lib/parentTemplates.js
//
// Per-teacher parent-message templates: generalized defaults plus a placeholder
// filler. Teachers copy the generated message and send it themselves — the app
// never emails parents here; it just builds the text and logs that it was done.
//
// Placeholders (filled from student / parent / teacher / school data):
//   {student}                 preferred or first name
//   {parent1} {parent2}       parent first names (blank if unknown)
//   {parents}                 salutation: "A and B", "A", or "parents"
//   {parentEmails}            parent emails joined with "; " (for the To line)
//   {he} {him} {his}          pronouns from gender (they/them/their if unknown)
//   {He} {Him} {His}          capitalized pronouns
//   {teacher}                 the sending teacher's name / signature
//   {subject}                 the teacher's subject label
//   {school}                  school name

export const DEFAULT_PARENT_TEMPLATES = [
  {
    name: "Missing / incomplete work",
    kind: "corrective",
    body:
`Dear {parents},

Just a quick note about {student}'s missing or incomplete work in {subject}. This is affecting {his} grade, and any support you can give at home would be appreciated. Please let me know how I can support you on my side as well.

Btw, I enjoy having {student} in class!

{teacher}
{school}`,
  },
  {
    name: "Below expected behaviour",
    kind: "corrective",
    body:
`Dear {parents},

A quick, proactive note about {student}'s conduct in {subject}. Behaviour has been better in the past, but recently {he} has been contributing to a less-than-ideal classroom environment — talking out of turn, being off-task during work time, or being slightly disrespectful. Please let me know if there's anything I should be aware of on your side.

This is meant to help {student} take some corrective action early. I do my best to keep classes engaging, which is harder when behaviour slips, so whatever support you can give for {his} benefit would be appreciated.

{teacher}
{school}`,
  },
  {
    name: "Improvement",
    kind: "encouraging",
    body:
`Dear {parents},

Just a quick note to let you know I've seen a marked improvement in {student}'s behaviour in {subject} — I'm taking that as a really positive sign! Classes are easier and more enjoyable when behaviour is positive, so thank you. Whatever support you've been giving {student} is certainly appreciated as we work together.

{teacher}
{school}`,
  },
  {
    name: "Reminder / task",
    kind: "encouraging",
    body:
`Dear {parents},

All is well with {student} at school. Could you please give {him} a nudge to complete [the task] at [link]? It only takes a few minutes and gives {him} useful feedback.

If {he} could get to it today, that would be great. Thanks for your support — have a great day!

{teacher}
{school}`,
  },
  {
    name: "Encouragement / a blessing",
    kind: "encouraging",
    body:
`Dear {parents},

I just wanted to reach out and let you know how much I appreciate {student} in my class and in school. {He} has such a great personality and so much potential! Thank you for sharing the blessing {he} is with us — the time goes quickly, so enjoy {him} while you can.

Have a great day,
{teacher}
{school}`,
  },
  {
    name: "Disruption — for your awareness",
    kind: "corrective",
    body:
`Dear {parents},

Just a quick note to let you know I had to give {student} a consequence for being disruptive today. {He} is a valued part of the class and often has good things to contribute, but I'd like to gently rein in that tendency early. I'm not asking you to take further action — I just want you to be aware.

Have a great day,
{teacher}
{school}`,
  },
];

// they/them/their by default — a name never implies a gender; only an explicit
// gender field shifts the pronoun.
function pronouns(gender) {
  const g = String(gender || "").trim().toLowerCase();
  if (g.startsWith("m") || g === "boy") return { he: "he", him: "him", his: "his" };
  if (g.startsWith("f") || g === "girl") return { he: "she", him: "her", his: "her" };
  return { he: "they", him: "them", his: "their" };
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function fillTemplate(body, { student, teacher, subject, schoolName } = {}) {
  const first = (student?.preferredName || student?.firstName || "").trim();
  const parents = Array.isArray(student?.parents) ? student.parents : [];
  const names = parents.map((p) => String(p?.name || "").trim().split(/\s+/)[0]).filter(Boolean);
  const emails = parents.map((p) => String(p?.email || "").trim()).filter(Boolean);
  const salutation = names.length >= 2 ? `${names[0]} and ${names[1]}` : names[0] || "parents";
  const pr = pronouns(student?.gender);

  const map = {
    student: first,
    parent1: names[0] || "",
    parent2: names[1] || "",
    parents: salutation,
    parentEmails: emails.join("; "),
    he: pr.he, him: pr.him, his: pr.his,
    He: cap(pr.he), Him: cap(pr.him), His: cap(pr.his),
    teacher: (teacher || "").trim(),
    subject: (subject || "").trim() || "class",
    school: (schoolName || "").trim(),
  };
  return String(body || "").replace(/\{(\w+)\}/g, (m, key) => (key in map ? map[key] : m));
}
