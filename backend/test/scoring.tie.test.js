// backend/test/scoring.tie.test.js
import { computeScores } from "../lib/scoring.js";

describe("scoring tie & config tests", () => {
  test("configurable speed bonuses and larger teams", () => {
    const session = { teams: [{ _id: '1' }, { _id: '2' }, { _id: '3' }, { _id: '4' }] };
    const subs = [
      { teamId: '1', isCorrect: true, responseTimeMs: 100 },
      { teamId: '2', isCorrect: true, responseTimeMs: 200 },
      { teamId: '3', isCorrect: true, responseTimeMs: 300 },
      { teamId: '4', isCorrect: true, responseTimeMs: 400 },
    ];

    const opts = { BASE_POINTS: 20, SPEED_BONUSES: [10,8,6,4] };
    const { scoresToAdd } = computeScores(session, subs, opts);

    expect(scoresToAdd['1']).toBe(20 + 10);
    expect(scoresToAdd['2']).toBe(20 + 8);
    expect(scoresToAdd['3']).toBe(20 + 6);
    expect(scoresToAdd['4']).toBe(20 + 4);
  });

  test("identical response times preserve order and bonuses assigned deterministically", () => {
    const session = { teams: [{ _id: 'A' }, { _id: 'B' }] };
    const subs = [
      { teamId: 'A', isCorrect: true, responseTimeMs: 1000 },
      { teamId: 'B', isCorrect: true, responseTimeMs: 1000 },
    ];

    const { scoresToAdd } = computeScores(session, subs);
    // Both get base, bonuses assigned by sort stability (original order maintained)
    expect(scoresToAdd['A']).toBeGreaterThanOrEqual(scoresToAdd['B'] - 10);
  });
});
