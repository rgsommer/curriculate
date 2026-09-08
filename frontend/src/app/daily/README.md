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
| `Setup!A1:D20` | Timing rules, matched by the label text in column B (see below). |
| `Setup!U1:AA8` | The feature-slot table; the **Lesson Pic** column gives the picture URL (row 4, `=IMAGE()` or a URL) and its on-screen window in seconds (row 7). |
| `Display!E1` / `DisplayAI!E1` | The feature cell (poem, riddle, message, **or a picture**) — the sheet's own priority logic is reused as-is. Read as both a value and a formula, because an `=IMAGE()` cell has no text value at all. |

Lesson cells are split using the shape the AI text already has:
`Subject Sec (n) Room (Code) Today we … Question? - bullet - bullet Reminders: …`
Cells that do not match (Lunch, Recess Duty, Dismissal) become "change of class" screens.

## Timing rules (Setup tab)

| Setup label | Board behaviour |
| --- | --- |
| Time in advance to show next | "After this" block appears N minutes before the end |
| Time in advance to show reminders | Reminders block appears N minutes before the end |
| Change time to red | Clock, countdown and progress bar turn red |
| Show homework … minutes before end of class | "Write in your agenda" block appears |
| Blank screen during announcements (C:D) | Blank screen between those times |
| Show Dismissal List (D) | Dismissal screen with the "Before you head out" list from that time |
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
rules (`statusStyle` in `parse.ts`) and shows the code as a coloured badge rather
than a plain label — so `A-1000`, which has no text substitution and exists only to
be coloured, still reads correctly as grey on green.

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

A header cell (column A or C, above the first time row) that starts with **Pray** is
picked up with its hyperlink. It shows in the bottom bar: as a link the teacher can
click when it points at a page such as Prayercast, or as a small player that enlarges
when it points at a video (YouTube or Drive), the same behaviour as the lesson video.

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
