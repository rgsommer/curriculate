// backend/config/currentEventsExcludedPublishers.js
//
// Publisher exclusion list for the Current Events Connection task type.
// Defined in CURRENT_EVENTS_PLAN.md §0.7 and §6c.
//
// At resolution time:
//   - The web-search prompt INSTRUCTS the model to avoid these sources.
//   - After the fact, `isExcludedPublisher(url)` filters any story whose
//     hostname (or any parent domain) matches an entry.
//
// Edit this list without a deploy via the optional env overrides:
//   CURRENT_EVENTS_EXCLUDED_PUBLISHERS_ADD="example.com,foo.net"
//   CURRENT_EVENTS_EXCLUDED_PUBLISHERS_REMOVE="bbc.co.uk"

const BASE_EXCLUDED = [
  "cbc.ca",
  "bbc.com",
  "bbc.co.uk",
  "cbsnews.com",
  "cbs.com",
  "msnbc.com",
  "nbcnews.com",
  "npr.org",
  "cnn.com",
];

function _envList(name) {
  const v = process.env[name];
  if (!v) return [];
  return String(v).split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const _added   = _envList("CURRENT_EVENTS_EXCLUDED_PUBLISHERS_ADD");
const _removed = new Set(_envList("CURRENT_EVENTS_EXCLUDED_PUBLISHERS_REMOVE"));

export const EXCLUDED_PUBLISHERS = Array.from(
  new Set([...BASE_EXCLUDED, ..._added].filter((d) => !_removed.has(d.toLowerCase()))),
);

export function isExcludedPublisher(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return EXCLUDED_PUBLISHERS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export default { EXCLUDED_PUBLISHERS, isExcludedPublisher };
