// backend/test/scoring.test.js
import { computeScores } from "../lib/scoring.js";

describe("scoring.computeScores", () => {
  test("adds base points for correct submissions", () => {
    const session = { teams: [{ _id: 'teamA', score: 0 }, { _id: 'teamB', score: 0 }] };
    const subs = [
      { teamId: 'teamA', isCorrect: true, responseTimeMs: 5000 },
      { teamId: 'teamB', isCorrect: false, responseTimeMs: 6000 },
    ];

    const { scoresToAdd } = computeScores(session, subs, { BASE_POINTS: 10, SPEED_BONUSES: [5,3,2] });

    expect(scoresToAdd['teamA']).toBe(10 + 5); // base + first speed bonus
    expect(scoresToAdd['teamB']).toBe(0);
  });

  test("applies speed bonuses in order of responseTimeMs", () => {
    const session = { teams: [{ _id: 'A', score: 0 }, { _id: 'B', score: 0 }, { _id: 'C', score: 0 }] };
    const subs = [
      { teamId: 'A', isCorrect: true, responseTimeMs: 3000 },
      { teamId: 'B', isCorrect: true, responseTimeMs: 2000 },
      { teamId: 'C', isCorrect: true, responseTimeMs: 4000 },
    ];

    const { scoresToAdd } = computeScores(session, subs);

    // B fastest, then A, then C
    expect(scoresToAdd['B']).toBe(10 + 5);
    expect(scoresToAdd['A']).toBe(10 + 3);
    expect(scoresToAdd['C']).toBe(10 + 2);
  });

  test("handles ties and missing teams gracefully", () => {
    const session = { teams: [{ _id: 'X', score: 1 }] };
    const subs = [
      { teamId: 'X', isCorrect: false, responseTimeMs: 1000 },
      { teamId: 'Y', isCorrect: true, responseTimeMs: 1000 },
    ];

    const { scoresToAdd } = computeScores(session, subs);

    expect(scoresToAdd['X']).toBe(0);
    // Y should be present with base points (no team in session list yet)
    expect(scoresToAdd['Y']).toBe(10 + 5);
  });
});
