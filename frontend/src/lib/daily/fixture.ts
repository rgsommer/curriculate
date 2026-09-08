import type { RawInputs } from "./parse";

// A Thursday-shaped sample of the DisplayAI / Setup cells, in the exact shape
// the Sheets API returns. Used by scripts/daily-parse-check.mjs and, outside
// production, by /api/daily when DAILY_FIXTURE=1 — so the board can be previewed
// on a laptop with no sheet credentials.

export const FIXTURE: RawInputs = {
  display: [
    ["Good morning, Thursday workers!", "", "", "0"],
    [" Tomorrow: MAPS Roster Due"],
    ["Week 1                       Brampton Christian School                      38 weeks left!"],
    [],
    ['Two short verses to remember for life. This is what He promises His followers: ~"God is our refuge and strength, a very present help in trouble." Psalm 46:1'],
    ["", "", "Pray for Albania"],
    ["", "FALSE", "UNSCRAMBLE for a treat: TNOMISNEPEO ___ ___ ___ ___ ___ ___ ___ ___ ___ ___ ___", "FALSE"],
    ["", "", "Plans for Thursday, Sep 10, 2026...    -660--871--220--820--290-", "1"],
    ["10:00 AM", "FALSE", "Math 7A (22) 202 (J003) Today we practice solving equations and using properties of operations. How do properties help solve equations faster? - Complete NS7-3: p. 7 problems. - Complete NS7-4: p. 8 problems. - Complete the Introduction Fill-In-the-Blanks worksheet (or from this link: https://docs.google.com/document/d/1YzABCdefGHIjkLMnop/edit?tab=t.0) Reminders: Test on Unit 1 (Number Sense) on Thu Sep 17; finish last day's work. Getting to Know You form http://tinyurl.com/BCSQuickCheckin", "AB1 & B2", "", "1"],
    ["59 minutes"],
    ["11:00 AM", "FALSE", "History 7A (22) 202 (H001) Today we introduce the course and begin the first assignment. What makes a useful historical perspective? - Pass out Intro and Due Dates handouts - Complete written task \"Historical Perspective\" p.2 - Find five challenging quotes about history (online or ChatGPT) Reminders: Written task Due Thu Sep 17. Textbook access link posted.", "A-FD & B1", "", "0"],
    ["12:00 PM", "FALSE", "Lunch", "REC"],
    ["12:20 PM", "FALSE", "Recess Duty", "REC"],
    ["12:55 PM", "FALSE", "CE 8A (22) - 212 (B003) Today we review God's word and the presentation on trusting Scripture. What helps you remember a Bible verse best? - Test the week's memory verse - Continue 'Can I Trust the Bible?' presentation (p.1) - Assign: Take one aspect of this year's theme verse and make a letter-sized poster, due Thu Sep 17 Reminders: Dress-down payments due BY Fri Sep 25 for fundraiser participation.", "AFD Only"],
    ["1:30 PM", "FALSE", "Math 7B (23) 207 (J002) Today we work on place value and order of operations. Why does the order you do things in change the answer? - Complete NS7-1: p. 2 problems. - Complete NS7-2: p. 5 problems. Reminders: Bring your textbook every class.", "B-B2"],
    ["2:30 PM", "FALSE", "Geography 8A (22) 212 (G002) Today we build vocabulary and begin reading about population patterns. How do maps show where people live and why? - Oral read p2: What is geography? Why study geography? - Build Chapter 1 term list in notebook (16 terms) - Read p18-23 to prepare for textbook work Reminders: Finish Chapter 1 term list due NEXT class; TERMS QUIZ (matching) next class; link posted", "AAll 3"],
    ["3:25 PM", "FALSE", "Dismissal Rm212"],
    ["4:00 PM", "", "Before you head out today, please remember: 1) Tidy your floor area and make sure your desk is neat. 2) If you've wronged someone today, take a moment to say sorry and make it right.  And as you go, receive this blessing: \u201cNow may the God of peace equip you with everything good so that you may do His will.\u201d"],
    ["", "", "Other Subjects/Reminders: Math Challenge Question (treat for FIRST correct answer in; max 1 win/week): Simplify: (5p + 6)(5p - 6)"],
  ],
  displayD: [[], [], [], [], [], [], [], [], ['=HYPERLINK("https://www.youtube.com/watch?v=dQw4w9WgXcQ","▶")'], [], ['=HYPERLINK("https://www.youtube.com/watch?v=dQw4w9WgXcQ","▶")']],
  displayC: [[], [], [], [], [], ['=HYPERLINK("https://prayercast.com/albania.html","Pray for Albania")']],
  // A handout attached to a phrase with Insert > Link, invisible to both the
  // value and the formula.
  displayCRuns: [[], [], [], [], [], [], [], [], [], [],
    [{ text: "Due Dates handout", url: "https://example.org/due-dates.pdf" }],
  ],
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
  // Setup!T1:AA8. Column T is a row label; the E1 formula's HLOOKUP runs on
  // U to AA, so the slots proper start one column in.
  slotBlock: [
    ["Priority", "6", "1", "", "5", "3", "2", ""],
    ["Name", "Vocab", "Verse & Poem", "Homework", "Kiss&Ride", "Gestation", "Lesson Pic", ""],
    ["On?", "FALSE", "FALSE", "TRUE", "FALSE", "FALSE", "C11", ""],
    ["Value", "", "", "Daily Update", "", "", "", ""],
    [],
    [],
    ["Seconds", "500", "800", "500", "200", "200", "600", "1300"],
  ],
  slotBlockFormulas: [
    [], [], [],
    ["", "", "", "=Setup!C6", "", "", '=IMAGE("https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Quebec_1759.jpg/960px-Quebec_1759.jpg")', ""],
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
  // Points row 3 names the classes; row 46 holds four flags each (7A at M, 7B at
  // Z, 7C at AM, 8A at AZ, 8B at BM), which the D-column status rule reads.
  pointsRow3: (() => { const r: string[] = []; r[3] = "7A"; r[16] = "7B"; r[29] = "7C"; r[42] = "8A"; r[55] = "8B"; return r; })(),
  pointsRow46: (() => {
    const r: string[] = [];
    const blocks: [number, string][] = [[12, "1100"], [25, "0110"], [38, "1010"], [51, "1110"], [64, "0100"]];
    blocks.forEach(([base, digits]) => {
      digits.split("").forEach((d, k) => { r[base + k] = d; });
    });
    return r;
  })(),
  poems: [
    ["Mon", "Tue", "Wed", "Thu", "Fri"],
    ["Monday poem", "Tuesday poem", "Wednesday poem", "The fisherman goes out at dawn", "Friday poem"],
    ["Poem of the week: The Fisherman, by Abbie Farwell Brown"],
  ],
  poemFormulas: [[], [], []],
  vertical: [
    ["", "", "", "", "", "", ""],
    ["1", "", "Mon update", "Tue update", "Wed update",
      "Things you need to know for today...\nGeography 8A term list is due next class.\nSkip 7A Bring your textbook to every class.\nDress-down payments due Fri Sep 25.",
      "Fri update"],
  ],
  riddles: [["Riddle for week 1"], ["Riddle for week 2"]],
  master: [["Week"], ["1"]],
  feature: "Q: A horse is on a 24 foot chain and wants an apple that is 26 feet away. How can the horse get to the apple?",
  // Setup!N1:Q8 — when the end-of-day package comes up, and how far ahead.
  setupMessages: [
    ["For Dismissal Messages", "", "", ""],
    ["Lunch", "12:00", "", "5"],
    ["Lunch Recess", "12:20", "", "minutes before Dismissal list"],
    ["Dismissal", "15:30", "", ""],
  ],
  // Verses!A1:A400 and Vertical!B4 \u2014 what A5 picks the day's verse from.
  verses: [
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
    ['Do you ever face temptations? Did you know that in your own strength you will fail? Here\u2019s a promise for those trusting in God. ~"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability." 1 Corinthians 10:13'],
  ],
  verseWeek: [["1"]],
  // The Kiss & Ride tab, as its "Waiting (Recent First)" column is returned.
  waiting: [
    ["Kiss & Ride", "", ""],
    ["Waiting (Recent First)", "", "Called"],
    ["Nguyen, Mia (8A)", "", "3:26 PM"],
    ["Okafor, Daniel (7B)", "", "3:27 PM"],
    ["Silva, Ana (7A)", "", "3:28 PM"],
  ],
};
