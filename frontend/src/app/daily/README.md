# /daily — classroom day board

A full-screen board for the classroom projector, driven by the **DisplayAI** tab of the
teacher's planning spreadsheet. One class per screen, no scrolling, no Curriculate
header or footer. It polls the sheet once a minute and gates what is shown by the
clock and by the timing rules in the **Setup** tab.

Open it at `https://www.curriculate.net/daily` and press F11 (or add it to the
projector PC's startup) — that is the whole deployment on the classroom side.

## Files

| File | Role |
| --- | --- |
| `page.jsx` | The board. Clock, phases, video tile, lesson picture, points strip. |
| `layout.tsx` | Kiosk layout: fonts, `noindex`, tags `<body>` so the site chrome is hidden. |
| `daily.css` | Styles. Everything is sized in `vh`/`vw` so it fills any projector. |
| `../api/daily/route.ts` | Reads the sheet, parses it, caches for 30 s. |
| `../../lib/daily/sheets.ts` | Sheets API access (service account or API key). |
| `../../lib/daily/parse.ts` | Pure parsing of DisplayAI / Setup cells into the board's JSON. |

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | What |
| --- | --- | --- |
| `DAILY_SHEETS_SERVICE_ACCOUNT` | one of the two | JSON of a Google service account. Share the spreadsheet with its `client_email` as **Viewer**. The sheet can stay private. |
| `DAILY_SHEETS_API_KEY` | one of the two | Google API key with the Sheets API enabled. Only works if the spreadsheet is shared "Anyone with the link can view". |
| `DAILY_SHEET_ID` | no | Spreadsheet id. Defaults to the Weekly Schedule sheet this was built for. |
| `DAILY_ACCESS_KEY` | no | If set, the board must be opened as `/daily?k=<key>`. |
| `DAILY_PING_KEY` | no | Enables `/api/daily/ping?key=…`, which the sheet's Apps Script trigger calls after an edit so the board refreshes within seconds. |

To create the service account: Google Cloud Console → IAM & Admin → Service Accounts →
Create → Keys → Add key (JSON). Enable the **Google Sheets API** on that project.
Paste the whole JSON file as the value of `DAILY_SHEETS_SERVICE_ACCOUNT`.

## What it reads

| Range | Used for |
| --- | --- |
| `DisplayAI!A1:F40` | Greeting (A1), week line (A3), verse (A5), unscramble (C7), "Plans for…" line with class points and the entered flag (C8/D8), then the time rows: A time, C lesson text, D status, F flag. |
| `DisplayAI!C1:D40` as formulas | `HYPERLINK()` targets in the lesson or status cells → the video tile. |
| `Setup!A1:F20` | Timing rules, matched by the label text in column B, values in C/D (see below). |
| `Setup!S1:AB8` (values and formulas) | The feature-slot table. S carries the picture the CE rule swaps in on the week's last teaching day and T labels the rows; the E1 formula's `HLOOKUP` runs on U onwards, so the slots proper start two columns in: row 1 priority, row 2 name, row 3 the slot's own material, row 4 the rule that gates it, row 7 seconds on screen. The board re-runs each row-4 rule at its own clock (see below), so the scrubber moves them. `?debug=1` prints every slot with both formulas and what the sheet itself said. |
| `Setup!N1:Q8` | The "For Dismissal Messages" block: when the end-of-day material comes forward (lunch, lunch recess, dismissal) and how many minutes ahead. |
| `Poems!F1:J3`, `VerticalAi!D1:J200`, `Riddles!D1:D400`, `Master!B1:B2` | Ingredients for the display rules the board evaluates itself. |
| `Verses!A1:A400`, `Vertical!B4` | What A5 picks the day's verse from, so the board can cut it at a word boundary rather than mid-word. |
| `Points!A1:BV46` | Row 3 the class names, row 46 the four privilege flags each, and the days in between — the status bubble, the points strip labels and the writing penalty all come from this one read. |
| `Lessons!C1:J400` (values, formulas, and the links inside E to J) | The teacher's own material, keyed by lesson code in column C ("~H001" or "H001"): E the starting page reference, F the homework, I the lesson picture, J the video. The student-facing tabs leave this out on purpose, so it is looked up by code and folded into whichever class carries that code. Columns I and J are the picture and video columns, so any URL there is taken — a Drive link written `open?id=…`, or a link attached to the cell's own text — rather than only one that looks like a picture. |
| `Vertical!A1:J200` | Column A the period times, F to J Monday to Friday — the day's plan with a row per period. B4 (the week the verse is indexed by) is inside this block, so it costs no extra range. |
| `VerticalAi!D1:J200` | Also the day's plan: columns F to J are Monday to Friday, and each holds the day's classes run together in one cell. Used when DisplayAI's lesson column has not been filled in yet. |
| The Kiss & Ride tab | Its "Waiting (Recent First)" column, for the dismissal panel. The tab is found by name (`listSheetTitles`, cached an hour) and the column by its header cell. |
| `Display!E1` / `DisplayAI!E1` | The feature cell (poem, riddle, message, **or a picture**) — the sheet's own priority logic is reused as-is. Read as both a value and a formula, because an `=IMAGE()` cell has no text value at all. |

The non-teaching rows get a friendlier heading than the sheet's own label, because
the room is reading them rather than the teacher: Lunch becomes "Enjoy your lunch",
Recess Duty becomes "Out for recess", and Playground, Dismissal, Assembly, Chapel and
No School are similarly reworded (`friendlyDutyTitle` in `parse.ts`). A row with no
better wording keeps its own text.

Lesson cells are split using the shape the AI text already has:
`Subject Sec (n) Room (Code) Today we … Question? - bullet - bullet Reminders: …`
Cells that do not match (Lunch, Recess Duty, Dismissal) become "change of class" screens.

### The read budget

Google allows 60 Sheets read requests a minute per user, and a classroom screen
polls every 10 seconds, so a refresh has to be cheap. One refresh is **four
requests**: one `values:batchGet` for every value range above, one for the
formula ranges, and two grid reads for the links (`readGridLinks` over the
DisplayAI rows and over the Lessons page/homework columns). The tab list is cached
for an hour on top of that.

Most polls are answered from the in-memory copy. A sheet edit pings
`/api/daily/ping` and marks it dirty, but a refresh still happens at most once
every 20 seconds. If Sheets does answer 429 the board sits out 90 seconds and
serves the last read, flagged stale, rather than retrying into the same wall.

`values:batchGet` fails the whole batch if any one range names a tab that is not
there, so a 400 triggers a one-off probe of each range; the offenders are
remembered and left out of later batches (`readRangesSafe`).

## Timing rules (Setup tab)

| Setup label | Board behaviour |
| --- | --- |
| Time in advance to show next | "After this" block appears N minutes before the end |
| Time in advance to show reminders | Reminders block appears N minutes before the end |
| Change time to red | Clock, countdown and progress bar turn red |
| Show homework … minutes before end of class | "Write in your agenda" block appears |
| O Canada for (C) | The anthem holds the screen for N minutes after the announcements — the words and the flag from the day's column of `Poems!F1:J3` — 5 if the row is missing, which it is in the sheet today |
| Blank screen during announcements (C:D) | The feature cell has the screen to itself between those times — the flag for the anthem, scaled to fill — with "Please listen" underneath; a blank screen when E1 holds no picture |
| Show Dismissal List (D) | Dismissal screen with the "Before you head out" list from that time |
| Stand ready for dismissal (C) | "Get ready for dismissal" block appears N minutes before the last bell — five if the row is missing, which it is in the sheet today |
| Show pregnancy weeks during (D) | Grace window (minutes) for the status chips at each end of a period |
| Can go to washroom x min before (D) | "Washroom" chip switches off N minutes before the end |
| Snacks are allowed with B2 (C) | "Snacks" chip for N minutes once B2 is on |

The opening window (question and warm-up instead of the bullet list) is fixed at
5 minutes in `parse.ts` (`DEFAULT_SETUP.openMin`); there is no Setup row for it yet.

## How quickly do sheet edits show?

The board polls `/api/daily` every 10 s. The server keeps an in-memory copy and re-reads
the sheet when that copy is older than 2 minutes, **or** when the sheet has pinged it.
With the ping wired up, an edit reaches the projector within about 10 to 20 seconds;
without it, within about 2 minutes.

To wire the ping:

1. In Vercel add `DAILY_PING_KEY` (any long random string) and redeploy.
2. In the spreadsheet: Extensions → Apps Script, paste this, replacing the key:

   ```js
   function dailyPing() {
     UrlFetchApp.fetch("https://www.curriculate.net/api/daily/ping?key=YOUR_KEY", {
       method: "post", muteHttpExceptions: true,
     });
   }
   ```

3. Save, then Triggers (clock icon) → Add Trigger: function `dailyPing`, event source
   *From spreadsheet*, event type *On edit*. Approve the permissions once. Add a second
   trigger for *On change* if you want structural edits (rows added, sheets renamed) to
   count too.

Caveat: the copy is per server instance. With one classroom screen polling, the same
warm instance answers every poll, so a ping is seen immediately; if two instances were
ever in play the 2-minute fallback still bounds the lag.

## The board evaluates the sheet's display rules itself

Three cells on the Display tab are computed from `NOW()`: the daily-update text,
the feature cell **E1**, and the **D-column status**. Reading their results would
pin the board to the sheet's clock — the scrubber could not move them, and a
picture in E1 would never arrive. So the board reads the *ingredients* and applies
the same rules against its own clock (`evaluateFeature`, `evaluateDailyText`,
`evaluateStatus` in `lib/daily/parse.ts`).

| Rule | Order it follows |
| --- | --- |
| **E1 feature** | poem window (Setup C12–D12) → manual message when B7 is ticked → lesson picture when D7 is ticked → the Setup slot table by priority 1 to 6 → the riddle before the window → nothing |
| **Daily text** | the weekday's poem inside the window, else the VerticalAi row keyed 1 for that weekday — first two lines once past A11, in full before that; "Skip 7A " and friends stripped |
| **D-column status** | blank outside the period, `REC` for Lunch and Recess, blank for rows starting `*`, else the class letter plus four flags from Points row 46, dashed (B2 off) inside the Setup D16 grace window at each end |

Extra ranges read for this: `Poems!F1:J3`, `VerticalAi!D1:J200`, `Riddles!D1:D400`,
`Master!B1:B2`, `Points!A3:BZ3`, `Points!A46:BZ46`. Each is read separately, so a
renamed or missing tab degrades that one rule instead of blanking the board.

### The status colours

The status is a **privilege code**, and the sheet's conditional formatting on
D9/D11/D13 is what makes it readable across the room. The board mirrors those
rules (`statusStyle` in `parse.ts`) and shows it as a coloured bubble — so
`A-1000`, which has no text substitution and exists only to be coloured, still
reads correctly as grey on green.

The bubble says **what the benefit is**, not the sheet's shorthand
(`statusWords`, `BENEFIT_WORDS`), and only while that benefit is on the table:

| Code | On the board | When it shows | The legend |
| --- | --- | --- | --- |
| B1 | Free seat | the opening minutes of the class (Setup "Free seat for", 5 by default) — change seats, settle, and the lesson can start | Benefit 1 — two days in a row at that level: "Sit Anywhere" (SA) or a snack |
| B2 | Free pass | from Setup's grace minutes (15) to the end — nobody walks out during the teaching at the top of the class | Benefit 2 — one day at that level: the pass, one at a time, while the Washroom chip is green |
| FD | Extra FD | the same window as the pass | Benefit 3 — a week's average at that level: an extra Formal Discussion |
| all three | All 3 | the whole class, from the first minute — it is the class's own reward | the "both" column, orange |
| trailing ` 4` | `+2` | with whatever else shows | the bonus of two for being perfect the whole class |

### The opening minutes

A class opens on the verse. For the first `openMin` minutes (Setup, 5 by
default) the day's verse leads the panel in full, large and in the serif — the
brief focus while everyone settles. After that it is not gone: it carries on
along the bottom bar, where it stays all day, just no longer the thing at the
front of the room.

### Pictures the API cannot see

The Sheets REST API has **no image field**. Its `CellData` carries formats,
formulas, notes, hyperlinks and chips, and nothing else; there is no image type
in `ExtendedValue` and no image schema anywhere in the discovery document. So a
picture put into a cell with Insert &rsaquo; Image — either kind — is invisible
to the board: that cell has neither a value nor a formula to read, and the flag,
the feature cartoon and the lesson pictures all arrive empty.

`apps-script/mirror-cell-images.gs` fixes it in the sheet, without touching how
the pictures are put there. The teacher keeps inserting and pasting them; the
script finds the cells holding one, takes Google's temporary address, fetches the
bytes while it is still good, writes them to a Drive folder shared with anyone
who has the link — the projector's browser is not signed in as the teacher, and
Google's own image address is tagged to whoever asked for it and expires within
the hour — and records the durable address on a hidden **BoardImages** tab: cell
address in column A, picture address in column B.

The board reads that tab (`BoardImages!A2:B200`) and uses the address wherever
the picture itself cannot be seen: the anthem flag, the feature cell, a lesson's
picture by its row, and any Setup rule whose reference lands on a picture cell.

The cells themselves are left exactly as they are. A picture that has not changed
is not uploaded again: the bytes are fingerprinted, so the address stays the same
from run to run.

On the Lessons tab, **I is the picture, J the mirror column** — where a script of
your own can write an `=IMAGE()` for the picture in I — **and K the video**. The
board looks for the picture in I, then in what BoardImages recorded, then in J;
the video comes only from K.

Give it an hourly trigger, or call it from the on-edit trigger that already
pings the board. A trigger cannot be bound to one column — Apps Script fires them
for the whole spreadsheet — so `onEditRecordImages` filters on the edited range;
and since inserting a picture often arrives as a *change* rather than an *edit*,
with no range to filter on, the hourly trigger is the dependable one.

### The writing penalty

The legend's last row — *"Writing assignment penalty if below x points z times in
previous y days"* — is the one rule the sheet does not work out for itself, so
the board does: **more than one day of five points or fewer inside the last five
school days** puts a brown **Writing** chip beside the class on screen.

The daily scores sit in the Points tab in a block of columns per class.
`writingOwed` finds each block's score column — the column under the class's own
name first, since that is where a table headed by the class puts them, otherwise
whichever column in the block carries a day's worth of small numbers — and
`?debug=1` prints the row range and the column it settled on for each class
("`8A=AQ`"), which is the first place to look if a chip is missing or wrong.

When nothing is on the table the bubble is not drawn at all, rather than sitting
there grey. The colour is worked out from what is actually on offer — the code is
rebuilt in the sheet's own shorthand and put through the same rules — so it can
never promise more than the words do.

The washroom pass is shut at both ends of the period: for the first few minutes
nobody walks out during the lesson, and it closes again before the bell. The
opening window is Setup's grace minutes — the same one the sheet's own status
rule uses to force B2 off, so the bubble and the chip always agree — and while it
is shut at the top the chip counts down to when it opens ("Washroom in 7 min").
The closing window is Setup's "Can go to washroom x min before".

The class group letter sits small beside the words, and the code itself stays in
the bubble's tooltip. A code with no text label is read as its digits in the
legend's order — Benefit 1, Benefit 2, Benefit 3 — so `A-1000` is "Sit anywhere"
rather than nothing at all.

The rules are mirrored in the sheet's own order (D8:D9, D11:D13), first match
winning:

| # | Match | Colour |
| --- | --- | --- |
| 1 | ends with `1` | magenta, black text |
| 2 | `REC` | bright green |
| 3 | `B1 & B2` | orange, white text |
| 4 | ends with `4` (the morning marker) | brown, white text |
| 5 | `FD & B1` | dark green, red text |
| 6 | `B1` | dark green, white text |
| 7 | `FD & B2` | cyan, red text |
| 8 | `B2` | cyan |
| 9 | `All 3` | orange, red text |
| 10 | `-FD Only` | no fill, red text |
| 11 | `FD Only` | bright green, red text |
| 12 | `-000` | no fill, grey text |
| 13 | `000` | bright green, grey text |

Two consequences of that order are worth knowing, and both match the sheet:
a code ending in 1 (`AB1`, `AFD & B1`) is magenta and never reaches the
dark-green rules; and `B1 & B2` is listed above the trailing-4 rule, so
`AB1 & B2 4` stays orange while `AFD & B1 4` goes brown.

The colours are close matches taken from the rule swatches, not exact hexes.

If the sheet's rule order changes, reorder `STATUS_RULES` to match.

**The slot rules are evaluated here, not read.** Each slot's row 4 is its own
timing rule written against `NOW()` — "the memory verse for the first ten minutes
of CE, but the picture in S2 on the week's last teaching day". Reading the cell's
value gives the answer for the instant of the read, which is why the scrubber
could not move E1. `lib/daily/formula.ts` is a small Sheets evaluator (IF, AND,
NOW, TIMEVALUE, WEEKDAY, INDEX, HLOOKUP, cell and range references, …) and the
board runs those formulas itself with `NOW()` bound to the time on screen. A
formula it cannot follow, or one reaching past the ranges the board reads, throws
and the sheet's own value is used instead — the behaviour before it existed. The
grids a formula may reach are `Setup!A1:F20`, `Setup!M1:Q8`, `Setup!S1:AB8` and
`Master!B1:B2`.

**One deliberate difference from the sheet.** The slot test in E1 is `<>""`, and an
`=IMAGE()` cell has no text value at all — so the sheet skips its own picture slots
and E1 renders nothing. Here a cell holding a picture counts as filled. That is why
a flag placed in the Lesson Pic slot shows on the board even though it never showed
in E1. `?debug=1` names the rule that fired ("E1 rule used").

## Pictures

Two things can put a picture on the board, and both take a large share of the screen
rather than sitting in the side panel:

1. **The feature cell E1.** Whenever the sheet's own logic puts a picture there — an
   `=IMAGE("…")`, a `=HYPERLINK()` to one, or a bare image URL — the board gives it the
   right-hand side at nearly two thirds of the width, shrinks the lesson text to suit,
   and captions it "On screen now". It stays up as long as E1 holds it, so the sheet
   decides the timing. On the greeting, between-class and dismissal screens the picture
   shares the screen with that screen's text.
2. **The Lesson Pic slot** in Setup, which shows for the seconds set in row 7 of that
   column (600 by default) from the start of the period. E1 wins when both are present.

Google Drive share links are rewritten to a form an `<img>` can load
(`lh3.googleusercontent.com/d/<id>`); the file still has to be shared so that anyone
with the link can view it. A picture that fails to load is dropped and the normal
side panel comes back, so a bad link never leaves a broken frame on the projector.
`?pic=off` hides pictures entirely; `?pic=left` puts them on the left.

The heading of the next class — subject, room and start time — sits under the period
line on every screen, so the room always knows what is coming.

## The "Pray for …" line

A header cell in any column A to F, above the first time row, that starts with **Pray**
is picked up along with its link. It shows in the bottom bar: as a link (with a ↗) the
teacher can click when it points at a page such as Prayercast, or as a small player that
enlarges when it points at a video (YouTube or Drive), the same behaviour as the lesson
video. If no link is found the text shows in grey instead, so the difference is visible.

The link is looked for in three places, because Sheets stores them three ways: a
`=HYPERLINK()` formula, a **rich-text link** applied to the cell text with Insert › Link
(which appears in neither the cell's value nor its formula, so the grid itself has to be
read — `readGridLinks` in `lib/daily/sheets.ts`), and a bare URL inside the text.

## Checking what the board sees

`/daily?debug=1` lists exactly what came back from the sheet: the E1 picture and text,
the Pray line and its link, the lesson picture, period counts, points, and whether the
copy is stale. It also renders each picture it found and says whether it **loaded** or
**did NOT load**, which separates "the sheet never sent a URL" from "the URL is there but
the file is not shared". Use it first whenever something in the sheet is not showing.

A picture reaches the board only if the **cell itself** holds it — `=IMAGE("…")`, a
`=HYPERLINK()` to an image, an image URL as text, or Insert › Image › **Image in cell**.
A floating image placed *over* the grid is invisible to the sheet API and can never be
read. If E1's formula is `=IMAGE(SomeCell)` or plain `=SomeCell`, the board follows that
one reference; a longer chain (an `IF` that returns a cell holding an image) does not
work, and in Sheets it does not render an image in E1 either.

## Time scrubber

The slim strip along the bottom edge is a slider. Drag it to preview any time of the
day; the board outlines itself in yellow while previewing and shows "Previewing 11:47".
It snaps back to the live clock 45 s after the last touch, or on "Back to now", so the
projector cannot be left on a preview.

Its range runs from 90 minutes before the first class (or 10 minutes before the
announcements window in Setup, whichever is earlier) to 30 minutes after the last
period, or 45 minutes past the dismissal time — so arrival, announcements and
dismissal can all be previewed, not just the teaching periods.

Because the board evaluates the three `NOW()` rules itself (see above), the scrubber
moves those too: at any previewed time the feature cell, the daily text and the status
chips show what they *would* show then. Cells the board does not evaluate — anything
else in the sheet computed from `NOW()` — still hold their current values.

## Testing

- `/daily?t=11:05` freezes the clock at 11:05 so any phase can be checked.
- `/daily?pic=left` puts the lesson picture on the left; `?pic=off` hides it.
- `/api/daily?nocache=1` bypasses the 30 s cache.
- `node scripts/daily-parse-check.mjs` runs the parser against sample rows.
