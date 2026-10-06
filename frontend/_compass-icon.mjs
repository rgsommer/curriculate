// Generates the Compass home-screen icons (iOS apple-touch + Android/manifest).
// Full-bleed slate square; the compass sits inside the central ~70% so the
// Android "maskable" crop (circle/squircle) never clips it.
import sharp from "sharp";
const out = process.argv[2];
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#e2e8f0" stroke-width="16"/>
  <g stroke="#94a3b8" stroke-width="10" stroke-linecap="round">
    <line x1="256" y1="118" x2="256" y2="140"/><line x1="256" y1="372" x2="256" y2="394"/>
    <line x1="118" y1="256" x2="140" y2="256"/><line x1="372" y1="256" x2="394" y2="256"/>
  </g>
  <g transform="rotate(35 256 256)">
    <polygon points="256,128 290,256 222,256" fill="#ef4444"/>
    <polygon points="256,384 290,256 222,256" fill="#f8fafc"/>
  </g>
  <circle cx="256" cy="256" r="18" fill="#0f172a" stroke="#f8fafc" stroke-width="8"/>
</svg>`;
const buf = Buffer.from(svg);
await sharp(buf).resize(512, 512).png().toFile(`${out}/compass-icon-512.png`);
await sharp(buf).resize(192, 192).png().toFile(`${out}/compass-icon-192.png`);
await sharp(buf).resize(180, 180).flatten({ background: "#0f172a" }).png().toFile(`${out}/compass-apple-touch-icon.png`);
console.log("icons written");
