import type { RawInputs } from "./parse";

// A Thursday-shaped sample of the DisplayAI / Setup cells, in the exact shape
// the Sheets API returns. Used by scripts/daily-parse-check.mjs and, outside
// production, by /api/daily when DAILY_FIXTURE=1 — so the board can be previewed
// on a laptop with no sheet credentials.

export const FIXTURE: RawInputs = {
  display: [
    ["Good morning, Thursday workers!", "", "", "0"],
    [],
    ["Week 1                       Brampton Christian School                      38 weeks left!"],
    [],
    ['Two short verses to remember for life. This is what He promises His followers: ~"God is our refuge and strength, a very present help in trouble." Psalm 46:1'],
    [],
    ["", "FALSE", "UNSCRAMBLE for a treat: TNOMISNEPEO ___ ___ ___ ___ ___ ___ ___ ___ ___ ___ ___", "FALSE"],
    ["", "", "Plans for Thursday, Sep 10, 2026...    -660--871--220--820--290-", "1"],
    ["10:00 AM", "FALSE", "Math 7A (22) 202 (J003) Today we practice solving equations and using properties of operations. How do properties help solve equations faster? - Complete NS7-3: p. 7 problems. - Complete NS7-4: p. 8 problems. Reminders: Test on Unit 1 (Number Sense) on Thu Sep 17; finish last day's work.", "AB1 & B2", "", "1"],
    ["59 minutes"],
    ["11:00 AM", "FALSE", "History 7A (22) 202 (H001) Today we introduce the course and begin the first assignment. What makes a useful historical perspective? - Pass out Intro and Due Dates handouts - Complete written task \"Historical Perspective\" p.2 - Find five challenging quotes about history (online or ChatGPT) Reminders: Written task Due Thu Sep 17. Textbook access link posted.", "A-FD & B1", "", "0"],
    ["12:00 PM", "FALSE", "Lunch", "REC"],
    ["12:20 PM", "FALSE", "Recess Duty", "REC"],
    ["12:55 PM", "FALSE", "CE 8A (22) - 212 (B003) Today we review God's word and the presentation on trusting Scripture. What helps you remember a Bible verse best? - Test the week's memory verse - Continue 'Can I Trust the Bible?' presentation (p.1) - Assign: Take one aspect of this year's theme verse and make a letter-sized poster, due Thu Sep 17 Reminders: Dress-down payments due BY Fri Sep 25 for fundraiser participation.", "AFD Only"],
    ["1:30 PM", "FALSE", "Math 7B (23) 207 (J002) Today we work on place value and order of operations. Why does the order you do things in change the answer? - Complete NS7-1: p. 2 problems. - Complete NS7-2: p. 5 problems. Reminders: Bring your textbook every class.", "B-B2"],
    ["2:30 PM", "FALSE", "Geography 8A (22) 212 (G002) Today we build vocabulary and begin reading about population patterns. How do maps show where people live and why? - Oral read p2: What is geography? Why study geography? - Build Chapter 1 term list in notebook (16 terms) - Read p18-23 to prepare for textbook work Reminders: Finish Chapter 1 term list due NEXT class; TERMS QUIZ (matching) next class; link posted", "AAll 3"],
    ["3:25 PM", "FALSE", "Dismissal Rm212"],
    ["4:00 PM", "", "Before you head out today, please: - Tidy your floor area and make sure your desk is neat. - If you've wronged someone, take a moment to say sorry and make it right."],
    ["", "", "Other Subjects/Reminders: Math Challenge Question (treat for FIRST correct answer in; max 1 win/week): Simplify: (5p + 6)(5p - 6)"],
  ],
  displayD: [[], [], [], [], [], [], [], [], ['=HYPERLINK("https://www.youtube.com/watch?v=dQw4w9WgXcQ","▶")'], [], ['=HYPERLINK("https://www.youtube.com/watch?v=dQw4w9WgXcQ","▶")']],
  displayC: [],
  setup: [
    [],
    ["", "School", "Brampton Christian School"],
    ["", "Teacher", "Mr. Sommer"],
    [],
    [],
    [],
    ["", "Time in advance to show next", "15", "minutes"],
    ["", "Time in advance to show reminders", "2", "minutes"],
    ["", "Change time to red", "3", "minutes before end"],
    ["", "Show homework from", "1", "days before"],
    ["", "Show homework", "1", "minutes before end of class"],
    ["", "Show riddle answer until", "12:30", "1"],
    ["", "Blank screen during announcements", "08:55", "09:00"],
    ["", "Show Dismissal List", "", "15:15:00"],
    ["", "Grade to show", "", "7"],
    ["", "Show pregnancy weeks during", "History", "15"],
    ["", "Can go to washroom x min before", "", "10"],
    ["", "Display riddle answer every", "3", "Lesson pic"],
    ["", "Snacks are allowed with B2 for", "5", "minutes"],
  ],
  slots: [
    ["6", "1", "", "5", "3", "2", ""],
    ["Vocab", "Verse & Poem", "Homework", "Kiss&Ride", "Gestation", "Lesson Pic", ""],
    ["FALSE", "FALSE", "TRUE", "FALSE", "FALSE", "C11", ""],
    ["", "", "Daily Update", "", "", "", ""],
    [],
    [],
    ["500", "800", "500", "200", "200", "600", "1300"],
  ],
  slotFormulas: [["", "", "", "", "", '=IMAGE("https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Quebec_1759.jpg/960px-Quebec_1759.jpg")', ""]],
  feature: "Q: A horse is on a 24 foot chain and wants an apple that is 26 feet away. How can the horse get to the apple?",
};
