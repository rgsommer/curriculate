// backend/test/wildCardService.test.js
//
// Contracts:
//   rollWildCard chooses a type DIFFERENT from the original
//   rollWildCard stamps team.taskOverride on success
//   rollWildCard preserves roundNumber + order on the replacement
//   rollWildCard falls through candidates on individual regen errors
//   rollWildCard returns ok:false when ALL candidates fail
//   clearWildCardOverrideIfMoved wipes the override on index change,
//     leaves it alone when still on the same index

import {
  rollWildCard,
  clearWildCardOverrideIfMoved,
} from "../services/wildCardService.js";

const makeRoom = (originalType) => ({
  taskset: {
    _id: "ts-1",
    name: "Fractions Review",
    subject: "Math",
    gradeLevel: "5",
    topicTitle: "Fractions",
    vocabulary: ["numerator", "denominator"],
    tasks: [
      { taskType: originalType, title: "Original", prompt: "…", roundNumber: 4, order: 3 },
    ],
  },
});

describe("rollWildCard", () => {
  test("returns a task of a DIFFERENT type than the original", async () => {
    const room = makeRoom("multiple-choice");
    const team = { teamId: "t1" };
    const seenTypes = [];
    const regenSpy = ({ allowedType }) => {
      seenTypes.push(allowedType);
      return { taskType: allowedType, title: `Regenerated ${allowedType}`, prompt: "…" };
    };
    const r = await rollWildCard({
      room,
      team,
      taskIndex: 0,
      regenerateSingleTask: regenSpy,
    });
    expect(r.ok).toBe(true);
    expect(r.task.taskType).not.toBe("multiple-choice");
    expect(seenTypes[0]).not.toBe("multiple-choice");
  });

  test("stamps team.taskOverride on success", async () => {
    const room = makeRoom("true-false");
    const team = { teamId: "t2" };
    const regen = ({ allowedType }) => ({ taskType: allowedType, title: "R", prompt: "…" });
    await rollWildCard({ room, team, taskIndex: 0, regenerateSingleTask: regen });
    expect(team.taskOverride).toBeDefined();
    expect(team.taskOverride.taskIndex).toBe(0);
    expect(team.taskOverride.poweredBy).toBe("wild_card");
    expect(team.taskOverride.task.taskType).not.toBe("true-false");
  });

  test("preserves roundNumber + order on the replacement", async () => {
    const room = makeRoom("multiple-choice");
    const team = { teamId: "t3" };
    const regen = ({ allowedType }) => ({ taskType: allowedType, title: "R", prompt: "…" });
    const r = await rollWildCard({ room, team, taskIndex: 0, regenerateSingleTask: regen });
    expect(r.task.roundNumber).toBe(4);
    expect(r.task.order).toBe(3);
    expect(r.task._wildCardReplacement.originalType).toBe("multiple-choice");
    expect(r.task._wildCardReplacement.newType).toBeDefined();
  });

  test("falls through to next candidate when regen throws once", async () => {
    const room = makeRoom("multiple-choice");
    const team = { teamId: "t4" };
    let calls = 0;
    const flakyRegen = ({ allowedType }) => {
      calls += 1;
      if (calls === 1) throw new Error("LLM outage");
      return { taskType: allowedType, title: "R", prompt: "…" };
    };
    const r = await rollWildCard({ room, team, taskIndex: 0, regenerateSingleTask: flakyRegen });
    expect(r.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("returns ok:false when EVERY candidate fails", async () => {
    const room = makeRoom("multiple-choice");
    const team = { teamId: "t5" };
    const alwaysFail = () => { throw new Error("regen down"); };
    const r = await rollWildCard({ room, team, taskIndex: 0, regenerateSingleTask: alwaysFail });
    expect(r.ok).toBe(false);
    expect(team.taskOverride).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  test("returns ok:false when the task index is out of range", async () => {
    const room = makeRoom("multiple-choice");
    const team = { teamId: "t6" };
    const regen = () => ({ taskType: "true-false", title: "R", prompt: "…" });
    const r = await rollWildCard({ room, team, taskIndex: 99, regenerateSingleTask: regen });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no-task-at-index");
  });

  test("returns ok:false when there is no taskset", async () => {
    const r = await rollWildCard({
      room: {},
      team: {},
      taskIndex: 0,
      regenerateSingleTask: () => ({ taskType: "true-false", title: "R", prompt: "…" }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no-taskset");
  });
});

describe("clearWildCardOverrideIfMoved", () => {
  test("clears the override when the task index changes", () => {
    const team = { taskOverride: { taskIndex: 2, task: {} } };
    clearWildCardOverrideIfMoved(team, 3);
    expect(team.taskOverride).toBeNull();
  });

  test("leaves the override alone on the same index", () => {
    const team = { taskOverride: { taskIndex: 2, task: {} } };
    clearWildCardOverrideIfMoved(team, 2);
    expect(team.taskOverride).not.toBeNull();
  });

  test("no-op when no override is set", () => {
    const team = {};
    expect(() => clearWildCardOverrideIfMoved(team, 5)).not.toThrow();
  });
});
