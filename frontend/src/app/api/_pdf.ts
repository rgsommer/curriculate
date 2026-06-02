// Shared report-drawing helper for TeeBee deliverables (audit report, tax
// return, loan financing package). pdf-lib only — no native fonts, survives
// Vercel's serverless bundling. A small flowing "Report" drawer keeps the
// route code short: a y-cursor with automatic A4 page-breaks.
import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

export const COL = {
  navy: rgb(0.058, 0.172, 0.321),
  navyDeep: rgb(0.031, 0.113, 0.227),
  gold: rgb(0.788, 0.635, 0.152),
  ink: rgb(0.039, 0.101, 0.180),
  soft: rgb(0.278, 0.337, 0.412),
  muted: rgb(0.392, 0.455, 0.545),
  cream: rgb(0.984, 0.980, 0.965),
  white: rgb(1, 1, 1),
  goldSoft: rgb(0.996, 0.965, 0.863),
  line: rgb(0.9, 0.9, 0.9),
  subtle: rgb(0.6, 0.7, 0.83),
  redInk: rgb(0.498, 0.114, 0.114),
  amberInk: rgb(0.486, 0.176, 0.071),
  greenInk: rgb(0.078, 0.325, 0.176),
};

export function money(n: any): string {
  return "PGK " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function pct(f: any): string { return (Number(f || 0) * 100).toFixed(1) + "%"; }

// pdf-lib's standard fonts use WinAnsi, which can't encode math symbols like
// ≥ ≤ ×. Map the common ones to ASCII and drop anything else still outside the
// encodable set so a stray glyph never 500s a report.
const SUB: Record<string, string> = { "≥": ">=", "≤": "<=", "≈": "~", "≠": "!=", "×": "x", "÷": "/", "√": "v", "→": "->" };
export function clean(s: any): string {
  let t = String(s ?? "");
  for (const k in SUB) t = t.split(k).join(SUB[k]);
  return t.replace(/[^\x09\x0A\x0D\x20-\xFF–—‘’“”•…€™]/g, "?");
}

export async function startDoc(): Promise<{ pdf: any; reg: any; bold: any }> {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  return { pdf, reg, bold };
}

function wrap(page: any, font: any, size: number, color: any, text: string, x: number, y: number, maxW: number, lh: number): number {
  const words = clean(text).split(/\s+/);
  let line = ""; let cy = y;
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) > maxW && line) { page.drawText(line, { x, y: cy, size, font, color }); cy -= lh; line = w; }
    else line = t;
  }
  if (line) page.drawText(line, { x, y: cy, size, font, color });
  return cy - lh;
}

export class Report {
  pdf: any; reg: any; bold: any; page: any;
  W = 0; H = 0; y = 0; M = 48;
  constructor(pdf: any, reg: any, bold: any) { this.pdf = pdf; this.reg = reg; this.bold = bold; this.addPage(); }
  addPage() { this.page = this.pdf.addPage(PageSizes.A4); this.W = this.page.getWidth(); this.H = this.page.getHeight(); this.y = this.H; }
  ensure(h: number) { if (this.y - h < this.M + 26) this.addPage(); }
  gap(h = 10) { this.y -= h; }

  header(title: string, subtitle?: string) {
    const p = this.page;
    p.drawRectangle({ x: 0, y: this.H - 92, width: this.W, height: 92, color: COL.navy });
    p.drawText(clean(title), { x: this.M, y: this.H - 52, size: 22, font: this.bold, color: COL.gold });
    if (subtitle) p.drawText(clean(subtitle), { x: this.M, y: this.H - 74, size: 10.5, font: this.reg, color: COL.subtle });
    this.y = this.H - 92 - 26;
  }
  heading(text: string) {
    this.ensure(30);
    this.page.drawText(clean(text), { x: this.M, y: this.y, size: 13, font: this.bold, color: COL.ink });
    this.y -= 8;
    this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness: 1, color: COL.gold });
    this.y -= 16;
  }
  kv(label: string, value: any) {
    this.ensure(16);
    this.page.drawText(clean(label), { x: this.M, y: this.y, size: 10, font: this.reg, color: COL.muted });
    this.page.drawText(clean(value ?? "—"), { x: this.M + 150, y: this.y, size: 10, font: this.bold, color: COL.ink });
    this.y -= 16;
  }
  // money/value row, value right-aligned; rule adds a hairline under it
  row(label: string, value: any, opts: { bold?: boolean; rule?: boolean; color?: any } = {}) {
    this.ensure(16);
    const f = opts.bold ? this.bold : this.reg;
    this.page.drawText(clean(label), { x: this.M, y: this.y, size: 10, font: f, color: opts.bold ? COL.ink : COL.soft });
    const v = clean(value ?? "");
    const vw = f.widthOfTextAtSize(v, 10);
    this.page.drawText(v, { x: this.W - this.M - vw, y: this.y, size: 10, font: f, color: opts.color || COL.ink });
    this.y -= 15;
    if (opts.rule) { this.page.drawLine({ start: { x: this.M, y: this.y + 5 }, end: { x: this.W - this.M, y: this.y + 5 }, thickness: 0.5, color: COL.line }); this.y -= 4; }
  }
  para(text: string, size = 10, color: any = COL.soft) {
    this.ensure(size + 8);
    this.y = wrap(this.page, this.reg, size, color, text, this.M, this.y, this.W - 2 * this.M, size + 4);
    this.y -= 6;
  }
  // wrapped text at the cursor in an explicit font/size/colour
  flow(text: string, size: number, font: any, color: any) {
    this.ensure(size + 6);
    this.y = wrap(this.page, font, size, color, text, this.M, this.y, this.W - 2 * this.M, size + 4);
    this.y -= 4;
  }
  // a small uppercase tag (e.g. a severity / band label)
  tag(text: string, color: any) {
    this.ensure(13);
    this.page.drawText(clean(text), { x: this.M, y: this.y, size: 8, font: this.bold, color });
    this.y -= 12;
  }
  finalize(footerText: string): Promise<Uint8Array> {
    const pages = this.pdf.getPages();
    const ft = clean(footerText);
    for (const p of pages) {
      const w = this.reg.widthOfTextAtSize(ft, 8);
      p.drawText(ft, { x: (p.getWidth() - w) / 2, y: 28, size: 8, font: this.reg, color: COL.muted });
    }
    return this.pdf.save();
  }
}

export function pdfHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
}
