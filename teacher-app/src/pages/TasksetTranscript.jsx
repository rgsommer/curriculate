// teacher-app/src/pages/TasksetTranscript.jsx
import React from "react";

function summarizeNarrationRatings(sub, task) {
  // Accept multiple shapes to stay backward compatible:
  // - sub.ratings (array of {score} or numbers)
  // - sub.answerPayload.ratings
  // - sub.data.ratings / sub.data.peerRatings
  const raw =
    (Array.isArray(sub?.ratings) ? sub.ratings : null) ||
    (Array.isArray(sub?.answerPayload?.ratings) ? sub.answerPayload.ratings : null) ||
    (Array.isArray(sub?.data?.ratings) ? sub.data.ratings : null) ||
    (Array.isArray(sub?.data?.peerRatings) ? sub.data.peerRatings : null) ||
    null;

  if (!raw || raw.length === 0) return null;

  const values = raw
    .map((r) => (typeof r === "number" ? r : Number(r?.score ?? r?.value ?? r?.rating)))
    .filter((n) => Number.isFinite(n));

  if (!values.length) return null;

  const scale =
    sub?.ratingScale ||
    sub?.answerPayload?.ratingScale ||
    sub?.data?.ratingScale ||
    task?.config?.ratingScale ||
    null;

  const max = Number(scale?.max) > 0 ? Number(scale.max) : 5;
  const min = Number(scale?.min) >= 0 ? Number(scale.min) : 1;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  // Per-speaker detail if present (preferred)
  const detailed =
    raw.some((r) => r && typeof r === "object" && ("playerIndex" in r || "playerName" in r))
      ? raw
          .map((r) => ({
            playerIndex: Number.isFinite(Number(r?.playerIndex)) ? Number(r.playerIndex) : null,
            playerName: r?.playerName ? String(r.playerName) : null,
            score: typeof r === "number" ? r : Number(r?.score ?? r?.value ?? r?.rating),
          }))
          .filter((r) => Number.isFinite(r.score))
      : null;

  return { avg, count: values.length, min, max, detailed };
}

function summarizeScriptPlay(sub, task) {
  // Accept multiple shapes:
  // - sub.answerPayload.expressiveRating
  // - sub.answerPayload.expressive (boolean)
  // - sub.data.expressiveRating
  const rating =
    (Number.isFinite(Number(sub?.answerPayload?.expressiveRating)) ? Number(sub.answerPayload.expressiveRating) : null) ??
    (Number.isFinite(Number(sub?.data?.expressiveRating)) ? Number(sub.data.expressiveRating) : null) ??
    null;

  const expressive =
    typeof sub?.answerPayload?.expressive === "boolean"
      ? sub.answerPayload.expressive
      : typeof sub?.data?.expressive === "boolean"
      ? sub.data.expressive
      : null;

  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const scenes = Array.isArray(cfg.scenes) ? cfg.scenes : null;
  const lines = Array.isArray(cfg.lines) ? cfg.lines : null;

  const totalTurns = scenes
    ? scenes.reduce((sum, s) => sum + (Array.isArray(s?.turns) ? s.turns.length : 0), 0)
    : lines
    ? lines.length
    : null;

  const rolesCount =
    Array.isArray(cfg.roles) ? cfg.roles.length : Number.isFinite(Number(cfg.playerCount)) ? Number(cfg.playerCount) : null;

  return { rating, expressive, totalTurns, rolesCount };
}

function summarizeRolePlayDeck(sub, task) {
  // Prefer task.config; fallback to submission payloads for backward compatibility.
  const cfg =
    (task?.config && typeof task.config === "object" ? task.config : null) ||
    (sub?.answerPayload?.config && typeof sub.answerPayload.config === "object" ? sub.answerPayload.config : null) ||
    (sub?.data?.config && typeof sub.data.config === "object" ? sub.data.config : null) ||
    null;

  if (!cfg) return null;

  const mode = cfg.mode ? String(cfg.mode) : null;
  const scenario = cfg.scenario ? String(cfg.scenario) : null;

  const roles = Array.isArray(cfg.roles) ? cfg.roles : null;
  const rolesCount =
    roles ? roles.length : Number.isFinite(Number(cfg.playerCount)) ? Number(cfg.playerCount) : null;

  const hasAny = Boolean(mode || scenario || rolesCount != null);
  if (!hasAny) return null;

  return { mode, scenario, rolesCount };
}

function summarizeFakeOut(sub, task) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};

  const rounds =
    (Array.isArray(ap.rounds) && ap.rounds.length ? ap.rounds : null) ||
    (Array.isArray(data.rounds) && data.rounds.length ? data.rounds : null) ||
    (Array.isArray(cfg.rounds) && cfg.rounds.length ? cfg.rounds : null) ||
    null;

  const round =
    (ap.round && typeof ap.round === "object" ? ap.round : null) ||
    (data.round && typeof data.round === "object" ? data.round : null) ||
    null;

  const votes =
    (Array.isArray(ap.votes) ? ap.votes : null) ||
    (Array.isArray(data.votes) ? data.votes : null) ||
    null;

  const votesByPlayer =
    (Array.isArray(ap.votesByPlayer) ? ap.votesByPlayer : null) ||
    (Array.isArray(data.votesByPlayer) ? data.votesByPlayer : null) ||
    null;

  const playerNames =
    (Array.isArray(cfg.playerNames) && cfg.playerNames.length ? cfg.playerNames : null) ||
    (Array.isArray(ap.playerNames) && ap.playerNames.length ? ap.playerNames : null) ||
    (Array.isArray(data.playerNames) && data.playerNames.length ? data.playerNames : null) ||
    null;

  const readerIndexRaw =
    (Number.isFinite(Number(ap.readerIndex)) ? Number(ap.readerIndex) : null) ??
    (Number.isFinite(Number(data.readerIndex)) ? Number(data.readerIndex) : null) ??
    (Number.isFinite(Number(ap.readerPlayerNumber)) ? Number(ap.readerPlayerNumber) - 1 : null) ??
    null;

  const toRoundSummary = (r) => {
    if (!r || typeof r !== "object") return null;
    const statement = r.statement ? String(r.statement) : "";
    const options = Array.isArray(r.options) ? r.options.map((x) => String(x)) : [];
    const correctIndex = Number.isFinite(Number(r.correctIndex)) ? Number(r.correctIndex) : null;
    if (!statement && options.length === 0 && correctIndex == null) return null;
    return { statement, options, correctIndex };
  };

  const roundSummaries = (rounds || []).map(toRoundSummary).filter(Boolean);
  const single = toRoundSummary(round);

  const useRounds = roundSummaries.length ? roundSummaries : single ? [single] : [];

  if (!useRounds.length) return null;

  let normalizedVotes = [];
  if (Array.isArray(votesByPlayer) && votesByPlayer.length) {
    normalizedVotes = votesByPlayer
      .map((v) => ({
        playerName: v?.playerName ? String(v.playerName) : null,
        optionIndex: Number.isFinite(Number(v?.optionIndex)) ? Number(v.optionIndex) : null,
      }))
      .filter((v) => v.optionIndex != null);
  } else if (Array.isArray(votes) && votes.length) {
    normalizedVotes = votes
      .map((optIdx, i) => ({
        playerName: playerNames?.[i] ? String(playerNames[i]) : `Player ${i + 1}`,
        optionIndex: Number.isFinite(Number(optIdx)) ? Number(optIdx) : null,
      }))
      .filter((v) => v.optionIndex != null);
  }

  return {
    rounds: useRounds.slice(0, 6),
    votes: normalizedVotes.slice(0, 24),
    readerIndex: readerIndexRaw,
  };
}

function summarizeFlashcardsRace(sub, task, teamsById = {}) {
  // Flashcards Race is an inter-team buzzer race.
  // Depending on deployment version, the backend may store results in one or more submissions.
  // Accept multiple shapes to stay backward compatible.
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};

  const scoresRaw =
    (ap.finalScores && typeof ap.finalScores === "object" ? ap.finalScores : null) ||
    (ap.scores && typeof ap.scores === "object" ? ap.scores : null) ||
    (data.finalScores && typeof data.finalScores === "object" ? data.finalScores : null) ||
    (data.scores && typeof data.scores === "object" ? data.scores : null) ||
    (cfg.scores && typeof cfg.scores === "object" ? cfg.scores : null) ||
    null;

  const winnerTeamId =
    (ap.winnerTeamId ? String(ap.winnerTeamId) : null) ||
    (data.winnerTeamId ? String(data.winnerTeamId) : null) ||
    (ap.winnerTeam ? String(ap.winnerTeam) : null) ||
    (data.winnerTeam ? String(data.winnerTeam) : null) ||
    null;

  const totalCards =
    (Number.isFinite(Number(ap.totalCards)) ? Number(ap.totalCards) : null) ??
    (Number.isFinite(Number(data.totalCards)) ? Number(data.totalCards) : null) ??
    (Array.isArray(ap.deck) ? ap.deck.length : null) ??
    (Array.isArray(data.deck) ? data.deck.length : null) ??
    (Array.isArray(cfg.deck) ? cfg.deck.length : null) ??
    null;

  const secondsPerCard =
    (Number.isFinite(Number(ap.secondsPerCard)) ? Number(ap.secondsPerCard) : null) ??
    (Number.isFinite(Number(data.secondsPerCard)) ? Number(data.secondsPerCard) : null) ??
    (Number.isFinite(Number(cfg.secondsPerCard)) ? Number(cfg.secondsPerCard) : null) ??
    null;

  const cardsWon =
    (Array.isArray(ap.cardsWon) ? ap.cardsWon : null) ||
    (Array.isArray(data.cardsWon) ? data.cardsWon : null) ||
    (Array.isArray(ap.rounds) ? ap.rounds : null) ||
    (Array.isArray(data.rounds) ? data.rounds : null) ||
    null;

  // Normalize scoreboard into [{ teamId, teamName, points }]
  let board = [];
  if (scoresRaw) {
    board = Object.entries(scoresRaw)
      .map(([teamId, pts]) => {
        const n = Number(pts);
        if (!Number.isFinite(n)) return null;
        const teamName = teamsById?.[String(teamId)]?.teamName || null;
        return { teamId: String(teamId), teamName, points: n };
      })
      .filter(Boolean)
      .sort((a, b) => (b.points || 0) - (a.points || 0));
  }

  const winnerLabel = winnerTeamId
    ? teamsById?.[String(winnerTeamId)]?.teamName || `Team ${String(winnerTeamId).slice(-4)}`
    : null;

  const hasAny = Boolean(board.length || winnerTeamId || totalCards != null || secondsPerCard != null || (cardsWon && cardsWon.length));
  if (!hasAny) return null;

  // Cards won summary (teamId -> count)
  const wonCounts = {};
  if (Array.isArray(cardsWon)) {
    for (const c of cardsWon) {
      const tid = c?.teamId || c?.winnerTeamId || c?.team || c?.winner;
      if (!tid) continue;
      const k = String(tid);
      wonCounts[k] = (wonCounts[k] || 0) + 1;
    }
  }

  const wonSummary = Object.entries(wonCounts)
    .map(([teamId, count]) => ({
      teamId,
      teamName: teamsById?.[teamId]?.teamName || `Team ${teamId.slice(-4)}`,
      count,
    }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  return {
    board,
    winnerTeamId,
    winnerLabel,
    totalCards,
    secondsPerCard,
    wonSummary,
  };
}




function summarizeBrainstormBattle(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const seed =
    (cfg.seedTopic ? String(cfg.seedTopic) : null) ||
    (ap.seedTopic ? String(ap.seedTopic) : null) ||
    (data.seedTopic ? String(data.seedTopic) : null) ||
    null;

  const ideas =
    (Array.isArray(ap.ideas) ? ap.ideas : null) ||
    (Array.isArray(ap.entries) ? ap.entries : null) ||
    (Array.isArray(data.ideas) ? data.ideas : null) ||
    (Array.isArray(data.entries) ? data.entries : null) ||
    null;

  const top =
    (Array.isArray(ap.topIdeas) ? ap.topIdeas : null) ||
    (Array.isArray(data.topIdeas) ? data.topIdeas : null) ||
    null;

  const count = Array.isArray(ideas) ? ideas.filter(Boolean).length : null;

  const hasAny = Boolean(seed || (count != null && count > 0) || (top && top.length));
  if (!hasAny) return null;

  const normalizeList = (arr) =>
    Array.isArray(arr)
      ? arr
          .map((x) => (typeof x === "string" ? x : x?.text || x?.idea || x?.value || ""))
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];

  return {
    seed,
    ideas: normalizeList(ideas),
    topIdeas: normalizeList(top),
    count,
  };
}


function summarizeMadDash(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const route =
    (Array.isArray(ap.route) ? ap.route : null) ||
    (Array.isArray(data.route) ? data.route : null) ||
    (Array.isArray(task?.sequence) ? task.sequence : null) ||
    (Array.isArray(cfg.sequence) ? cfg.sequence : null) ||
    null;

  const bestTimeMs =
    (Number.isFinite(Number(ap.bestTimeMs)) ? Number(ap.bestTimeMs) : null) ??
    (Number.isFinite(Number(data.bestTimeMs)) ? Number(data.bestTimeMs) : null) ??
    (Number.isFinite(Number(ap.timeMs)) ? Number(ap.timeMs) : null) ??
    (Number.isFinite(Number(data.timeMs)) ? Number(data.timeMs) : null) ??
    null;

  const bestRunner =
    (typeof ap.bestRunner === "string" ? ap.bestRunner : null) ||
    (typeof data.bestRunner === "string" ? data.bestRunner : null) ||
    null;

  const runs =
    (Array.isArray(ap.runs) ? ap.runs : null) ||
    (Array.isArray(data.runs) ? data.runs : null) ||
    null;

  const attempts = runs ? runs.length : null;
  const scans =
    (Number.isFinite(Number(ap.scans)) ? Number(ap.scans) : null) ??
    (Number.isFinite(Number(data.scans)) ? Number(data.scans) : null) ??
    (route ? route.length : null) ??
    null;

  const hasAny = Boolean(bestTimeMs != null || bestRunner || (route && route.length) || attempts != null || scans != null);
  if (!hasAny) return null;

  return { route, scans, attempts, bestTimeMs, bestRunner };
}

function fmtMsCompact(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return "";
  const s = Math.max(0, v) / 1000;
  return s.toFixed(s >= 10 ? 1 : 2) + "s";
}

function summarizeCollaboration(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const prompt =
    (typeof task?.prompt === "string" ? task.prompt : null) ||
    (typeof cfg?.prompt === "string" ? cfg.prompt : null) ||
    null;

  const initial =
    (typeof ap.initialResponse === "string" ? ap.initialResponse : null) ||
    (typeof ap.initial === "string" ? ap.initial : null) ||
    (typeof data.initialResponse === "string" ? data.initialResponse : null) ||
    (typeof data.initial === "string" ? data.initial : null) ||
    null;

  const reply =
    (typeof ap.reply === "string" ? ap.reply : null) ||
    (typeof ap.responseToOtherTeam === "string" ? ap.responseToOtherTeam : null) ||
    (typeof data.reply === "string" ? data.reply : null) ||
    (typeof data.responseToOtherTeam === "string" ? data.responseToOtherTeam : null) ||
    null;

  const partner =
    (ap.partnerTeamName ? String(ap.partnerTeamName) : null) ||
    (ap.otherTeamName ? String(ap.otherTeamName) : null) ||
    (data.partnerTeamName ? String(data.partnerTeamName) : null) ||
    (data.otherTeamName ? String(data.otherTeamName) : null) ||
    null;

  const hasAny = Boolean(initial || reply || partner);
  if (!hasAny) return null;

  const clip = (s) => {
    const x = String(s || "").trim();
    if (!x) return "";
    return x.length > 220 ? x.slice(0, 220) + "…" : x;
  };

  return {
    prompt: prompt ? clip(prompt) : null,
    partner,
    initial: initial ? clip(initial) : null,
    reply: reply ? clip(reply) : null,
  };
}

function summarizeLiveDebate(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const topic =
    (cfg.topic ? String(cfg.topic) : null) ||
    (ap.topic ? String(ap.topic) : null) ||
    (data.topic ? String(data.topic) : null) ||
    null;

  // Common shapes: speakers array, turns array, or single transcript text.
  const speakers =
    (Array.isArray(ap.speakers) ? ap.speakers : null) ||
    (Array.isArray(data.speakers) ? data.speakers : null) ||
    null;

  const transcript =
    (typeof ap.transcript === "string" ? ap.transcript : null) ||
    (typeof data.transcript === "string" ? data.transcript : null) ||
    (typeof ap.text === "string" ? ap.text : null) ||
    (typeof data.text === "string" ? data.text : null) ||
    null;

  const clip = (s) => {
    const x = String(s || "").trim();
    if (!x) return "";
    return x.length > 240 ? x.slice(0, 240) + "…" : x;
  };

  const lines =
    Array.isArray(speakers) && speakers.length
      ? speakers
          .map((sp, i) => {
            if (!sp || typeof sp !== "object") return null;
            const name = sp.playerName || sp.name || (Number.isFinite(Number(sp.playerIndex)) ? `Player ${Number(sp.playerIndex) + 1}` : `Player ${i + 1}`);
            const score = Number.isFinite(Number(sp.score)) ? Number(sp.score) : null;
            const summary = sp.summary || sp.comment || sp.notes || null;
            const bits = [];
            if (score != null) bits.push(`${score} pts`);
            if (summary) bits.push(clip(summary));
            return `${name}${bits.length ? ` — ${bits.join(" • ")}` : ""}`;
          })
          .filter(Boolean)
          .slice(0, 6)
      : [];

  const hasAny = Boolean(topic || lines.length || transcript);
  if (!hasAny) return null;

  return {
    topic,
    speakers: lines,
    transcript: transcript ? clip(transcript) : null,
  };
}

function summarizePetFeeding(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const pet =
    (cfg.petName ? String(cfg.petName) : null) ||
    (ap.petName ? String(ap.petName) : null) ||
    (data.petName ? String(data.petName) : null) ||
    null;

  const food =
    (ap.food ? String(ap.food) : null) ||
    (ap.treat ? String(ap.treat) : null) ||
    (data.food ? String(data.food) : null) ||
    (data.treat ? String(data.treat) : null) ||
    null;

  const pack =
    (cfg.pack ? String(cfg.pack) : null) ||
    (ap.pack ? String(ap.pack) : null) ||
    (data.pack ? String(data.pack) : null) ||
    null;

  const points =
    (Number.isFinite(Number(ap.pointsAwarded)) ? Number(ap.pointsAwarded) : null) ??
    (Number.isFinite(Number(data.pointsAwarded)) ? Number(data.pointsAwarded) : null) ??
    (Number.isFinite(Number(cfg.pointsAwarded)) ? Number(cfg.pointsAwarded) : null) ??
    null;

  const hasAny = Boolean(pet || food || pack || points != null);
  if (!hasAny) return null;

  return { pet, food, pack, points };
}

function summarizeWordWeaver(sub, task) {
  // Word Weaver Duel can appear in two modes:
  // 1) Scrabble/grid placement: answerPayload has placements / placedWords / scores.
  // 2) Phrase rebuild: answerPayload has phraseAttempt / filled / selectedWords etc.
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};

  const mode =
    (ap.mode ? String(ap.mode) : null) ||
    (data.mode ? String(data.mode) : null) ||
    (task?.mode ? String(task.mode) : null) ||
    (cfg.mode ? String(cfg.mode) : null) ||
    null;

  const placements =
    (Array.isArray(ap.placements) ? ap.placements : null) ||
    (Array.isArray(ap.boardPlacements) ? ap.boardPlacements : null) ||
    (Array.isArray(data.placements) ? data.placements : null) ||
    (Array.isArray(data.boardPlacements) ? data.boardPlacements : null) ||
    null;

  const placedWords =
    (Array.isArray(ap.placedWords) ? ap.placedWords : null) ||
    (Array.isArray(ap.wordsPlaced) ? ap.wordsPlaced : null) ||
    (Array.isArray(data.placedWords) ? data.placedWords : null) ||
    (Array.isArray(data.wordsPlaced) ? data.wordsPlaced : null) ||
    null;

  const scores =
    (ap.scores && typeof ap.scores === "object" ? ap.scores : null) ||
    (data.scores && typeof data.scores === "object" ? data.scores : null) ||
    null;

  const totalPoints =
    (Number.isFinite(Number(scores?.totalPoints)) ? Number(scores.totalPoints) : null) ??
    (Number.isFinite(Number(scores?.points)) ? Number(scores.points) : null) ??
    (Number.isFinite(Number(ap.totalPoints)) ? Number(ap.totalPoints) : null) ??
    (Number.isFinite(Number(data.totalPoints)) ? Number(data.totalPoints) : null) ??
    null;

  // Phrase mode attempt (legacy)
  const targetPhrase = task?.targetPhrase || task?.phrase || cfg?.phrase || "";
  const attempt =
    (typeof ap.phraseAttempt === "string" ? ap.phraseAttempt : null) ||
    (typeof ap.attempt === "string" ? ap.attempt : null) ||
    (typeof data.phraseAttempt === "string" ? data.phraseAttempt : null) ||
    (typeof data.attempt === "string" ? data.attempt : null) ||
    null;

  const filled =
    (Array.isArray(ap.filled) ? ap.filled : null) ||
    (Array.isArray(data.filled) ? data.filled : null) ||
    null;

  const phraseAttempt =
    attempt ||
    (filled && filled.length ? filled.filter(Boolean).join(" ").trim() : "") ||
    "";

  const looksLikeScrabble = Boolean((placements && placements.length) || (placedWords && placedWords.length));
  const looksLikePhrase = Boolean(phraseAttempt || targetPhrase);

  if (!looksLikeScrabble && !looksLikePhrase) return null;

  return {
    mode: mode || (looksLikeScrabble ? "scrabble" : "phrase"),
    placementsCount: placements ? placements.length : 0,
    placedWords: (placedWords || []).map((w) => String(w)).filter(Boolean),
    totalPoints,
    targetPhrase: targetPhrase ? String(targetPhrase) : "",
    phraseAttempt: phraseAttempt ? String(phraseAttempt) : "",
  };
}




function summarizeDiffDetective(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const diffs =
    (Array.isArray(ap.differences) ? ap.differences : null) ||
    (Array.isArray(ap.diffs) ? ap.diffs : null) ||
    (Array.isArray(ap.items) ? ap.items : null) ||
    (Array.isArray(data.differences) ? data.differences : null) ||
    (Array.isArray(data.diffs) ? data.diffs : null) ||
    (Array.isArray(data.items) ? data.items : null) ||
    null;

  const mode =
    (cfg.mode ? String(cfg.mode) : null) ||
    (ap.mode ? String(ap.mode) : null) ||
    (data.mode ? String(data.mode) : null) ||
    null;

  const count =
    (Number.isFinite(Number(ap.countFound)) ? Number(ap.countFound) : null) ??
    (Number.isFinite(Number(data.countFound)) ? Number(data.countFound) : null) ??
    (Array.isArray(diffs) ? diffs.length : null) ??
    null;

  const max =
    (Number.isFinite(Number(cfg.expectedCount)) ? Number(cfg.expectedCount) : null) ??
    (Number.isFinite(Number(cfg.maxDifferences)) ? Number(cfg.maxDifferences) : null) ??
    null;

  const lines = Array.isArray(diffs)
    ? diffs
        .map((d) => {
          if (typeof d === "string") return d;
          if (!d || typeof d !== "object") return null;
          return d.text || d.description || d.diff || d.change || null;
        })
        .filter(Boolean)
        .slice(0, 10)
        .map((s) => String(s))
    : [];

  const hasAny = Boolean(lines.length || count != null || max != null || mode);
  if (!hasAny) return null;

  return { mode, count, max, lines };
}

function summarizeVennSort(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  // Common shapes:
  // - placements: [{ itemId, zoneId }] or mapping { itemId: zoneId }
  // - zones: { zoneId: [itemIds...] }
  const mapping =
    (ap.mapping && typeof ap.mapping === "object" ? ap.mapping : null) ||
    (ap.placements && typeof ap.placements === "object" && !Array.isArray(ap.placements) ? ap.placements : null) ||
    (data.mapping && typeof data.mapping === "object" ? data.mapping : null) ||
    null;

  const placements =
    (Array.isArray(ap.placements) ? ap.placements : null) ||
    (Array.isArray(ap.placed) ? ap.placed : null) ||
    (Array.isArray(data.placements) ? data.placements : null) ||
    (Array.isArray(data.placed) ? data.placed : null) ||
    null;

  const zonesObj =
    (ap.zones && typeof ap.zones === "object" ? ap.zones : null) ||
    (data.zones && typeof data.zones === "object" ? data.zones : null) ||
    null;

  const zoneLabels = Array.isArray(cfg.zones)
    ? cfg.zones.map((z) => ({
        id: z?.id != null ? String(z.id) : z?.key != null ? String(z.key) : z?.label ? String(z.label) : null,
        label: z?.label ? String(z.label) : z?.name ? String(z.name) : null,
      }))
    : null;

  const labelFor = (zoneId) => {
    const zid = zoneId == null ? "" : String(zoneId);
    const found = zoneLabels?.find((z) => z?.id === zid || z?.label === zid);
    return found?.label || (zid ? zid : "Outside");
  };

  const counts = {};
  const add = (zoneId) => {
    const k = labelFor(zoneId);
    counts[k] = (counts[k] || 0) + 1;
  };

  if (zonesObj) {
    for (const [zid, items] of Object.entries(zonesObj)) {
      const n = Array.isArray(items) ? items.length : 0;
      if (!n) continue;
      const k = labelFor(zid);
      counts[k] = (counts[k] || 0) + n;
    }
  } else if (placements && placements.length) {
    for (const p of placements) {
      const zid = p?.zoneId ?? p?.zone ?? p?.bucket ?? p?.region ?? p?.targetZone ?? null;
      add(zid);
    }
  } else if (mapping) {
    for (const zid of Object.values(mapping)) add(zid);
  }

  const lines = Object.entries(counts)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, 8)
    .map(([k, n]) => `${k}: ${n}`);

  if (!lines.length) return null;

  return { lines };
}

function summarizeMysteryClues(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  // Final recall task typically has:
  // - revealedClues / correctClues (array)
  // - selected / selectedClues (array)
  const revealed =
    (Array.isArray(cfg.revealedClues) ? cfg.revealedClues : null) ||
    (Array.isArray(cfg.correctClues) ? cfg.correctClues : null) ||
    (Array.isArray(ap.revealedClues) ? ap.revealedClues : null) ||
    (Array.isArray(data.revealedClues) ? data.revealedClues : null) ||
    null;

  const selected =
    (Array.isArray(ap.selected) ? ap.selected : null) ||
    (Array.isArray(ap.selectedClues) ? ap.selectedClues : null) ||
    (Array.isArray(ap.picks) ? ap.picks : null) ||
    (Array.isArray(data.selected) ? data.selected : null) ||
    (Array.isArray(data.selectedClues) ? data.selectedClues : null) ||
    (Array.isArray(data.picks) ? data.picks : null) ||
    null;

  const allChoices =
    (Array.isArray(cfg.allChoices) ? cfg.allChoices : null) ||
    (Array.isArray(cfg.choicePool) ? cfg.choicePool : null) ||
    (Array.isArray(cfg.pool) ? cfg.pool : null) ||
    null;

  const isFinal =
    typeof task?.isFinal === "boolean"
      ? task.isFinal
      : typeof cfg?.isFinal === "boolean"
      ? cfg.isFinal
      : typeof ap?.isFinal === "boolean"
      ? ap.isFinal
      : typeof data?.isFinal === "boolean"
      ? data.isFinal
      : null;

  const hasAny = Boolean((revealed && revealed.length) || (selected && selected.length) || isFinal != null);
  if (!hasAny) return null;

  const norm = (arr) => (Array.isArray(arr) ? arr.map((x) => String(x)).filter(Boolean) : []);
  const r = norm(revealed);
  const s = norm(selected);

  // Diff sets (small and readable)
  const rSet = new Set(r);
  const sSet = new Set(s);

  const missed = r.filter((x) => !sSet.has(x)).slice(0, 10);
  const extras = s.filter((x) => !rSet.has(x)).slice(0, 10);

  return {
    isFinal,
    revealed: r.slice(0, 12),
    selected: s.slice(0, 12),
    missed,
    extras,
    poolSize: Array.isArray(allChoices) ? allChoices.length : null,
  };
}


function summarizeTreasureRunner(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : null;
  const raw = ap || sub?.answer || sub?.answerText || sub?.response || null;
  let obj = null;
  if (raw && typeof raw === "object") obj = raw;
  if (!obj && typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("{") && s.endsWith("}")) {
      try { obj = JSON.parse(s); } catch {}
    }
  }

  const points = Number.isFinite(Number(obj?.pointsEarned)) ? Number(obj.pointsEarned) : null;
  const coins = Number.isFinite(Number(obj?.coins ?? obj?.collectibles)) ? Number(obj.coins ?? obj.collectibles) : null;
  const boosts = Number.isFinite(Number(obj?.boosts)) ? Number(obj.boosts) : null;
  const hits = Number.isFinite(Number(obj?.hits)) ? Number(obj.hits) : null;
  const dur = Number.isFinite(Number(obj?.durationSeconds)) ? Number(obj.durationSeconds) : null;
  const speed = Number.isFinite(Number(obj?.finalSpeed)) ? Number(obj.finalSpeed) : null;

  const hasAny = points != null || coins != null || boosts != null || hits != null || dur != null || speed != null;
  if (!hasAny) return null;

  return { points, coins, boosts, hits, durationSeconds: dur, finalSpeed: speed, controls: obj?.controls || null };
}

function summarizeDrawMimeOrSpeedDraw(sub, task) {
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const concept =
    (cfg.concept ? String(cfg.concept) : null) ||
    (task?.concept ? String(task.concept) : null) ||
    (ap.concept ? String(ap.concept) : null) ||
    (data.concept ? String(data.concept) : null) ||
    (task?.prompt ? String(task.prompt) : null) ||
    null;

  const drawerOrActor =
    (ap.actorName ? String(ap.actorName) : null) ||
    (ap.drawerName ? String(ap.drawerName) : null) ||
    (ap.performerName ? String(ap.performerName) : null) ||
    (data.actorName ? String(data.actorName) : null) ||
    (data.drawerName ? String(data.drawerName) : null) ||
    null;

  const guessedBy =
    (ap.guessedBy ? String(ap.guessedBy) : null) ||
    (ap.winnerName ? String(ap.winnerName) : null) ||
    (data.guessedBy ? String(data.guessedBy) : null) ||
    (data.winnerName ? String(data.winnerName) : null) ||
    null;

  const correct =
    typeof ap.correct === "boolean"
      ? ap.correct
      : typeof data.correct === "boolean"
      ? data.correct
      : Number.isFinite(Number(ap.isCorrect))
      ? Boolean(Number(ap.isCorrect))
      : Number.isFinite(Number(data.isCorrect))
      ? Boolean(Number(data.isCorrect))
      : null;

  const secondsRemaining =
    (Number.isFinite(Number(ap.secondsRemaining)) ? Number(ap.secondsRemaining) : null) ??
    (Number.isFinite(Number(data.secondsRemaining)) ? Number(data.secondsRemaining) : null) ??
    (Number.isFinite(Number(ap.timeLeft)) ? Number(ap.timeLeft) : null) ??
    (Number.isFinite(Number(data.timeLeft)) ? Number(data.timeLeft) : null) ??
    null;

  const guessLog =
    (Array.isArray(ap.guessLog) ? ap.guessLog : null) ||
    (Array.isArray(ap.guesses) ? ap.guesses : null) ||
    (Array.isArray(data.guessLog) ? data.guessLog : null) ||
    (Array.isArray(data.guesses) ? data.guesses : null) ||
    null;

  const guesses = Array.isArray(guessLog)
    ? guessLog
        .map((g) => {
          if (!g) return null;
          if (typeof g === "string") return g;
          const who = g.playerName || g.who || g.player || "";
          const txt = g.guess || g.text || g.value || "";
          const ok = typeof g.correct === "boolean" ? g.correct : null;
          if (!who && !txt) return null;
          return `${who ? String(who) : "—"}: ${txt ? String(txt) : "—"}${ok === true ? " ✅" : ok === false ? "" : ""}`;
        })
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const hasAny = Boolean(concept || drawerOrActor || guessedBy || correct != null || secondsRemaining != null || guesses.length);
  if (!hasAny) return null;

  return { concept, drawerOrActor, guessedBy, correct, secondsRemaining, guesses };
}


function summarizeOrderingTask(sub, task) {
  // Handles sequence + timeline (order arrays).
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const order =
    (Array.isArray(ap.order) ? ap.order : null) ||
    (Array.isArray(ap.orderedIds) ? ap.orderedIds : null) ||
    (Array.isArray(ap.ordered) ? ap.ordered : null) ||
    (Array.isArray(data.order) ? data.order : null) ||
    (Array.isArray(data.orderedIds) ? data.orderedIds : null) ||
    (Array.isArray(data.ordered) ? data.ordered : null) ||
    null;

  const items =
    (Array.isArray(cfg.items) ? cfg.items : null) ||
    (Array.isArray(cfg.events) ? cfg.events : null) ||
    (Array.isArray(task.items) ? task.items : null) ||
    (Array.isArray(task.events) ? task.events : null) ||
    (Array.isArray(task.shuffledItems) ? task.shuffledItems : null) ||
    null;

  // Build id->label map
  const map = {};
  if (Array.isArray(items)) {
    for (const it of items) {
      if (!it) continue;
      const id = it.id ?? it._id ?? it.key ?? it.value ?? it.label ?? it.text;
      const label = it.label ?? it.text ?? it.title ?? it.value ?? "";
      if (id != null && label) map[String(id)] = String(label);
    }
  }

  const pretty =
    Array.isArray(order) && order.length
      ? order.slice(0, 10).map((x, i) => `${i + 1}. ${map[String(x)] || String(x)}`)
      : null;

  return pretty && pretty.length ? { order: pretty } : null;
}

function summarizeSortTask(sub, task) {
  // Handles sort/categorize: item->category mapping or per-category buckets.
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const mapping =
    (ap.mapping && typeof ap.mapping === "object" ? ap.mapping : null) ||
    (ap.assignments && typeof ap.assignments === "object" ? ap.assignments : null) ||
    (data.mapping && typeof data.mapping === "object" ? data.mapping : null) ||
    (data.assignments && typeof data.assignments === "object" ? data.assignments : null) ||
    null;

  const buckets =
    (ap.buckets && typeof ap.buckets === "object" ? ap.buckets : null) ||
    (ap.categories && typeof ap.categories === "object" ? ap.categories : null) ||
    (data.buckets && typeof data.buckets === "object" ? data.buckets : null) ||
    (data.categories && typeof data.categories === "object" ? data.categories : null) ||
    null;

  const categoryLabels = Array.isArray(cfg.categories) ? cfg.categories.map((c) => (typeof c === "string" ? c : c?.label || c?.name)).filter(Boolean) : null;

  // If buckets object: { "Category": [items...] }
  if (buckets && typeof buckets === "object") {
    const entries = Object.entries(buckets)
      .map(([k, v]) => {
        const count = Array.isArray(v) ? v.length : 0;
        return { category: String(k), count };
      })
      .filter((e) => e.category);
    if (entries.length) {
      const lines = entries.slice(0, 6).map((e) => `${e.category}: ${e.count}`);
      return { buckets: lines };
    }
  }

  // If mapping object: { itemId: categoryLabel }
  if (mapping && typeof mapping === "object") {
    const counts = {};
    for (const [item, cat] of Object.entries(mapping)) {
      const key = cat == null ? "—" : String(cat);
      counts[key] = (counts[key] || 0) + 1;
    }
    const lines = Object.entries(counts)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 6)
      .map(([cat, n]) => `${cat}: ${n}`);
    if (lines.length) return { buckets: lines };
  }

  // If no submission mapping, but categories exist, show placeholder
  if (categoryLabels && categoryLabels.length) {
    return { buckets: categoryLabels.slice(0, 6).map((c) => `${c}: —`) };
  }

  return null;
}

function summarizeMatchingTask(sub, task) {
  // Handles matching/connect: left->right mapping or pairs.
  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
  const data = sub?.data && typeof sub.data === "object" ? sub.data : {};
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};

  const matches =
    (ap.matches && typeof ap.matches === "object" ? ap.matches : null) ||
    (ap.correctMatches && typeof ap.correctMatches === "object" ? ap.correctMatches : null) ||
    (ap.mapping && typeof ap.mapping === "object" ? ap.mapping : null) ||
    (data.matches && typeof data.matches === "object" ? data.matches : null) ||
    (data.mapping && typeof data.mapping === "object" ? data.mapping : null) ||
    null;

  const pairs =
    (Array.isArray(ap.pairs) ? ap.pairs : null) ||
    (Array.isArray(data.pairs) ? data.pairs : null) ||
    null;

  const leftItems =
    (Array.isArray(cfg.leftItems) ? cfg.leftItems : null) ||
    (Array.isArray(task.leftItems) ? task.leftItems : null) ||
    null;
  const rightItems =
    (Array.isArray(cfg.rightItems) ? cfg.rightItems : null) ||
    (Array.isArray(task.rightItems) ? task.rightItems : null) ||
    null;

  const leftMap = {};
  const rightMap = {};
  if (Array.isArray(leftItems)) {
    for (const it of leftItems) {
      const id = it?.id ?? it?._id ?? it?.key ?? it?.value ?? it?.label ?? it?.text;
      const label = it?.label ?? it?.text ?? it?.title ?? it?.value ?? "";
      if (id != null && label) leftMap[String(id)] = String(label);
    }
  }
  if (Array.isArray(rightItems)) {
    for (const it of rightItems) {
      const id = it?.id ?? it?._id ?? it?.key ?? it?.value ?? it?.label ?? it?.text;
      const label = it?.label ?? it?.text ?? it?.title ?? it?.value ?? "";
      if (id != null && label) rightMap[String(id)] = String(label);
    }
  }

  const lines = [];

  if (pairs && pairs.length) {
    for (const p of pairs.slice(0, 8)) {
      const l = p?.left ?? p?.leftId ?? p?.a ?? p?.from;
      const r = p?.right ?? p?.rightId ?? p?.b ?? p?.to;
      if (l == null || r == null) continue;
      lines.push(`${leftMap[String(l)] || String(l)} → ${rightMap[String(r)] || String(r)}`);
    }
  } else if (matches) {
    for (const [l, r] of Object.entries(matches).slice(0, 8)) {
      if (r == null) continue;
      lines.push(`${leftMap[String(l)] || String(l)} → ${rightMap[String(r)] || String(r)}`);
    }
  }

  return lines.length ? { matches: lines } : null;
}

function extractAnswerText(sub, task) {
  // Prefer canonical flattened field if present
  if (sub?.answerText) return String(sub.answerText);

  const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : null;
  const data = sub?.data && typeof sub.data === "object" ? sub.data : null;

  // Common shapes across TaskRunner + backend normalization
  const candidates = [
    ap?.text,
    ap?.answer,
    ap?.response,
    ap?.value,
    ap?.comment,
    ap?.feedback,
    ap?.learned,
    data?.text,
    data?.answer,
    data?.response,
    data?.value,
    data?.comment,
    data?.feedback,
    data?.learned,
  ].filter((v) => v != null);

  if (candidates.length) {
    const v = candidates[0];
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }

  // Multi-pack answers (arrays)
  const multi =
    (Array.isArray(ap?.answers) ? ap.answers : null) ||
    (Array.isArray(data?.answers) ? data.answers : null) ||
    null;

  if (Array.isArray(multi) && multi.length) {
    // Show a compact “Q1: …” list (first 6)
    const lines = multi
      .slice(0, 6)
      .map((a, i) => {
        const val = a?.value ?? a?.answer ?? a;
        const id = a?.itemId || a?.id || null;
        const label = id ? String(id) : `Q${i + 1}`;
        return `${label}: ${val == null ? "—" : String(val)}`;
      });
    return lines.join(" • ");
  }

  // True/False sometimes comes through as numeric index 0/1
  const tfVal = ap?.selected ?? ap?.choice ?? data?.selected ?? data?.choice ?? null;
  if (tfVal != null) {
    const n = Number(tfVal);
    if (Number.isFinite(n)) return n === 0 ? "True" : n === 1 ? "False" : String(tfVal);
  }

  return "";
}

function isVocabParagraphTask(task) {
  const tt = String(task?.taskType || task?.type || "")
    .toLowerCase()
    .replace(/_/g, "-");
  return (
    tt === "open-text" &&
    task?.config &&
    typeof task.config === "object" &&
    String(task.config.kind || "").toLowerCase() === "vocabulary-paragraph" &&
    Array.isArray(task.config.words)
  );
}

function normalizeWordList(words) {
  return (Array.isArray(words) ? words : [])
    .map((w) => String(w || "").trim())
    .filter(Boolean)
    .slice(0, 14);
}

function tokenizeForPrefixMatch(text) {
  const s = String(text || "")
    .toLowerCase()
    // keep apostrophes inside words; strip other punctuation to spaces
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.split(" ") : [];
}

// Allows suffixes/inflections by prefix matching on token boundaries.
// For multi-word phrases, requires consecutive token-prefix matches.
function hasWordOrPhrase(tokens, required) {
  const req = String(required || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!req) return false;

  const parts = req.split(" ").filter(Boolean);
  if (parts.length === 1) {
    const p = parts[0];
    return tokens.some((t) => t.startsWith(p));
  }

  // phrase: sliding window
  for (let i = 0; i <= tokens.length - parts.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      if (!String(tokens[i + j] || "").startsWith(parts[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Simple transcript viewer.
 * Props:
 *   - transcript: {
 *       roomCode,
 *       tasksetName,
 *       tasks: [{ index, title, taskType, prompt }],
 *       teams: [{ teamId, teamName }],
 *       submissions: [...]
 *     }
 */
export default function TasksetTranscript({ transcript }) {
  if (!transcript) {
    return <div style={{ padding: 16 }}>No transcript loaded.</div>;
  }

  const { roomCode, tasksetName, tasks, teams, submissions } = transcript;

  const teamsById = Object.fromEntries((teams || []).map((t) => [t.teamId, t]));

  // Group submissions by taskIndex
  const subsByTask = {};
  (submissions || []).forEach((sub) => {
    const idx = sub.taskIndex ?? 0;
    if (!subsByTask[idx]) subsByTask[idx] = [];
    subsByTask[idx].push(sub);
  });

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header>
        <h1 style={{ marginBottom: 4 }}>Session transcript</h1>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563" }}>
          Room: <strong>{roomCode}</strong>
        </p>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563" }}>
          Task set: <strong>{tasksetName}</strong>
        </p>

        {(transcript.runByPresenterName || transcript.sharedFromTeacherName || transcript.sharedFromTeacherEmail) && (
          <p style={{ margin: 0, fontSize: "0.9rem", color: "#4b5563" }}>
            {transcript.sharedFromTeacherName || transcript.sharedFromTeacherEmail ? (
              <>
                TaskSet from: <strong>{transcript.sharedFromTeacherName || transcript.sharedFromTeacherEmail}</strong>
                {transcript.runByPresenterName ? (
                  <>
                    {" "}• Presented by: <strong>{transcript.runByPresenterName}</strong>
                  </>
                ) : null}
              </>
            ) : (
              <>
                Presented by: <strong>{transcript.runByPresenterName}</strong>
              </>
            )}
          </p>
        )}
      </header>

      {(tasks || []).map((task) => {
        const idx = task.index ?? 0;
        const taskSubs = subsByTask[idx] || [];

        return (
          <section
            key={idx}
            style={{
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              padding: 12,
              background: "#f9fafb",
            }}
          >
            <h2 style={{ margin: "0 0 4px" }}>
              Task {idx + 1}: {task.title || task.taskType}
            </h2>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: "0.9rem",
                color: "#4b5563",
              }}
            >
              {task.prompt}
            </p>

            {taskSubs.length === 0 ? (
              (() => {
                const tt = String(task.taskType || task.type || "").toLowerCase();

                const isFlashcardsRace =
                  tt === "flashcards-race" || tt === "flashcards_race" || tt === "flashcardsrace";

                const isBodyBreak =
                  tt === "bodybreak" || tt === "body-break" || tt === "body_break";

                const isMotionMission =
                  tt === "motion-mission" || tt === "motion_mission" || tt === "motionmission";

                const isMusicalChairs =
                  tt === "musical-chairs" || tt === "musical_chairs" || tt === "musicalchairs";

                // These tasks are often "live activity" and may not produce a submission record.
                if (isFlashcardsRace) {
                  return (
                    <div
                      style={{
                        marginTop: 6,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px dashed rgba(255,255,255,0.0)",
                        background: "rgba(59,130,246,0.06)",
                        color: "#374151",
                        fontSize: "0.9rem",
                      }}
                    >
                      <div style={{ fontWeight: 800, marginBottom: 2 }}>Flashcards Race (live inter-team)</div>
                      <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                        This task is typically driven by live socket events (buzz/answer/advance). If your backend is
                        configured to persist the race outcome, you’ll see a scoreboard submission here.
                      </div>
                    </div>
                  );
                }

                if (isBodyBreak || isMotionMission || isMusicalChairs) {
                  const label = isBodyBreak
                    ? "Body Break (movement reset)"
                    : isMotionMission
                    ? "Motion Mission (embodied challenge)"
                    : "Musical Chairs (movement + cue)";

                  return (
                    <div
                      style={{
                        marginTop: 6,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px dashed rgba(0,0,0,0.10)",
                        background: "rgba(16,185,129,0.06)",
                        color: "#374151",
                        fontSize: "0.9rem",
                      }}
                    >
                      <div style={{ fontWeight: 800, marginBottom: 2 }}>{label}</div>
                      <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                        This task is usually completed physically as a team and may not create a submission record.
                        Completion is typically reflected in engagement and timing metrics rather than an answer payload.
                      </div>
                    </div>
                  );
                }

                return <p style={{ color: "#9ca3af", margin: 0 }}>No submissions for this task.</p>;
              })()
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                }}
              >
                {taskSubs.map((sub) => {
                  const team = teamsById[sub.teamId];

                  const displayScore =
                    sub.teacherOverride?.isOverridden && typeof sub.teacherOverride.overrideScore === "number"
                      ? sub.teacherOverride.overrideScore
                      : sub.aiScore?.totalScore ?? null;

                  const maxPoints = sub.aiScore?.maxPoints ?? task.points ?? null;

                  return (
                    <div
                      key={`${sub.teamId}-${sub.playerId}-${sub.taskIndex}`}
                      style={{
                        borderRadius: 10,
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        padding: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: "0.8rem",
                              textTransform: "uppercase",
                              letterSpacing: 1,
                              color: "#6b7280",
                            }}
                          >
                            {team?.teamName || "Team"}
                          </div>
                          {sub.playerId && (
                            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{sub.playerId}</div>
                          )}
                        </div>

                        {displayScore != null && maxPoints != null && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Score</div>
                            <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                              {displayScore} / {maxPoints}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Answer / media */}
                      {sub.mediaUrl && (
                        <div style={{ marginTop: 4 }}>
                          {task.taskType === "record-audio" ? (
                            <audio controls src={sub.mediaUrl} style={{ width: "100%" }} />
                          ) : (
                            <img
                              src={sub.mediaUrl}
                              alt="Student submission"
                              style={{
                                maxWidth: "100%",
                                maxHeight: 180,
                                objectFit: "contain",
                                borderRadius: 6,
                                border: "1px solid #e5e7eb",
                              }}
                            />
                          )}
                        </div>
                      )}

                      {/* Diff Detective summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isDiff =
                          tt === "diff-detective" || tt === "diff_detective" || tt === "diffdetective";
                        if (!isDiff) return null;

                        const summary = summarizeDiffDetective(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(59,130,246,0.22)",
                              background: "rgba(59,130,246,0.07)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#1e3a8a", marginBottom: 6 }}>
                              🔍 Diff Detective
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: "0.82rem", color: "#111827" }}>
                              {summary.mode && (
                                <div>
                                  <strong>Mode:</strong> {summary.mode}
                                </div>
                              )}
                              {summary.count != null && (
                                <div>
                                  <strong>Found:</strong> {summary.count}
                                  {summary.max != null ? ` / ${summary.max}` : ""}
                                </div>
                              )}
                            </div>

                            {Array.isArray(summary.lines) && summary.lines.length > 0 && (
                              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                {summary.lines.slice(0, 10).map((line, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      padding: "6px 8px",
                                      borderRadius: 10,
                                      border: "1px solid rgba(0,0,0,0.08)",
                                      background: "rgba(255,255,255,0.85)",
                                      fontSize: "0.82rem",
                                      color: "#111827",
                                    }}
                                  >
                                    {line}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Venn Sort summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isVenn = tt === "vennsort" || tt === "venn-sort" || tt === "venn_sort";
                        if (!isVenn) return null;

                        const summary = summarizeVennSort(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(16,185,129,0.22)",
                              background: "rgba(16,185,129,0.07)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#065f46", marginBottom: 6 }}>
                              ⭕⭕ Venn Sort
                            </div>
                            <div style={{ fontSize: "0.82rem", color: "#111827" }}>
                              {summary.lines.join(" • ")}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Mystery Clues summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isMystery =
                          tt === "mystery-clues" ||
                          tt === "mystery_clues" ||
                          tt === "mysteryclues" ||
                          tt === "physical-mystery-clues" ||
                          tt === "physical_mystery_clues" ||
                          tt === "physicalmysteryclues";
                        if (!isMystery) return null;

                        const summary = summarizeMysteryClues(sub, task);
                        if (!summary) return null;

                        const hasRecall = (summary.revealed && summary.revealed.length) || (summary.selected && summary.selected.length);

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(245,158,11,0.22)",
                              background: "rgba(245,158,11,0.07)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#92400e", marginBottom: 6 }}>
                              🕵️ Mystery Clues {summary.isFinal ? "(final recall)" : ""}
                            </div>

                            {summary.poolSize != null && (
                              <div style={{ fontSize: "0.82rem", color: "#374151", marginBottom: 6 }}>
                                Pool: {summary.poolSize} cards
                              </div>
                            )}

                            {hasRecall ? (
                              <div style={{ display: "grid", gap: 6 }}>
                                {summary.revealed?.length > 0 && (
                                  <div style={{ fontSize: "0.82rem", color: "#111827" }}>
                                    <strong>Revealed:</strong> {summary.revealed.join(" ")}
                                  </div>
                                )}
                                {summary.selected?.length > 0 && (
                                  <div style={{ fontSize: "0.82rem", color: "#111827" }}>
                                    <strong>Selected:</strong> {summary.selected.join(" ")}
                                  </div>
                                )}
                                {(summary.missed?.length > 0 || summary.extras?.length > 0) && (
                                  <div style={{ fontSize: "0.82rem", color: "#374151" }}>
                                    {summary.missed?.length > 0 ? `Missed: ${summary.missed.join(" ")} ` : ""}
                                    {summary.extras?.length > 0 ? `Extras: ${summary.extras.join(" ")}` : ""}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: "0.82rem", color: "#374151" }}>
                                (No recall payload stored for this submission.)
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Treasure Runner summary (score + pickups) */}
                      (() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isTreasure =
                          tt === "treasure-runner" ||
                          tt === "treasurerunner" ||
                          tt === "treasure_runner";
                        if (!isTreasure) return null;

                        const summary = summarizeTreasureRunner(sub, task);
                        if (!summary) return null;

                        const chips = [];
                        if (summary.points != null) chips.push(`Score: ${summary.points}`);
                        if (summary.coins != null) chips.push(`Coins: ${summary.coins}`);
                        if (summary.boosts != null) chips.push(`Boosts: ${summary.boosts}`);
                        if (summary.hits != null) chips.push(`Hits: ${summary.hits}`);
                        if (summary.durationSeconds != null) chips.push(`Duration: ${summary.durationSeconds}s`);
                        if (summary.finalSpeed != null) chips.push(`Final speed: ${summary.finalSpeed}`);

                        const tilt = summary.controls?.tiltEnabled;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(59,130,246,0.26)",
                              background: "rgba(59,130,246,0.06)",
                            }}
                          >
                            <div style={{ fontWeight: 800, marginBottom: 6 }}>🏃 Treasure Runner</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {chips.map((c) => (
                                <span
                                  key={c}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    border: "1px solid rgba(0,0,0,0.10)",
                                    background: "rgba(255,255,255,0.85)",
                                    fontSize: "0.82rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  {c}
                                </span>
                              ))}
                              {typeof tilt === "boolean" && (
                                <span
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    border: "1px solid rgba(0,0,0,0.10)",
                                    background: tilt ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.18)",
                                    fontSize: "0.82rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  Tilt: {tilt ? "On" : "Off"}
                                </span>
                              )}
                            </div>
                            <div style={{ marginTop: 6, fontSize: "0.82rem", color: "#334155" }}>
                              Arcade engagement: quick attention, persistence, and momentum. (This is typically best reported as a compact score snapshot, not detailed play-by-play.)
                            </div>
                          </div>
                        );
                      })()}


                      {/* Draw/Mime + Speed Draw summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isDrawMime =
                          tt === "draw-mime" || tt === "draw_mime" || tt === "drawmime";
                        const isSpeedDraw =
                          tt === "speed-draw" || tt === "speeddraw" || tt === "speed_draw";
                        if (!isDrawMime && !isSpeedDraw) return null;

                        const summary = summarizeDrawMimeOrSpeedDraw(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(99,102,241,0.22)",
                              background: "rgba(99,102,241,0.07)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#312e81", marginBottom: 6 }}>
                              {isSpeedDraw ? "⚡️ Speed Draw" : "✍️🎭 Draw or Mime"}
                            </div>

                            {summary.concept && (
                              <div style={{ fontSize: "0.82rem", color: "#111827", marginBottom: 6 }}>
                                <strong>Concept:</strong> {summary.concept}
                              </div>
                            )}

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: "0.82rem", color: "#111827" }}>
                              {summary.drawerOrActor && (
                                <div>
                                  <strong>{isSpeedDraw ? "Drawer" : "Actor/Drawer"}:</strong> {summary.drawerOrActor}
                                </div>
                              )}
                              {summary.guessedBy && (
                                <div>
                                  <strong>Guessed by:</strong> {summary.guessedBy}
                                </div>
                              )}
                              {summary.correct != null && (
                                <div>
                                  <strong>Correct:</strong> {summary.correct ? "Yes" : "No"}
                                </div>
                              )}
                              {summary.secondsRemaining != null && (
                                <div>
                                  <strong>Time left:</strong> {summary.secondsRemaining}s
                                </div>
                              )}
                            </div>

                            {Array.isArray(summary.guesses) && summary.guesses.length > 0 && (
                              <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#374151" }}>
                                Guesses: {summary.guesses.join(" • ")}
                              </div>
                            )}
                          </div>
                        );
                      })()}


{/* Flashcards Race summary (if present) */}
                      {(() => {
                        const isFlashcardsRace =
                          task.taskType === "flashcards-race" ||
                          task.taskType === "flashcards_race" ||
                          task.taskType === "flashcardsRace";
                        if (!isFlashcardsRace) return null;

                        const summary = summarizeFlashcardsRace(sub, task, teamsById);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(99,102,241,0.25)",
                              background: "rgba(99,102,241,0.08)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#3730a3", marginBottom: 6 }}>
                              Flashcards Race outcome
                            </div>

                            {(summary.winnerLabel || summary.winnerTeamId) && (
                              <div style={{ fontWeight: 900, color: "#111827", marginBottom: 6 }}>
                                Winner: {summary.winnerLabel || `Team ${String(summary.winnerTeamId).slice(-4)}`}
                              </div>
                            )}

                            {(summary.totalCards != null || summary.secondsPerCard != null) && (
                              <div style={{ fontSize: "0.82rem", color: "#374151", marginBottom: 6 }}>
                                {summary.totalCards != null ? `${summary.totalCards} cards` : ""}
                                {summary.totalCards != null && summary.secondsPerCard != null ? " • " : ""}
                                {summary.secondsPerCard != null ? `${summary.secondsPerCard}s per card` : ""}
                              </div>
                            )}

                            {Array.isArray(summary.board) && summary.board.length > 0 && (
                              <div style={{ display: "grid", gap: 6 }}>
                                {summary.board.slice(0, 8).map((row) => (
                                  <div
                                    key={row.teamId}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      padding: "6px 8px",
                                      borderRadius: 10,
                                      border: "1px solid rgba(0,0,0,0.08)",
                                      background: "rgba(255,255,255,0.85)",
                                    }}
                                  >
                                    <div style={{ fontWeight: 900, color: "#111827" }}>
                                      {row.teamName || `Team ${row.teamId.slice(-4)}`}
                                    </div>
                                    <div style={{ fontWeight: 900, color: "#111827" }}>{row.points} pts</div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {Array.isArray(summary.wonSummary) && summary.wonSummary.length > 0 && (
                              <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#374151" }}>
                                Cards won: {summary.wonSummary.map((w) => `${w.teamName}: ${w.count}`).join(" • ")}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Narration Synthesize peer ratings (if present) */}
                      {(() => {
                        const isNarration =
                          task.taskType === "narration-synthesize" ||
                          task.taskType === "narration_synthesize" ||
                          task.taskType === "narrationSynthesize" ||
                          task.taskType === "narrationSynthesizeTask";
                        if (!isNarration) return null;

                        const summary = summarizeNarrationRatings(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid #bae6fd",
                              background: "#ecfeff",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 900,
                                color: "#075985",
                                marginBottom: 4,
                              }}
                            >
                              Narration ratings
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontSize: "0.85rem", color: "#0f172a", fontWeight: 800 }}>
                                Avg: {summary.avg.toFixed(1)} / {summary.max}
                              </div>
                              <div style={{ fontSize: "0.8rem", color: "#0f172a" }}>
                                {summary.count} ratings • scale {summary.min}–{summary.max}
                              </div>
                            </div>

                            {Array.isArray(summary.detailed) && summary.detailed.length > 0 && (
                              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                {summary.detailed.slice(0, 12).map((r, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      padding: "6px 8px",
                                      borderRadius: 8,
                                      border: "1px solid #e2e8f0",
                                      background: "rgba(255,255,255,0.85)",
                                      fontSize: "0.82rem",
                                    }}
                                  >
                                    <div style={{ fontWeight: 800, color: "#0f172a" }}>
                                      {r.playerName || (r.playerIndex != null ? `Player ${r.playerIndex + 1}` : "Player")}
                                    </div>
                                    <div style={{ fontWeight: 900, color: "#0f172a" }}>{r.score}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Script Play performance summary (if present) */}
                      {(() => {
                        const isScriptPlay =
                          task.taskType === "script-play" ||
                          task.taskType === "script_play" ||
                          task.taskType === "scriptplay" ||
                          task.taskType === "script";
                        if (!isScriptPlay) return null;

                        const summary = summarizeScriptPlay(sub, task);
                        if (!summary) return null;

                        const hasAny =
                          summary.rating != null ||
                          summary.expressive != null ||
                          summary.totalTurns != null ||
                          summary.rolesCount != null;

                        if (!hasAny) return null;

                        return (
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid rgba(245,158,11,0.35)",
                              background: "rgba(255,247,237,0.9)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 900,
                                color: "#92400e",
                                marginBottom: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  background: "rgba(245,158,11,0.14)",
                                  border: "1px solid rgba(245,158,11,0.25)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                🎭
                              </span>
                              Script Play details
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              {summary.rolesCount != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Roles:</strong> {summary.rolesCount}
                                </div>
                              )}
                              {summary.totalTurns != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Lines:</strong> {summary.totalTurns}
                                </div>
                              )}
                              {summary.rating != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Expressiveness:</strong> {summary.rating}/5
                                </div>
                              )}
                              {summary.expressive != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Expressive:</strong> {summary.expressive ? "Yes" : "No"}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Role Play Deck summary (scenario / roles / mode) */}
                      {(() => {
                        const isRolePlay =
                          task.taskType === "role-play-deck" ||
                          task.taskType === "role_play_deck" ||
                          task.taskType === "roleplaydeck" ||
                          task.taskType === "role-play" ||
                          task.taskType === "role_play" ||
                          task.taskType === "roleplay";
                        if (!isRolePlay) return null;

                        const summary = summarizeRolePlayDeck(sub, task);
                        if (!summary) return null;

                        const modeLabel =
                          summary.mode === "mystery"
                            ? "Mystery (hidden)"
                            : summary.mode === "classic"
                            ? "Classic (open)"
                            : summary.mode
                            ? String(summary.mode)
                            : "Choose";

                        return (
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 10,
                              border: "1px solid rgba(59,130,246,0.28)",
                              background: "rgba(239,246,255,0.9)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 900,
                                color: "#1d4ed8",
                                marginBottom: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  background: "rgba(59,130,246,0.12)",
                                  border: "1px solid rgba(59,130,246,0.22)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                🎴
                              </span>
                              Role Play Deck
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                <strong>Mode:</strong> {modeLabel}
                              </div>
                              {summary.rolesCount != null && (
                                <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                  <strong>Roles:</strong> {summary.rolesCount}
                                </div>
                              )}
                            </div>

                            {summary.scenario && (
                              <div style={{ marginTop: 6, fontSize: "0.84rem", color: "#0f172a" }}>
                                <strong>Scenario:</strong> {summary.scenario}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      
{/* Fake Out (bluffing / listening) summary */}
{(() => {
  const isFakeOut =
    task.taskType === "fake-out" ||
    task.taskType === "fake_out" ||
    task.taskType === "fakeout" ||
    task.taskType === "fakeOut";
  if (!isFakeOut) return null;

  const summary = summarizeFakeOut(sub, task);
  if (!summary) return null;

  const first = summary.rounds[0];
  const correctLabel =
    first.correctIndex != null ? `Option ${first.correctIndex + 1}` : "—";

  const fooledCount =
    first.correctIndex != null
      ? summary.votes.filter((v) => v.optionIndex != null && v.optionIndex !== first.correctIndex).length
      : null;

  return (
    <div
      style={{
        marginTop: 4,
        padding: 10,
        borderRadius: 10,
        border: "1px solid rgba(239,68,68,0.28)",
        background: "rgba(254,242,242,0.9)",
      }}
    >
      <div
        style={{
          fontSize: "0.78rem",
          fontWeight: 900,
          color: "#b91c1c",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.22)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          🤥
        </span>
        Fake Out – votes &amp; reveal
      </div>

      <div style={{ fontSize: "0.84rem", color: "#111827" }}>
        <strong>Correct:</strong> {correctLabel}
        {fooledCount != null && (
          <>
            {" "}
            • <strong>Fooled:</strong> {fooledCount}
          </>
        )}
      </div>

      {Array.isArray(first.options) && first.options.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {first.options.slice(0, 4).map((opt, i) => {
            const isCorrect = first.correctIndex === i;
            return (
              <div
                key={i}
                style={{
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: isCorrect ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.8)",
                  fontSize: "0.82rem",
                }}
              >
                <strong>Option {i + 1}:</strong> {opt}
              </div>
            );
          })}
        </div>
      )}

      {summary.votes.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {summary.votes.slice(0, 12).map((v, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.08)",
                background: "rgba(255,255,255,0.85)",
                fontSize: "0.82rem",
              }}
            >
              <div style={{ fontWeight: 800, color: "#111827" }}>{v.playerName || "Player"}</div>
              <div style={{ fontWeight: 900, color: "#111827" }}>
                Option {Number(v.optionIndex) + 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
})()}

                                            {/* Word Weaver Duel summary (Scrabble / Phrase) */}
                      {(() => {
                        const isWordWeaver =
                          task.taskType === "word-weaver-duel" ||
                          task.taskType === "word_weaver_duel" ||
                          task.taskType === "wordweaverduel" ||
                          task.taskType === "word-weaver" ||
                          task.taskType === "word_weaver" ||
                          task.taskType === "wordweaver";

                        if (!isWordWeaver) return null;

                        const summary = summarizeWordWeaver(sub, task);
                        if (!summary) return null;

                        const modeLabel =
                          summary.mode === "scrabble"
                            ? "Scrabble grid"
                            : summary.mode === "phrase"
                            ? "Phrase rebuild"
                            : summary.mode;

                        const chips = [];
                        if (summary.totalPoints != null) chips.push(`${summary.totalPoints} pts`);
                        if (summary.mode === "scrabble" && summary.placementsCount != null)
                          chips.push(`${summary.placementsCount} placed`);
                        if (summary.mode !== "scrabble" && summary.targetPhrase)
                          chips.push(`Target: ${summary.targetPhrase}`);

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(16,185,129,0.30)",
                              background: "rgba(16,185,129,0.07)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 900,
                                color: "#065f46",
                                marginBottom: 6,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 999,
                                  background: "rgba(16,185,129,0.12)",
                                  border: "1px solid rgba(16,185,129,0.22)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                🔤
                              </span>
                              Word Weaver Duel — {modeLabel}
                            </div>

                            {chips.length > 0 && (
                              <div style={{ fontSize: "0.82rem", color: "#064e3b", marginBottom: 6 }}>
                                {chips.join(" • ")}
                              </div>
                            )}

                            {summary.mode === "scrabble" && summary.placedWords && summary.placedWords.length > 0 && (
                              <div style={{ fontSize: "0.82rem", color: "#0f172a" }}>
                                <strong>Words:</strong> {summary.placedWords.slice(0, 12).join(", ")}
                                {summary.placedWords.length > 12 ? "…" : ""}
                              </div>
                            )}

                            {summary.mode !== "scrabble" && summary.phraseAttempt && (
                              <div style={{ fontSize: "0.84rem", color: "#0f172a" }}>
                                <strong>Attempt:</strong> {summary.phraseAttempt}
                              </div>
                            )}
                          </div>
                        );
                      })()}



                      {/* Brainstorm Battle summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isBrainstorm =
                          tt === "brainstorm-battle" || tt === "brainstorm_battle" || tt === "brainstormbattle";
                        if (!isBrainstorm) return null;

                        const summary = summarizeBrainstormBattle(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(245,158,11,0.25)",
                              background: "rgba(245,158,11,0.07)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#92400e", marginBottom: 6 }}>
                              💡 Brainstorm Battle
                            </div>

                            {summary.seed && (
                              <div style={{ fontSize: "0.84rem", color: "#111827", marginBottom: 6 }}>
                                <strong>Seed:</strong> {summary.seed}
                              </div>
                            )}

                            {summary.count != null && (
                              <div style={{ fontSize: "0.82rem", color: "#374151", marginBottom: 6 }}>
                                Ideas captured: <strong>{summary.count}</strong>
                              </div>
                            )}

                            {summary.topIdeas?.length > 0 && (
                              <div style={{ fontSize: "0.82rem", color: "#111827" }}>
                                <strong>Top picks:</strong> {summary.topIdeas.join(" • ")}
                              </div>
                            )}

                            {summary.ideas?.length > 0 && (
                              <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#374151" }}>
                                Samples: {summary.ideas.join(" • ")}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      
                      {/* Reading Comp summary */}
                      {(() => {
                        const t = String(task.taskType || "").toLowerCase().replace(/_/g, "-");
                        const isReadingComp =
                          t === "reading-comp" || t === "readingcomp" || t === "reading-comprehension";

                        if (!isReadingComp) return null;

                        const paragraph =
                          task.generatedParagraph ||
                          task.paragraph ||
                          task.text ||
                          task?.config?.generatedParagraph ||
                          task?.config?.paragraph ||
                          "";

                        const ap = sub?.answerPayload && typeof sub.answerPayload === "object" ? sub.answerPayload : {};
                        const mode = String(ap.mode || sub?.mode || (task.isTeamVariation ? "team" : "solo")).toLowerCase();

                        const responses = Array.isArray(ap.responses)
                          ? ap.responses.map((r) => String(r || "").trim()).filter(Boolean)
                          : typeof ap.answer === "string"
                          ? [ap.answer.trim()]
                          : typeof sub?.answerText === "string"
                          ? [sub.answerText.trim()]
                          : typeof sub?.answer === "string"
                          ? [sub.answer.trim()]
                          : [];

                        const aiFeedback =
                          (typeof sub?.aiFeedback === "string" ? sub.aiFeedback : "") ||
                          (typeof ap?.aiFeedback === "string" ? ap.aiFeedback : "") ||
                          (typeof sub?.feedback === "string" ? sub.feedback : "") ||
                          "";

                        const details = (sub?.details && typeof sub.details === "object" ? sub.details : {}) || {};
                        const rc = (details.readingComp && typeof details.readingComp === "object" ? details.readingComp : details) || {};
                        const levelRaw = String(rc.comparison || rc.gradeComparison || rc.levelComparison || "").toLowerCase();
                        const level =
                          levelRaw.startsWith("below") ? "below" : levelRaw.startsWith("above") ? "above" : levelRaw.startsWith("at") ? "at" : "";

                        const clipP = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n).trimEnd() + "…" : s);
                        const paraClip = clipP(paragraph, 380);

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 12,
                              borderRadius: 14,
                              border: "1px solid rgba(99,102,241,0.22)",
                              background: "linear-gradient(180deg, rgba(99,102,241,0.08), rgba(99,102,241,0.03))",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#3730a3" }}>
                                📖 Reading Comprehension {mode === "team" ? "(team)" : ""}
                              </div>
                              {level && (
                                <div
                                  style={{
                                    fontSize: "0.72rem",
                                    fontWeight: 800,
                                    padding: "4px 8px",
                                    borderRadius: 999,
                                    color: "#111827",
                                    background: "rgba(255,255,255,0.9)",
                                    border: "1px solid rgba(0,0,0,0.08)",
                                  }}
                                >
                                  Level: {level}
                                </div>
                              )}
                            </div>

                            {paraClip && (
                              <div style={{ marginTop: 8, fontSize: "0.86rem", color: "#111827", lineHeight: 1.35 }}>
                                <strong>Paragraph:</strong> {paraClip}
                              </div>
                            )}

                            {responses.length > 0 && (
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#4b5563", marginBottom: 6 }}>
                                  Response{responses.length > 1 ? "s" : ""}:
                                </div>
                                <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {responses.slice(0, 6).map((r, i) => (
                                    <li key={i} style={{ fontSize: "0.86rem", color: "#111827", marginBottom: 4 }}>
                                      {clipP(r, 200)}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {aiFeedback && (
                              <div
                                style={{
                                  marginTop: 10,
                                  padding: 10,
                                  borderRadius: 12,
                                  border: "1px solid rgba(16,185,129,0.25)",
                                  background: "rgba(16,185,129,0.06)",
                                  color: "#064e3b",
                                  fontSize: "0.86rem",
                                  lineHeight: 1.35,
                                }}
                              >
                                <strong>AI feedback:</strong> {clipP(aiFeedback, 280)}
                              </div>
                            )}
                          </div>
                        );
                      })()}


                      {/* Mad Dash summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isMadDash =
                          tt === "mad-dash" ||
                          tt === "mad_dash" ||
                          tt === "maddash" ||
                          tt === "mad-dash-sequence" ||
                          tt === "mad_dash_sequence" ||
                          tt === "maddashsequence";

                        if (!isMadDash) return null;

                        const summary = summarizeMadDash(sub, task);
                        if (!summary) return null;

                        const chips = [];
                        if (summary.scans != null) chips.push(`${summary.scans} scans`);
                        if (summary.attempts != null) chips.push(`${summary.attempts} run${summary.attempts === 1 ? "" : "s"}`);
                        if (summary.bestRunner) chips.push(`Best: ${summary.bestRunner}`);
                        if (summary.bestTimeMs != null) chips.push(`Time: ${fmtMsCompact(summary.bestTimeMs)}`);

                        const routePreview =
                          summary.route && summary.route.length
                            ? summary.route.slice(0, 6).map((c) => String(c)).join(" → ")
                            : null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(234,88,12,0.25)",
                              background: "rgba(234,88,12,0.06)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#9a3412", marginBottom: 6 }}>
                              🏃‍♂️⚡ Mad Dash
                            </div>

                            {chips.length > 0 && (
                              <div style={{ fontSize: "0.84rem", color: "#111827", marginBottom: 6 }}>
                                {chips.join(" • ")}
                              </div>
                            )}

                            {routePreview && (
                              <div style={{ fontSize: "0.82rem", color: "#374151" }}>
                                <strong>Route:</strong> {routePreview}
                                {summary.route.length > 6 ? " …" : ""}
                              </div>
                            )}
                          </div>
                        );
                      })()}

{/* Collaboration summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isCollab =
                          tt === "collaboration" || tt === "collab" || tt === "collaboration-task";
                        if (!isCollab) return null;

                        const summary = summarizeCollaboration(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(59,130,246,0.25)",
                              background: "rgba(59,130,246,0.06)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#1d4ed8", marginBottom: 6 }}>
                              🤝 Collaboration (inter-team)
                            </div>

                            {summary.partner && (
                              <div style={{ fontSize: "0.82rem", color: "#374151", marginBottom: 6 }}>
                                Partner team: <strong>{summary.partner}</strong>
                              </div>
                            )}

                            {summary.initial && (
                              <div style={{ fontSize: "0.84rem", color: "#111827", marginBottom: 6 }}>
                                <strong>Initial:</strong> {summary.initial}
                              </div>
                            )}

                            {summary.reply && (
                              <div style={{ fontSize: "0.84rem", color: "#111827" }}>
                                <strong>Reply:</strong> {summary.reply}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Live Debate summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isDebate =
                          tt === "live-debate" || tt === "live_debate" || tt === "livedebate";
                        if (!isDebate) return null;

                        const summary = summarizeLiveDebate(sub, task);
                        if (!summary) return null;

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(16,185,129,0.30)",
                              background: "rgba(16,185,129,0.07)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#065f46", marginBottom: 6 }}>
                              🗣️ Live Debate
                            </div>

                            {summary.topic && (
                              <div style={{ fontSize: "0.84rem", color: "#111827", marginBottom: 6 }}>
                                <strong>Topic:</strong> {summary.topic}
                              </div>
                            )}

                            {summary.speakers?.length > 0 && (
                              <div style={{ fontSize: "0.82rem", color: "#111827" }}>
                                <strong>Speaker notes:</strong>
                                <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                                  {summary.speakers.slice(0, 6).map((ln, i) => (
                                    <div
                                      key={i}
                                      style={{
                                        padding: "6px 8px",
                                        borderRadius: 10,
                                        border: "1px solid rgba(0,0,0,0.08)",
                                        background: "rgba(255,255,255,0.85)",
                                      }}
                                    >
                                      {ln}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {summary.transcript && (
                              <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#374151" }}>
                                Transcript (preview): {summary.transcript}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Pet Feeding summary */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isPet =
                          tt === "pet-feeding" || tt === "pet_feeding" || tt === "petfeeding";
                        if (!isPet) return null;

                        const summary = summarizePetFeeding(sub, task);
                        if (!summary) return null;

                        const chips = [];
                        if (summary.pet) chips.push(`Pet: ${summary.pet}`);
                        if (summary.pack) chips.push(`Pack: ${summary.pack}`);
                        if (summary.food) chips.push(`Food: ${summary.food}`);
                        if (summary.points != null) chips.push(`${summary.points} pts`);

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(99,102,241,0.25)",
                              background: "rgba(99,102,241,0.06)",
                            }}
                          >
                            <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#3730a3", marginBottom: 6 }}>
                              🐾 Pet Feeding
                            </div>
                            <div style={{ fontSize: "0.82rem", color: "#111827" }}>
                              {chips.length ? chips.join(" • ") : "Pet progress recorded."}
                            </div>
                          </div>
                        );
                      })()}
/* Objective task summaries (matching / sequence / sort / timeline) */}
                      {(() => {
                        const tt = String(task.taskType || task.type || "").toLowerCase();
                        const isMatching = tt === "matching" || tt === "match" || tt.includes("matching");
                        const isSequence = tt === "sequence" || tt.includes("sequence");
                        const isTimeline = tt === "timeline" || tt.includes("timeline");
                        const isSort = tt === "sort" || tt.includes("sort");

                        if (isMatching) {
                          const summary = summarizeMatchingTask(sub, task);
                          if (!summary) return null;
                          return (
                            <div
                              style={{
                                marginTop: 6,
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid rgba(59,130,246,0.25)",
                                background: "rgba(59,130,246,0.06)",
                              }}
                            >
                              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#1d4ed8", marginBottom: 6 }}>
                                🔗 Matching connections
                              </div>
                              <div style={{ display: "grid", gap: 4, fontSize: "0.82rem", color: "#111827" }}>
                                {summary.matches.map((ln, i) => (
                                  <div key={i}>{ln}</div>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        if (isSort) {
                          const summary = summarizeSortTask(sub, task);
                          if (!summary) return null;
                          return (
                            <div
                              style={{
                                marginTop: 6,
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid rgba(16,185,129,0.30)",
                                background: "rgba(16,185,129,0.07)",
                              }}
                            >
                              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#065f46", marginBottom: 6 }}>
                                🧺 Sort buckets
                              </div>
                              <div style={{ display: "grid", gap: 4, fontSize: "0.82rem", color: "#111827" }}>
                                {(summary.buckets || []).map((ln, i) => (
                                  <div key={i}>{ln}</div>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        if (isSequence || isTimeline) {
                          const summary = summarizeOrderingTask(sub, task);
                          if (!summary) return null;
                          const label = isTimeline ? "🕰️ Timeline order" : "🔢 Sequence order";
                          return (
                            <div
                              style={{
                                marginTop: 6,
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid rgba(99,102,241,0.25)",
                                background: "rgba(99,102,241,0.06)",
                              }}
                            >
                              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#3730a3", marginBottom: 6 }}>
                                {label}
                              </div>
                              <div style={{ display: "grid", gap: 4, fontSize: "0.82rem", color: "#111827" }}>
                                {summary.order.map((ln, i) => (
                                  <div key={i}>{ln}</div>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        return null;
                      })()}

                      {/* Open-text: Vocabulary Paragraph summary (required words + progress) */}
                      {(() => {
                        if (!isVocabParagraphTask(task)) return null;

                        const required = normalizeWordList(task?.config?.words);
                        if (!required.length) return null;

                        const paragraph = extractAnswerText(sub, task);
                        const tokens = tokenizeForPrefixMatch(paragraph);

                        const matched = required.filter((w) => hasWordOrPhrase(tokens, w));
                        const missing = required.filter((w) => !hasWordOrPhrase(tokens, w));

                        const pct = Math.round((matched.length / Math.max(1, required.length)) * 100);

                        return (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 12,
                              borderRadius: 14,
                              border: "1px solid rgba(99,102,241,0.22)",
                              background: "linear-gradient(180deg, rgba(99,102,241,0.08), rgba(99,102,241,0.03))",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#3730a3" }}>
                                ✍️ Vocabulary Paragraph
                              </div>
                              <div
                                style={{
                                  fontSize: "0.72rem",
                                  fontWeight: 800,
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  color: "#111827",
                                  background: "rgba(255,255,255,0.9)",
                                  border: "1px solid rgba(0,0,0,0.08)",
                                }}
                              >
                                Words used: {matched.length}/{required.length} ({pct}%)
                              </div>
                            </div>

                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {required.map((w) => {
                                const ok = matched.includes(w);
                                return (
                                  <span
                                    key={w}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: 999,
                                      fontSize: "0.78rem",
                                      fontWeight: 800,
                                      border: ok ? "1px solid rgba(16,185,129,0.30)" : "1px solid rgba(239,68,68,0.25)",
                                      background: ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.06)",
                                      color: ok ? "#065f46" : "#7f1d1d",
                                    }}
                                  >
                                    {ok ? "✓" : "•"} {w}
                                  </span>
                                );
                              })}
                            </div>

                            {missing.length > 0 && (
                              <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#374151" }}>
                                <strong>Still missing:</strong> {missing.join(", ")}
                              </div>
                            )}
                          </div>
                        );
                      })()}

{(() => {
                        const txt = extractAnswerText(sub, task);
                        if (!txt) return null;
                        return (
                          <div style={{ fontSize: "0.85rem", color: "#111827", marginTop: 4 }}>
                            <strong>Response:</strong> {txt}
                          </div>
                        );
                      })()}

                      {/* AI rubric breakdown (if present) */}
                      {sub.aiScore?.criteria && sub.aiScore.criteria.length > 0 && (
                        <details style={{ marginTop: 6, fontSize: "0.8rem" }}>
                          <summary style={{ cursor: "pointer", color: "#2563eb" }}>
                            View rubric breakdown
                          </summary>
                          <ul style={{ paddingLeft: 18, margin: "4px 0 0" }}>
                            {sub.aiScore.criteria.map((c) => (
                              <li key={c.id}>
                                <strong>
                                  {c.id} ({c.score}/{c.maxPoints})
                                </strong>
                                {c.comment ? ` – ${c.comment}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      {sub.aiScore?.overallComment && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: "0.8rem",
                            color: "#4b5563",
                            fontStyle: "italic",
                          }}
                        >
                          {sub.aiScore.overallComment}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}