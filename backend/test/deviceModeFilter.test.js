// backend/test/deviceModeFilter.test.js
//
// Unit tests for shared/deviceModeFilter.js. Guards the contracts
// downstream code will lean on:
//   - universal tasks stay in every mode
//   - motion-blocked tasks drop out of laptop/mixed but stay in tablet
//   - unknown task types default to universal (no false positives)
//   - normalizeDeviceMode rescues bad input
//   - tasksetNeedsAdaptation returns false when the mode is
//     tablet_only (fast path in the launch flow)

import {
  filterTasksForDeviceMode,
  isTaskCompatibleWithMode,
  tasksetNeedsAdaptation,
  resolveDeviceCompat,
  supportedModesForTypeMeta,
} from "../../shared/deviceModeFilter.js";
import {
  DEVICE_MODES,
  DEVICE_CAPABILITIES,
  DEFAULT_DEVICE_COMPAT,
  ALL_DEVICE_MODES,
  normalizeDeviceMode,
  supportedModesForRequired,
} from "../../shared/deviceCapabilities.js";

const META = {
  "multiple-choice": {
    // Universal by default — no deviceCompat present.
  },
  "photo": {
    // File-picker fallback covers laptop; not gating.
  },
  "motion-mission": {
    deviceCompat: {
      requiredCapabilities: [DEVICE_CAPABILITIES.DEVICE_MOTION],
      supportedDeviceModes: [DEVICE_MODES.TABLET_ONLY],
      incompatibilityReason: "Needs a tablet that can detect motion.",
    },
  },
  "hole-in-one": {
    deviceCompat: {
      requiredCapabilities: [DEVICE_CAPABILITIES.DEVICE_MOTION],
      supportedDeviceModes: [DEVICE_MODES.TABLET_ONLY],
    },
  },
  "body-break": {
    deviceCompat: {
      requiredCapabilities: [DEVICE_CAPABILITIES.DEVICE_MOTION],
      supportedDeviceModes: [DEVICE_MODES.TABLET_ONLY],
    },
  },
  "treasure-runner": {
    deviceCompat: {
      // Motion is preferred (only the interstitial mini-game uses it),
      // so this stays playable in every mode.
      preferredCapabilities: [DEVICE_CAPABILITIES.DEVICE_MOTION],
      supportedDeviceModes: ALL_DEVICE_MODES,
    },
  },
};

const t = (type, extras = {}) => ({ type, ...extras });

describe("filterTasksForDeviceMode", () => {
  test("universal tasks pass every mode", () => {
    const tasks = [t("multiple-choice"), t("photo"), t("treasure-runner")];
    for (const mode of ALL_DEVICE_MODES) {
      const { compatible, incompatible } = filterTasksForDeviceMode(tasks, mode, META);
      expect(compatible).toHaveLength(3);
      expect(incompatible).toHaveLength(0);
    }
  });

  test("motion tasks stay in tablet_only, drop from laptop_only + mixed", () => {
    const tasks = [t("multiple-choice"), t("motion-mission"), t("hole-in-one"), t("body-break")];

    const tabletResult = filterTasksForDeviceMode(tasks, DEVICE_MODES.TABLET_ONLY, META);
    expect(tabletResult.compatible.map((x) => x.type)).toEqual([
      "multiple-choice",
      "motion-mission",
      "hole-in-one",
      "body-break",
    ]);
    expect(tabletResult.incompatible).toHaveLength(0);

    const laptopResult = filterTasksForDeviceMode(tasks, DEVICE_MODES.LAPTOP_ONLY, META);
    expect(laptopResult.compatible.map((x) => x.type)).toEqual(["multiple-choice"]);
    expect(laptopResult.incompatible.map((x) => x.task.type)).toEqual([
      "motion-mission",
      "hole-in-one",
      "body-break",
    ]);

    const mixedResult = filterTasksForDeviceMode(tasks, DEVICE_MODES.MIXED, META);
    // Per architecture decision: mixed == laptop_only for filtering.
    expect(mixedResult.compatible.map((x) => x.type)).toEqual(["multiple-choice"]);
    expect(mixedResult.incompatible.map((x) => x.task.type)).toEqual([
      "motion-mission",
      "hole-in-one",
      "body-break",
    ]);
  });

  test("incompatibility record carries reason + required capabilities", () => {
    const { incompatible } = filterTasksForDeviceMode(
      [t("motion-mission")],
      DEVICE_MODES.LAPTOP_ONLY,
      META,
    );
    expect(incompatible).toHaveLength(1);
    const rec = incompatible[0];
    expect(rec.task.type).toBe("motion-mission");
    expect(rec.reason).toBe("Needs a tablet that can detect motion.");
    expect(rec.requiredCapabilities).toEqual([DEVICE_CAPABILITIES.DEVICE_MOTION]);
  });

  test("falls back to auto-generated reason when meta omits incompatibilityReason", () => {
    const { incompatible } = filterTasksForDeviceMode(
      [t("hole-in-one")],
      DEVICE_MODES.LAPTOP_ONLY,
      META,
    );
    expect(incompatible[0].reason).toMatch(/tablet.*detect motion/i);
  });

  test("unknown task types default to universal (no false blocking)", () => {
    const tasks = [t("brand-new-type-nobody-registered")];
    const laptopResult = filterTasksForDeviceMode(tasks, DEVICE_MODES.LAPTOP_ONLY, META);
    expect(laptopResult.compatible).toHaveLength(1);
    expect(laptopResult.incompatible).toHaveLength(0);
  });

  test("null/undefined tasks input handled gracefully", () => {
    expect(filterTasksForDeviceMode(null, DEVICE_MODES.LAPTOP_ONLY, META)).toEqual({
      compatible: [],
      incompatible: [],
    });
    expect(filterTasksForDeviceMode(undefined, DEVICE_MODES.LAPTOP_ONLY, META)).toEqual({
      compatible: [],
      incompatible: [],
    });
  });

  test("supports task shape with taskType (alt field name)", () => {
    const alt = { taskType: "motion-mission" };
    const { incompatible } = filterTasksForDeviceMode([alt], DEVICE_MODES.LAPTOP_ONLY, META);
    expect(incompatible).toHaveLength(1);
  });
});

describe("isTaskCompatibleWithMode", () => {
  test("returns boolean without partitioning", () => {
    expect(isTaskCompatibleWithMode(t("multiple-choice"), DEVICE_MODES.LAPTOP_ONLY, META)).toBe(true);
    expect(isTaskCompatibleWithMode(t("motion-mission"), DEVICE_MODES.LAPTOP_ONLY, META)).toBe(false);
    expect(isTaskCompatibleWithMode(t("motion-mission"), DEVICE_MODES.TABLET_ONLY, META)).toBe(true);
  });
});

describe("tasksetNeedsAdaptation", () => {
  test("tablet_only always returns false (fast path)", () => {
    const tasks = [t("motion-mission"), t("hole-in-one"), t("body-break")];
    expect(tasksetNeedsAdaptation(tasks, DEVICE_MODES.TABLET_ONLY, META)).toBe(false);
  });

  test("laptop_only returns true when any incompatible task present", () => {
    expect(
      tasksetNeedsAdaptation([t("multiple-choice"), t("motion-mission")], DEVICE_MODES.LAPTOP_ONLY, META),
    ).toBe(true);
  });

  test("laptop_only returns false when all tasks compatible", () => {
    expect(
      tasksetNeedsAdaptation([t("multiple-choice"), t("photo"), t("treasure-runner")], DEVICE_MODES.LAPTOP_ONLY, META),
    ).toBe(false);
  });
});

describe("resolveDeviceCompat", () => {
  test("returns DEFAULT_DEVICE_COMPAT for unknown types", () => {
    const dc = resolveDeviceCompat(t("something-new"), META);
    expect(dc.supportedDeviceModes).toEqual(ALL_DEVICE_MODES);
    expect(dc.requiredCapabilities).toEqual([]);
  });

  test("merges partial deviceCompat over defaults", () => {
    const dc = resolveDeviceCompat(t("treasure-runner"), META);
    expect(dc.preferredCapabilities).toEqual([DEVICE_CAPABILITIES.DEVICE_MOTION]);
    expect(dc.requiredCapabilities).toEqual([]);
  });
});

describe("supportedModesForTypeMeta", () => {
  test("falls back to universal when no compat metadata", () => {
    expect(supportedModesForTypeMeta({})).toEqual(ALL_DEVICE_MODES);
    expect(supportedModesForTypeMeta(undefined)).toEqual(ALL_DEVICE_MODES);
  });

  test("returns explicit supportedDeviceModes when present", () => {
    expect(supportedModesForTypeMeta(META["motion-mission"])).toEqual([DEVICE_MODES.TABLET_ONLY]);
  });
});

describe("normalizeDeviceMode", () => {
  test("passes through valid modes", () => {
    for (const mode of ALL_DEVICE_MODES) {
      expect(normalizeDeviceMode(mode)).toBe(mode);
    }
  });

  test("returns tablet_only for unknown / non-string input", () => {
    expect(normalizeDeviceMode("something-else")).toBe(DEVICE_MODES.TABLET_ONLY);
    expect(normalizeDeviceMode(null)).toBe(DEVICE_MODES.TABLET_ONLY);
    expect(normalizeDeviceMode(undefined)).toBe(DEVICE_MODES.TABLET_ONLY);
    expect(normalizeDeviceMode(42)).toBe(DEVICE_MODES.TABLET_ONLY);
  });
});

describe("supportedModesForRequired", () => {
  test("empty requirements → all modes", () => {
    expect(supportedModesForRequired([])).toEqual(ALL_DEVICE_MODES);
    expect(supportedModesForRequired()).toEqual(ALL_DEVICE_MODES);
  });

  test("device_motion → tablet_only only", () => {
    expect(supportedModesForRequired([DEVICE_CAPABILITIES.DEVICE_MOTION])).toEqual([
      DEVICE_MODES.TABLET_ONLY,
    ]);
  });

  test("preferred-only capabilities (rear_camera) do not gate", () => {
    // Even though rear_camera is a preferred capability, if a hypothetical
    // task listed it as REQUIRED it still wouldn't hard-block on laptop —
    // it's not in the mode's blocker set.
    expect(supportedModesForRequired([DEVICE_CAPABILITIES.REAR_CAMERA])).toEqual(ALL_DEVICE_MODES);
  });
});
