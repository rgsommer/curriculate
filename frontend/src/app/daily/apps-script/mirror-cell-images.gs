/**
 * Record the sheet's in-cell pictures where the board can read them.
 *
 * WHY THIS EXISTS
 * The board reads the sheet through the Sheets REST API, and that API has no
 * image field anywhere: CellData carries formats, formulas, notes, hyperlinks
 * and chips, ExtendedValue has no image type, and the discovery document has no
 * image schema at all. A picture put into a cell with Insert > Image is
 * therefore unreadable to it — not awkward, unreadable — so the flag, the
 * feature cartoon and the lesson pictures all arrived empty.
 *
 * Apps Script, running inside the sheet, can see them. So:
 *
 *   1. Keep inserting and pasting pictures exactly as you do now.
 *   2. This script finds the cells holding one.
 *   3. It takes Google's temporary address for the picture,
 *   4. fetches the bytes while that address is still good,
 *   5. writes them somewhere durable — a Drive folder shared with anyone who
 *      has the link, because the projector is not signed in as you and Google's
 *      own address is tagged to whoever asked for it and expires within the hour,
 *   6. and records the durable address on a helper tab, leaving your cell alone.
 *   7. The board reads that tab through the ordinary API and uses the address
 *      wherever the picture itself cannot be seen.
 *
 * Nothing in the sheet changes but the helper tab. A picture that has not
 * changed is not uploaded again — the bytes are fingerprinted — so the address
 * stays the same from run to run.
 *
 * HOW TO USE IT
 *   1. Extensions > Apps Script, paste this in, Save.
 *   2. Run `recordCellImagesForBoard` once and grant the permissions it asks
 *      for. It will tell you how many pictures it recorded.
 *   3. Triggers (the clock icon) > Add Trigger > recordCellImagesForBoard,
 *      time-driven, every hour — or call it from the on-edit trigger that
 *      already pings the board.
 */

/** The cells the board takes pictures from. Add to this as the sheet grows. */
var BOARD_PICTURE_RANGES = [
  'Setup!S2',        // the picture the CE rule swaps in on the week's last day
  'Poems!F1:J3',     // the flag for O Canada, one column per weekday
  'DisplayAI!E1',    // the feature cell, when it holds a picture rather than a rule
  'Display!E1',
  'Lessons!I2:I400', // the lesson picture, by lesson code
];

/** The tab this writes to, and the Drive folder the copies live in. */
var BOARD_IMAGE_SHEET = 'BoardImages';
var BOARD_IMAGE_FOLDER = 'Daily Board images';

function recordCellImagesForBoard() {
  var ss = SpreadsheetApp.getActive();
  var known = readRecorded_(ss);
  var folder = null; // opened only if something actually needs uploading
  var rows = [];
  var fresh = 0;
  var reused = 0;
  var failed = [];

  BOARD_PICTURE_RANGES.forEach(function (a1) {
    var range;
    try {
      range = ss.getRange(a1);
    } catch (e) {
      return; // that tab is not in this sheet
    }
    var values = range.getValues();
    var formulas = range.getFormulas();
    for (var r = 0; r < values.length; r += 1) {
      for (var c = 0; c < values[r].length; c += 1) {
        var image = asCellImage_(values[r][c]);
        // Belt and braces: on some versions getValues() hands a picture back as
        // an empty string rather than a CellImage, so a cell that is blank in
        // both the values and the formulas is asked directly. Only those cells,
        // so this stays one round trip per genuinely empty cell.
        if (!image && values[r][c] === '' && !(formulas[r] || [])[c]) {
          var probe = range.getCell(r + 1, c + 1);
          if (probe.getValueType() === SpreadsheetApp.ValueType.IMAGE) image = asCellImage_(probe.getValue());
        }
        if (!image) continue;
        var cell = range.getCell(r + 1, c + 1);
        var ref = cell.getSheet().getName() + '!' + cell.getA1Notation().replace(/\$/g, '');
        try {
          var record = durableUrl_(image, ref, known[ref], function () {
            if (!folder) folder = boardImageFolder_();
            return folder;
          });
          if (!record) { failed.push(ref); continue; }
          rows.push([ref, record.url, record.hash, new Date(), record.how]);
          if (record.uploaded) fresh += 1; else reused += 1;
        } catch (err) {
          failed.push(ref + ' (' + err.message + ')');
        }
      }
    }
  });

  writeRecorded_(ss, rows);

  var message = rows.length + ' picture(s) recorded — ' + fresh + ' new, ' + reused + ' unchanged'
    + (failed.length ? '; could not read ' + failed.join(', ') : '');
  try {
    ss.toast(message, 'Daily board', 10);
  } catch (e) {
    // running from the editor rather than from the sheet
  }
  Logger.log(message);
  return message;
}

/** A cell holding a picture reads back as a CellImage; everything else does not. */
function asCellImage_(value) {
  if (!value || typeof value !== 'object') return null;
  return typeof value.getContentUrl === 'function' ? value : null;
}

/**
 * An address for this picture that will still work tomorrow, in a browser that
 * is not signed in as you.
 *
 * A picture inserted from a URL already has one. One pasted or uploaded is
 * copied to Drive — but only when its bytes have actually changed, so the
 * address does not churn every time this runs.
 */
function durableUrl_(image, ref, previous, openFolder) {
  var source = typeof image.getUrl === 'function' ? image.getUrl() : '';
  if (source && /^https?:\/\//.test(source)) {
    return { url: source, hash: 'url', how: 'inserted from a URL', uploaded: false };
  }

  var temporary = image.getContentUrl();
  if (!temporary) return null;
  var blob = UrlFetchApp.fetch(temporary).getBlob();
  var hash = digest_(blob.getBytes());

  // The same picture as last time, and the copy is still there: keep the address.
  if (previous && previous.hash === hash && previous.url && fileStillThere_(previous.url)) {
    return { url: previous.url, hash: hash, how: 'unchanged', uploaded: false };
  }

  var folder = openFolder();
  blob.setName(ref.replace(/[^A-Za-z0-9]+/g, '-') + '-' + hash.slice(0, 8) + '.png');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // The old copy of this cell's picture is no longer referenced by anything.
  if (previous && previous.url) trashFileByUrl_(previous.url);
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId(), hash: hash, how: 'copied to Drive', uploaded: true };
}

function digest_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)
    .map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); })
    .join('');
}

function driveIdFromUrl_(url) {
  var m = /(?:googleusercontent\.com\/d\/|drive\.google\.com\/file\/d\/|[?&]id=)([A-Za-z0-9_-]+)/.exec(url || '');
  return m ? m[1] : '';
}

function fileStillThere_(url) {
  var id = driveIdFromUrl_(url);
  if (!id) return true; // not one of ours; assume the address is good
  try {
    return !DriveApp.getFileById(id).isTrashed();
  } catch (e) {
    return false;
  }
}

function trashFileByUrl_(url) {
  var id = driveIdFromUrl_(url);
  if (!id) return;
  try {
    DriveApp.getFileById(id).setTrashed(true);
  } catch (e) {
    // already gone
  }
}

/** What the last run recorded, so unchanged pictures keep their address. */
function readRecorded_(ss) {
  var sheet = ss.getSheetByName(BOARD_IMAGE_SHEET);
  var out = {};
  if (!sheet) return out;
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r += 1) {
    var ref = String(values[r][0] || '').trim();
    if (ref) out[ref] = { url: String(values[r][1] || '').trim(), hash: String(values[r][2] || '').trim() };
  }
  return out;
}

function writeRecorded_(ss, rows) {
  var sheet = ss.getSheetByName(BOARD_IMAGE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(BOARD_IMAGE_SHEET);
    sheet.hideSheet();
  }
  sheet.clear();
  var header = [['Cell', 'Picture address', 'Fingerprint', 'Recorded', 'How']];
  sheet.getRange(1, 1, 1, 5).setValues(header).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  sheet.setFrozenRows(1);
}

function boardImageFolder_() {
  var found = DriveApp.getFoldersByName(BOARD_IMAGE_FOLDER);
  return found.hasNext() ? found.next() : DriveApp.createFolder(BOARD_IMAGE_FOLDER);
}

/* ------------------------------------------------------------------ *
 * Triggers
 *
 * A trigger cannot be bound to one column — Apps Script fires them for the
 * whole spreadsheet — so the filtering is done here, in the handler.
 *
 * And the honest caveat: inserting a picture into a cell often arrives as a
 * *change* rather than an *edit*, and a change event carries no range to filter
 * on. So the hourly time-driven trigger is the one to rely on; these two are
 * what make it feel immediate when they do fire.
 *
 *   Triggers > Add Trigger > onEditRecordImages   > From spreadsheet > On edit
 *   Triggers > Add Trigger > onChangeRecordImages > From spreadsheet > On change
 * ------------------------------------------------------------------ */

/** On edit: run only when the edit lands in one of the picture ranges. */
function onEditRecordImages(e) {
  if (!e || !e.range) return;
  if (!touchesPictureRange_(e.range)) return;
  runRecordingSoon_();
}

/** On change: no range to look at, so the whole sweep runs, at most once a minute. */
function onChangeRecordImages(e) {
  if (e && e.changeType && ['EDIT', 'INSERT_GRID', 'OTHER', 'FORMAT'].indexOf(e.changeType) < 0) return;
  runRecordingSoon_();
}

function touchesPictureRange_(edited) {
  var ss = SpreadsheetApp.getActive();
  var name = edited.getSheet().getName();
  for (var i = 0; i < BOARD_PICTURE_RANGES.length; i += 1) {
    var target;
    try {
      target = ss.getRange(BOARD_PICTURE_RANGES[i]);
    } catch (err) {
      continue;
    }
    if (target.getSheet().getName() !== name) continue;
    var overlapsRows = edited.getLastRow() >= target.getRow()
      && edited.getRow() <= target.getLastRow();
    var overlapsCols = edited.getLastColumn() >= target.getColumn()
      && edited.getColumn() <= target.getLastColumn();
    if (overlapsRows && overlapsCols) return true;
  }
  return false;
}

/**
 * Pictures often arrive several at a time, and each one would otherwise start
 * its own sweep. One run a minute is plenty.
 */
function runRecordingSoon_() {
  var props = PropertiesService.getDocumentProperties();
  var last = Number(props.getProperty('lastImageSweep') || 0);
  if (Date.now() - last < 60 * 1000) return;
  props.setProperty('lastImageSweep', String(Date.now()));
  recordCellImagesForBoard();
}
