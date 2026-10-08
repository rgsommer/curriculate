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

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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
export function reconcileSectionsFromGuide(grade, log = () => {}) {
  if (!grade || !Array.isArray(grade.sections)) return grade;
  const guideSections = grade.marking_guide?.sections;
  if (!Array.isArray(guideSections)) return grade;

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

    const complete = gs.items.every(
      (it) => Number.isFinite(Number(it?.marks)) && Number.isFinite(Number(it?.marks_out_of))
    );
    if (!complete) return;

    const allocated = gs.items.reduce((t, it) => t + Number(it.marks_out_of), 0);
    if (Math.abs(allocated - outOf) > 0.01) {
      log(`[grading] "${sec.name}": parts allocate ${allocated} but the section is out of ${outOf} — left as marked`);
      return;
    }

    const earned = Math.round(gs.items.reduce((t, it) => t + Number(it.marks), 0) * 100) / 100;
    const clamped = Math.max(0, Math.min(outOf, earned));
    if (Math.abs(clamped - Number(sec.score)) > 0.01) {
      log(`[grading] "${sec.name}": ${sec.score} asserted, ${clamped} from the parts — using the parts`);
      sec.score = clamped;
    }
    if (Math.abs(clamped - Number(gs.score)) > 0.01) gs.score = clamped;
  });

  return grade;
}
