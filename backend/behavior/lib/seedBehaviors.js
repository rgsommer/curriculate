// backend/behavior/lib/seedBehaviors.js
//
// The standard division-wide behaviour list seeded at school setup (brief §5a).
// The originator can edit/add/remove these on the fly afterward. Trigger modes
// and consequences here are sensible defaults — the admin tunes them in Setup.

export const SEED_BEHAVIORS = [
  { name: "Talking out", triggerMode: "THRESHOLD", consequenceText: "Write the school expectation 10× before 9am the next school day.", followUpType: "next_school_day" },
  { name: "Disruptive behaviour", triggerMode: "THRESHOLD", consequenceText: "Write the school expectation 10× before 9am the next school day.", followUpType: "next_school_day" },
  { name: "Use of class time", triggerMode: "THRESHOLD", consequenceText: "Complete the missed work and see the teacher at lunch.", followUpType: "next_school_day" },
  { name: "Inappropriate language", triggerMode: "THRESHOLD", consequenceText: "Written apology.", followUpType: "next_school_day" },
  { name: "Poor lunch behaviour", triggerMode: "THRESHOLD", consequenceText: "See the teacher at lunch.", followUpType: "next_school_day" },
  { name: "No computer/charger", triggerMode: "THRESHOLD", consequenceText: "Bring the device charged the next school day.", followUpType: "next_school_day" },
  { name: "Using God's name in vain", triggerMode: "THRESHOLD", consequenceText: "Written reflection.", followUpType: "next_school_day" },
  { name: "Poor chapel/assembly behaviour", triggerMode: "THRESHOLD", consequenceText: "Written reflection.", followUpType: "next_school_day" },
  { name: "Disrespectful", triggerMode: "THRESHOLD", consequenceText: "Written apology.", followUpType: "next_school_day" },
  { name: "Insolence", triggerMode: "IMMEDIATE", consequenceText: "See me before the next class; parent contacted.", followUpType: "next_school_day" },
  { name: "Not seated at start of class", triggerMode: "THRESHOLD", consequenceText: "Write the school expectation 10× before 9am the next school day.", followUpType: "next_school_day" },
  { name: "Cheating", triggerMode: "IMMEDIATE", consequenceText: "Zero on the assessment; parent contacted; meeting required.", followUpType: "custom_deadline" },
];

/**
 * Build BehaviorSchema docs from the seed list for a given school.
 */
export function seedBehaviorDocs(schoolId) {
  return SEED_BEHAVIORS.map((b, i) => ({
    schoolId,
    name: b.name,
    description: b.description || "",
    triggerMode: b.triggerMode,
    consequenceText: b.consequenceText,
    followUpType: b.followUpType || "none",
    scope: "standard",
    ownerTeacherId: null,
    sortOrder: i,
  }));
}
