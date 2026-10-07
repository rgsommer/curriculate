/**
 * consensusKey.js — derive an answer key from the class, when the teacher
 * has not supplied one.
 *
 * Without a key, a grader asked to mark a matching column has nothing to go
 * on and invents plausible letters, which marks correct work wrong. A class
 * of twenty papers is better evidence than that: for objective items most
 * students are right most of the time, so the answers themselves carry the
 * key.
 *
 * A flat majority is not good enough, though. Every teacher knows which
 * students' papers could be used as the key, and a vote that counts the
 * weakest paper equally throws that away. So reliability is estimated from
 * the papers themselves and the vote is weighted by it: a student who agrees
 * with the class on the items nobody gets wrong is trusted more on the items
 * that are contested. Nobody has to be named, and it needs no history.
 *
 * This is the classic treatment of disagreeing annotators (Dawid–Skene),
 * cut down to a few rounds: vote, score each paper against the vote, vote
 * again with those weights.
 *
 * What it must never do is state an answer it is not sure of. Consensus can
 * be confidently wrong — a whole class can misunderstand one question, and
 * that is exactly the question a teacher most wants to see. So every item
 * carries its agreement, weak items are returned as "unclear" rather than
 * marked, and the whole key is the teacher's to correct before it is used.
 */

// A class smaller than this is not a vote, it is an opinion.
export const MIN_VOTERS = 5;
// Below this weighted agreement an item is not called.
export const STRONG_AGREEMENT = 0.7;
// And this much is needed before an item is marked without the teacher
// looking at it.
export const AUTO_APPLY_AGREEMENT = 0.8;

/** Normalise an answer for comparison without destroying what it says. */
export function normaliseAnswer(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");
  // True/False in all the ways a student writes it.
  const tf = s.toUpperCase().replace(/[^A-Z]/g, "");
  if (tf === "T" || tf === "TRUE") return "T";
  if (tf === "F" || tf === "FALSE") return "F";
  // A bare option letter: "(c)", "C.", "c" are one answer.
  const letter = s.toUpperCase().match(/^\(?([A-Z])\)?[.)]?$/);
  if (letter) return letter[1];
  // Otherwise compare case-insensitively without trailing punctuation.
  return s.toLowerCase().replace(/[.,;:!?]+$/, "");
}

/**
 * Is this item the kind a class can vote on?
 *
 * Matching, True/False, multiple choice and a one-word blank: the answer is
 * short and drawn from a small set, so agreement means something. An essay or
 * a worked solution is not — twenty students write twenty different things,
 * and the modal answer of that is noise.
 */
function isVotable(answers) {
  const given = answers.filter(Boolean);
  if (given.length < MIN_VOTERS) return false;
  const distinct = new Set(given).size;
  // Lots of different answers means it is not a closed question. Allowed to
  // grow a little with class size, since a longer matching column has more
  // options.
  if (distinct > Math.max(8, Math.ceil(given.length / 2))) return false;
  const lengths = given.map((a) => a.length).sort((x, y) => x - y);
  const median = lengths[Math.floor(lengths.length / 2)];
  return median <= 16;
}

/** Weighted tally of one item. Returns the winner and how strongly it won. */
function tally(answers, weights) {
  const score = new Map();
  let total = 0;
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!a) continue;
    const w = weights[i] ?? 1;
    score.set(a, (score.get(a) || 0) + w);
    total += w;
  }
  if (!total) return { answer: "", agreement: 0, support: 0, voters: 0, runnerUp: "" };
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [answer, won] = ranked[0];
  return {
    answer,
    agreement: won / total,
    // Head count, not weight — a teacher reads "14 of 21", not "11.３".
    support: answers.filter((a) => a === answer).length,
    voters: answers.filter(Boolean).length,
    runnerUp: ranked[1]?.[0] || "",
  };
}

/**
 * A matching column is a one-to-one pairing: every letter is used once. That
 * is a strong constraint and it settles items a vote leaves split — if seven
 * of eight are confidently placed, the eighth is whatever letter is left.
 *
 * Only applied where the section really looks like one: single-letter answers
 * and at least as many options as items.
 */
function enforceBijection(items) {
  const lettersOnly = items.every((it) => /^[A-Z]$/.test(it.answer || ""));
  if (!lettersOnly || items.length < 3) return items;

  // True/False is single letters too, and it reuses them on purpose — six
  // items drawing on two letters. Applying the one-to-one rule there blanked
  // four of the six and called them conflicts. A real matching column has at
  // least as many options as items, so require that.
  const distinct = new Set(items.map((it) => it.answer).filter(Boolean));
  if (distinct.size < items.length) return items;

  // Place the confident ones first; each letter can only be spent once.
  const order = items.map((it, i) => i).sort((a, b) => items[b].agreement - items[a].agreement);
  const taken = new Set();
  const out = items.map((it) => ({ ...it }));
  const contested = [];

  for (const i of order) {
    const want = out[i].answer;
    if (!taken.has(want)) {
      taken.add(want);
    } else {
      // Someone more confident already has this letter.
      contested.push(i);
      out[i].answer = "";
      out[i].agreement = 0;
      out[i].bijectionConflict = true;
    }
  }

  // One unplaced item and one unused letter means the answer is forced.
  const all = new Set(items.map((it) => it.answer).filter(Boolean));
  const spare = [...all].filter((l) => !taken.has(l));
  if (contested.length === 1 && spare.length === 1) {
    const i = contested[0];
    out[i].answer = spare[0];
    out[i].agreement = 1;
    out[i].inferred = "the only letter left";
    out[i].bijectionConflict = false;
  }
  return out;
}

/**
 * @param papers  [{ id, label, sections: [{ name, items: [{ n, answer }] }] }]
 * @param graderOpinion  optional Map "section\u0000n" -> the answer the model
 *   proposed on its own reading. Where it disagrees with the class the item
 *   is flagged disputed — not resolved, flagged. A whole class can misread
 *   one question the same way and agree 100% on the wrong answer, and no
 *   amount of agreement reveals that. A second, independent opinion is the
 *   only thing that can raise a hand, and the teacher decides.
 */
export function deriveConsensusKey(papers, { rounds = 3, graderOpinion = null } = {}) {
  // A paper the teacher starred is evidence rather than inference. Reliability
  // is otherwise guessed from agreement, which works but needs a crowd and
  // cannot help where the crowd is wrong together. One starred paper anchors
  // the vote; two or three settle it.
  //
  // Not treated as infallible: a strong paper still drops a mark, and a
  // single star against a confident class is a dispute to show the teacher,
  // not a verdict. Weight, not override.
  const valid = (papers || []).filter((p) => Array.isArray(p.sections) && p.sections.length);
  if (valid.length < MIN_VOTERS) {
    return { sections: [], reliability: [], votable: 0, skipped: 0, tooFew: valid.length };
  }

  // Index every item by section + number, so papers that disagree about how
  // many questions there were still line up on the ones they share.
  const keys = [];
  const seen = new Set();
  for (const p of valid) {
    for (const sec of p.sections) {
      for (const it of sec.items || []) {
        const k = `${sec.name}\u0000${it.n}`;
        if (!seen.has(k)) { seen.add(k); keys.push({ section: sec.name, n: it.n, k }); }
      }
    }
  }

  const answerAt = valid.map((p) => {
    const m = new Map();
    for (const sec of p.sections) {
      for (const it of sec.items || []) {
        m.set(`${sec.name}\u0000${it.n}`, normaliseAnswer(it.answer));
      }
    }
    return m;
  });

  const columns = keys.map(({ k }) => answerAt.map((m) => m.get(k) || ""));
  const votable = keys.map((_, i) => isVotable(columns[i]));

  // Round 1 is an unweighted vote — except that a starred paper starts
  // trusted — and after that each paper is weighted by how well it agreed,
  // so the strong papers carry the contested items.
  const STAR_WEIGHT = 4;
  const starred = valid.map((p) => !!p.starred);
  let weights = valid.map((_, i) => (starred[i] ? STAR_WEIGHT : 1));
  let tallies = [];
  for (let r = 0; r < rounds; r++) {
    tallies = columns.map((col, i) => (votable[i] ? tally(col, weights) : null));

    const next = valid.map((_, s) => {
      let hit = 0, seenN = 0;
      for (let i = 0; i < keys.length; i++) {
        if (!tallies[i] || !tallies[i].answer) continue;
        const a = columns[i][s];
        if (!a) continue;
        seenN++;
        if (a === tallies[i].answer) hit++;
      }
      if (seenN < 3) return starred[s] ? STAR_WEIGHT : 1;   // too little to judge them on
      const acc = hit / seenN;
      // Smoothed so nobody reaches zero (one bad paper is still evidence)
      // and nobody dominates. 0.25 at worst, ~2 at best.
      const earned = Math.max(0.25, Math.min(2, Math.pow(acc + 0.15, 3) * 2));
      // A starred paper keeps its floor even when it disagrees with the
      // class — disagreeing with a class that is wrong together is the whole
      // reason the star is worth having.
      return starred[s] ? Math.max(STAR_WEIGHT, earned) : earned;
    });
    weights = next;
  }

  // Group back into sections, and let a matching column's one-to-one shape
  // settle what the vote could not.
  const bySection = new Map();
  keys.forEach(({ section, n }, i) => {
    if (!bySection.has(section)) bySection.set(section, []);
    const t = tallies[i];
    bySection.get(section).push({
      n,
      answer: t?.answer || "",
      agreement: t?.agreement || 0,
      support: t?.support || 0,
      voters: t?.voters || 0,
      runnerUp: t?.runnerUp || "",
      votable: !!votable[i],
    });
  });

  const sections = [...bySection.entries()].map(([name, items]) => ({
    name,
    items: enforceBijection(items).map((it) => {
      const said = graderOpinion ? normaliseAnswer(graderOpinion.get(`${name}\u0000${it.n}`)) : "";
      // What the starred papers put for this item. A star disagreeing with
      // the called answer is the clearest warning available that the class
      // has gone wrong together.
      const starAnswers = valid
        .map((p, i) => (starred[i] ? answerAt[i].get(`${name}\u0000${it.n}`) : ""))
        .filter(Boolean);
      const starDisagrees = starAnswers.length > 0 && it.answer && starAnswers.every((a) => a !== it.answer);
      const disputed = !!((said && it.answer && said !== it.answer) || starDisagrees);
      return {
        ...it,
        graderSaid: said || undefined,
        starSaid: starAnswers[0] || undefined,
        starDisagrees: starDisagrees || undefined,
        disputed: disputed || undefined,
        confidence: !it.votable ? "not-votable"
          // A contested item is never auto-applied, however well the class
          // agreed: unanimity is exactly what a shared misconception looks
          // like, so it goes to the teacher instead.
          : disputed ? "disputed"
          : it.agreement >= AUTO_APPLY_AGREEMENT ? "high"
          : it.agreement >= STRONG_AGREEMENT ? "medium"
          : "low",
      };
    }),
  }));

  const reliability = valid
    .map((p, i) => ({ id: p.id, label: p.label || p.id, weight: weights[i], starred: starred[i] }))
    .sort((a, b) => b.weight - a.weight);

  return {
    sections,
    reliability,
    votable: votable.filter(Boolean).length,
    skipped: votable.filter((v) => !v).length,
    papers: valid.length,
    starredCount: starred.filter(Boolean).length,
  };
}

/**
 * Mark one answer against the derived key.
 *
 * "unclear" where the class could not settle it, which is honest and leaves
 * the item for the teacher, rather than a cross the student did not earn.
 */
export function verdictAgainstKey(studentAnswer, keyItem) {
  const undecided = ["low", "not-votable", "disputed"];
  if (!keyItem || !keyItem.answer || undecided.includes(keyItem.confidence)) {
    return "unclear";
  }
  const a = normaliseAnswer(studentAnswer);
  if (!a) return "blank";
  return a === keyItem.answer ? "correct" : "incorrect";
}

/* ------------------------------------------------------------------
 *  Applying a derived key back to the marks.
 *
 *  Objective items need no second trip to the model: once the answer is
 *  known, "did this student write it" is a string comparison. So the key is
 *  applied here, deterministically and reversibly, rather than by grading
 *  the whole stack again.
 * ------------------------------------------------------------------ */

/** The key as a lookup, for verdictAgainstKey. */
export function keyIndex(derived) {
  const m = new Map();
  for (const sec of derived?.sections || []) {
    for (const it of sec.items || []) m.set(`${sec.name}\u0000${it.n}`, it);
  }
  return m;
}

/**
 * Re-mark the objective items of one marking guide against the derived key.
 *
 * Only items the key actually settles are touched: an item left unclear
 * stays as the grader had it rather than being overwritten with a shrug.
 * Marks move by the section's own per-item value, and the overall score
 * moves by the same total, so the paper still adds up.
 */
export function applyKeyToGuide(guide, index) {
  if (!guide || !Array.isArray(guide.sections)) return { guide, delta: 0, changed: [] };

  let delta = 0;
  const changed = [];
  const sections = guide.sections.map((sec) => {
    const items = Array.isArray(sec.items) ? sec.items : [];
    if (!items.length) return sec;

    // Objective sections are one mark an item as a rule; take the section's
    // own arithmetic rather than assuming it.
    const perItem = (typeof sec.out_of === "number" && sec.out_of > 0)
      ? sec.out_of / items.length
      : 1;

    let secDelta = 0;
    const next = items.map((it) => {
      const keyItem = index.get(`${sec.name}\u0000${it.n}`);
      if (!keyItem || !keyItem.answer) return it;
      const verdict = verdictAgainstKey(it.student_answer, keyItem);
      if (verdict === "unclear") return it;
      if (verdict === it.verdict) {
        // Agreed, but the stated answer may still have been invented.
        return { ...it, correct_answer: verdict === "correct" ? "" : keyItem.answer };
      }
      const was = it.verdict === "correct" ? perItem : 0;
      const now = verdict === "correct" ? perItem : 0;
      secDelta += now - was;
      changed.push({
        section: sec.name, n: it.n, from: it.verdict, to: verdict,
        student: it.student_answer, answer: keyItem.answer,
      });
      return {
        ...it,
        verdict,
        correct_answer: verdict === "correct" ? "" : keyItem.answer,
        note: verdict === "correct" ? "" : (it.note || ""),
        fromClassKey: true,
      };
    });

    const score = typeof sec.score === "number"
      ? Math.max(0, Math.min(sec.out_of ?? Infinity, Math.round((sec.score + secDelta) * 100) / 100))
      : sec.score;
    delta += secDelta;
    return { ...sec, items: next, score };
  });

  return {
    guide: { ...guide, sections, fromClassKey: changed.length > 0 || undefined },
    delta: Math.round(delta * 100) / 100,
    changed,
  };
}
