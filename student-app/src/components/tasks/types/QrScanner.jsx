const SOCKET_URL = import.meta.env.VITE_API_URL;
const socket = io(SOCKET_URL);

// Physical pad colours, in station order
const COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
];

// Determine which station this device is,
// based on either the URL path (/red) or ?station=station-3
function getStationIdFromUrl() {
  // 1) Query param still supported: ?station=station-3
  const search = new URLSearchParams(window.location.search);
  const fromQuery = search.get("station");

  // 2) Path-based colour, e.g. https://curriculate.website/red
  //    Grab the last non-empty segment.
  const pathSegments = window.location.pathname
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean); // removes empty strings

  const fromPath = pathSegments[pathSegments.length - 1] || "";

  // Use query param if present, otherwise path segment
  const slug = (fromQuery || fromPath).toLowerCase();

  // If slug is a known colour, map it to a station-#
  if (COLORS.includes(slug)) {
    const idx = COLORS.indexOf(slug); // 0-based
    return `station-${idx + 1}`;      // station-1, station-2, ...
  }

  // If slug already looks like "station-3", just use it
  if (/^station-\d+$/.test(slug)) {
    return slug;
  }

  // Fallback: station-1
  return "station-1";
}

const STATION_ID = getStationIdFromUrl();
