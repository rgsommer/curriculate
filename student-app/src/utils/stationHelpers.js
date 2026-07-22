// student-app/src/utils/stationHelpers.js
import { COLORS } from "@shared/colors.js";

const COLOR_NAMES = COLORS;

/**
 * Normalize a human-readable location into a slug like "room-12"
 */
export function normalizeLocationSlug(raw) {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Parse a station ID in various formats and return normalized info.
 *
 * When `roomStations` is provided (array or object of station records
 * from `roomState.stations`), token-based QRs are honored: a scanned
 * payload containing `?t=<hex>` (or a raw 6–16-char hex token) is
 * resolved to the matching station by qrToken. This is Phase 2b of the
 * Device Mode Support feature — see docs/device-mode-architecture.md
 * §4.5. Legacy color URLs and plain color names still work so already-
 * printed classroom posters keep functioning.
 */
export function normalizeStationId(raw, roomStations = null) {
  if (!raw) {
    return { id: null, color: null, label: "Not assigned yet" };
  }

  const s = String(raw).trim();
  let lower = s.toLowerCase();

  // Phase 2b — token-based QR payload (opaque per-station token).
  // Two accepted shapes:
  //   • URL with ?t=<hex>   e.g. https://play.curriculate.net/scan?t=ab12cd34
  //   • bare hex string     e.g. "ab12cd34ef56"
  // Both cases require roomStations context to resolve; without it we
  // fall through and let the legacy color/URL parsers try.
  if (roomStations) {
    const stationList = Array.isArray(roomStations)
      ? roomStations
      : Object.values(roomStations);

    // Case: ?t=<token> or &t=<token>
    let token = null;
    const urlToken = s.match(/[?&]t=([a-f0-9]{6,32})\b/i);
    if (urlToken) token = urlToken[1].toLowerCase();
    // Case: bare hex string of a plausible token length
    else if (/^[a-f0-9]{6,32}$/i.test(s)) token = s.toLowerCase();

    if (token) {
      const match = stationList.find(
        (st) => String(st?.qrToken || "").toLowerCase() === token
      );
      if (match) {
        const numMatch = String(match.id || "").match(/^station-(\d+)$/);
        const num = numMatch ? numMatch[1] : null;
        const color = match.color || (num ? COLOR_NAMES[parseInt(num, 10) - 1] : null);
        return {
          id: match.id || (num ? `station-${num}` : s),
          color: color || null,
          label: color
            ? `Station-${color[0].toUpperCase()}${color.slice(1)}`
            : String(match.id || s).toUpperCase(),
        };
      }
      // Token-shaped but no match — keep going so a legacy-colour URL
      // with a token-shaped path segment still resolves.
    }
  }

  // Case 1: full numeric id: "station-1", "station-2", ...
  let m = /^station-(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const color = COLOR_NAMES[idx] || null;
    return {
      id: `station-${m[1]}`,
      color,
      label: color
        ? `Station-${color[0].toUpperCase()}${color.slice(1)}`
        : `Station-${m[1]}`,
    };
  }

  // Case 2: numeric only: "1", "2", ...
  m = /^(\d+)$/.exec(lower);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const color = COLOR_NAMES[idx] || null;
    return {
      id: `station-${m[1]}`,
      color,
      label: color
        ? `Station-${color[0].toUpperCase()}${color.slice(1)}`
        : `Station-${m[1]}`,
    };
  }

  // Case 3: colour name: "red", "blue", ...
  const colourIdx = COLOR_NAMES.indexOf(lower);
  if (colourIdx >= 0) {
    return {
      id: `station-${colourIdx + 1}`,
      color: lower,
      label: `Station-${lower[0].toUpperCase()}${lower.slice(1)}`,
    };
  }

  // Case 4: "station-red", "station-blue", ...
  m = /^station-(\w+)$/.exec(lower);
  if (m && COLOR_NAMES.includes(m[1])) {
    const colourIdx2 = COLOR_NAMES.indexOf(m[1]) + 1;
    return {
      id: `station-${colourIdx2}`,
      color: m[1],
      label: `Station-${m[1][0].toUpperCase()}${m[1].slice(1)}`,
    };
  }

  // Case 5: URL that contains a color segment like ".../red"
  const colorRegex = new RegExp(
    `(?:^|[\\/\\?#&=])(${COLOR_NAMES.join("|")})(?:$|[\\/\\?#&=])`,
    "i"
  );
  const cm = lower.match(colorRegex);
  if (cm) {
    const c = cm[1].toLowerCase();
    const idx = COLOR_NAMES.indexOf(c);
    return {
      id: `station-${idx + 1}`,
      color: c,
      label: `Station-${c[0].toUpperCase()}${c.slice(1)}`,
    };
  }

  // Default fallback
  return { id: s, color: null, label: s.toUpperCase() };
}

/**
 * Convert a room label to title case
 */
export function titleCaseRoom(label) {
  const s = (label || "").toString().trim();
  if (!s) return "CLASSROOM";
  return s.toUpperCase();
}

/**
 * Display a room name, preferring teacher-provided labels
 */
export function displayRoomFromSlugOrLabel(loc, selectedRooms) {
  // if teacher provided "Upper Hallway", show that; otherwise fall back to slug-ish text
  const cleaned = (loc || "").toString().trim();
  if (!cleaned) return "CLASSROOM";

  const found =
    (selectedRooms || []).find((r) => r.toLowerCase() === cleaned.toLowerCase()) ||
    null;

  // if it's already a nice label, use it; else make slug more readable
  const label = found || cleaned.replace(/[-_]/g, " ").replace(/\s+/g, " ");
  return titleCaseRoom(label);
}

/**
 * Get background and text color for a station bubble by color name
 */
export function getStationBubbleStyles(colorName) {
  // Default pale yellow & dark text when no station colour yet
  if (!colorName) {
    return {
      background: "#fef9c3",
      color: "#111827",
    };
  }

  const COLOR_MAP = {
    red: "#ef4444",
    blue: "#3b82f6",
    green: "#22c55e",
    yellow: "#eab308",
    purple: "#a855f7",
    orange: "#f97316",
    teal: "#14b8a6",
    pink: "#ec4899",
  };

  const bg = COLOR_MAP[colorName] || "#fef9c3";

  // Light-ish colours → dark text; dark colours → white text
  const lightColours = ["yellow", "orange", "teal", "pink"];
  const isLight = lightColours.includes(colorName);

  return {
    background: bg,
    color: isLight ? "#111827" : "#ffffff",
  };
}
