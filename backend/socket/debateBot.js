// backend/socket/debateBot.js
//
// Bot opponent for live-debate when no second team shows up within 2 min.
// Two exports:
//   - BOT_TEAM_ID_PREFIX / makeBotTeam(): creates a synthetic team entry
//   - autoplayBotIfNeeded(io, room, debateKey, deps): if the current turn
//     belongs to a bot, generate its next argument via gpt-4o-mini and
//     apply it to the shared debate state, mirroring the real-team path.
//
// Re-uses the same scoring helper as the human handler so the debate
// closes cleanly when both sides have spoken turnsPerTeam times.

import OpenAI from "openai";

export const BOT_TEAM_ID_PREFIX = "bot:";

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[debateBot] OPENAI_API_KEY is not set");
  return (_client = new OpenAI({ apiKey }));
}

/** Synthetic team entry for the bot. teamId carries the "bot:" prefix so
 *  the rest of the system can recognise it without a separate flag. */
export function makeBotTeam(seed = "") {
  const id = `${BOT_TEAM_ID_PREFIX}${seed || Math.random().toString(36).slice(2, 8)}`;
  return {
    teamId: id,
    name: "🦊 Curru the Fox",
    isBot: true,
  };
}

/** Last-resort line if BOTH attempts at a real AI response fail.
 *  Phrased in Curru's voice so even the emergency path stays in
 *  character. Three rotating one-liners per side so a repeat bot
 *  doesn't say the exact same thing twice in a row. */
function _fallback(side) {
  const FOR = [
    "Okay, my turn — I think this side has the stronger argument, and I want to hear how you'd push back.",
    "I'm going with FOR on this one. The evidence I keep coming back to lines up too cleanly to ignore.",
    "Curru's pick: FOR. The principle at the centre of this just outweighs the costs.",
  ];
  const AGAINST = [
    "Pushing back here — the assumption behind that doesn't hold up once you change the situation.",
    "I'm going AGAINST. Being wrong on this one costs too much.",
    "Curru's not buying it — there's a less risky path that lands in a better place.",
  ];
  const pool = side === "for" ? FOR : AGAINST;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * If the current turn in a debate belongs to a bot, write its next
 * argument and apply it. Re-entrant safe (de-duped via debate.botPending).
 *
 * deps = { scoreDebateResponses, addBonusSubmission }
 *   — passed in so we don't duplicate them; both already live in gameHandlers.js.
 *
 * Schedules an artificial 2.5-4s delay before posting so it reads as a
 * thinking pause rather than an instant blurb.
 */
export function autoplayBotIfNeeded(io, room, debateKey, deps = {}) {
  const debate = room?.debate?.[debateKey];
  if (!debate) return;
  const turnSide = debate.currentTurn;
  const meta = debate.teams?.[turnSide];
  if (!meta?.isBot) return;
  if (debate.botPending) return;
  debate.botPending = true;

  const delayMs = 2500 + Math.floor(Math.random() * 1500);
  setTimeout(async () => {
    try {
      const text = await _generateBotArgument(debate, turnSide);
      _applyBotArgument(io, room, debate, debateKey, turnSide, text, deps);
    } catch (err) {
      console.warn(`[debateBot] autoplay failed for ${debateKey}:`, err?.message);
      try {
        _applyBotArgument(io, room, debate, debateKey, turnSide, _fallback(turnSide), deps);
      } catch {}
    } finally {
      debate.botPending = false;
    }
  }, delayMs);
}

async function _generateBotArgument(debate, side) {
  const postulate = debate.postulate || "";
  const sideLabel = side === "for" ? "FOR" : "AGAINST";
  const priorTranscript = (debate.responses || [])
    .map((r) =>
      `${r.teamName || (r.side === "for" ? "FOR" : "AGAINST")}: ${r.text}`
    )
    .join("\n");

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[Curru] OPENAI_API_KEY missing — falling back to canned line. Real AI calls are the design intent.");
    return _fallback(side);
  }

  // Curru's character — clever-but-kind fox, grade-8 voice. The character
  // brief lives at the top so future task-type integrations (any other
  // duel/AI-opponent context) can reuse it verbatim.
  const system =
    `You are CURRU THE FOX (pronounced "Krew"), a clever-but-kind Grade 8 student who's the practice opponent in this classroom. ` +
    `Voice: friendly, curious, a little playful. You like asking "but what if…" and you give credit where it's earned. ` +
    `You're arguing the ${sideLabel} side of this debate. ` +
    `Write 1-3 short sentences in a plain student voice — no preamble, no "I'd argue that", no labels. Just say what you think. ` +
    `Stay on the proposition. If the other side has already spoken, address their strongest specific claim — don't just repeat your earlier point.`;

  const user =
    `Proposition: "${postulate}"\n\n` +
    `Debate so far:\n${priorTranscript || "(you speak first — open the case for the " + sideLabel + " side)"}\n\n` +
    `Your next argument as the ${sideLabel} side. 1-3 sentences in Curru's voice.`;

  const openai = getClient();
  // One retry on transient errors so a flaky API doesn't immediately drop
  // Curru into the canned fallback. Two real-AI attempts before degrading.
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.85,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const text = (completion?.choices?.[0]?.message?.content || "").trim();
      if (text) return text;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  if (lastErr) {
    console.warn("[Curru] both AI attempts failed:", lastErr?.message);
  }
  return _fallback(side);
}

/** Mirror of the human path inside gameHandlers.js — push the response,
 *  flip the turn, broadcast, and close out the debate if both sides have
 *  spoken turnsPerTeam times. Awards points only to the REAL team. */
function _applyBotArgument(io, room, debate, debateKey, side, text, deps) {
  if (!text) return;
  const { scoreDebateResponses, addBonusSubmission } = deps || {};

  const turnNumber = side === "for" ? debate.forCount : debate.againstCount;
  const entry = {
    side,
    teamName: debate.teams[side].name,
    speaker: "🦊 Curru the Fox",
    text,
    turnNumber,
    isBot: true,
  };
  debate.responses.push(entry);
  if (side === "for") debate.forCount += 1;
  else debate.againstCount += 1;
  debate.currentTurn = side === "for" ? "against" : "for";

  const payload = {
    ...entry,
    currentTurn: debate.currentTurn,
    forCount: debate.forCount,
    againstCount: debate.againstCount,
  };
  const forId = debate.teams?.for?.teamId;
  const againstId = debate.teams?.against?.teamId;
  if (forId && againstId) {
    io.to(forId).emit("debate-new-response", payload);
    io.to(againstId).emit("debate-new-response", payload);
  } else if (room?.code) {
    io.to(room.code).emit("debate-new-response", payload);
  }

  // Completion sweep — same shape as gameHandlers.js, minus bonus for the bot.
  const turnsPerTeam = debate.turnsPerTeam || 3;
  const done = debate.forCount >= turnsPerTeam && debate.againstCount >= turnsPerTeam;
  if (done && typeof scoreDebateResponses === "function") {
    const verdict = scoreDebateResponses(debate.responses, turnsPerTeam);
    const forName = debate.teams?.for?.name;
    const againstName = debate.teams?.against?.name;
    const awarded = {};
    if (typeof addBonusSubmission === "function" && room) {
      // Award the real team only.
      const realIsFor = !debate.teams.for.isBot;
      if (realIsFor && forId && verdict.award.for > 0) {
        addBonusSubmission(room, forId, verdict.award.for, "live-debate", {
          side: "for", winningSide: verdict.winningSide, postulate: debate.postulate, vsBot: true,
        });
        awarded[forId] = verdict.award.for;
      } else if (!realIsFor && againstId && verdict.award.against > 0) {
        addBonusSubmission(room, againstId, verdict.award.against, "live-debate", {
          side: "against", winningSide: verdict.winningSide, postulate: debate.postulate, vsBot: true,
        });
        awarded[againstId] = verdict.award.against;
      }
    }
    const completePayload = {
      taskId: debate.taskId,
      responses: debate.responses,
      postulate: debate.postulate,
      winningSide: verdict.winningSide,
      forScore: verdict.forScore,
      againstScore: verdict.againstScore,
      forTeamName: forName,
      againstTeamName: againstName,
      awarded,
      vsBot: true,
    };
    if (forId && againstId) {
      io.to(forId).emit("debate-complete", completePayload);
      io.to(againstId).emit("debate-complete", completePayload);
    } else if (room?.code) {
      io.to(room.code).emit("debate-complete", completePayload);
    }
    if (room?.debate) delete room.debate[debateKey];
    return;
  }

  // If the new current turn ALSO belongs to a bot (bot-vs-bot would be a
  // bug, but we guard anyway), schedule the next move.
  const nextMeta = debate.teams?.[debate.currentTurn];
  if (nextMeta?.isBot) {
    autoplayBotIfNeeded(io, room, debateKey, deps);
  }
}
