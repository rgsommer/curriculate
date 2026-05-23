// shared/diffDetectiveScene.js
//
// Deterministic "spot the difference" scene generator for diff-detective.
//
// The task generator supplies only a SCENE SPEC (a short list of topic-relevant
// labels). From that spec this module deterministically renders TWO SVG images
// — Scene A and Scene B — where B is A with exactly N controlled differences,
// and returns an EXACT answer key. This keeps diff-detective fully
// generated/ready-to-play (no curation, no external image URLs) while
// guaranteeing the differences are real and spottable.
//
// Output images are inline SVG data URIs (text + shapes only — no emoji — so
// they render reliably inside <img src=…>). Pure JS, no framework deps.

const TILE_COLORS = [
  "#bfdbfe", "#bbf7d0", "#fde68a", "#fecaca",
  "#ddd6fe", "#a5f3fc", "#fed7aa", "#f9a8d4",
];

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function svgToDataUri(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const CELL_W = 172;
const CELL_H = 124;
const PAD = 18;

function renderScene(items, cols, title) {
  const rows = Math.ceil(items.length / cols);
  const headerH = title ? 34 : 0;
  const width = cols * CELL_W + PAD * 2;
  const height = rows * CELL_H + PAD * 2 + headerH;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">`
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>`);
  if (title) {
    parts.push(
      `<text x="${width / 2}" y="${PAD + 18}" text-anchor="middle" font-size="18" font-weight="800" fill="#0f172a">${escapeXml(title)}</text>`
    );
  }

  items.forEach((it, i) => {
    if (it.hidden) return; // removed in this scene — leave the cell empty
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = PAD + col * CELL_W + CELL_W / 2;
    const cy = PAD + headerH + row * CELL_H + CELL_H / 2;
    const scale = it.scale || 1;
    const tw = (CELL_W - 24) * scale;
    const th = (CELL_H - 28) * scale;
    const x = cx - tw / 2;
    const y = cy - th / 2;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="16" fill="${it.color}" stroke="#0f172a" stroke-opacity="0.18" stroke-width="2"/>`
    );
    const fontSize = Math.max(13, Math.round(17 * scale));
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(cy + fontSize / 3).toFixed(1)}" text-anchor="middle" font-size="${fontSize}" font-weight="800" fill="#0f172a">${escapeXml(it.label)}</text>`
    );
    if (it.badge) {
      parts.push(
        `<text x="${(x + tw - 10).toFixed(1)}" y="${(y + 22).toFixed(1)}" text-anchor="middle" font-size="22" fill="#f59e0b">${"★"}</text>`
      );
    }
  });

  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * Build a deterministic spot-the-difference pair from a list of labels.
 * @param {string[]} labels - topic-relevant scene items (1-2 words each)
 * @param {string} seedStr - stable seed (e.g. the task title) so a given task
 *   always renders the same pair
 * @returns {{ imageA, imageB, differences, totalDifferences, labelA, labelB }}
 */
export function buildDiffScene(labels, seedStr = "diff") {
  const clean = (Array.isArray(labels) ? labels : [])
    .map((l) => String(l || "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const n = clean.length;
  if (n < 3) return null; // not enough to make a meaningful scene

  const cols = n <= 4 ? Math.max(2, n) : 4;
  const itemsA = clean.map((label, i) => ({
    label,
    color: TILE_COLORS[i % TILE_COLORS.length],
    hidden: false,
    scale: 1,
    badge: false,
  }));

  const rnd = mulberry32(hashStr(seedStr));
  // Choose distinct items to alter (up to 5).
  const order = clean.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const diffCount = Math.min(5, n);
  const chosen = order.slice(0, diffCount);

  const itemsB = itemsA.map((it) => ({ ...it }));
  const differences = [];
  const ops = ["remove", "recolor", "enlarge", "badge", "shrink"];

  chosen.forEach((idx, k) => {
    const op = ops[k % ops.length];
    const it = itemsB[idx];
    const label = it.label;
    if (op === "remove") {
      it.hidden = true;
      differences.push({ expected: `"${label}" is missing in Scene B` });
    } else if (op === "recolor") {
      it.color = TILE_COLORS[(idx + 3) % TILE_COLORS.length];
      differences.push({ expected: `"${label}" is a different color in Scene B` });
    } else if (op === "enlarge") {
      it.scale = 1.35;
      differences.push({ expected: `"${label}" is larger in Scene B` });
    } else if (op === "badge") {
      it.badge = true;
      differences.push({ expected: `"${label}" has a ★ marker in Scene B` });
    } else if (op === "shrink") {
      it.scale = 0.68;
      differences.push({ expected: `"${label}" is smaller in Scene B` });
    }
  });

  return {
    imageA: svgToDataUri(renderScene(itemsA, cols, "Scene A")),
    imageB: svgToDataUri(renderScene(itemsB, cols, "Scene B")),
    differences,
    totalDifferences: differences.length,
    labelA: "Scene A",
    labelB: "Scene B",
  };
}

export default buildDiffScene;
