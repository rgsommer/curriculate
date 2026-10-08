// backend/utils/objectiveMarking.js
//
// Marking the objective sections without asking a model to do it.
//
// Matching a letter to a row is a lookup. Given the key and what the student
// wrote, "is this right" is a string comparison, and a string comparison does
// not hallucinate, drift, or get generous on a weak paper. Measured against a
// hand-marked class of twenty, the objective sections (20 of 50 marks) were
// out by about one mark each when the model marked them, and the matching
// section was inflated on five papers because blanks were filled in from the
// key.
//
// So the model is asked for one thing only — what is written on each line —
// and everything after that happens here.
//
// Deliberately free of any model call, so it can be tested on its own.

/** Normalise an answer for comparison without destroying what it says. */
export function normaliseAnswer(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");

  // True/False however a student writes it.
  const tf = s.toUpperCase().replace(/[^A-Z]/g, "");
  if (tf === "T" || tf === "TRUE") return "T";
  if (tf === "F" || tf === "FALSE") return "F";

  // A bare option letter: "(c)", "C.", "c" are one answer.
  const letter = s.toUpperCase().match(/^\(?([A-Z])\)?[.)]?$/);
  if (letter) return letter[1];

  return s.toLowerCase().replace(/[.,;:!?]+$/, "");
}

// A key prints "×" and a student writes "x"; a key prints "÷" and a student
// writes "/". Marking those wrong over a glyph is pedantry no teacher would
// apply. Handled in the comparison rather than the normaliser, because "x" is
// also a perfectly good option letter in a matching column.
const SAME_THING = [
  new Set(["X", "×", "*"]),
  new Set(["÷", "/"]),
  new Set(["-", "−"]),
];
// "6n + 15" and "15 + 6n" are the same answer. A key writes one order and a
// student writes the other, and a sum is the commonest shape in a
// fill-in-the-blank, so the terms are compared as a set rather than a string.
// Only for sums: order matters everywhere else.
function sumParts(v) {
  if (!v.includes("+")) return null;
  const parts = v.split("+").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.sort().join("+") : null;
}

export function answersMatch(a, b) {
  if (a === b) return true;
  if (SAME_THING.some((g) => g.has(a) && g.has(b))) return true;
  const sa = sumParts(a), sb = sumParts(b);
  return !!(sa && sb && sa === sb);
}

// An answer that is more than a letter, a digit or a T/F is one where a
// student can be right in words the key does not use. Those are still marked
// — the key is the key — but flagged, so a teacher glancing down the guide
// can see which crosses rest on wording rather than on arithmetic.
export function needsEye(written) {
  const w = String(written || "").trim();
  return w.length > 3 && !/^[\d.,/\s-]+$/.test(w);
}

/**
 * Parse the extracted key into numbered answers per section letter.
 *
 * /grading/extract-answer-key emits one line per question, labelled by the
 * section letter and number as the paper prints them:
 *     A1: F (/1)      B3: FALSE (/1)      C2: 6 (/1)
 * Anything it cannot label that way — the headers, the working-out sections,
 * the grading notes — is skipped, because those are not lookups.
 *
 * Stops at a second paper's key: a key covering an Accommodated version as
 * well restarts its numbering, and merging the two would mark every student
 * against whichever came last.
 */
export function parseKeyAnswers(text) {
  const bySection = new Map();
  const lines = String(text || "").split("\n");
  let started = false;

  for (const raw of lines) {
    const line = raw.trim();
    // A second "ANSWER KEY: …" banner means another paper begins here.
    if (/^=+\s*ANSWER KEY/i.test(line)) {
      if (started) break;
      started = true;
      continue;
    }
    // An item the two readings of the key disagreed about. Never used to
    // mark: a wrong key entry crosses every student who got that question
    // right, and on this test a single reading turned "3" into "4".
    if (line.includes("[CHECK]")) continue;
    const m = line.match(/^([A-Z])\s*(\d{1,2}[a-z]?)\s*[:.]\s*(.+?)\s*(?:\(\/\s*[\d.]+[^)]*\))?\s*$/);
    if (!m) continue;
    const [, letter, n, answer] = m;
    const clean = answer.trim();
    // "See Option 1 and 2 solutions provided" is not an answer to compare to.
    if (!clean || clean.length > 40 || /^see\b/i.test(clean)) continue;
    if (!bySection.has(letter)) bySection.set(letter, new Map());
    const sec = bySection.get(letter);
    if (!sec.has(n)) sec.set(n, normaliseAnswer(clean));
  }
  return bySection;
}

/**
 * Is this section one a key can settle?
 *
 * A section is objective when the key gives a short answer for most of its
 * items. "Show your work" and the extended problem are not: their key entries
 * are method descriptions, and marks there are for the working.
 */
export function isObjectiveSection(keyItems) {
  if (!keyItems || keyItems.size < 2) return false;
  const vals = [...keyItems.values()];
  const short = vals.filter((v) => v.length <= 20).length;
  return short / vals.length >= 0.8;
}

/**
 * Is this section a CLOSED SET — a letter from a column, or true/false?
 *
 * Stricter than isObjectiveSection, and the distinction is worth real marks.
 * Matching and true/false have an answer that is right or wrong with nothing
 * in between, and a string comparison settles them exactly. A fill-in-the
 * blank does not: the key says one word and a student writes another that
 * means the same, or the same one spelled differently, or the right thing
 * with the units attached.
 *
 * Measured over a hand-marked class of twenty, taking the blind reading for
 * matching and true/false cut their error from 28 marks to 10 and from 11 to
 * 8. Taking it for the blanks as well raised theirs from 16 to 36 — every
 * paper in the class lost marks it had earned. So the blanks are left to the
 * grader, which can see that "brackets" and "parentheses" are one answer.
 */
export function isClosedSetSection(keyItems) {
  if (!keyItems || keyItems.size < 2) return false;
  const vals = [...keyItems.values()];
  const allLetters = vals.every((v) => /^[A-Z]$/.test(v));
  const allTF = vals.every((v) => v === "T" || v === "F");
  return allLetters || allTF;
}

/**
 * Mark one transcribed paper against the key.
 *
 * @param transcript  [{ section, letter?, items: [{ n, written }] }]
 * @param keyText     the extracted answer key
 * @returns { sections: [{ name, letter, score, out_of, items, objective }], marked, skipped }
 *
 * A blank is "blank", never guessed. An item the key does not cover is left
 * alone rather than marked wrong.
 */
export function markObjective(transcript, keyText) {
  const key = parseKeyAnswers(keyText);
  const out = [];
  let marked = 0;
  let skipped = 0;

  for (const sec of transcript || []) {
    // Match the key's section letter to the transcript's, by the letter the
    // transcript reports or by the one its name starts with.
    const letter = String(sec.letter || "").toUpperCase().slice(0, 1)
      || (String(sec.section || "").trim().match(/^([A-Z])[.)\s]/) || [])[1]
      || "";
    const keyItems = letter ? key.get(letter) : null;

    if (!keyItems || !isObjectiveSection(keyItems)) {
      out.push({ name: sec.section, letter, objective: false, closedSet: false, items: sec.items || [] });
      skipped += (sec.items || []).length;
      continue;
    }
    const closedSet = isClosedSetSection(keyItems);

    const items = (sec.items || []).map((it) => {
      const want = keyItems.get(String(it.n));
      const wrote = normaliseAnswer(it.written);
      if (!want) return { n: it.n, written: it.written, verdict: "unmarked" };
      if (!wrote) return { n: it.n, written: "", verdict: "blank", answer: want };
      const ok = answersMatch(wrote, want);
      marked += 1;
      return {
        n: it.n,
        written: it.written,
        verdict: ok ? "correct" : "incorrect",
        answer: ok ? "" : want,
        ...(!ok && needsEye(it.written) ? { checkWording: true } : {}),
      };
    });

    const counted = items.filter((i) => i.verdict !== "unmarked");
    out.push({
      name: sec.section,
      letter,
      objective: true,
      // Only a closed set may override the grader outright; see
      // isClosedSetSection for what that cost when it was not checked.
      closedSet,
      items,
      score: counted.filter((i) => i.verdict === "correct").length,
      out_of: counted.length,
    });
  }

  return { sections: out, marked, skipped };
}

/**
 * Is this key answer one that could actually mark a student wrong?
 *
 * Only short answers are ever used as a lookup: parseKeyAnswers drops
 * anything longer, and isObjectiveSection drops a section whose answers are
 * mostly long. A key's entry for "Show your work" is a method, and nobody is
 * marked against it. So there is no point telling a teacher that the two
 * readings punctuated a worked solution differently — it buries the one line
 * that matters under ten that do not.
 */
export function isCheckableAnswer(v) {
  const s = String(v ?? "").trim();
  return s.length > 0 && s.length <= 24;
}

/**
 * Do two readings of the same key entry say the same thing?
 *
 * Looser than answersMatch, which compares a student's answer to the key and
 * should be strict. This compares the key with ITSELF, read twice, and the
 * question is only whether the transcription differs in substance. "16x 15x
 * 7x" and "16x, 15x, 7x" are one answer written two ways; flagging that as a
 * disagreement makes the warning worthless, and a warning nobody reads is
 * worse than no warning.
 */
export function sameKeyReading(a, b) {
  const loose = (v) => String(v ?? "")
    .toLowerCase()
    .replace(/[→–—]/g, " ")     // arrows and dashes are punctuation here
    .replace(/[^a-z0-9+=./]+/g, " ")           // keep what changes the meaning
    .replace(/\s+/g, "");                      // "x = 6" and "x=6" are one reading
  const x = loose(a), y = loose(b);
  if (x === y) return true;
  return answersMatch(normaliseAnswer(a), normaliseAnswer(b));
}
