/**
 * The journal on a test, review or quiet-work day: about the unit, not about
 * getting through the period.
 *
 * WHY THIS EXISTS
 * The lesson writer puts a journal line in each class, and on a day whose lesson
 * cell describes how the period will RUN rather than what it is ABOUT, it has
 * nothing to write about but the running of it. Both of these are real:
 *
 *     Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra.
 *     🍎 Journal: … What practical steps, thoughts, or prayers helped you handle
 *     stress and do your best? How could you apply those strategies during
 *     today's test?
 *
 *     Today we use quiet work time to complete assigned review tasks.
 *     🍎 Journal: When you have a long list like today's, how do you decide what
 *     to do first and stay focused? Describe one strategy that helps you keep
 *     momentum when working quietly and independently.
 *
 * Two journals about study skills, set for a room that is about to spend the
 * period inside the unit itself. These are the days the whole unit is in their
 * heads at once, and the half hour is worth more than a prompt about momentum.
 *
 * So the journal on such a day is about the unit:
 *
 *   - on a TEST day, forward to the unit coming next where one is known, else
 *     back over the unit just tested. Forward is preferred: it is the only one
 *     of the two they can still act on;
 *   - on a REVIEW or QUIET-WORK day the unit is still in play, so it looks at
 *     the unit in hand — what is still not clear, what they would say about it
 *     to someone who missed those classes.
 *
 * HOW TO USE IT
 *   1. Extensions > Apps Script, paste this in, Save.
 *   2. Add the rule to the instructions you send the model:
 *
 *        var prompt = JOURNAL_RULES + '\n\n' + yourExistingPrompt;
 *
 *      Where you already add LESSON_TEXT_RULES, add this after it.
 *   3. Give the model the unit names when you have them — it cannot see further
 *      down the Lessons tab than the row you hand it:
 *
 *        var about = unitsAround_(code, topic);          // {unit, next}
 *        if (about.unit) prompt += '\nThe unit in hand is: ' + about.unit + '.';
 *        if (about.next) prompt += '\nThe next unit is: ' + about.next + '.';
 *
 *   4. Check what came back before it goes in the cell, because a rule in a
 *      prompt is a request and this one is easy to drift from:
 *
 *        journal = fixJournal_(journal, topic, about);
 *
 *      It returns the model's own line where that line is fine, and a written
 *      one where it is a journal about study skills.
 *
 * TUNING IT
 * ROUTINE_SKILLS is the list of shapes that count as a journal about getting
 * through the period, and ABOUT_THE_ROUTINE the days the rule applies to. Both
 * are in plain sight below. Run `checkJournals` to see every journal line in
 * VerticalAi this would replace, with its replacement, before it replaces any of
 * them: a journal wrongly replaced is a good prompt lost.
 */

/**
 * The rule for the model.
 */
var JOURNAL_RULES = [
  'THE JOURNAL ON A TEST, REVIEW OR QUIET-WORK DAY.',
  '',
  'Some lesson cells describe how the period will RUN rather than what it is',
  'ABOUT: a test or quiz, a review period, quiet work time, a work period, a',
  'study guide or practice test. On those days the journal is NOT about getting',
  'through the period. Do not ask about nerves, stress, staying calm or focused,',
  'keeping momentum, deciding what to do first, prioritising, time management,',
  'working independently, study habits, or strategies of any kind. The class is',
  'about to spend the period inside the unit; a prompt about the running of it',
  'teaches them nothing and takes the one quiet half hour the unit gets.',
  '',
  'Write about THE UNIT instead:',
  '',
  '1. On a TEST day, look FORWARD to the unit coming next where one is given.',
  '   What do they already half-know about it? What do they want to be able to',
  '   do by the end of it? Where might it show up outside this classroom? This',
  '   is the best of the prompts here, being the only one they can still act on.',
  '',
  '2. On a TEST day with no next unit given, look BACK over the unit just',
  '   tested: which idea took the longest to come clear, and what finally made',
  '   it clear? What do they understand now that they did not in the first week',
  '   of it?',
  '',
  '3. On a REVIEW or QUIET-WORK day the unit is still in play, so write about',
  '   the unit in hand: which idea is still not clear and what would make it',
  '   clear? How would they explain the hardest part of it to someone who missed',
  '   those classes? Which part will they still be able to use a year from now?',
  '',
  'Name the unit. "Think about what you learned" is a prompt about nothing; use',
  'the unit names given to you, and where none are given, the topic of the',
  'lesson itself. Keep it to two or three questions, in the second person, the',
  'way the other journals are written. A verse or a line of Scripture is welcome',
  'where it fits the subject, as in the other journals; it is not required.',
].join('\n');

/**
 * A journal line that is about getting through the period rather than about the
 * work of it.
 *
 * Each pattern names the thing itself. A unit genuinely about stress — a health
 * unit, say — would be written about in its own words ("how stress affects the
 * body") rather than in these, which are all about the student sitting at the
 * desk rather than about anything being learned.
 */
var ROUTINE_SKILLS = [
  // Writing the test.
  //
  // The apostrophe is the curly one as often as not — the cell is typed in
  // Google Sheets, which turns it — so both are allowed everywhere one appears.
  /\b(during|before|for)\s+(today['’]?s?|the|this|your)\s+(test|quiz|exam|assessment)\b/i,
  /\b(test|exam)\s*(-|\s)?\s*(taking|day)\s+(skill|strategy|strategies|tip|technique)/i,
  /\b(test|exam)\s+(anxiety|nerves|stress|jitters)\b/i,
  /\b(nervous|anxious|stressed|worried)\b[^.?!]{0,60}\b(test|quiz|exam)\b/i,
  /\b(test|quiz|exam)\b[^.?!]{0,60}\b(nervous|anxious|stressed|calm|worried)\b/i,
  /\bhow\s+(did|do)\s+you\s+(prepare|study)\b[^.?!]{0,40}\b(test|quiz|exam)\b/i,
  /\bhandle\s+(the\s+)?(stress|pressure|nerves)\b/i,
  /\bdo\s+your\s+best\b[^.?!]{0,80}\b(test|quiz|exam)\b/i,
  /\b(test|quiz|exam)\b[^.?!]{0,80}\bdo\s+your\s+best\b/i,

  // Getting through a work period. The second shape the writer produced:
  // "how do you decide what to do first and stay focused … one strategy that
  // helps you keep momentum when working quietly and independently".
  /\b(stay|staying|keep|keeping|remain|remaining)\s+(calm|focused|focussed|relaxed|on\s+task|motivated)\b/i,
  /\b(keep|keeping|build|building|lose|losing)\s+(your\s+)?momentum\b/i,
  /\b(decide|deciding|choose|choosing|pick|picking|work\s+out)\b[^.?!]{0,30}\bwhat\s+to\s+(do|tackle|start|work\s+on)\s+first\b/i,
  /\bwhat\s+(will|would|do)\s+you\s+(tackle|do|start\s+with)\s+first\b/i,
  /\bpriorit(i[sz]e|i[sz]ing|i[sz]ation|ies)\b/i,
  /\bwork(ing)?\s+(quietly\s+(and\s+)?)?(independently|on\s+your\s+own)\b/i,
  /\b(study|revision|revising|work|working)\s+(habit|strategy|strategies|routine|tip|system)/i,
  /\b(describe|name|share|explain)\s+(one|a|two|your)\s+(strategy|strategies|tip|technique|habit)\b/i,
  /\bapply\s+(those|these|your)\s+strateg(y|ies)\b/i,
  /\b(manage|managing|budget|budgeting|use|using)\s+(your\s+)?time\s+(well|wisely)\b/i,
  /\b(time|task)\s+management\b/i,
  /\b(get|getting)\s+started\b[^.?!]{0,40}\b(list|work|task|assignment)/i,
  /\blong\s+list\b/i,
  /\bprocrastinat/i,
  /\bdistract(ed|ion|ions|ing)\b/i,
];

/**
 * Days this rule applies to: the cell describes the running of the period.
 *
 * `test` and `work` are told apart because the unit is finished on one and
 * still in hand on the other, and the journal is written differently for each.
 */
var ABOUT_THE_ROUTINE = {
  test: [
    /\b(unit\s*\d*\s*)?test\b/i,
    /\bquiz\b/i,
    /\bexam\b/i,
    /\bsummative\b/i,
  ],
  work: [
    /\bquiet\s*work\s*time\b/i,
    /\bqwt\b/i,
    /\bwork\s*period\b/i,
    /\bstudy\s*(guide|period|hall)\b/i,
    /\bpractice\s*test\b/i,
    /\breview\b/i,
    /\bcatch[-\s]?up\b/i,
    /\bfinish(ing)?\s+(up\s+)?(your\s+|the\s+|assigned\s+)?(work|tasks?|assignments?)\b/i,
  ],
};

/** "Geography 8B (23) 211 (G009)" — the line that opens a class's own text. */
var CLASS_HEADER = /^[A-Z][A-Za-z]*\s+\d[A-C]\b/;

/** Rows on the Lessons tab that are not the next unit: more of the same ending. */
var NOT_A_NEW_UNIT = [
  /\btest\b/i,
  /\bquiz\b/i,
  /\bexam\b/i,
  /\breview\b/i,
  /\bstudy\b/i,
  /\bcatch[-\s]?up\b/i,
  /\bwork\s*period\b/i,
  /\bquiet\s*work\s*time\b/i,
  /\bqwt\b/i,
];

function matchesAny_(list, text) {
  var s = String(text == null ? '' : text);
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].test(s)) return true;
  }
  return false;
}

/**
 * 'test', 'work', or '' for an ordinary lesson. The cell's own words decide.
 *
 * A test wins over a work period where the cell says both — "practice test" is
 * the exception, since that is a work period with a test-shaped handout in it,
 * so it is tried first.
 */
function periodKind_(topic) {
  var text = String(topic == null ? '' : topic);
  if (/\bpractice\s*test\b/i.test(text) && !/\b(write|take|writing|taking)\b[^.?!]{0,20}\btest\b/i.test(text)) {
    return 'work';
  }
  if (matchesAny_(ABOUT_THE_ROUTINE.test, text)) return 'test';
  if (matchesAny_(ABOUT_THE_ROUTINE.work, text)) return 'work';
  return '';
}

/** Whether a journal line is the kind this guard exists to replace. */
function isRoutineJournal_(journal) {
  return matchesAny_(ROUTINE_SKILLS, journal);
}

/**
 * The unit a row is working on, out of the row's own words.
 *
 * The teacher writes it several ways — "Test — 7.1 Unit 1: Number Sense and
 * Patterns and Algebra", "Unit 2 TEST", "Test on The Divided Kingdom: 1-2
 * Kings" — so the routine words come off and what is left is the unit. Where
 * nothing is left, a chapter or unit number named anywhere in the text is taken
 * instead ("Ch1 Review Handout" is Chapter 1). An empty answer is fine and
 * means the row names no unit at all.
 */
function unitFromRow_(topic) {
  var whole = String(topic == null ? '' : topic);
  // The first line of a class's text is its header — "Geography 8B (23) 211
  // (G009)" — which names the room and the code and nothing about the unit. A
  // Lessons row has no such line, so this is skipped where there is none.
  var lines = whole.split('\n');
  var line = '';
  for (var n = 0; n < lines.length; n += 1) {
    var candidate = lines[n].trim();
    if (!candidate) continue;
    if (CLASS_HEADER.test(candidate)) continue;
    line = candidate;
    break;
  }
  var text = line
    .replace(/^\s*today\s+we\s+(take|write|have|do|use|spend|continue|complete)\s+(the\s+)?/i, '')
    .replace(/\b(test(ing)?|quiz|exam|summative)\b/gi, ' ')
    .replace(/\bquiet\s*work\s*time\b|\bwork\s*period\b|\bstudy\s*(guide|period|hall)\b|\bqwt\b/gi, ' ')
    .replace(/\b(review|revision|catch[-\s]?up|assigned|tasks?|handouts?|practice)\b/gi, ' ')
    .replace(/\b(to\s+complete|complete|finish|on|for|we|use|using)\b/gi, ' ')
    .replace(/^[\s—–:,.\-]+|[\s—–:,.\-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // "7.1 Unit 1: Number Sense" — the name after the colon is the useful half,
  // but a bare "Unit 1" with nothing after it is still worth saying.
  var named = /unit\s*\d+\s*:\s*(.+)$/i.exec(text);
  if (named) return named[1].trim();
  if (text && text.length > 2 && /[a-z]/i.test(text)) return text;

  // Nothing in the first line: a chapter or unit named anywhere in the cell is
  // better than nothing, and a review period usually names one in its tasks.
  var numbered = /\b(?:ch(?:apter)?\.?\s*(\d+)|unit\s*(\d+))\b/i.exec(whole);
  if (numbered) return numbered[1] ? 'Chapter ' + numbered[1] : 'Unit ' + numbered[2];
  return '';
}

/**
 * {unit, next} — the unit in hand and the one that follows it.
 *
 * `next` is read off the Lessons tab: the rows after this code, in the same
 * subject (the code's letter), skipping the rows that are the end of a unit
 * rather than the start of the next one — test, review, study, a work period.
 * The first real topic after those is what is coming.
 */
function unitsAround_(code, topic) {
  var out = { unit: unitFromRow_(topic), next: '' };
  var key = normalizeCode_(code);
  if (!key) return out;

  var sheet = SpreadsheetApp.getActive().getSheetByName('Lessons');
  if (!sheet) return out;

  var last = sheet.getLastRow();
  if (last < 3) return out;

  var rows = sheet.getRange(3, 3, last - 2, 2).getValues();   // C the code, D the topic
  var at = -1;
  for (var r = 0; r < rows.length; r += 1) {
    if (normalizeCode_(rows[r][0]) === key) { at = r; break; }
  }
  if (at < 0) return out;

  // The row's own topic, where the class text named no unit of its own.
  if (!out.unit) out.unit = unitFromRow_(String(rows[at][1] || ''));

  var letter = key.charAt(0);
  for (var i = at + 1; i < rows.length; i += 1) {
    var thisCode = normalizeCode_(rows[i][0]);
    // A blank code is a day with no lesson of its own; keep walking. A code of
    // another subject means this subject's rows have run out.
    if (thisCode && thisCode.charAt(0) !== letter) break;
    var next = String(rows[i][1] || '').split('\n')[0].trim();
    if (!next) continue;
    if (matchesAny_(NOT_A_NEW_UNIT, next)) continue;
    out.next = next;
    break;
  }
  return out;
}

/** "~J017 📷" and "j017" are both J017. */
function normalizeCode_(raw) {
  var m = /^\s*~?\s*([A-Za-z]\d{3})\b/.exec(String(raw == null ? '' : raw));
  return m ? m[1].toUpperCase() : '';
}

/**
 * The journal line, replaced where it is a journal about getting through the
 * period.
 *
 * Returns the model's own line untouched everywhere else — including on an
 * ordinary teaching day, since this rule has no business there.
 */
function fixJournal_(journal, topic, about) {
  var kind = periodKind_(topic);
  if (!kind) return journal;
  if (!isRoutineJournal_(journal)) return journal;
  return writtenJournal_(about || unitsAround_('', topic), kind);
}

/**
 * The written prompt.
 *
 * On a test day, forward to the next unit where one is known — the unit just
 * tested is finished, and a prompt they can act on is worth more than one they
 * cannot. On a review or quiet-work day the unit is still in hand, so the
 * prompt stays in it.
 */
function writtenJournal_(about, kind) {
  var next = about && about.next ? String(about.next).trim() : '';
  var unit = about && about.unit ? String(about.unit).trim() : '';

  if (kind === 'work') {
    if (unit) {
      return '🍎 Journal: As you work through ' + lower_(unit) + ', which part of it '
        + 'is still not clear to you, and what would make it clear? How would you '
        + 'explain the hardest part of it to someone who missed those classes?';
    }
    return '🍎 Journal: Which part of this unit is still not clear to you, and what '
      + 'would make it clear? How would you explain the hardest part of it to '
      + 'someone who missed those classes?';
  }

  if (next) {
    return '🍎 Journal: Once this is handed in we start ' + lower_(next) + '. '
      + 'What do you already know about it, even in passing? What do you want to '
      + 'be able to do by the end of it, and where do you think it turns up '
      + 'outside this classroom?';
  }
  if (unit) {
    return '🍎 Journal: Look back over ' + lower_(unit) + '. Which idea took '
      + 'longest to come clear, and what finally made it clear? What do you '
      + 'understand now that you did not in the first week of it?';
  }
  return '🍎 Journal: Look back over the unit this test covers. Which idea took '
    + 'longest to come clear, and what finally made it clear? What would you '
    + 'tell someone starting it next year?';
}

/** A unit name mid-sentence, with a capital left alone where it is a name. */
function lower_(name) {
  var text = String(name || '').trim();
  if (!text) return text;
  // Only the first word, and only when it is ordinary sentence capitalisation:
  // "Number Sense" is the unit's name and keeps its capitals.
  var first = text.split(' ')[0];
  // "Chapter 1", "Unit 2", "Book 3" keep their capital: a numbered division is
  // named, not described, and "as you work through chapter 1" reads as a slip.
  if (/^(chapter|unit|book|part|section|module)$/i.test(first)) return text;
  if (first.length > 1 && first === first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
      && !/^[A-Z]{2,}/.test(first) && text.split(' ').length > 1) {
    var rest = text.split(' ').slice(1).join(' ');
    if (rest && rest === rest.toLowerCase()) return first.toLowerCase() + ' ' + rest;
  }
  return text;
}

/**
 * Every journal line in VerticalAi this would replace, in the Log.
 *
 * Read it before trusting it. A journal wrongly replaced is a good prompt lost,
 * and the only way to know is to look at the ones it caught.
 */
function checkJournals() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('VerticalAi');
  if (!sheet) throw new Error('No tab called VerticalAi');

  var last = sheet.getLastRow();
  if (last < 4) return 'Nothing to check';

  var cells = sheet.getRange(4, 6, last - 3, 5).getValues();   // F to J, Monday to Friday
  var days = 0;
  var caught = 0;

  for (var r = 0; r < cells.length; r += 1) {
    for (var c = 0; c < cells[r].length; c += 1) {
      var text = String(cells[r][c] || '');
      if (!text) continue;
      var lines = text.split('\n');
      var journal = '';
      for (var i = 0; i < lines.length; i += 1) {
        if (/^\s*(🍎\s*)?journal\s*:/i.test(lines[i])) { journal = lines[i]; break; }
      }
      if (!journal) continue;
      var kind = periodKind_(text);
      if (!kind) continue;
      days += 1;
      if (!isRoutineJournal_(journal)) continue;
      caught += 1;
      Logger.log('row ' + (r + 4) + ' col ' + (c + 6) + ' (' + kind + ')'
        + '\n  was: ' + journal.trim()
        + '\n  now: ' + writtenJournal_(unitsAround_(codeIn_(text), text), kind));
    }
  }

  var message = caught + ' of ' + days + ' journals on a test or work period would be rewritten';
  Logger.log(message);
  return message;
}

/** The lesson code out of a class's text, for looking up what comes next. */
function codeIn_(text) {
  var m = /\(([A-Za-z]\d{3})[^)]*\)|[●•\-]\s*~?([A-Za-z]\d{3})\b/.exec(String(text || ''));
  return m ? (m[1] || m[2]).toUpperCase() : '';
}
