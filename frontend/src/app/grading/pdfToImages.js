// frontend/src/app/grading/pdfToImages.js
//
// Render the pages of a PDF to JPEG data URLs in the browser.
//
// Homework Check takes photographs of pages, but an answer key or a textbook
// page usually exists as a PDF already — and telling a teacher to "export the
// key pages as images" is asking them to do by hand what the browser can do
// here. pdf.js is loaded from the same proxied/CDN sources BatchGrading uses,
// so there is no new dependency and no new failure mode.

const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const PDFJS_JSR = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build";
const PDFJS_URLS = [
  "/api/vendor?lib=pdfjs",
  `${PDFJS_JSR}/pdf.min.js`,
  `${PDFJS_CDN}/pdf.min.js`,
];
const PDFJS_WORKER_URLS = [
  "/api/vendor?lib=pdfjs-worker",
  `${PDFJS_JSR}/pdf.worker.min.js`,
  `${PDFJS_CDN}/pdf.worker.min.js`,
];

let pdfjsPromise = null;

export function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR"));
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URLS[0];
      return resolve(window.pdfjsLib);
    }
    let idx = 0;
    function tryNext() {
      if (idx >= PDFJS_URLS.length) {
        pdfjsPromise = null; // let a later attempt retry rather than cache the failure
        reject(new Error("Could not load the PDF reader."));
        return;
      }
      const script = document.createElement("script");
      script.src = PDFJS_URLS[idx];
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URLS[idx] || PDFJS_WORKER_URLS[0];
          resolve(window.pdfjsLib);
        } else { idx++; tryNext(); }
      };
      script.onerror = () => { idx++; tryNext(); };
      document.head.appendChild(script);
    }
    tryNext();
  });
  return pdfjsPromise;
}

export function isPdf(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

/**
 * Render a PDF File to JPEG data URLs, one per page.
 *
 * `maxEdge` caps the long side so a 300-dpi scan doesn't become a 20 MB data
 * URL per page — the same ceiling the photo path downscales to. `maxPages`
 * stops a whole textbook being turned into images by accident; the caller is
 * told how many were skipped rather than silently losing them.
 */
export async function pdfToDataUrls(file, { maxEdge = 2000, maxPages = 40, onProgress } = {}) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const total = pdf.numPages;
  const take = Math.min(total, maxPages);
  const urls = [];

  for (let n = 1; n <= take; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // Scale so the long edge lands on maxEdge, but never blow up a small page.
    const scale = Math.min(maxEdge / Math.max(base.width, base.height), 3);
    const viewport = page.getViewport({ scale: Math.max(scale, 1) });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    // PDFs have no background of their own; without this, anything transparent
    // renders black and the page reads as an unreadable photo.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    urls.push(canvas.toDataURL("image/jpeg", 0.85));
    onProgress?.(n, take);
  }

  try { await pdf.destroy(); } catch {}
  return { dataUrls: urls, pageCount: total, skipped: Math.max(0, total - take) };
}
