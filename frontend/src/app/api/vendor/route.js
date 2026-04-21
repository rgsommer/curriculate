/**
 * GET /api/vendor?lib=jspdf|qrcode
 *
 * Proxies CDN scripts through our own domain so school/corporate firewalls
 * that block cdnjs.cloudflare.com don't break PDF generation.
 * Cached aggressively (1 year) since these are versioned, immutable files.
 */

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const PDFJS_JSR = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build";

const LIBS = {
  jspdf: [
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js",
  ],
  qrcode: [
    "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js",
    "https://unpkg.com/qrcode-generator@1.4.4/qrcode.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
  ],
  pdfjs: [
    `${PDFJS_JSR}/pdf.min.js`,
    `${PDFJS_CDN}/pdf.min.js`,
  ],
  "pdfjs-worker": [
    `${PDFJS_JSR}/pdf.worker.min.js`,
    `${PDFJS_CDN}/pdf.worker.min.js`,
  ],
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lib = searchParams.get("lib");

  const urls = LIBS[lib];
  if (!urls) {
    return new Response("Unknown lib", { status: 400 });
  }

  for (const url of urls) {
    try {
      const upstream = await fetch(url, { cache: "force-cache" });
      if (!upstream.ok) {
        console.warn(`[vendor proxy] ${url} returned ${upstream.status}`);
        continue;
      }

      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (err) {
      console.warn(`[vendor proxy] ${url} failed:`, err.message);
    }
  }

  return new Response("All upstream sources failed", { status: 502 });
}
