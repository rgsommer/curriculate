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
// Two answers that mean the same thing.
//
// A key prints "\u00d7" and a student writes "x"; a key prints "\u00f7" and a
// student writes "/". Marking those wrong over a glyph is pedantry no
// teacher would apply. Handled here rather than in normaliseAnswer because
// "x" is also a perfectly good option letter in a matching column, and
// flattening it there would damage the commoner case.
const SAME_THING = [
  new Set(["X", "\u00d7", "*"]),
  new Set(["\u00f7", "/"]),
  new Set(["-", "\u2212"]),
];
export function answersMatch(a, b) {
  if (a === b) return true;
  return SAME_THING.some((group) => group.has(a) && group.has(b));
}

export function verdictAgainstKey(studentAnswer, keyItem) {
  const undecided = ["low", "not-votable", "disputed"];
  if (!keyItem || !keyItem.answer || undecided.includes(keyItem.confidence)) {
    return "unclear";
  }
  const a = normaliseAnswer(studentAnswer);
  if (!a) return "blank";
  return answersMatch(a, keyItem.answer) ? "correct" : "incorrect";
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

/* ------------------------------------------------------------------
 *  The teacher's own key, applied the same deterministic way.
 *
 *  The model reads a key accurately and then fails to USE it: holding a
 *  key that says 4 is A it accepted G, and rejected A on question 6
 *  while naming question 1's answer. Matching a letter to a row is a
 *  lookup, and a lookup is not a thing to ask a language model for when
 *  the table is already in hand.
 *
 *  /grading/extract-answer-key transcribes the key reliably — that part
 *  it does well. So parse that text and mark the objective items here,
 *  by string comparison, exactly as the class-derived key is applied.
 * ------------------------------------------------------------------ */

/**
 * Parse the extracted key into sections of numbered answers.
 *
 * The extractor emits one line per question, labelled by the section
 * letter and number as the paper prints them:
 *     A1: F (/1)        B3: FALSE (/1)       C2: 6 (/1)
 * Lines it cannot label that way (the working-out sections, the headers,
 * the grading notes) are skipped — those are not lookups anyway.
 */
export function parseExtractedKey(text) {
  const bySection = new Map();
  const seen = new Set();
  let started = false;

  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();

    // STOP at a second paper's key. This comment was here with no code under
    // it, and the cost was severe: a key covering the Unit Test and an
    // Accommodated paper restarts its numbering, so the second A1 overwrote
    // the first and every paper was marked against the wrong answers. The
    // best paper in a class of twenty came back 19 out of 50.
    if (/^=+\s*ANSWER KEY/i.test(line)) {
      if (started) break;
      started = true;
      continue;
    }

    // An item the two readings of the key disagreed about — never used to
    // mark. See parseKeyAnswers in backend/utils/objectiveMarking.js.
    if (line.includes("[CHECK]")) continue;
    const m = line.match(/^([A-Z])\s*(\d{1,2}[a-z]?)\s*[:.]\s*(.+?)\s*(?:\(\/\s*[\d.]+[^)]*\))?\s*$/);
    if (!m) continue;
    const [, letter, n, answer] = m;
    const clean = answer.trim();
    // "See Option 1 and 2 solutions provided" and similar are not answers
    // to compare against.
    if (!clean || clean.length > 40 || /^see\b/i.test(clean)) continue;
    // First answer for an item wins, so a stray repeat cannot replace it.
    const k = `${letter}\u0000${n}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!bySection.has(letter)) bySection.set(letter, []);
    bySection.get(letter).push({ n, answer: normaliseAnswer(clean) });
  }
  return [...bySection.entries()].map(([letter, items]) => ({ letter, items }));
}

/**
 * Line the key's lettered sections up with the guide's named ones.
 *
 * The key says "A1"; the guide says "Key terms — matching". Where the
 * guide's own name starts with that letter ("A. Key terms") they are
 * matched on it; otherwise they are matched in order, which is the order
 * both read the paper in. A section whose item numbers do not line up is
 * left alone rather than forced.
 */
export function keyIndexFromExtracted(text, guideSections) {
  const parsed = parseExtractedKey(text);
  const index = new Map();
  if (!parsed.length || !Array.isArray(guideSections) || !guideSections.length) return index;

  const used = new Set();
  const pairs = [];
  for (const sec of guideSections) {
    const lead = String(sec.name || "").trim().match(/^([A-Z])[.)\s]/);
    const hit = lead && parsed.find((p) => p.letter === lead[1] && !used.has(p.letter));
    if (hit) { used.add(hit.letter); pairs.push([sec, hit]); }
  }
  // Anything unmatched falls back to order, skipping what is already paired.
  const leftoverGuide = guideSections.filter((sec) => !pairs.some(([g]) => g === sec));
  const leftoverKey = parsed.filter((p) => !used.has(p.letter));
  leftoverGuide.forEach((sec, i) => { if (leftoverKey[i]) pairs.push([sec, leftoverKey[i]]); });

  for (const [sec, keySec] of pairs) {
    // Only sections a key can actually settle.
    //
    // A key's entry for "Show your work" is a method — "x = 5 y = 8 z = 6
    // m = 63", "add 5 -> 21, 26 multiply by 2 -> 40, 80" — not an answer to
    // compare a string against. Applied as a lookup it marked correct
    // working wrong whenever the student wrote it differently, and because
    // that section is twenty marks over six items each miss cost 3.33. That
    // is where the fractional totals and the five-to-eight mark losses on
    // the strongest papers came from.
    //
    // A section qualifies when its answers are short: a letter, a truth
    // value, a word, a term. Anything wordier is left to the model.
    const answers = keySec.items.map((it) => it.answer).filter(Boolean);
    const short = answers.filter((a) => a.length <= 20).length;
    if (answers.length < 2 || short / answers.length < 0.8) continue;

    const byN = new Map(keySec.items.map((it) => [String(it.n), it.answer]));
    const names = (sec.items || []).map((it) => String(it.n));
    // Only apply where the numbering actually corresponds. A section of
    // eight items against a key of six is a different section.
    const overlap = names.filter((n) => byN.has(n)).length;
    if (!overlap || overlap < Math.min(names.length, keySec.items.length) * 0.6) continue;
    for (const n of names) {
      const answer = byN.get(n);
      if (!answer) continue;
      index.set(`${sec.name}\u0000${n}`, { answer, agreement: 1, confidence: "high", fromTeacherKey: true });
    }
  }
  return index;
}

/* ------------------------------------------------------------------
 *  The blind reading, put back into the grade.
 *
 *  A grader holding the answer key reports the student's answers AS the
 *  key's answers. Against a hand-marked class of twenty the matching
 *  section came back 22 marks over the teacher's own — "8 out of 8" on ten
 *  papers where four earned it. On one of them the key read F C H A G D B E
 *  and the student had written F C A G H D B E, three of them rotated; the
 *  grader called it full marks, and the same model reading the same pages
 *  with no key in front of it read all three correctly.
 *
 *  So /grading/transcribe reads the paper blind and marks it in code, and
 *  what it returns replaces the grader's verdict on those sections. The
 *  grader keeps the written sections and the feedback.
 * ------------------------------------------------------------------ */

const letterOf = (name) =>
  (String(name || "").trim().match(/^([A-Z])[.)\s]/) || [])[1] || "";

/**
 * @param grade          the /grading response, mutated in place
 * @param blindSections  marking.sections from /grading/transcribe
 * @returns short descriptions of what moved, for the activity line
 */
export function applyBlindMarking(grade, blindSections) {
  if (!grade || !Array.isArray(grade.sections) || !Array.isArray(blindSections)) return [];

  const byLetter = new Map();
  for (const b of blindSections) {
    // Closed sets only: a letter from a matching column, a true or a false.
    // Those a string comparison settles exactly, and taking the blind
    // reading for them cut this class's matching error from 28 marks to 10.
    // A fill-in-the-blank is not one — the key says one word and a student
    // writes another that means the same — and taking it there put every
    // paper in the class BELOW its real mark, 16 marks of error becoming 36.
    // The grader keeps those, and keeps the written sections.
    if (!b?.objective || !b?.closedSet) continue;
    const l = String(b.letter || "").toUpperCase().slice(0, 1) || letterOf(b.name);
    if (l && !byLetter.has(l)) byLetter.set(l, b);
  }
  if (!byLetter.size) return [];

  const moved = [];
  for (const sec of grade.sections) {
    const l = letterOf(sec?.name);
    const b = l ? byLetter.get(l) : null;
    if (!b || !(Number(b.out_of) > 0) || !(Number(sec.out_of) > 0)) continue;

    // The blind pass counts the items it could mark; the paper's section may
    // be worth more or less than that. The proportion is what it knows.
    const next = Math.round((Number(b.score) / Number(b.out_of)) * Number(sec.out_of) * 100) / 100;
    const was = Number(sec.score);
    if (!Number.isFinite(next)) continue;
    if (Math.abs(next - was) > 0.01) moved.push(`${l} ${was}→${next}`);
    sec.score = next;

    // Keep the marking guide in step, or the teacher's guide would tick
    // items the score says were wrong.
    const gs = (grade.marking_guide?.sections || []).find((g) => letterOf(g?.name) === l);
    if (gs) {
      gs.score = next;
      const byN = new Map((b.items || []).map((it) => [String(it.n), it]));
      for (const it of gs.items || []) {
        const bi = byN.get(String(it.n));
        if (!bi || bi.verdict === "unmarked") continue;
        it.verdict = bi.verdict === "blank" ? "blank" : bi.verdict;
        it.student_answer = bi.written ?? it.student_answer;
        it.correct_answer = bi.verdict === "correct" ? "" : (bi.answer || it.correct_answer || "");
        it.readBlind = true;
      }
    }
  }

  if (moved.length) {
    const sum = grade.sections.reduce((t, s) => t + (Number(s.score) || 0), 0);
    const outOf = Number(grade.overall_out_of);
    grade.overall_score = Number.isFinite(outOf) && outOf > 0
      ? Math.max(0, Math.min(outOf, Math.round(sum * 100) / 100))
      : Math.round(sum * 100) / 100;
  }
  return moved;
}

/* ------------------------------------------------------------------
 *  The key, laid out so a teacher can check it in fifteen seconds.
 *
 *  An error in the key is not worth one mark, it is worth the class: it
 *  crosses every student who answered that question correctly. On a real
 *  Math 7 key the extractor shifted a whole section — C3 "×" came back as
 *  "5", C4 "3" as "12x", C5 "12x" as "15 + 6n" — so three of the six blanks
 *  were marked against the answer to the NEXT question. Reading the key
 *  twice did not catch it, because both readings shifted the same way.
 *
 *  Verification cannot fix a systematic misread. The teacher can, and they
 *  only have to do it once per test.
 * ------------------------------------------------------------------ */

/** The short, checkable answers of a key, in the order they appear. */
export function keyRowsForReview(text) {
  const rows = [];
  let paper = "";
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    const banner = line.match(/^=+\s*ANSWER KEY:\s*(.+?)\s*\(Total/i);
    if (banner) { paper = banner[1]; continue; }
    const m = line.match(/^([A-Z])\s*(\d{1,2}[a-z]?)\s*[:.]\s*(.+?)\s*(?:\(\/\s*([\d.]+)[^)]*\))?\s*(\[CHECK\])?\s*$/);
    if (!m) continue;
    const [, letter, n, answer, marks, flagged] = m;
    const clean = String(answer || "").trim();
    // Only the ones a teacher can eyeball. A worked solution for an extended
    // problem is not a row in a table, and marking it is a judgement anyway.
    if (!clean || clean.length > 24) continue;
    rows.push({ id: `${letter}${n}`, letter, n, answer: clean, marks: Number(marks) || 1, flagged: !!flagged, paper });
  }
  return rows;
}

/**
 * Put a corrected answer back into the key text, on its own line only.
 * The [CHECK] marker comes off: the teacher has just settled it.
 */
export function withCorrectedAnswer(text, id, answer) {
  const want = String(id || "").match(/^([A-Z])(\d{1,2}[a-z]?)$/);
  if (!want) return text;
  let done = false;
  return String(text || "").split("\n").map((raw) => {
    if (done) return raw;
    const m = raw.match(/^(\s*)([A-Z])\s*(\d{1,2}[a-z]?)\s*[:.]\s*(.+?)\s*(\(\/\s*[\d.]+[^)]*\))?\s*(\[CHECK\])?\s*$/);
    if (!m || m[2] !== want[1] || m[3] !== want[2]) return raw;
    done = true;
    return `${m[1]}${m[2]}${m[3]}: ${String(answer).trim()}${m[5] ? ` ${m[5]}` : ""}`;
  }).join("\n");
}
