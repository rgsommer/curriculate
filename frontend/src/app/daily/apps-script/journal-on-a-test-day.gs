/**
 * The journal on a test day: about the work, not about writing tests.
 *
 * WHY THIS EXISTS
 * The lesson writer puts a journal line in each class ("🍎 Journal: …"), and on
 * the day a class writes a test it reaches for the only thing the lesson cell
 * talks about — the test itself:
 *
 *     Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra.
 *     What helps you stay calm and focused during a test?
 *     🍎 Journal: Think about a time you faced a challenging test or situation.
 *     What practical steps, thoughts, or prayers helped you handle stress and do
 *     your best? How could you apply those strategies during today's test?
 *
 * That is a journal about test-taking, written for a room that is about to
 * write a test and has nothing to say about it yet. The hour is worth more than
 * that. A test day is the one day the whole unit is in their heads at once, so
 * the journal should either look **back over the unit being tested** — what
 * changed in how they think about it, which idea took the longest to come
 * clear — or, better, **forward to the unit coming next**, which is the thing
 * they can actually do something about.
 *
 * Forward is preferred because it is the only prompt of the two that is not
 * already finished when they put the pen down.
 *
 * HOW TO USE IT
 *   1. Extensions > Apps Script, paste this in, Save.
 *   2. Add the rule to the instructions you send the model:
 *
 *        var prompt = JOURNAL_RULES + '\n\n' + yourExistingPrompt;
 *
 *      Where you already add LESSON_TEXT_RULES, add this after it.
 *   3. Give the model the two unit names when you have them — the one being
 *      tested and the one coming next — since it cannot see further down the
 *      Lessons tab than the row you hand it:
 *
 *        var about = unitsAroundTest_(code, topic);     // {tested, next}
 *        if (about.next) prompt += '\nThe next unit is: ' + about.next + '.';
 *        if (about.tested) prompt += '\nThe unit being tested is: ' + about.tested + '.';
 *
 *   4. Check what came back before it goes in the cell, because a rule in a
 *      prompt is a request and this one is easy to drift from:
 *
 *        journal = fixJournal_(journal, topic, about);
 *
 *      It returns the model's own line where that line is fine, and a written
 *      one where it is a journal about writing tests.
 *
 * TUNING IT
 * TEST_SKILLS is the list of shapes that count as a journal about test-taking.
 * Run `checkJournals` to see every journal line in VerticalAi this would have
 * replaced, and read them before trusting it: a prompt wrongly replaced is a
 * good journal lost.
 */

/**
 * The rule for the model.
 */
var JOURNAL_RULES = [
  'THE JOURNAL ON A TEST DAY.',
  '',
  'When the class writes a test, a quiz or an exam that period, the journal is',
  'NOT about writing tests. Do not ask about nerves, stress, staying calm,',
  'focus, time management, study habits, cramming, or what they will do during',
  'today\'s test. They are about to write it; a prompt about writing it teaches',
  'them nothing and takes the one quiet half hour the unit gets.',
  '',
  'Write one of these two instead, and prefer the first:',
  '',
  '1. THE UNIT COMING NEXT. What do they already half-know about it? What do',
  '   they expect it to be like, and what do they want to be able to do by the',
  '   end of it? Where might it show up outside this classroom? This is the',
  '   better prompt because it is the only one of the two they can still act on.',
  '',
  '2. THE UNIT BEING TESTED, looking back. Which idea took the longest to come',
  '   clear, and what finally made it come clear? What do they understand now',
  '   that they did not in the first week of it? Where have they seen it outside',
  '   school since?',
  '',
  'Name the unit. "Think about what you learned" is a prompt about nothing; use',
  'the unit names given to you, and where none are given, the topic of the',
  'lesson itself. Keep it to two or three questions, in the second person, the',
  'way the other journals are written. A verse or a line of Scripture is welcome',
  'where it fits the subject, as in the other journals; it is not required.',
].join('\n');

/**
 * A journal line that is about writing tests rather than about the work.
 *
 * Each pattern names the thing itself. A unit genuinely about stress — a health
 * unit, say — would be written about in its own words ("how stress affects the
 * body") rather than in these, which are all about the student sitting the test.
 */
var TEST_SKILLS = [
  // The apostrophe is the curly one as often as not — the cell is typed in
  // Google Sheets, which turns it — so both are allowed everywhere one appears.
  /\b(during|before|for)\s+(today['\u2019]?s?|the|this|your)\s+(test|quiz|exam|assessment)\b/i,
  /\b(test|exam)\s*(-|\s)?\s*(taking|day)\s+(skill|strategy|strategies|tip|technique)/i,
  /\b(stay|staying|keep|keeping|remain|remaining)\s+(calm|focused|focussed|relaxed)\b/i,
  /\b(test|exam)\s+(anxiety|nerves|stress|jitters)\b/i,
  /\b(nervous|anxious|stressed|worried)\b[^.?!]{0,60}\b(test|quiz|exam)\b/i,
  /\b(test|quiz|exam)\b[^.?!]{0,60}\b(nervous|anxious|stressed|calm|worried)\b/i,
  /\b(study|revision|revising)\s+(habit|strategy|strategies|routine|tip)/i,
  /\b(manage|managing|budget|budgeting)\s+(your\s+)?time\b[^.?!]{0,40}\b(test|quiz|exam)\b/i,
  /\bhow\s+(did|do)\s+you\s+(prepare|study)\b[^.?!]{0,40}\b(test|quiz|exam)\b/i,
  // The shape the writer actually produced: coping, in the abstract, with a
  // hard moment — "what helped you handle stress and do your best".
  /\bhandle\s+(the\s+)?(stress|pressure|nerves)\b/i,
  /\bdo\s+your\s+best\b[^.?!]{0,80}\b(test|quiz|exam)\b/i,
  /\b(test|quiz|exam)\b[^.?!]{0,80}\bdo\s+your\s+best\b/i,
  /\bapply\s+(those|these|your)\s+strateg(y|ies)\b/i,
];

/** Words that mark the period as a test rather than a lesson. */
var IS_A_TEST = [
  /\b(unit\s*\d*\s*)?test\b/i,
  /\bquiz\b/i,
  /\bexam\b/i,
  /\bsummative\b/i,
];

/** Rows on the Lessons tab that are not the next unit: more of the same ending. */
var NOT_A_NEW_UNIT = [
  /\btest\b/i,
  /\bquiz\b/i,
  /\bexam\b/i,
  /\breview\b/i,
  /\bstudy\b/i,
  /\bcatch[- ]?up\b/i,
  /\bwork\s*period\b/i,
  /\bqwt\b/i,
];

function matchesAny_(list, text) {
  var s = String(text == null ? '' : text);
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].test(s)) return true;
  }
  return false;
}

/** Whether this period is a test. The lesson's own words decide. */
function isTestPeriod_(topic) {
  return matchesAny_(IS_A_TEST, topic);
}

/** Whether a journal line is the kind this guard exists to replace. */
function isTestSkillsJournal_(journal) {
  return matchesAny_(TEST_SKILLS, journal);
}

/**
 * The unit a test row is testing, out of the row's own words.
 *
 * The teacher writes it several ways — "Test — 7.1 Unit 1: Number Sense and
 * Patterns and Algebra", "Unit 2 TEST", "Test on The Divided Kingdom: 1-2
 * Kings" — so the test words come off and what is left is the unit. An empty
 * answer is fine and means the row names no unit beyond the word "test".
 */
function unitFromTestRow_(topic) {
  var line = String(topic == null ? '' : topic).split('\n')[0];
  var text = line
    .replace(/^\s*today\s+we\s+(take|write|have|do)\s+(the\s+)?/i, '')
    .replace(/\btest(ing)?\b|\bquiz\b|\bexam\b|\bsummative\b/gi, ' ')
    .replace(/\bon\b|\bfor\b/gi, ' ')
    .replace(/^[\s—–:,.\-]+|[\s—–:,.\-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "7.1 Unit 1: Number Sense" — the name after the colon is the useful half,
  // but a bare "Unit 1" with nothing after it is still worth saying.
  var named = /unit\s*\d+\s*:\s*(.+)$/i.exec(text);
  if (named) return named[1].trim();
  return text;
}

/**
 * {tested, next} — the unit this test covers and the one that follows it.
 *
 * `next` is read off the Lessons tab: the rows after this code, in the same
 * subject (the code's letter), skipping the rows that are the end of the unit
 * rather than the start of the next one — more test, review, study, a work
 * period. The first real topic after those is what is coming.
 */
function unitsAroundTest_(code, topic) {
  var out = { tested: unitFromTestRow_(topic), next: '' };
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
 * The journal line, replaced where it is a journal about writing tests.
 *
 * Returns the model's own line untouched everywhere else — including on a day
 * that is not a test, since this rule has no business there.
 */
function fixJournal_(journal, topic, about) {
  if (!isTestPeriod_(topic)) return journal;
  if (!isTestSkillsJournal_(journal)) return journal;
  return writtenJournal_(about || unitsAroundTest_('', topic));
}

/**
 * The written prompt: forward to the next unit where one is known, back over
 * the one being tested where it is not.
 */
function writtenJournal_(about) {
  var next = about && about.next ? String(about.next).trim() : '';
  var tested = about && about.tested ? String(about.tested).trim() : '';

  if (next) {
    return '🍎 Journal: Once this is handed in we start ' + lower_(next) + '. '
      + 'What do you already know about it, even in passing? What do you want to '
      + 'be able to do by the end of it, and where do you think it turns up '
      + 'outside this classroom?';
  }
  if (tested) {
    return '🍎 Journal: Look back over ' + lower_(tested) + '. Which idea took '
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
  var tests = 0;
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
      if (!isTestPeriod_(text)) continue;
      tests += 1;
      if (!isTestSkillsJournal_(journal)) continue;
      caught += 1;
      Logger.log('row ' + (r + 4) + ' col ' + (c + 6) + '\n  was: ' + journal.trim()
        + '\n  now: ' + writtenJournal_(unitsAroundTest_(codeIn_(text), text)));
    }
  }

  var message = caught + ' of ' + tests + ' journals on a test period would be rewritten';
  Logger.log(message);
  return message;
}

/** The lesson code out of a class's text, for looking up what comes next. */
function codeIn_(text) {
  var m = /\(([A-Za-z]\d{3})[^)]*\)|[●•\-]\s*~?([A-Za-z]\d{3})\b/.exec(String(text || ''));
  return m ? (m[1] || m[2]).toUpperCase() : '';
}
