/**
 * Keep the lesson writer from teaching the timetable.
 *
 * WHY THIS EXISTS
 * "MAPS testing" is the standardized test — Measures of Academic Progress —
 * written into the period the school gives it in. Handed to a model as a lesson
 * title it reads as cartography, and the board gets a confident, well-written
 * lesson that never existed:
 *
 *     How can maps help you solve real problems?
 *     Today we practice problem solving with maps and coordinates.
 *
 * The room then sees a question nobody is going to ask. The same thing happens
 * to every title that names an EVENT rather than a TOPIC — Chapel, Picture
 * Retakes, Supply, Mass, Assembly, Field trip, CAT4, EQAO — because a model
 * asked for a lesson will write one, and an acronym is the easiest thing in the
 * world to mistake for a subject.
 *
 * Two answers, and the second is the one that holds:
 *
 *   1. LESSON_TEXT_RULES — a paragraph for the prompt, so the model is told
 *      what to do with a title it does not recognise instead of guessing.
 *   2. plainLesson_() — the titles that recur here are not sent to the model at
 *      all. A test period needs no lesson written for it, and a rule that never
 *      calls the model cannot be talked out of its answer.
 *
 * HOW TO USE IT
 *   1. Extensions > Apps Script, paste this in, Save.
 *   2. In the function that writes a lesson, before the UrlFetchApp call:
 *
 *        var plain = plainLesson_(title);
 *        if (plain) return plain;           // nothing to generate
 *
 *      `plain` is { question: '', today: <the title, tidied>, plan: [] } —
 *      reshape it to whatever your generator returns.
 *   3. Add LESSON_TEXT_RULES to the instructions you send:
 *
 *        var prompt = LESSON_TEXT_RULES + '\n\n' + yourExistingPrompt;
 *
 * TUNING IT
 * NOT_A_TOPIC is the list, in plain sight. A title the model keeps inventing a
 * lesson for goes in it; a pattern catching a real lesson comes out. Run
 * `checkLessonTitles` to see which of the year's titles this would intercept,
 * before it intercepts any of them.
 */

/**
 * The rule for the model. It covers the open set — the acronym nobody has
 * thought to list yet — which the list below cannot.
 */
var LESSON_TEXT_RULES = [
  'The lesson cell is the teacher\'s own shorthand, and it does not always name',
  'a topic. It may name a test ("MAPS testing", "CAT4", "EQAO"), a school event',
  '(chapel, assembly, picture retakes, a field trip), or a routine (supply,',
  'catch-up, study hall).',
  '',
  'If the cell names one of those, do not write a lesson about it, and in',
  'particular do not treat an acronym or a proper noun as a subject: "MAPS',
  'testing" is a standardized test, not a lesson about maps. Return the title as',
  'it stands, with no question, no overview and no activities. An empty lesson is',
  'correct here; an invented one is shown to a room of students.',
  '',
  'If you are not sure whether a title names a topic or an event, treat it as an',
  'event and return it unchanged. Write a lesson only for a cell that plainly',
  'describes what the class will learn.',
].join('\n');

/**
 * Titles that are events, not topics.
 *
 * Deliberately narrow: each pattern has to name the thing itself, so "a map of
 * the Nile" and "test your hypothesis" are untouched. What is matched here is
 * never sent to the model.
 */
var NOT_A_TOPIC = [
  // Standardized testing. The capitals are the tell: MAP and MAPS are the test,
  // "Maps of the Nile" and "Map skills" are lessons — so this one pattern is
  // case-SENSITIVE, with the lookahead for a title written all in capitals.
  /\bMAPS?\b(?!\s+(?:OF|SKILLS?|AND|IN|TO|FOR)\b)/,
  /\bmaps?\s*(testing|test|assessment)\b/i,
  /\b(cat\s?4|eqao|osslt|psat|ccat|olsat)\b/i,
  /\bstandardi[sz]ed\s+(test|testing|assessment)/i,
  /\bbenchmark\s+(test|testing|assessment)/i,
  /\bdiagnostic\s+(test|testing|assessment)\b/i,

  // Days the class is not the class.
  /\b(chapel|assembly|mass|liturgy|prayer service)\b/i,
  /\b(picture|photo)\s+(day|retakes?)\b/i,
  /\bfield\s?trip\b/i,
  /\b(pd|p\.d\.)\s*day\b/i,
  /\b(supply|coverage|covering|sub|substitute)\b/i,
  /\b(fire|lockdown|evacuation)\s+drill\b/i,
  /\bno\s+(class|school)\b/i,
  /\b(study\s?hall|silent reading|catch[- ]?up|free period)\b/i,
];

/**
 * What to write for a title that is an event — or null, meaning generate.
 *
 * The title comes back as the teacher wrote it, bar a capital at the front.
 * Whatever else is in the cell is kept — a note in brackets is usually the one
 * useful instruction of the period ("bring a Chromebook").
 */
function plainLesson_(title) {
  var text = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
  if (!text) return null;

  for (var i = 0; i < NOT_A_TOPIC.length; i += 1) {
    if (NOT_A_TOPIC[i].test(text)) {
      return { question: '', today: tidyTitle_(text), plan: [] };
    }
  }
  return null;
}

/**
 * The title as the teacher wrote it, with a capital at the front.
 *
 * Nothing else is touched. Title-casing the words looked tidier on two examples
 * and then produced "Bring A Chromebook" and "Field Trip To The Conservation
 * Area"; the teacher's own capitals are better than any rule about them.
 */
function tidyTitle_(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every title in the Lessons tab this would intercept, in the Log.
 *
 * Read it before trusting it: a pattern that catches a real lesson is a lesson
 * the board stops showing, which is a worse fault than the one being fixed.
 */
function checkLessonTitles() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Lessons');
  if (!sheet) throw new Error('No tab called Lessons');

  var last = sheet.getLastRow();
  if (last < 3) return 'Nothing to check';

  var titles = sheet.getRange(3, 4, last - 2, 1).getValues();  // D — the lesson
  var caught = 0;
  for (var r = 0; r < titles.length; r += 1) {
    var plain = plainLesson_(titles[r][0]);
    if (plain) {
      caught += 1;
      Logger.log((r + 3) + '\t' + plain.today);
    }
  }

  var message = caught + ' of ' + titles.length + ' titles would be left as they stand';
  Logger.log(message);
  return message;
}
