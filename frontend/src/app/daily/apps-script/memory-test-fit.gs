// Memory test: fits MemoryCards A1:E12 (four cards) onto one page, or A1:B6
// (one card) when the verse is too long. Install: run installMemoryTestFit once.
// How it works and how to print: see the notes at the end of this file.

var MT_SHEET = 'MemoryCards';

/** Text cells of the four cards, by row: [row, sizeOffset]. Rows 3 and 6 are
 *  the verse and the review (the full size); 2, 4 and 5 — the question and
 *  name line, the review heading, the practice text — sit two points smaller,
 *  which is how the sheet was set up by hand. */
var MT_ROWS = [[2, -2], [3, 0], [4, -2], [5, -2], [6, 0]];
var MT_TOP_CARD_ROWS = [2, 6];       // first and last text row of the top cards
var MT_BOTTOM_OFFSET = 6;            // the bottom cards are the same rows + 6
var MT_TEXT_COLUMNS = ['B', 'E'];    // left and right card

/** The cells whose change changes the cards' size. */
var MT_CONTROLS = 'A7:E7';

/** Font sizes tried for the verse rows. */
var MT_MAX_PT = 20;
var MT_MIN_PT = 9;

/** The page the fit aims at, in inches, and how much slack to leave: Sheets'
 *  row fitting is an estimate and the printer's text can run a little wider. */
var MT_PAGE = { longIn: 11, shortIn: 8.5, marginIn: 0.25, slack: 0.94 };
var MT_PX_PER_IN = 96;

function onOpenMemoryTest() {
  SpreadsheetApp.getUi()
    .createMenu('Memory test')
    .addItem('Fit to one page', 'fitMemoryTest')
    .addItem('Print (PDF)', 'printMemoryTest')
    .addToUi();
}

/** Run once: installs the triggers and fits the test. */
function installMemoryTestFit() {
  var mine = { onEditMemoryTest: true, fitMemoryTestIfChanged: true, onOpenMemoryTest: true };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onOpenMemoryTest').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('onEditMemoryTest').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('fitMemoryTestIfChanged').timeBased().everyHours(1).create();
  fitMemoryTest();
}

/** Installable on-edit trigger: refit when one of the switches in row 7 moves. */
function onEditMemoryTest(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== MT_SHEET) return;
  var c = sh.getRange(MT_CONTROLS);
  var r = e.range;
  var overlaps = r.getRow() <= c.getLastRow() && r.getLastRow() >= c.getRow() &&
                 r.getColumn() <= c.getLastColumn() && r.getLastColumn() >= c.getColumn();
  if (overlaps) fitMemoryTest();
}

/** Hourly trigger: refit only when the cards' text has changed — a new week. */
function fitMemoryTestIfChanged() {
  var sh = SpreadsheetApp.getActive().getSheetByName(MT_SHEET);
  if (!sh) return;
  var props = PropertiesService.getDocumentProperties();
  var print = mtFingerprint_(sh);
  if (props.getProperty('memoryTestFingerprint') === print) return;
  fitMemoryTest();
}

function fitMemoryTest() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(MT_SHEET);
    if (!sh) return;
    SpreadsheetApp.flush(); // let the formulas catch up with the switch just pressed

    var all = mtLayout_(sh, 'all');
    var one = mtLayout_(sh, 'one');

    var pt = mtLargestFitting_(sh, all.maxHeight, all.rows);
    var mode = 'all';
    if (pt === null) {
      mode = 'one';
      pt = mtLargestFitting_(sh, one.maxHeight, one.rows);
      if (pt === null) pt = MT_MIN_PT; // nothing fits: smallest, and G1 says so
    }
    mtSetSize_(sh, pt);
    var used = mode === 'all' ? all : one;
    var over = mtMeasure_(sh, used.rows) > used.maxHeight;

    sh.getRange('G1').setValue(
      'Print ' + used.range + ' · ' + used.orientation + ' · ' + pt + ' pt' +
      (mode === 'one' ? ' · one card (long verse)' : ' · four cards') +
      (over ? ' · STILL TOO LONG' : ''));
    PropertiesService.getDocumentProperties()
      .setProperty('memoryTestFingerprint', mtFingerprint_(sh));
    PropertiesService.getDocumentProperties().setProperty('memoryTestMode', mode);
  } finally {
    lock.releaseLock();
  }
}

/** Opens a PDF of the range G1 names, printed the way the fit assumed. */
function printMemoryTest() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(MT_SHEET);
  var mode = PropertiesService.getDocumentProperties().getProperty('memoryTestMode') || 'all';
  var l = mtLayout_(sh, mode);
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export' +
    '?format=pdf&gid=' + sh.getSheetId() +
    '&range=' + encodeURIComponent(l.range) +
    '&size=letter&portrait=' + (l.orientation === 'portrait') +
    '&scale=4' + // fit to page, so a row the estimate missed cannot spill over
    '&top_margin=' + MT_PAGE.marginIn + '&bottom_margin=' + MT_PAGE.marginIn +
    '&left_margin=' + MT_PAGE.marginIn + '&right_margin=' + MT_PAGE.marginIn +
    '&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED' +
    '&horizontal_alignment=CENTER&vertical_alignment=TOP&fzr=false';
  var html = HtmlService.createHtmlOutput(
    '<p style="font:14px Arial">' +
    '<a href="' + url + '" target="_blank">Open the memory test PDF (' + l.range + ')</a></p>' +
    '<script>window.open(' + JSON.stringify(url) + ', "_blank");</script>')
    .setWidth(360).setHeight(80);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Memory test');
}

/** The two ways of printing: four cards landscape, or one card portrait. The
 *  tallest the rows may be follows from fitting the range's width to the
 *  page's printable width. */
function mtLayout_(sh, mode) {
  var colWidth = function (from, to) {
    var w = 0;
    for (var c = from; c <= to; c++) w += sh.getColumnWidth(c);
    return w;
  };
  var printable = function (inches) { return (inches - 2 * MT_PAGE.marginIn) * MT_PX_PER_IN; };
  if (mode === 'one') {
    var w1 = colWidth(1, 2);                                   // A:B
    var scale1 = printable(MT_PAGE.shortIn) / w1;                 // portrait
    return { range: 'A1:B6', orientation: 'portrait', rows: [1, 6],
             maxHeight: printable(MT_PAGE.longIn) / scale1 * MT_PAGE.slack };
  }
  var w = colWidth(1, 5);                                      // A:E
  var scale = printable(MT_PAGE.longIn) / w;                      // landscape
  return { range: 'A1:E12', orientation: 'landscape', rows: [1, 12],
           maxHeight: printable(MT_PAGE.shortIn) / scale * MT_PAGE.slack };
}

/** The largest verse size whose rows fit maxHeight, or null if none does. */
function mtLargestFitting_(sh, maxHeight, rows) {
  var lo = MT_MIN_PT, hi = MT_MAX_PT, best = null;
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    mtSetSize_(sh, mid);
    if (mtMeasure_(sh, rows) <= maxHeight) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

function mtSetSize_(sh, pt) {
  MT_TEXT_COLUMNS.forEach(function (col) {
    MT_ROWS.forEach(function (pair) {
      var size = Math.max(MT_MIN_PT - 2, pt + pair[1]);
      sh.getRange(col + pair[0]).setFontSize(size);
      sh.getRange(col + (pair[0] + MT_BOTTOM_OFFSET)).setFontSize(size);
    });
  });
}

/** Fit the text rows to their contents and add up rows[0]..rows[1]. Row 7, the
 *  gap the cards are cut along, keeps its own height. */
function mtMeasure_(sh, rows) {
  SpreadsheetApp.flush();
  var top = MT_TOP_CARD_ROWS;
  sh.autoResizeRows(top[0], top[1] - top[0] + 1);
  sh.autoResizeRows(top[0] + MT_BOTTOM_OFFSET, top[1] - top[0] + 1);
  SpreadsheetApp.flush();
  var h = 0;
  for (var r = rows[0]; r <= rows[1]; r++) h += sh.getRowHeight(r);
  return h;
}

/** What the cards say, plus the switches — a new week changes it. */
function mtFingerprint_(sh) {
  var text = sh.getRange('B2:B6').getDisplayValues().join('\n') + '|' +
             sh.getRange(MT_CONTROLS).getDisplayValues().join(',');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text);
  return Utilities.base64Encode(bytes);
}

/**
 * Fit the memory verse test (MemoryCards) onto one printed page.
 *
 * WHAT IT DOES
 * The test is four copies of the same card — A1:E12, two across and two down,
 * cut apart after printing. How tall a card is depends on the week's verse and
 * on whether there is a review under it, so one font size cannot suit every
 * week: a short verse leaves half the page empty and a long one runs onto a
 * second page.
 *
 * So the script sizes the type to the page. It sets the cards' text size,
 * lets Sheets fit the rows to it, adds up how tall the four cards came out and
 * compares that with how tall the page is (letter, landscape, narrow margins,
 * fit to width — the MT_PAGE settings below). It takes the largest size that fits.
 *
 * Where even the smallest size will not fit four on a page — Psalm 1, the
 * longest verse of the year, plus a review — it fits ONE card (A1:B6) to a
 * portrait page instead, and says so in G1.
 *
 * WHEN IT RUNS
 *   - when C7 (test / practice), D7 (week offset) or E7 (review) is changed,
 *     and A7 / B7 (which words are kept) for good measure;
 *   - every hour, but it only does anything when the week's text has changed,
 *     so the new week is fitted the morning it comes round;
 *   - from the menu, Memory test > Fit to one page, whenever you like.
 *
 * PRINTING
 * G1 says which range to print. Memory test > Print (PDF) opens a PDF of
 * exactly that range with the same page settings the fit assumed, which is the
 * dependable way to print it. From File > Print, choose Selected cells, the
 * orientation G1 names, Scale: Fit to width, Margins: Narrow.
 *
 * HOW TO INSTALL
 *   1. Extensions > Apps Script, add a file, paste this in, Save.
 *   2. Choose `installMemoryTestFit` in the function list and press Run. Grant
 *      the permissions it asks for. It sets up its triggers (on open for the
 *      menu, on edit, hourly) and fits the test once. It defines no onOpen of
 *      its own, so it cannot collide with one the project already has.
 *   3. Reload the sheet to see the Memory test menu.
 */
