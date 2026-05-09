# Field Day — End-to-End Test Plan

The features and CSS responsive pass are done. Before any school relies on
this for a real event, **do this checklist on real hardware** in roughly 90
minutes. Find a colleague to play "the admin" while you play "the leader"
on a different device.

## Devices to use (or as close as you can get)

- One **iPad** (any year — landscape and portrait)
- One **iPhone** (any year, narrow viewport — 375–390px wide)
- One older **Android tablet** (cheap parent-volunteer device — Chrome)
- One **laptop** (admin's Excel-editing primary)

Use real cellular Wi-Fi — not your office fiber. If possible, run from a
school's actual outdoor Wi-Fi to surface latency issues.

## Setup walkthrough (15 min)

1. **Admin (laptop)** opens `https://www.curriculate.net/fieldday`
2. Click "Enter as Admin" → enter your email → check inbox for passkey
3. Enter passkey, name the school "Test School", note the school code
4. Settings → set up 3–5 houses, 3 divisions (Junior 5–8, Intermediate 9–11, Senior 12–14)
5. Settings → toggle both placement AND standard scoring on
6. Click "Download Workbook" → fill in 30 kids across 6 events → upload back
7. Verify: events created, competitors imported, no duplicates on second upload (try Merge mode)

## Multi-device sync (15 min)

8. **Leader (iPad)** opens `/fieldday/`
9. "Enter as Event Leader" → enter school code → click "Look up names"
10. Pick name from dropdown → land on Assignments view
11. Verify: only assigned events visible, status pips show correctly
12. **Admin** completes one event on laptop → leader's iPad reflects within 6 seconds
13. **Leader** submits a result → announcer queue on admin tab updates within 6 seconds

## Run a mock event (30 min)

14. Pick a 50m sprint event with 6 competitors
15. Tap "Start All" — verify each row shows independent live clock
16. Tap each runner's ⏹ as they "finish" (just tap in random order)
17. Verify: times saved, places computed, fastest highlighted with horn animation if it's a record
18. Mark one competitor as DQ (tap the DQ button) — confirm placement recomputes
19. Submit event → confirm it appears in the announcer tab on a different device

## Critical mobile checks (15 min)

20. **iPhone (portrait)**: tap into an attempt input — does the keyboard pop up without zooming the page?
21. **Tabs**: do they scroll horizontally without wrapping into multiple lines?
22. **Modals**: do they fit the screen without clipping? (especially the workbook import modal)
23. **Stopwatch button**: is the touch target big enough to hit reliably mid-race?
24. **Confetti / horn**: does the celebration overlay close cleanly with the "Awesome 🎺" button?

## Refresh resilience (5 min)

25. Start a multi-row timer on the leader's iPad
26. Force a refresh (pull down to refresh, or tap reload)
27. **Verify**: the leader is signed back in, on the same event, with the same timers still ticking against the original start time
28. Stop a timer — confirm the elapsed time is correct (within ~1s tolerance for the refresh)

## Print + ribbons (10 min)

29. Submit 4–5 events
30. Ribbons tab → "Print List" — does it look right? (Hide UI chrome, just the table)
31. "Print Label Sheet" — sheet format correct? (7 cols × 10 rows of 1" labels on Letter)
32. **If you have label paper**: print on actual Avery 22806 (or similar) and verify alignment

## Day Summary + cross-promotion (5 min)

33. Admin → Day Summary
34. Verify: top 3 overall, by gender, by age band, house standings, records, per-event top 4
35. Confirm the "Discover Curriculate" card appears at the bottom
36. Print the summary — does it print cleanly without UI chrome?

## Refer + Report (5 min)

37. Click "Recommend ✉︎" → fill in fake teacher info → check that the recommendation email arrives
38. Click "Report 🐞" → file a test problem report → check `admin@curriculate.net` inbox
39. Verify: report email includes context (which view, which event, browser UA)

## Privacy + Terms (2 min)

40. Visit `/meet-fieldday/privacy.html` and `/meet-fieldday/terms.html` on iPhone
41. Verify legibility, no horizontal scroll, links work

## Things to watch for (write these down as you find them)

- Any input that triggers iOS zoom (means font-size < 16px somewhere)
- Any button that's smaller than your fingertip
- Any modal that clips or can't scroll its content
- Any horizontal overflow that creates a sideways scrollbar on the page itself
- Any race condition where two devices show different state for >10 seconds
- Any error toast you can't act on

## Sign-off

Tester name: _______________ Date: _____________

Devices tested: ☐ iPad ☐ iPhone ☐ Android tablet ☐ Laptop

Outdoor Wi-Fi tested: ☐ yes ☐ no

Critical bugs found: ___________

Ship readiness: ☐ ready ☐ blocked by: ___________
