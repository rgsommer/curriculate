# Demo Task QA Report

**Date:** April 18, 2026  
**URL:** play.curriculate.net/demo  
**Tasks checked:** 56 of 56  

---

## Critical Issues

### 1. Hide & Seek — No content rendered
Shows "Demo task (template missing)" placeholder instead of real task content. The fallback template is not implemented for this task type.

---

## Medium Issues

### 2. Flashcards — Raw markdown visible
Card text displays raw markdown syntax (`**text**`) instead of rendering bold formatting. Students see asterisks around words instead of styled text.

### 3. Make It & Snap It — Raw JSON exposed to students
Shows raw JSON object `{ "camera": "on", "taskType": "make-and-snap" }` in the student-facing UI. This is developer data leaking into the presentation layer.

### 4. Mime — Very low contrast text
Text on the pink-purple gradient background is nearly invisible. The instruction text blends into the background, making the task very difficult to read.

### 5. Speech Recognition Answer — Poor text contrast
Instruction text appears very light/faded against the white background. Difficult to read, especially on lower-quality screens or in bright classroom environments.

### 6. Body Break — Low contrast on title and helper text
The "Quick reset" title (golden text on light gradient), "Do this together" subtitle, and "Nice work" helper text all have low contrast against the pastel background. The "Refresh" button is particularly faint and hard to see. The main instruction text is readable but lighter than ideal.

---

## Minor Issues

### 7. Art View — Image unavailable
Shows "Image unavailable" because the illustration references an external Wikimedia URL that fails to load. Needs a bundled or reliably-hosted image.

### 8. Brain Spark Notes — Placeholder text in summary
Displays "Summary point 2" which appears to be normalizer placeholder text rather than real content.

### 9. Echo Chain — Done/Skip button overlap
The Done and Skip buttons overlap or crowd each other at the bottom of the task.

### 10. Historical Document — Document image unavailable
Shows "Document image unavailable" placeholder. Similar to Art View — the referenced image resource is missing or unreachable.

### 11. Many tasks — Black rectangle at top (missing illustrations)
A large number of tasks display a black rectangle in the illustration/header area where an image should appear. This is a widespread cosmetic issue affecting the visual appeal of the demo. Observed on: Word Weaver Duel, and many others.

### 12. Motion Mission — Numbered steps run together
The numbered movement steps are displayed as a continuous paragraph rather than as a properly formatted numbered list. Hard to scan quickly.

### 13. Photo Journal — Illustration nearly invisible
The illustration/image area is nearly invisible against the dark background, creating a poor visual impression.

### 14. Timeline — Developer hint text visible to students
Students can see the text: "(Generator hint: correctOrder is present; objective scoring compares your submitted order to it.)" This is internal developer guidance that should be hidden from the student-facing view.

### 15. Word Weaver Duel — Grid layout could be improved
The crossword grid is small and left-aligned with large empty space to the right. Could benefit from being wider or centered for better usability on larger screens.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Medium | 5 |
| Minor | 9 |
| **Total** | **15** |

**Passing tasks:** 41 of 56 tasks passed QA with no issues (beyond the widespread missing illustration images noted in item 11).

### Priority Recommendations

1. **Fix Hide & Seek** — add a static demo template so it renders real content
2. **Fix raw data leaks** — Flashcards markdown, Make It & Snap It JSON, and Timeline developer hint should all be cleaned from student-facing views
3. **Improve contrast** — Mime and Speech Recognition need contrast fixes to meet accessibility standards; Body Break title/helper text could also use darker colors
4. **Bundle images** — Art View and Historical Document should use reliably-hosted images rather than external URLs
