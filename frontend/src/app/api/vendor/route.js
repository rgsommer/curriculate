/**
 * GET /api/vendor?lib=jspdf|qrcode
 *
 * Proxies CDN scripts through our own domain so school/corporate firewalls
 * that block cdnjs.cloudflare.com don't break PDF generation.
 * Cached aggressively (1 year) since these are versioned, immutable files.
 */

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

const LIBS = {
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js",
  qrcode: "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
  pdfjs: `${PDFJS_CDN}/pdf.min.js`,
  "pdfjs-worker": `${PDFJS_CDN}/pdf.worker.min.js`,
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lib = searchParams.get("lib");

  const url = LIBS[lib];
  if (!url) {
    return new Response("Unknown lib", { status: 400 });
  }

  try {
    const upstream = await fetch(url, { next: { revalidate: 86400 * 365 } });
    if (!upstream.ok) {
      return new Response("Upstream fetch failed", { status: 502 });
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
    console.error("[vendor proxy]", err);
    return new Response("Fetch error", { status: 502 });
  }
}
