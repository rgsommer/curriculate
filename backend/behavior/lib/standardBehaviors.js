// backend/behavior/lib/standardBehaviors.js
//
// The Brampton CS Junior High standard behaviour set (also a sensible default
// for other Christian JH schools). Upserted by name — missing ones are added,
// existing ones left untouched. "nnn" is replaced with the student's name by the
// AI/personalize step; serious behaviours are IMMEDIATE; write-lines
// consequences carry a next-school-day follow-up.

export const STANDARD_BEHAVIORS = [
  { name: "Computer use without permission", keyword: "computer", description: "Students are not permitted to use their computers unless explicitly given permission." },
  { name: "No computer or charger", keyword: "preparedness", description: "Students are expected to have a working, charged computer (and a charger at school) for every class. Getting this note probably means this has been an ongoing concern rather than a one-off." },
  { name: "Dishonesty & not completing work", keyword: "honesty", description: "Dishonesty about, or failure to complete, assigned work." },
  { name: "Disrespecting others", keyword: "respect", description: "nnn knows to treat others with respect, whether fellow students or adults." },
  { name: "Cheating on a test", keyword: "honesty", triggerMode: "IMMEDIATE", description: "There is a certain amount of trust we place in students in the education process. nnn was found to be involved in willful dishonesty. This is under review with administration." },
  { name: "Cheating on a class game", keyword: "honesty", description: "We use games to help learning. It is disappointing that nnn would spoil it for the class by cheating." },
  { name: "Damaging school property", keyword: "property", description: "nnn knows to treat all school property with respect." },
  { name: "Disrespectful during devotions/prayer", keyword: "faith", description: "Disrespectful or inattentive during devotions or prayer. We design these activities to be helpful for our students, including nnn." },
  { name: "Disrespectful on a class trip", keyword: "trip", description: "Disrespectful or inattentive during a class trip or tour. We plan these activities to benefit our students, including nnn." },
  { name: "Distracting during a presentation", keyword: "class time", description: "Inappropriate or distracting behaviour during another student's presentation." },
  { name: "Leaving a mess", keyword: "tidiness", description: "Students are expected to straighten and tidy around their desks, and tuck in their chairs, before leaving the classroom for the day or for lunch recess." },
  { name: "Lines not handed in", keyword: "follow-up", followUpType: "next_school_day", description: "Lines are expected to be handed in the very next day by 8:55 am." },
  { name: "Excessively loud at lunch", keyword: "lunch", description: "nnn was excessively loud during lunch. Students are expected to eat quietly at their seats; loud voices may be fine outside, but not inside." },
  { name: "Not focused / distracting others", keyword: "class time", description: "Not focused during the lesson, and even distracting others." },
  { name: "Not ready for class", keyword: "preparedness", description: "Students are expected to come prepared with class materials — textbook, notebook, pens, pencils, etc. Getting this note probably means nnn has not been ready more than once." },
  { name: "Not seated at start of class", keyword: "class time", description: "Students are expected to be seated and ready at the beginning of each class." },
  { name: "Not in assigned seat", keyword: "class time", description: "Not seated in the proper assigned seat. Free seating is sometimes allowed as a special privilege." },
  { name: "Rudeness", keyword: "respect", description: "Rudeness such as burping or similar things done in public to draw attention." },
  { name: "Sent out of class", keyword: "class time", triggerMode: "IMMEDIATE", description: "Sent out of class for disruptive behaviour — usually for a series of inappropriate actions. The hope is that nnn will learn from this." },
  { name: "Sleeping / tired in class", keyword: "class time", description: "Sleeping or excessively tired in class. Is nnn getting enough rest?" },
  { name: "Test protocol violation", keyword: "honesty", triggerMode: "IMMEDIATE", description: "During a test, students are not permitted to communicate with others or to look at others' screens or papers." },
  { name: "Tipping back on chair", keyword: "safety", description: "Tipping back after repeated warnings to keep their chair on four legs. This is hard on chairs, which are expensive to replace." },
  { name: "Unfocused during reading time", keyword: "class time", description: "Students are to follow the reading and stay engaged, even when it is not their turn to read." },
  { name: "Upset about a grade", keyword: "attitude", description: "nnn did not agree with the grade assigned, but after reasonable consideration and adjustment it is now what it should be, unless other factors come to light." },
  { name: "Use of class time", keyword: "class time", description: "When given time to work in class, students are expected to use their time wisely. Often this note means one or more assignments are outstanding in Edsby — parents, please check for overdue assignments." },
  { name: "Talking out", keyword: "class time", description: "The usual expectation is raising a hand and waiting to be called on." },
  { name: "Disruptive behaviour", keyword: "class time", description: "nnn was expected to be focused on the class work, and not to distract others." },
  { name: "Inappropriate language", keyword: "language", triggerMode: "IMMEDIATE", description: "Vulgar or disrespectful language." },
  { name: "Poor lunch behaviour", keyword: "lunch", description: "Students are expected to stay in their seats and clean up their area before leaving. Getting this note could mean nnn made a food mess." },
  {
    name: "Using God's name in vain", keyword: "faith", triggerMode: "IMMEDIATE", followUpType: "next_school_day",
    description: "Using God's Name carelessly or disrespectfully. God takes this seriously and it is offensive to those who believe.",
    consequenceText: "Write 10× for next school day before 9 am: “I will make sure I do not use God's Name in vain anymore. I realize it is offensive.”",
  },
  {
    name: "Poor chapel/assembly behaviour", keyword: "chapel", followUpType: "next_school_day",
    description: "Students are expected to be attentive and not distract others in chapel/assembly.",
    consequenceText: "Write 10× for next school day before 9 am: “I will make sure my behaviour in chapel is exemplary from now on.”",
  },
  {
    name: "Disrespectful", keyword: "respect", followUpType: "next_school_day",
    description: "Students are expected to treat others (teachers and fellow students) with respect.",
    consequenceText: "Write 10× for next school day before 9 am: “I will make sure my behaviour is respectful towards everyone from now on.”",
  },
  {
    name: "Insolence", keyword: "respect", triggerMode: "IMMEDIATE", followUpType: "next_school_day",
    description: "Speaking to a teacher in a disrespectful way, or disregarding what a teacher says.",
    consequenceText: "Write 10× for next school day before 9 am: “I will make sure I am respectful in my words and attitude from now on.”",
  },
];
