// src/utils/stationColors.ts

export type StationColor =
  | "red"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "purple"
  | "pink"
  | "teal";

export const STATION_COLORS: StationColor[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "teal",
];

export const COLOR_HEX: Record<StationColor, string> = {
  red: "#e53935",
  blue: "#1e88e5",
  green: "#43a047",
  yellow: "#fdd835",
  orange: "#fb8c00",
  purple: "#8e24aa",
  pink: "#d81b60",
  teal: "#00897b",
};

export function extractColorFromUrl(raw: string): StationColor | null {
  try {
    const url = new URL(raw);
    const path = url.pathname.toLowerCase(); // e.g. "/red"
    const segments = path.split("/").filter(Boolean); // ["red"]
    if (!segments.length) return null;
    const last = segments[segments.length - 1]; // "red"
    if (STATION_COLORS.includes(last as StationColor)) {
      return last as StationColor;
    }
    return null;
  } catch {
    // If it's not a valid URL, try a looser match: endsWith("/red") etc.
    const lowered = raw.toLowerCase();
    for (const c of STATION_COLORS) {
      if (lowered.endsWith("/" + c)) return c;
    }
    return null;
  }
}
