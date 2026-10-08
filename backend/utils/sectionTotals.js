// backend/utils/sectionTotals.js
//
// Two places where a number the model asserted is replaced by one that is
// known: what a written section is worth in earned marks, and what the whole
// paper is out of.
//
// Both were measured against a class of twenty marked by hand. The objective
// sections are settled against the answer key by string comparison and are
// now exact; everything still wrong sat in the two numbers below.
//
// In its own module, and imported, because the last two faults in this area
// were the same logic living in two files and drifting apart — a guard
// written into the backend copy and not the frontend one that runs. A test
// that imports this is testing what ships.

/**
 * Pull the mark totals an extracted answer key declares.
 *
 * /grading/extract-answer-key writes one "Total: /50" line per version of the
 * paper. A multi-version key therefore declares several.
 */
export function declaredTotals(keyText) {
  return [...new Set(
    [...String(keyText || "").matchAll(/^[ \t]*Total:[ \t]*\/[ \t]*([\d.]+)[ \t]*$/gim)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0)
  )];
}

/**
 * What the paper is out of, when the teacher has not said and nothing was
 * counted off the pages.
 *
 * Left alone when the model's own denominator matches a declared total: a
 * multi-version key carries one per paper, and an accommodated /40 paper
 * marked out of 40 is already right. Where none matches, the nearest is
 * taken — one paper in that class of twenty came back 84/100 on a test the
 * key heads "Total: /50", and with no teacher total nothing challenged it.
 *
 * @returns the total to use, or null to leave the marking as it stands.
 */
export function totalFromKey(keyText, modelOutOf) {
  const totals = declaredTotals(keyText);
  const out = Number(modelOutOf);
  if (!totals.length || !Number.isFinite(out) || out <= 0) return null;
  if (totals.some((t) => Math.abs(t - out) <= 0.01)) return null;
  return totals.reduce((best, t) => (Math.abs(t - out) < Math.abs(best - out) ? t : best));
}

/**
 * The mark scheme for each section, as the key states it.
 *
 * The extractor writes the marks on every line — "D1: 36 16 12 14 (/4)" —
 * and for this paper D's six entries allocate exactly its 20. Left to
 * itself the model does not use that: one run itemised D as seventeen
 * invented sub-parts allocating 27, the next as six allocating 13, and the
 * section score moved several marks between runs on the same paper for no
 * reason but the shape it happened to choose.
 *
 * So the allocation is taken from here and only the earning is asked of the
 * model. First paper only, for the same reason parseKeyAnswers stops there:
 * a key covering an accommodated version restarts its numbering.
 *
 * @returns Map "D" -> [{ n: "1", outOf: 4 }, ...]
 */
export function markSchemeFromKey(keyText) {
  const byLetter = new Map();
  let started = false;
  for (const raw of String(keyText || "").split("\n")) {
    const line = raw.trim();
    if (/^=+\s*ANSWER KEY/i.test(line)) {
      if (started) break;
      started = true;
      continue;
    }
    // No [CHECK] guard here on purpose: that marks an answer the two
    // readings of the key disagreed about, and this reads only the marks
    // available — "(/4)" — which is a different thing and reliably read.
    // Greedy up to the LAST bracket, since an answer may carry its own.
    const m = line.match(/^([A-Z])\s*(\d{1,2}[a-z]?)\s*[:.]\s*.*\(\/\s*([\d.]+)[^)]*\)\s*(?:\[[A-Z]+\]\s*)?$/);
    if (!m) continue;
    const [, letter, n, marks] = m;
    const outOf = Number(marks);
    if (!Number.isFinite(outOf) || outOf <= 0) continue;
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    const list = byLetter.get(letter);
    if (!list.some((x) => x.n === n)) list.push({ n, outOf });
  }
  return byLetter;
}

/**
 * The scheme written out for the prompt, so the model marks against the
 * allocation rather than inventing one.
 */
export function markSchemeBrief(keyText) {
  const scheme = markSchemeFromKey(keyText);
  const lines = [];
  for (const [letter, items] of scheme) {
    const total = items.reduce((t, i) => t + i.outOf, 0);
    // One mark an item is an objective section; it is settled against the
    // key and needs no per-part marking.
    if (items.length > 1 && items.every((i) => i.outOf <= 1)) continue;
    lines.push(`  ${letter}: ${items.map((i) => `${letter}${i.n} (/${i.outOf})`).join(", ")} — ${total} in all`);
  }
  return lines.join("\n");
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const leadNum = (n) => (String(n ?? "").match(/^\s*(\d{1,2})/) || [])[1] || null;

/**
 * A written section's score is the sum of its parts, not an impression.
 *
 * Asked for a section total outright the model gives a judgement about how
 * the paper felt as a whole, and that judgement regresses to the mean: the
 * written sections came back inside a band of 12 to 27 out of 30 where the
 * truth ran the full 12 to 30 — the best papers short by four or five, the
 * weakest over by eight or ten, while the class mean was right to half a
 * mark. Marking each part against its own allocation is a local judgement,
 * which is the kind it makes well, and the section total is then arithmetic.
 *
 * Only where the itemisation is complete and the parts allocate exactly the
 * section's own denominator. A partial itemisation says nothing about the
 * rest of the section, and a sum over half the items would be worse than the
 * total it replaced.
 *
 * Mutates and returns the grade, matching the other reconcilers around it.
 */
export function reconcileSectionsFromGuide(grade, log = () => {}, keyText = "") {
  if (!grade || !Array.isArray(grade.sections)) return grade;
  const guideSections = grade.marking_guide?.sections;
  if (!Array.isArray(guideSections)) return grade;

  const scheme = markSchemeFromKey(keyText);

  const byName = new Map();
  for (const gs of guideSections) {
    if (gs?.name) byName.set(norm(gs.name), gs);
  }
  // A guide mirroring the scoring sections one for one can also be paired by
  // position, for where one says "D. Show your work" and the other "Show
  // your work".
  const sameShape = guideSections.length === grade.sections.length;

  grade.sections.forEach((sec, i) => {
    const outOf = Number(sec?.out_of);
    if (!Number.isFinite(outOf) || outOf <= 0) return;

    const want = norm(sec?.name);
    let gs = byName.get(want);
    if (!gs && want) {
      gs = guideSections.find((x) => {
        const n = norm(x?.name);
        return n && (n.endsWith(want) || want.endsWith(n));
      });
    }
    if (!gs && sameShape) gs = guideSections[i];
    if (!gs || !Array.isArray(gs.items) || gs.items.length < 2) return;

    // The key's own allocation for this section, where it has one.
    //
    // Preferred over the model's, because the model's moves between runs on
    // the same paper. Its parts are grouped onto the scheme's — sub-parts
    // 1a, 1b, 1c count towards item 1 by the share of their own marks they
    // earned — so whichever shape came back, the section is marked out of
    // what the key says it is worth.
    const letter = String(sec?.name || "").trim().match(/^([A-Z])[.)\s]/)?.[1]
      || String(gs?.name || "").trim().match(/^([A-Z])[.)\s]/)?.[1]
      || null;
    let schemeItems = letter ? scheme.get(letter) : null;
    // An objective section — every item worth one mark — is settled against
    // the key by string comparison and is not marked part by part here.
    if (schemeItems && schemeItems.length > 1 && schemeItems.every((i) => i.outOf <= 1)) {
      schemeItems = null;
    }
    const schemeSum = schemeItems ? schemeItems.reduce((t, i) => t + i.outOf, 0) : 0;

    // Only when the scheme is for this paper: a multi-version key states the
    // first paper's marks, and an accommodated section is worth less.
    if (schemeItems && Math.abs(schemeSum - outOf) <= 0.01) {
      let earned = 0;
      let covered = 0;
      for (const si of schemeItems) {
        let group = gs.items.filter((it) => leadNum(it?.n) === si.n);
        // A single-item section the model labelled its own way — "Option 2"
        // against the key's "E1" — still pairs when there is only one of each.
        if (!group.length && schemeItems.length === 1 && gs.items.length === 1) group = gs.items;
        const usable = group.filter(
          (it) => Number.isFinite(Number(it.marks)) && Number(it.marks_out_of) > 0
        );
        if (!usable.length) continue;
        const got = usable.reduce((t, it) => t + Number(it.marks), 0);
        const avail = usable.reduce((t, it) => t + Number(it.marks_out_of), 0);
        earned += Math.max(0, Math.min(1, got / avail)) * si.outOf;
        covered += si.outOf;
      }
      if (covered >= schemeSum - 0.01) {
        const marked = Math.round(earned * 100) / 100;
        if (Math.abs(marked - Number(sec.score)) > 0.01) {
          log(`[grading] "${sec.name}": ${sec.score} asserted, ${marked} against the key's own scheme — using the scheme`);
          sec.score = marked;
        }
        if (Math.abs(marked - Number(gs.score)) > 0.01) gs.score = marked;
        return;
      }
      log(`[grading] "${sec.name}": the key allocates ${schemeSum} but only ${covered} of it was marked — falling back`);
    }

    const complete = gs.items.every(
      (it) => Number.isFinite(Number(it?.marks)) && Number.isFinite(Number(it?.marks_out_of))
    );
    if (!complete) return;

    const allocated = gs.items.reduce((t, it) => t + Number(it.marks_out_of), 0);
    if (allocated <= 0) return;

    // An itemisation that allocates a different total is scaled, not thrown
    // away. Asked to mark "Show your work /20" part by part it came back with
    // four parts of 4 and eight of 1 — 32 marks of allocation on a section
    // worth 20 — while judging every part correctly. Discarding that put the
    // section back on the holistic number the itemisation exists to replace.
    // The proportion is the judgement; the denominator is bookkeeping.
    //
    // Within reason: an allocation less than half or more than three times
    // the section is not a scale error but a misread of what the section is,
    // and scaling it would turn nonsense into a plausible-looking mark.
    const ratio = allocated / outOf;
    if (ratio < 0.5 || ratio > 3) {
      log(`[grading] "${sec.name}": parts allocate ${allocated} against a section of ${outOf} — too far out to scale, left as marked`);
      return;
    }
    if (Math.abs(allocated - outOf) > 0.01) {
      log(`[grading] "${sec.name}": parts allocate ${allocated}, section is out of ${outOf} — scaling`);
    }

    const rawEarned = gs.items.reduce((t, it) => t + Number(it.marks), 0);
    const earned = Math.round((rawEarned / allocated) * outOf * 100) / 100;
    const clamped = Math.max(0, Math.min(outOf, earned));
    if (Math.abs(clamped - Number(sec.score)) > 0.01) {
      log(`[grading] "${sec.name}": ${sec.score} asserted, ${clamped} from the parts — using the parts`);
      sec.score = clamped;
    }
    if (Math.abs(clamped - Number(gs.score)) > 0.01) gs.score = clamped;
  });

  return grade;
}
