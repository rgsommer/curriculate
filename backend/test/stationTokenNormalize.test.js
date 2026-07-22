// backend/test/stationTokenNormalize.test.js
//
// Phase 2b — QR payload token hardening. Guards that
// normalizeStationId() in student-app/src/utils/stationHelpers.js
// resolves token-based QR payloads to the correct station and still
// honors every legacy input format (color URL, plain color name,
// "station-N", numeric-only).

import { normalizeStationId } from "../../student-app/src/utils/stationHelpers.js";

// Sample stations from a live room broadcast.
const STATIONS = [
  { id: "station-1", color: "red",    qrToken: "ab12cd34ef56" },
  { id: "station-2", color: "blue",   qrToken: "112233445566" },
  { id: "station-3", color: "green",  qrToken: "778899aabbcc" },
  { id: "station-4", color: "yellow", qrToken: "abcabcabcabc" },
];

describe("normalizeStationId — token path (Phase 2b)", () => {
  test("resolves ?t=<token> URL to the matching station", () => {
    const raw = "https://play.curriculate.net/classroom/scan?t=ab12cd34ef56";
    const out = normalizeStationId(raw, STATIONS);
    expect(out.id).toBe("station-1");
    expect(out.color).toBe("red");
  });

  test("resolves &t=<token> in a query string", () => {
    const raw = "https://play.curriculate.net/scan?loc=cls&t=112233445566";
    const out = normalizeStationId(raw, STATIONS);
    expect(out.id).toBe("station-2");
    expect(out.color).toBe("blue");
  });

  test("resolves a bare hex token (12 chars)", () => {
    const out = normalizeStationId("778899aabbcc", STATIONS);
    expect(out.id).toBe("station-3");
    expect(out.color).toBe("green");
  });

  test("accepts stations as an object (not just array)", () => {
    const asObj = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
    const out = normalizeStationId("abcabcabcabc", asObj);
    expect(out.id).toBe("station-4");
    expect(out.color).toBe("yellow");
  });

  test("unknown token falls through to legacy parsing (URL with color)", () => {
    // Token-shaped hex not in the room → fall through. A URL with a
    // color segment should still parse.
    const raw = "https://play.curriculate.net/classroom/red";
    const out = normalizeStationId(raw, STATIONS);
    expect(out.id).toBe("station-1"); // legacy color routing preserved
    expect(out.color).toBe("red");
  });

  test("token-shaped input with no roomStations context falls through", () => {
    // Without room context, a hex string that looks like a token is NOT
    // a color name, so it goes to the default fallback. Use an
    // alphanumeric token so we don't collide with the legacy numeric-only
    // "station-N" shorthand.
    const out = normalizeStationId("ab12cd34ef56");
    expect(out.id).toBe("ab12cd34ef56"); // returned as-is (default fallback)
    expect(out.color).toBeNull();
  });

  test("case-insensitive token match", () => {
    const out = normalizeStationId("AB12CD34EF56", STATIONS);
    expect(out.id).toBe("station-1");
  });
});

describe("normalizeStationId — legacy inputs still work (regression)", () => {
  test("plain color name", () => {
    const out = normalizeStationId("red");
    expect(out.id).toBe("station-1");
  });

  test("station-N numeric", () => {
    const out = normalizeStationId("station-2");
    expect(out.id).toBe("station-2");
  });

  test("numeric only", () => {
    const out = normalizeStationId("3");
    expect(out.id).toBe("station-3");
  });

  test("URL with color segment", () => {
    const out = normalizeStationId("https://play.curriculate.net/classroom/blue");
    expect(out.id).toBe("station-2");
    expect(out.color).toBe("blue");
  });

  test("empty / null input returns not-assigned placeholder", () => {
    expect(normalizeStationId("").id).toBeNull();
    expect(normalizeStationId(null).id).toBeNull();
    expect(normalizeStationId(undefined).id).toBeNull();
  });
});
