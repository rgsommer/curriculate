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
| `Display!E1` / `DisplayAI!E1` | The feature cell (poem, riddle, message) — the sheet's own priority logic is reused as-is. |

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

## Time scrubber

The slim strip along the bottom edge is a slider. Drag it to preview any time of the
day; the board outlines itself in yellow while previewing and shows "Previewing 11:47".
It snaps back to the live clock 45 s after the last touch, or on "Back to now", so the
projector cannot be left on a preview.

## Testing

- `/daily?t=11:05` freezes the clock at 11:05 so any phase can be checked.
- `/daily?pic=left` puts the lesson picture on the left; `?pic=off` hides it.
- `/api/daily?nocache=1` bypasses the 30 s cache.
- `node scripts/daily-parse-check.mjs` runs the parser against sample rows.
