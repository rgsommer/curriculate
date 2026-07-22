// backend/test/deviceModeSubstitute.test.js
//
// Unit tests for the silent substitution service. Guards contracts:
//   - tablet_only: no-op + restores any prior substitutions
//   - laptop_only + incompatible tasks: substitute via stubbed regen
//   - regen failure per-candidate: try the next candidate; drop only
//     when all candidates fail
//   - repeat mode changes: snapshot preserves the original, each pass
//     restores-then-substitutes cleanly
//   - substituted tasks carry the _deviceModeSubstituted marker

import { substituteTasksForRoom } from "../services/deviceModeSubstitute.js";

const makeRoom = (mode, tasks) => ({
  deviceMode: mode,
  taskset: {
    _id: "test-taskset",
    name: "Grade 5 Fractions Review",
    subject: "Math",
    gradeLevel: "5",
    topicTitle: "Fractions",
    vocabulary: ["numerator", "denominator", "equivalent"],
    tasks: [...tasks],
  },
});

const originalTask = (type) => ({
  taskType: type,
  title: `Original ${type}`,
  prompt: `Do the ${type}`,
});

// Success stub — returns a shaped multiple-choice-ish payload of the
// requested type so we can assert on the substituted content.
const okRegen = ({ allowedType }) => ({
  taskType: allowedType,
  title: `Regenerated ${allowedType}`,
  prompt: "Replacement content",
});

describe("substituteTasksForRoom", () => {
  test("tablet_only is a no-op even with motion tasks present", async () => {
    const room = makeRoom("tablet_only", [
      originalTask("multiple-choice"),
      originalTask("motion-mission"),
      originalTask("body-break"),
    ]);
    const before = JSON.parse(JSON.stringify(room.taskset.tasks));
    const { substitutionCount } = await substituteTasksForRoom(room, {
      regenerateSingleTask: okRegen,
    });
    expect(substitutionCount).toBe(0);
    expect(room.taskset.tasks).toEqual(before);
  });

  test("laptop_only replaces motion tasks with regen output", async () => {
    const room = makeRoom("laptop_only", [
      originalTask("multiple-choice"),
      originalTask("motion-mission"),
      originalTask("body-break"),
    ]);
    const calls = [];
    const spyRegen = (opts) => { calls.push(opts.allowedType); return okRegen(opts); };
    const { substitutionCount, log } = await substituteTasksForRoom(room, {
      regenerateSingleTask: spyRegen,
    });
    expect(substitutionCount).toBe(2);
    expect(log.every((e) => e.action === "substituted")).toBe(true);
    // Task 0 untouched, tasks 1 and 2 replaced
    expect(room.taskset.tasks[0].taskType).toBe("multiple-choice");
    expect(room.taskset.tasks[1].taskType).not.toBe("motion-mission");
    expect(room.taskset.tasks[2].taskType).not.toBe("body-break");
    // Marker fields present
    expect(room.taskset.tasks[1]._deviceModeSubstituted?.originalType).toBe("motion-mission");
    expect(room.taskset.tasks[2]._deviceModeSubstituted?.originalType).toBe("body-break");
  });

  test("falls through to the next candidate when regen throws once", async () => {
    let callNum = 0;
    const flakyRegen = (opts) => {
      callNum += 1;
      if (callNum === 1) throw new Error("LLM outage");
      return okRegen(opts);
    };
    const room = makeRoom("laptop_only", [originalTask("motion-mission")]);
    const { substitutionCount, log } = await substituteTasksForRoom(room, {
      regenerateSingleTask: flakyRegen,
    });
    expect(substitutionCount).toBe(1);
    expect(log[0].action).toBe("substituted");
    expect(callNum).toBeGreaterThanOrEqual(2);
  });

  test("drops the task from the sequence when ALL candidates fail", async () => {
    const alwaysFail = () => { throw new Error("regen down"); };
    const room = makeRoom("laptop_only", [
      originalTask("multiple-choice"),
      originalTask("motion-mission"),
      originalTask("multiple-choice"),
    ]);
    const originalLen = room.taskset.tasks.length;
    const { substitutionCount, log } = await substituteTasksForRoom(room, {
      regenerateSingleTask: alwaysFail,
    });
    expect(substitutionCount).toBe(1); // one log entry (the drop)
    expect(log[0].action).toBe("dropped");
    expect(room.taskset.tasks.length).toBe(originalLen - 1);
    // The two multiple-choice tasks are the only ones left
    expect(room.taskset.tasks.every((t) => t.taskType === "multiple-choice")).toBe(true);
  });

  test("preserves roundNumber + order on substituted tasks", async () => {
    const tasks = [
      { taskType: "motion-mission", title: "MM", roundNumber: 3, order: 2 },
    ];
    const room = makeRoom("laptop_only", tasks);
    await substituteTasksForRoom(room, { regenerateSingleTask: okRegen });
    expect(room.taskset.tasks[0].roundNumber).toBe(3);
    expect(room.taskset.tasks[0].order).toBe(2);
    expect(room.taskset.tasks[0]._deviceModeSubstituted).toBeDefined();
  });

  test("snapshot lets mode changes restore-then-resubstitute cleanly", async () => {
    const room = makeRoom("laptop_only", [
      originalTask("multiple-choice"),
      originalTask("motion-mission"),
    ]);
    // First pass: substitute
    await substituteTasksForRoom(room, { regenerateSingleTask: okRegen });
    expect(room.taskset.tasks[1]._deviceModeSubstituted).toBeDefined();
    // Flip to tablet_only: should restore the original taskset
    room.deviceMode = "tablet_only";
    await substituteTasksForRoom(room, { regenerateSingleTask: okRegen });
    expect(room.taskset.tasks[1].taskType).toBe("motion-mission");
    expect(room.taskset.tasks[1]._deviceModeSubstituted).toBeUndefined();
    // Flip back to laptop_only: should substitute again
    room.deviceMode = "laptop_only";
    await substituteTasksForRoom(room, { regenerateSingleTask: okRegen });
    expect(room.taskset.tasks[1]._deviceModeSubstituted).toBeDefined();
  });

  test("mixed mode behaves as laptop_only for filtering", async () => {
    const room = makeRoom("mixed", [
      originalTask("multiple-choice"),
      originalTask("hole-in-one"),
    ]);
    const { substitutionCount } = await substituteTasksForRoom(room, {
      regenerateSingleTask: okRegen,
    });
    expect(substitutionCount).toBe(1);
    expect(room.taskset.tasks[0].taskType).toBe("multiple-choice");
    expect(room.taskset.tasks[1].taskType).not.toBe("hole-in-one");
  });

  test("empty / missing taskset is a safe no-op", async () => {
    const room1 = { deviceMode: "laptop_only" }; // no taskset at all
    const result1 = await substituteTasksForRoom(room1, { regenerateSingleTask: okRegen });
    expect(result1.substitutionCount).toBe(0);

    const room2 = { deviceMode: "laptop_only", taskset: { tasks: [] } };
    const result2 = await substituteTasksForRoom(room2, { regenerateSingleTask: okRegen });
    expect(result2.substitutionCount).toBe(0);
  });

  test("no regen provided: motion tasks are dropped rather than substituted", async () => {
    const room = makeRoom("laptop_only", [
      originalTask("motion-mission"),
      originalTask("multiple-choice"),
    ]);
    // No `regenerateSingleTask` in deps.
    await substituteTasksForRoom(room, {});
    // With no regen available, dropping is the honest fallback.
    expect(room.taskset.tasks).toHaveLength(1);
    expect(room.taskset.tasks[0].taskType).toBe("multiple-choice");
  });
});
