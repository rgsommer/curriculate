/**
 * Fill the Lessons picture column (I) with openly-licensed pictures.
 *
 * WHY THIS EXISTS
 * The board shows a lesson's own picture at the foot of the right-hand half for
 * the whole class, and column I is where it looks. Most rows have nothing in
 * them, so most classes get no picture.
 *
 * Two things rule out doing this from outside the sheet:
 *
 *   1. The Sheets API cannot put a picture INTO a cell. There is no image field
 *      on CellData at all — which is the same wall `mirror-cell-images.gs` was
 *      written for, seen from the other side. A script can write a URL or an
 *      =IMAGE() formula, and nothing else.
 *   2. A URL is the better thing anyway. A picture pasted into a cell is exactly
 *      the kind the board cannot see; a link is read straight off the row.
 *
 * So this writes **a link** into column I, and nothing else. It never touches
 * another column — column M in particular carries an arrayformula that must not
 * be written over — and it never overwrites a cell that already holds something.
 *
 * WHERE THE PICTURES COME FROM
 * Wikimedia Commons, searched on the lesson's own topic (column D). Everything
 * there is openly licensed, so nothing here depends on a key, a bill, or a
 * licence nobody read. The address written is Commons' own permanent one —
 * `Special:FilePath/<file>?width=1200` — which follows the file if it is ever
 * re-uploaded, and which the board recognises as a picture because it ends in
 * the file's own extension.
 *
 * It is honest about what it cannot do. A Commons search is good for History and
 * Geography — maps, places, artefacts, portraits — passable for a Bible lesson,
 * and poor for Math, where a page of fractions is not a thing anyone photographs.
 * A row it cannot answer **is left empty** rather than filled with something
 * loosely related, and the log says so. A test, a review, a work period or a
 * study day gets nothing either: those are not lessons with a subject.
 *
 * HOW TO USE IT
 *   1. Extensions > Apps Script, paste this in, Save.
 *   2. Run `checkLessonPictures` first. It writes NOTHING. The Log gets a line
 *      per row — the topic, the words it searched, and the picture it would
 *      write, with its licence — so the whole run can be read before any of it
 *      happens. Read it. A wrong picture on the projector is worse than none.
 *   3. Tune SUBJECT_WORDS and SKIP_WORDS at the top if the log asks for it.
 *   4. Run `fillLessonPictures`. Apps Script stops a script at six minutes, so it
 *      does a batch, remembers where it got to, and says what to do next; run it
 *      again until it reports that it has reached the end.
 *   5. `resetLessonPictures` forgets the place and starts from the top again.
 *      `clearLessonPictures` removes only the links this script wrote (it keeps
 *      a note on each cell saying so), and leaves your own alone.
 */

var LESSON_PICTURES = {
  tab: 'Lessons',
  firstRow: 3,       // rows 1 and 2 are headings
  codeCol: 3,        // C, the lesson code
  topicCol: 4,       // D, what the lesson is about
  pictureCol: 9,     // I, where the board looks for the picture
  batch: 60,         // rows per run; Apps Script stops a script at six minutes
  minWidth: 600,     // anything smaller looks like a stamp on a projector
  thumbWidth: 1200,
  note: 'Picture found on Wikimedia Commons by lesson-pictures.gs',
};

/**
 * The word that tells Commons what kind of lesson this is, by the code's letter.
 *
 * Without it a search for "settlements" returns housing estates. With it the
 * search is "settlements geography", which returns maps and towns. Add a letter
 * here when a course starts; an unlisted letter simply searches the topic.
 */
var SUBJECT_WORDS = {
  H: 'history Canada',
  G: 'geography',
  B: 'Bible',
  C: 'Bible Christianity',
  J: 'mathematics',
  M: 'mathematics',
};

/** Rows that are not a lesson with a subject, and get no picture. */
var SKIP_WORDS = [
  /\btest\b/i, /\bquiz\b/i, /\bexam\b/i, /\breview\b/i, /\bstudy\b/i,
  /\bcatch[-\s]?up\b/i, /\bwork\s*period\b/i, /\bquiet\s*work\s*time\b/i, /\bqwt\b/i,
  /\bchapel\b/i, /\bassembly\b/i, /\bfield\s?trip\b/i, /\bsupply\b/i, /\bno\s+(class|school)\b/i,
  /\bpresentations?\b/i, /\byearbook/i, /\bbook\s?fair\b/i, /\bcounsel/i,
];

/** Words that are the teacher talking, not the subject. */
var NOT_THE_SUBJECT = new RegExp([
  'teach', 'teaching', 'assign', 'assigned', 'complete', 'completed', 'continue', 'continued',
  'begin', 'start', 'finish', 'introduce', 'introduction', 'intro', 'overview', 'lesson', 'lessons',
  'class', 'classes', 'handout', 'handouts', 'worksheet', 'sheet', 'notes', 'notebook', 'note',
  'slides', 'slide', 'deck', 'presentation', 'video', 'watch', 'read', 'reading', 'write', 'written',
  'discuss', 'discussion', 'activity', 'practice', 'practise', 'enrichment', 'reminder', 'reminders',
  'due', 'today', 'tomorrow', 'next', 'day', 'days', 'week', 'min', 'minutes', 'part', 'unit',
  'chapter', 'ch', 'page', 'pages', 'pp', 'p', 'and', 'the', 'a', 'an', 'of', 'to', 'in', 'on',
  'for', 'with', 'from', 'by', 'at', 'is', 'are', 'it', 'its', 'your', 'our', 'their', 'you', 'we',
  'how', 'what', 'why', 'when', 'where', 'who', 'do', 'does', 'did', 'use', 'using', 'using',
].map(function (w) { return '^' + w + '$'; }).join('|'), 'i');

/** Licences that may go on a projector without a lawyer. */
var GOOD_LICENCES = /public domain|^cc0|^cc by(-sa)?(\s|$)|^pd|no restrictions/i;

/** Files that are not pictures of the subject. */
var BLOCKED_FILES = /\b(logo|icon|flag of|coat of arms|signature|stub|placeholder|disambig|commons-logo|question mark|nuvola|crystal)\b/i;

/**
 * The words to search Commons with, out of a lesson's topic — or '' where the
 * row is not a lesson with a subject.
 */
function lessonQuery_(topic, code) {
  var whole = String(topic == null ? '' : topic);
  var line = whole.split('\n')[0];
  if (!line.trim()) return '';
  if (matchesAny__(SKIP_WORDS, line)) return '';

  var text = line
    .replace(/\[Assign:[\s\S]*$/i, ' ')             // the assignment block
    .replace(/https?:\/\/\S+/g, ' ')                 // links
    .replace(/[←-⇿①-➿\uD83C-􏰀-\uDFFF•●✅⛔✋]/g, ' ') // arrows, bullets, emoji
    .replace(/^\s*~?\s*[A-Za-z]\d{3}\b/, ' ')        // the lesson code
    .replace(/\([^)]*\)/g, ' ')                       // (p. 44), (15 min)
    .replace(/\b\d+(\.\d+)?\b/g, ' ')                // 7.1, p44, slide 84
    .replace(/\b(unit|chapter|ch|lesson|day|part|pp?)\b\.?/gi, ' ')
    .split(/[;—–|]/)[0]                     // the first clause
    .replace(/[^A-Za-z'’\s-]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  var words = [];
  text.split(/\s+/).forEach(function (w) {
    var word = w.replace(/^['’-]+|['’-]+$/g, '');
    if (word.length < 3) return;
    if (NOT_THE_SUBJECT.test(word)) return;
    if (words.length >= 6) return;
    if (words.indexOf(word.toLowerCase()) >= 0) return;
    words.push(word.toLowerCase());
  });
  if (!words.length) return '';

  var letter = String(code || '').replace(/^~\s*/, '').charAt(0).toUpperCase();
  var hint = SUBJECT_WORDS[letter] || '';
  return (words.join(' ') + (hint ? ' ' + hint : '')).trim();
}

function matchesAny__(list, text) {
  var s = String(text == null ? '' : text);
  for (var i = 0; i < list.length; i += 1) if (list[i].test(s)) return true;
  return false;
}

/** Commons' own permanent address for a file, at a size worth projecting. */
function pictureUrl_(file) {
  var name = String(file || '').replace(/^File:/i, '').replace(/ /g, '_');
  return 'https://commons.wikimedia.org/wiki/Special:FilePath/'
    + encodeURIComponent(name) + '?width=' + LESSON_PICTURES.thumbWidth;
}

/**
 * The best openly-licensed picture Commons has for these words, or null.
 *
 * Null is a real answer. A lesson with no good picture keeps an empty cell,
 * which the board handles, rather than a picture of something else, which the
 * room has to look at for an hour.
 */
function commonsPicture_(query) {
  if (!query) return null;
  var url = 'https://commons.wikimedia.org/w/api.php'
    + '?action=query&format=json&origin=*'
    + '&generator=search&gsrnamespace=6&gsrlimit=12'
    + '&gsrsearch=' + encodeURIComponent(query + ' filetype:bitmap')
    + '&prop=imageinfo&iiprop=url|size|extmetadata';

  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  } catch (e) {
    return null;
  }
  if (res.getResponseCode() !== 200) return null;

  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { return null; }
  var pages = (body && body.query && body.query.pages) || {};

  var best = null;
  Object.keys(pages).forEach(function (k) {
    var page = pages[k] || {};
    var info = (page.imageinfo || [])[0];
    if (!info) return;
    if (BLOCKED_FILES.test(page.title || '')) return;
    if ((info.width || 0) < LESSON_PICTURES.minWidth) return;
    var meta = info.extmetadata || {};
    var licence = ((meta.LicenseShortName || {}).value || '').replace(/<[^>]*>/g, '').trim();
    if (!GOOD_LICENCES.test(licence)) return;
    // The search returns them in its own order of relevance, and the first that
    // passes is the one it thought fitted best.
    if (best) return;
    best = {
      file: String(page.title || '').replace(/^File:/i, ''),
      url: pictureUrl_(page.title),
      licence: licence,
      by: ((meta.Artist || {}).value || '').replace(/<[^>]*>/g, '').trim().slice(0, 80),
      page: info.descriptionurl || '',
      width: info.width || 0,
    };
  });
  return best;
}

/** The rows this would work on: a code, a topic, and nothing in column I yet. */
function lessonRowsNeeding_() {
  var cfg = LESSON_PICTURES;
  var sheet = SpreadsheetApp.getActive().getSheetByName(cfg.tab);
  if (!sheet) throw new Error('No tab called ' + cfg.tab);
  var last = sheet.getLastRow();
  if (last < cfg.firstRow) return { sheet: sheet, rows: [] };

  var n = last - cfg.firstRow + 1;
  var codes = sheet.getRange(cfg.firstRow, cfg.codeCol, n, 1).getValues();
  var topics = sheet.getRange(cfg.firstRow, cfg.topicCol, n, 1).getValues();
  var pics = sheet.getRange(cfg.firstRow, cfg.pictureCol, n, 1).getValues();

  var rows = [];
  for (var i = 0; i < n; i += 1) {
    var code = String(codes[i][0] || '').trim();
    var topic = String(topics[i][0] || '').trim();
    if (!code || !topic) continue;
    if (String(pics[i][0] || '').trim()) continue;   // never overwrite what is there
    rows.push({ row: cfg.firstRow + i, code: code, topic: topic });
  }
  return { sheet: sheet, rows: rows };
}

/**
 * The whole run, in the Log, writing nothing.
 *
 * Read this before running the real thing. It is the only way to know whether a
 * subject's hint word is pulling the right kind of picture.
 */
function checkLessonPictures() {
  var found = lessonRowsNeeding_();
  var hits = 0;
  var misses = 0;
  var skipped = 0;

  found.rows.forEach(function (r) {
    var query = lessonQuery_(r.topic, r.code);
    if (!query) {
      skipped += 1;
      Logger.log(r.row + '\tSKIP\t' + r.topic.split('\n')[0].slice(0, 60));
      return;
    }
    var pic = commonsPicture_(query);
    if (!pic) {
      misses += 1;
      Logger.log(r.row + '\tNONE\t"' + query + '"\t' + r.topic.split('\n')[0].slice(0, 40));
      return;
    }
    hits += 1;
    Logger.log(r.row + '\tOK\t"' + query + '"\t' + pic.file + '\t' + pic.licence);
  });

  var message = found.rows.length + ' rows with no picture: '
    + hits + ' found, ' + misses + ' with nothing good enough, ' + skipped + ' not a lesson';
  Logger.log(message);
  return message;
}

/**
 * Write the links, a batch at a time.
 *
 * Where it got to is remembered, so running it again carries on rather than
 * starting over. Nothing is overwritten and nothing but column I is touched.
 */
function fillLessonPictures() {
  var cfg = LESSON_PICTURES;
  var props = PropertiesService.getDocumentProperties();
  var from = Number(props.getProperty('lessonPicturesNextRow') || 0) || 0;
  var found = lessonRowsNeeding_();
  var todo = found.rows.filter(function (r) { return r.row >= from; });

  var started = new Date().getTime();
  var wrote = 0;
  var misses = 0;
  var skipped = 0;
  var at = 0;

  for (at = 0; at < todo.length; at += 1) {
    // Apps Script stops a script at six minutes; stop first and leave a marker.
    if (wrote + misses >= cfg.batch || new Date().getTime() - started > 4.5 * 60 * 1000) break;
    var r = todo[at];
    var query = lessonQuery_(r.topic, r.code);
    if (!query) { skipped += 1; continue; }
    var pic = commonsPicture_(query);
    if (!pic) {
      misses += 1;
      Logger.log(r.row + '\tNONE\t"' + query + '"');
      continue;
    }
    var cell = found.sheet.getRange(r.row, cfg.pictureCol);
    cell.setValue(pic.url);
    // The note carries the attribution the licence asks for, and says which
    // links this script wrote — `clearLessonPictures` goes by it.
    cell.setNote(cfg.note + '\n' + pic.file + '\n' + pic.licence + (pic.by ? '\n' + pic.by : '')
      + (pic.page ? '\n' + pic.page : ''));
    wrote += 1;
    Logger.log(r.row + '\tWROTE\t' + pic.file + '\t' + pic.licence);
  }

  var left = todo.length - at;
  props.setProperty('lessonPicturesNextRow', String(at < todo.length ? todo[at].row : 0));
  var message = wrote + ' written, ' + misses + ' with nothing good enough, ' + skipped + ' not a lesson. '
    + (left > 0 ? left + ' rows still to look at — run fillLessonPictures again.' : 'That is the end of the tab.');
  Logger.log(message);
  return message;
}

/** Start from the top of the tab again. */
function resetLessonPictures() {
  PropertiesService.getDocumentProperties().deleteProperty('lessonPicturesNextRow');
  return 'Next run starts at the top.';
}

/**
 * Take out the links this script wrote, and only those.
 *
 * It goes by the note it leaves, so a picture of your own in the same column is
 * not touched.
 */
function clearLessonPictures() {
  var cfg = LESSON_PICTURES;
  var sheet = SpreadsheetApp.getActive().getSheetByName(cfg.tab);
  if (!sheet) throw new Error('No tab called ' + cfg.tab);
  var last = sheet.getLastRow();
  if (last < cfg.firstRow) return 'Nothing to clear';

  var range = sheet.getRange(cfg.firstRow, cfg.pictureCol, last - cfg.firstRow + 1, 1);
  var notes = range.getNotes();
  var values = range.getValues();
  var cleared = 0;
  for (var i = 0; i < notes.length; i += 1) {
    if (String(notes[i][0] || '').indexOf(cfg.note) !== 0) continue;
    values[i][0] = '';
    notes[i][0] = '';
    cleared += 1;
  }
  range.setValues(values);
  range.setNotes(notes);
  return cleared + ' links removed.';
}

/** A menu, so none of this needs the script editor after the first time. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Lesson pictures')
    .addItem('Dry run (writes nothing)', 'checkLessonPictures')
    .addItem('Fill the next batch', 'fillLessonPictures')
    .addSeparator()
    .addItem('Start again from the top', 'resetLessonPictures')
    .addItem('Remove the links this added', 'clearLessonPictures')
    .addToUi();
}
