/**
 * Mirror in-cell images into =IMAGE() formulas, so the daily board can see them.
 *
 * WHY THIS EXISTS
 * The board reads the sheet through the Sheets REST API, and that API has no
 * image field at all — CellData carries formats, formulas, notes, hyperlinks and
 * chips, and nothing else. A picture put in with Insert > Image > Image in cell
 * is therefore invisible to it: the cell has no value and no formula to read, so
 * the flag, the cartoon and the lesson pictures all reached the board as empty.
 *
 * Apps Script can see them. Running inside the sheet, a cell holding a picture
 * reads back as a CellImage, and this script turns each one into an =IMAGE("…")
 * formula pointing at the same picture. The sheet looks exactly the same
 * afterwards; the difference is that the formula is something the API can read.
 *
 * An image inserted from a URL keeps that URL. One pasted or uploaded has no
 * public address, so its bytes are copied to a Drive folder shared with anyone
 * who has the link — the projector's browser is not signed in as you, and
 * Google's own temporary image URLs are tagged to the account that asked for
 * them and expire within the hour.
 *
 * HOW TO USE IT
 *   1. Extensions > Apps Script, paste this in, Save.
 *   2. Run `mirrorCellImagesForBoard` once and grant it the permissions it asks
 *      for. It will tell you how many pictures it converted.
 *   3. Triggers (the clock icon) > Add Trigger > mirrorCellImagesForBoard,
 *      time-driven, every hour — or call it from the on-edit trigger that
 *      already pings the board.
 *
 * Converting a cell is a one-way door: the picture becomes a formula. That is
 * the point, and the picture still shows in the sheet, but keep a copy of
 * anything irreplaceable before the first run.
 */

/** The cells the board takes pictures from. Add to this as the sheet grows. */
var BOARD_PICTURE_RANGES = [
  'Setup!S2',        // the picture the CE rule swaps in on the week's last day
  'Poems!F3:J3',     // the flag for O Canada, one column per weekday
  'DisplayAI!E1',    // the feature cell, when it holds a picture rather than a rule
  'Display!E1',
  'Lessons!I2:I400', // the lesson picture, by lesson code
];

/** Where the copies live. Created on first use. */
var BOARD_IMAGE_FOLDER = 'Daily Board images';

function mirrorCellImagesForBoard() {
  var ss = SpreadsheetApp.getActive();
  var folder = boardImageFolder_();
  var converted = 0;
  var skipped = [];

  BOARD_PICTURE_RANGES.forEach(function (a1) {
    var range;
    try {
      range = ss.getRange(a1);
    } catch (e) {
      return; // the tab is not in this sheet; nothing to do
    }
    var values = range.getValues();
    for (var r = 0; r < values.length; r += 1) {
      for (var c = 0; c < values[r].length; c += 1) {
        var value = values[r][c];
        // Only a cell that actually holds a picture reads back as a CellImage.
        // A cell holding a formula gives its computed value, so E1's own rule is
        // never overwritten.
        if (!value || typeof value !== 'object' || typeof value.getContentUrl !== 'function') continue;
        var cell = range.getCell(r + 1, c + 1);
        var label = cell.getSheet().getName() + '!' + cell.getA1Notation();
        var url = stableImageUrl_(value, folder, label);
        if (url) {
          cell.setFormula('=IMAGE("' + url + '")');
          converted += 1;
        } else {
          skipped.push(label);
        }
      }
    }
  });

  var message = converted + ' picture(s) converted'
    + (skipped.length ? '; could not read ' + skipped.join(', ') : '');
  try {
    ss.toast(message, 'Daily board', 10);
  } catch (e) {
    // running from the editor rather than the sheet
  }
  Logger.log(message);
  return message;
}

/**
 * A web address for the picture that will still work tomorrow, on a browser
 * that is not signed in as you.
 */
function stableImageUrl_(image, folder, label) {
  // Inserted from a URL: it already has one, and that one is the original.
  var source = typeof image.getUrl === 'function' ? image.getUrl() : '';
  if (source && /^https?:\/\//.test(source)) return source;

  // Pasted or uploaded: Google's own URL for it is tagged to whoever asked and
  // expires, so the bytes are copied somewhere durable instead.
  var temporary = image.getContentUrl();
  if (!temporary) return '';
  var name = label.replace(/[^A-Za-z0-9]+/g, '-') + '.png';
  var blob = UrlFetchApp.fetch(temporary).getBlob().setName(name);

  // One file per cell, replaced in place, so the address does not change every
  // time this runs.
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

function boardImageFolder_() {
  var found = DriveApp.getFoldersByName(BOARD_IMAGE_FOLDER);
  return found.hasNext() ? found.next() : DriveApp.createFolder(BOARD_IMAGE_FOLDER);
}
