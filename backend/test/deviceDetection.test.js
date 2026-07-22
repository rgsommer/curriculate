// backend/test/deviceDetection.test.js
//
// Unit tests for the student-app device detection helper's exported
// pure fns. The async detectClientDeviceInfo() needs a real window
// so we don't cover it here (that's e2e territory); we DO cover the
// preferredFacingModeFor() decision tree which drives the QrScanner
// facingMode fallback.

import { preferredFacingModeFor } from "../../student-app/src/utils/deviceDetection.js";

describe("preferredFacingModeFor", () => {
  test("tablet with rear camera prefers environment (rear)", () => {
    expect(preferredFacingModeFor("tablet_only", {
      deviceType: "tablet",
      cameraFacingModes: ["environment", "user"],
    })).toBe("environment");
  });

  test("laptop with only front camera prefers user (webcam)", () => {
    expect(preferredFacingModeFor("laptop_only", {
      deviceType: "laptop",
      cameraFacingModes: ["user"],
    })).toBe("user");
  });

  test("laptop_only mode with unknown cameras still prefers user", () => {
    expect(preferredFacingModeFor("laptop_only", {
      deviceType: "laptop",
      cameraFacingModes: [],
    })).toBe("user");
  });

  test("laptop with rear cam accessible prefers environment (rear beats webcam)", () => {
    // Some Chromebooks have both — prefer the rear one if the room
    // supports rear-cam tasks.
    expect(preferredFacingModeFor("laptop_only", {
      deviceType: "laptop",
      cameraFacingModes: ["environment", "user"],
    })).toBe("environment");
  });

  test("mixed mode w/ rear cam prefers rear; falls back gracefully", () => {
    expect(preferredFacingModeFor("mixed", {
      deviceType: "tablet",
      cameraFacingModes: ["environment"],
    })).toBe("environment");
    expect(preferredFacingModeFor("mixed", {
      deviceType: "laptop",
      cameraFacingModes: ["user"],
    })).toBe("user");
  });

  test("returns null when no cameras + non-laptop mode (scanner will try any-camera constraint)", () => {
    expect(preferredFacingModeFor("tablet_only", {
      deviceType: "tablet",
      cameraFacingModes: [],
    })).toBeNull();
  });

  test("handles missing clientDeviceInfo gracefully", () => {
    expect(preferredFacingModeFor("tablet_only", null)).toBeNull();
    expect(preferredFacingModeFor("laptop_only", null)).toBe("user");
    expect(preferredFacingModeFor("mixed", undefined)).toBeNull();
  });
});
