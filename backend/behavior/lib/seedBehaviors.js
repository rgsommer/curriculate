// backend/behavior/lib/seedBehaviors.js
//
// The standard division-wide behaviour list seeded at school setup (brief §5a).
// The originator can edit/add/remove these on the fly afterward. Trigger modes
// and consequences here are sensible defaults — the admin tunes them in Setup.

export const SEED_BEHAVIORS = [
  // Document-only interaction (never notifies; appears first; in admin summary).
  { name: "Interaction", keyword: "interaction", triggerMode: "INTERACTION", consequenceText: "", followUpType: "none", description: "A documented interaction with the student — no notice home." },
  { name: "Talking out", keyword: "talking out", triggerMode: "THRESHOLD", consequenceText: "Write the school expectation 10× before 9am the next school day.", followUpType: "next_school_day" },
  { name: "Disruptive behaviour", keyword: "disruptive", triggerMode: "THRESHOLD", consequenceText: "Write the school expectation 10× before 9am the next school day.", followUpType: "next_school_day" },
  { name: "Use of class time", keyword: "class time", triggerMode: "THRESHOLD", consequenceText: "Complete the missed work and see the teacher at lunch.", followUpType: "next_school_day" },
  { name: "Inappropriate language", keyword: "language", triggerMode: "THRESHOLD", consequenceText: "Written apology.", followUpType: "next_school_day" },
  { name: "Poor lunch behaviour", keyword: "lunch", triggerMode: "THRESHOLD", consequenceText: "See the teacher at lunch.", followUpType: "next_school_day" },
  { name: "No computer/charger", keyword: "computer", triggerMode: "THRESHOLD", consequenceText: "Bring the device charged the next school day.", followUpType: "next_school_day" },
  { name: "Using God's name in vain", keyword: "God's name", triggerMode: "THRESHOLD", consequenceText: "Written reflection.", followUpType: "next_school_day" },
  { name: "Poor chapel/assembly behaviour", keyword: "chapel", triggerMode: "THRESHOLD", consequenceText: "Written reflection.", followUpType: "next_school_day" },
  { name: "Disrespectful", keyword: "disrespect", triggerMode: "THRESHOLD", consequenceText: "Written apology.", followUpType: "next_school_day" },
  { name: "Insolence", keyword: "insolence", triggerMode: "IMMEDIATE", consequenceText: "See me before the next class; parent contacted.", followUpType: "next_school_day" },
  { name: "Not seated at start of class", keyword: "seating", triggerMode: "THRESHOLD", consequenceText: "Write the school expectation 10× before 9am the next school day.", followUpType: "next_school_day" },
  { name: "Cheating", keyword: "cheating", triggerMode: "IMMEDIATE", consequenceText: "Zero on the assessment; parent contacted; meeting required.", followUpType: "custom_deadline" },
];

/**
 * Build BehaviorSchema docs from the seed list for a given school.
 */
export function seedBehaviorDocs(schoolId) {
  return SEED_BEHAVIORS.map((b, i) => ({
    schoolId,
    name: b.name,
    description: b.description || "",
    keyword: b.keyword || "",
    triggerMode: b.triggerMode,
    consequenceText: b.consequenceText,
    followUpType: b.followUpType || "none",
    scope: "standard",
    ownerTeacherId: null,
    sortOrder: i,
  }));
}
