// Memory test: sizes the MemoryCards text so A1:E12 (four cards) prints on one
// portrait page, or A1:B6 (one card) when the verse is too long for that.
// Install: run installMemoryTestFit once. Notes at the end of this file.
// It sets the text size AND the width of columns B and E.

var MT_SHEET = 'MemoryCards';
var MT_ROWS = [[2, -2], [3, 0], [4, -2], [5, -2], [6, 0]]; // [row, size offset]
var MT_BOTTOM_OFFSET = 6;          // the bottom cards are the same rows + 6
var MT_TEXT_COLUMNS = ['B', 'E'];  // left and right card
var MT_CONTROLS = 'A7:E7';         // the switches that trigger a refit
var MT_MAX_PT = 24;
var MT_MIN_PT = 9;
var MT_MIN_WIDTH = 420;            // narrowest and widest the text columns may be
var MT_MAX_WIDTH = 800;
// The page as printed: letter, portrait, fit to width, margins in inches
// (top 1.5 cm, bottom 1 cm, sides 0.635 cm). slack < 1 leaves room for error.
var MT_PAGE = { w: 8.5, h: 11, top: 0.59, bottom: 0.39, side: 0.25, slack: 0.97 };

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

/** On edit: refit when one of the switches in row 7 changes. */
function onEditMemoryTest(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== MT_SHEET) return;
  var c = sh.getRange(MT_CONTROLS), r = e.range;
  if (r.getRow() <= c.getLastRow() && r.getLastRow() >= c.getRow() &&
      r.getColumn() <= c.getLastColumn() && r.getLastColumn() >= c.getColumn()) {
    fitMemoryTest();
  }
}

/** Hourly: refit only when the cards' text has changed (a new week). */
function fitMemoryTestIfChanged() {
  var sh = SpreadsheetApp.getActive().getSheetByName(MT_SHEET);
  if (!sh) return;
  var saved = PropertiesService.getDocumentProperties().getProperty('memoryTestFingerprint');
  if (saved !== mtFingerprint_(sh)) fitMemoryTest();
}

function fitMemoryTest() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(MT_SHEET);
    if (!sh) return;
    SpreadsheetApp.flush(); // let the formulas catch up with the switch just pressed
    var cells = mtCells_(sh);

    var mode = 'all', best = mtBestFit_(sh, cells, 'all');
    if (!best) { mode = 'one'; best = mtBestFit_(sh, cells, 'one'); }
    var tooLong = !best;
    if (tooLong) best = { pt: MT_MIN_PT, width: MT_MAX_WIDTH };
    var pt = best.pt, layout = mtLayout_(sh, mode);

    sh.setColumnWidth(2, best.width);
    sh.setColumnWidth(5, best.width);
    MT_TEXT_COLUMNS.forEach(function (col) {
      MT_ROWS.forEach(function (pair) {
        var size = Math.max(MT_MIN_PT - 2, pt + pair[1]);
        sh.getRange(col + pair[0]).setFontSize(size);
        sh.getRange(col + (pair[0] + MT_BOTTOM_OFFSET)).setFontSize(size);
      });
    });

    sh.getRange('G1').setValue('Print ' + layout.range + ' · portrait · ' + pt + ' pt · columns ' +
      best.width + ' px · ' +
      (mode === 'one' ? 'one card (long verse)' : 'four cards') +
      (tooLong ? ' · STILL TOO LONG' : ''));
    var props = PropertiesService.getDocumentProperties();
    props.setProperty('memoryTestFingerprint', mtFingerprint_(sh));
    props.setProperty('memoryTestMode', mode);
  } finally {
    lock.releaseLock();
  }
}

/** Opens a PDF of the range G1 names, with the page settings the fit assumed. */
function printMemoryTest() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(MT_SHEET);
  var mode = PropertiesService.getDocumentProperties().getProperty('memoryTestMode') || 'all';
  var l = mtLayout_(sh, mode);
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export' +
    '?format=pdf&gid=' + sh.getSheetId() + '&range=' + encodeURIComponent(l.range) +
    '&size=letter&portrait=true&scale=4' + // scale=4: fit to page
    '&top_margin=' + MT_PAGE.top + '&bottom_margin=' + MT_PAGE.bottom +
    '&left_margin=' + MT_PAGE.side + '&right_margin=' + MT_PAGE.side +
    '&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED' +
    '&horizontal_alignment=CENTER&vertical_alignment=TOP&fzr=false';
  var html = HtmlService.createHtmlOutput(
    '<p style="font:14px Arial"><a href="' + url + '" target="_blank">' +
    'Open the memory test PDF (' + l.range + ')</a></p>' +
    '<script>window.open(' + JSON.stringify(url) + ', "_blank");</script>')
    .setWidth(360).setHeight(80);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Memory test');
}

/** Four cards (A1:E12) or one (A1:B6): the range, how many cards are stacked
 *  down the page, the width of the columns that are not text columns, and the
 *  rows the fit does not touch (row 1, and row 7, the cut line). */
function mtLayout_(sh, mode) {
  var one = mode === 'one';
  return {
    range: one ? 'A1:B6' : 'A1:E12',
    cards: one ? 1 : 2,
    textColumns: one ? 1 : 2,
    otherWidth: one ? sh.getColumnWidth(1)
                    : sh.getColumnWidth(1) + sh.getColumnWidth(3) + sh.getColumnWidth(4),
    fixedHeight: sh.getRowHeight(1) + (one ? 0 : sh.getRowHeight(7))
  };
}

/** The text size and column width that print the text largest while the
 *  cards still fit the page, preferring the one that fills it most. Printing
 *  is fit to width, so narrower columns print bigger but wrap into more lines;
 *  trying widths as well as sizes is what lets the cards fill the page rather
 *  than stop a size short of it. Null when nothing fits. */
function mtBestFit_(sh, cells, mode) {
  var l = mtLayout_(sh, mode);
  var pageW = (MT_PAGE.w - 2 * MT_PAGE.side) * 96;
  var pageH = (MT_PAGE.h - MT_PAGE.top - MT_PAGE.bottom) * 96 * MT_PAGE.slack;
  var best = null;
  for (var pt = MT_MIN_PT; pt <= MT_MAX_PT; pt++) {
    for (var w = MT_MIN_WIDTH; w <= MT_MAX_WIDTH; w += 10) {
      var scale = pageW / (l.otherWidth + l.textColumns * w);
      var printed = (l.cards * mtCardHeight_(cells, pt, w) + l.fixedHeight) * scale;
      if (printed > pageH) continue;
      var size = pt * scale, fill = printed / pageH;
      if (!best || size > best.size + 0.05 ||
          (Math.abs(size - best.size) <= 0.05 && fill > best.fill)) {
        best = { pt: pt, width: w, size: size, fill: fill };
      }
    }
  }
  return best;
}

/** The text of one card, row by row (the four copies are the same). */
function mtCells_(sh) {
  return MT_ROWS.map(function (pair) {
    return { text: sh.getRange('B' + pair[0]).getDisplayValue(), offset: pair[1] };
  });
}

/** How tall one card comes out, in sheet pixels. Sheets cannot report a
 *  wrapped row's height to a script, so the text is wrapped here, word by
 *  word, with Arial's character widths. */
function mtCardHeight_(cells, pt, width) {
  var total = 0;
  cells.forEach(function (cell) {
    var size = Math.max(MT_MIN_PT - 2, pt + cell.offset);
    var px = size * 96 / 72;
    var lines = cell.text === '' ? 0 : mtLines_(cell.text, px, width - 8);
    total += Math.max(21, Math.ceil(lines * px * 1.2 + 6));
  });
  return total;
}

function mtLines_(text, px, width) {
  var lines = 0;
  text.split('\n').forEach(function (para) {
    var line = 0, words = para.split(' ');
    lines++;
    words.forEach(function (word, i) {
      var w = mtTextWidth_(word, px), gap = i === 0 ? 0 : 0.278 * px;
      if (line > 0 && line + gap + w > width) { lines++; line = w; }
      else line += gap + w;
      while (line > width) { lines++; line -= width; } // a word wider than the cell
    });
  });
  return lines;
}

var MT_ARIAL = (function () {
  // Arial advance widths, in ems.
  var w = {}, set = function (chars, v) { for (var i = 0; i < chars.length; i++) w[chars.charAt(i)] = v; };
  set('abdeghnopqu0123456789_?$#', 0.556);
  set('ckszvxy', 0.5);
  set('ijl\'|', 0.222);
  set('ft ,.;:!/[]()-', 0.278);
  set('r', 0.333);
  set('m', 0.833);
  set('w', 0.722);
  set('"', 0.355);
  set('ABEKPSVXY', 0.667);
  set('CDHNRU', 0.722);
  set('FTZ', 0.611);
  set('GOQ', 0.778);
  set('J', 0.5);
  set('L', 0.556);
  set('M', 0.833);
  set('W', 0.944);
  set('I', 0.278);
  set('\u2014', 1.0);
  return w;
})();

function mtTextWidth_(s, px) {
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var v = MT_ARIAL[s.charAt(i)];
    w += v === undefined ? 0.556 : v;
  }
  return w * px;
}

/** What the cards say plus the switches; a new week changes it. */
function mtFingerprint_(sh) {
  var text = sh.getRange('B2:B6').getDisplayValues().join('\n') + '|' +
             sh.getRange(MT_CONTROLS).getDisplayValues().join(',');
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text));
}

/*
 * NOTES
 * The test is four copies of one card, A1:E12, two across and two down, cut
 * apart after printing. A card's height depends on the week's verse and on the
 * review under it, so the script picks the text size (9 to 24 pt for the verse
 * rows; rows 2, 4 and 5 two points smaller) and the width of columns B and E
 * (420 to 800 px) that print the text largest while the four cards still fit
 * a portrait letter page printed fit to width, filling the page as fully as
 * it can. Where none does (Psalm 1
 * with a review) it fits one card, A1:B6, instead. G1 says which.
 *
 * It runs when A7:E7 change (C7 test/practice, D7 week, E7 review), hourly when
 * the verse has changed, and from the Memory test menu.
 *
 * Print with Memory test > Print (PDF), or File > Print: Selected cells (the
 * range in G1), portrait, Fit to width, the margins in MT_PAGE.
 *
 * If a printed page still runs over, lower MT_PAGE.slack (say 0.85); if the
 * text comes out smaller than it needs to, raise it.
 */
