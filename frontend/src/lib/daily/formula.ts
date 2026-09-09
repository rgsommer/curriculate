/**
 * A small Google Sheets formula evaluator.
 *
 * The board already re-computes a handful of the sheet's NOW()-driven rules by
 * hand (the greeting, the verse, the status code) so the time scrubber moves
 * them. That does not scale: the E1 slot table in Setup carries its own timing
 * formulas — "show the memory verse for the first ten minutes of CE, but the
 * picture in S2 on the last teaching day of the week" — and reading their
 * results means reading them at the sheet's clock, not the board's, so the
 * scrubber saw whatever was true at the moment of the read.
 *
 * So the formulas are evaluated here instead, with NOW() bound to the time on
 * the board. Anything this evaluator does not understand throws, and the caller
 * falls back to the value the sheet computed — the behaviour before this
 * existed, so a formula out of its depth costs nothing.
 */

export class FormulaError extends Error {}

export type Grid = {
  top: number; // 1-based row of values[0]
  left: number; // 1-based column of values[0][0]
  width: number; // columns the range covers, whether or not they carry a value
  height: number; // rows the range covers, likewise
  values: string[][];
  formulas?: string[][];
};

/** The ranges the board holds, by tab name. */
export type Book = Record<string, Grid[]>;

export type Ctx = {
  book: Book;
  now: Date; // the board's clock — the scrubbed time, not the read time
  sheet?: string; // the tab an unqualified reference belongs to
};

type Matrix = Val[][];
type Val = string | number | boolean | null | Matrix;

const isMatrix = (v: Val): v is Matrix => Array.isArray(v);

/* ------------------------------------------------------------------ *
 * Serial numbers
 *
 * Sheets counts days from 1899-12-30, with the time of day as the fraction,
 * which is what makes TIMEVALUE(NOW()) a number between 0 and 1 and lets the
 * sheet compare it against TIMEVALUE("11:55").
 * ------------------------------------------------------------------ */

const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function toSerial(d: Date): number {
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (local - EPOCH) / DAY_MS;
}

/** "11:55", "3:25 PM", "15:25:00" → the fraction of a day. */
function timeSerial(s: string): number {
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) throw new FormulaError(`not a time: ${s}`);
  let h = parseInt(m[1], 10);
  const ap = (m[4] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return (h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10)) / 86_400;
}

/* ------------------------------------------------------------------ *
 * References
 * ------------------------------------------------------------------ */

export function colToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const IMAGE_IN_FORMULA = /=\s*IMAGE\s*\(\s*"([^"]+)"/i;
const LINK_IN_FORMULA = /=\s*HYPERLINK\s*\(\s*"([^"]+)"/i;

/**
 * One cell, as the board can see it.
 *
 * An =IMAGE() cell has no text value at all, so a rule that hands a picture
 * cell on would come back empty; the URL inside the formula stands in for it.
 */
function cellAt(ctx: Ctx, sheet: string, row: number, col: number): string {
  const grids = ctx.book[sheet.toLowerCase()];
  if (!grids || !grids.length) throw new FormulaError(`no data for ${sheet}`);
  for (const g of grids) {
    const r = row - g.top;
    const c = col - g.left;
    // Sheets drops trailing empties, so the range's own shape decides what a
    // grid covers — not how many values came back. Without that, a reference to
    // Setup!M4 landed in the A1:F20 grid and read as blank.
    if (r < 0 || c < 0 || r >= g.height || c >= g.width) continue;
    const value = String(((g.values[r] || [])[c] ?? "")).trim();
    if (value) return value;
    const formula = String((((g.formulas || [])[r] || [])[c] ?? "")).trim();
    const pic = formula.match(IMAGE_IN_FORMULA) || formula.match(LINK_IN_FORMULA);
    return pic ? pic[1] : "";
  }
  throw new FormulaError(`${sheet}!${row}/${col} is outside what the board reads`);
}

/** The tallest row a tab's grids reach, so a whole-column reference can stop. */
function sheetBottom(ctx: Ctx, sheet: string): number {
  const grids = ctx.book[sheet.toLowerCase()] || [];
  return grids.reduce((n, g) => Math.max(n, g.top + g.height - 1), 0);
}

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

type Tok = { kind: "num" | "str" | "op" | "name" | "ref"; text: string };

const REF = String.raw`(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!\$?[A-Za-z]{1,3}(?:\$?\d+)?(?::\$?[A-Za-z]{1,3}\$?\d*)?|\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?`;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '"') {
      let j = i + 1;
      let text = "";
      while (j < s.length) {
        if (s[j] === '"' && s[j + 1] === '"') { text += '"'; j += 2; continue; }
        if (s[j] === '"') break;
        text += s[j];
        j += 1;
      }
      if (j >= s.length) throw new FormulaError("unterminated string");
      out.push({ kind: "str", text });
      i = j + 1;
      continue;
    }
    if (/[\d.]/.test(ch) && !(ch === "." && !/\d/.test(s[i + 1] || ""))) {
      const m = s.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?%?/);
      if (m) { out.push({ kind: "num", text: m[0] }); i += m[0].length; continue; }
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { out.push({ kind: "op", text: two }); i += 2; continue; }
    if ("+-*/^&=<>(),;%{}:".includes(ch)) { out.push({ kind: "op", text: ch }); i += 1; continue; }
    // A reference first: "Setup!V3", "M:M", "V3" — otherwise a function name.
    const ref = s.slice(i).match(new RegExp(`^(?:${REF})(?![A-Za-z0-9_(])`));
    if (ref) { out.push({ kind: "ref", text: ref[0] }); i += ref[0].length; continue; }
    const name = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (name) { out.push({ kind: "name", text: name[0] }); i += name[0].length; continue; }
    throw new FormulaError(`unexpected character ${ch}`);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Coercion
 * ------------------------------------------------------------------ */

const TIME_LIKE = /^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?$/;

function single(v: Val): string | number | boolean | null {
  if (isMatrix(v)) {
    const first = (v[0] || [])[0];
    return first === undefined ? null : (first as string | number | boolean | null);
  }
  return v;
}

function toNum(v: Val): number {
  const x = single(v);
  if (x === null || x === "") return 0;
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  const t = String(x).trim().replace(/,/g, "");
  // A time first: parseFloat is happy to read "15:25:00" as 15, which put the
  // afternoon cut-off a day and a half out.
  if (TIME_LIKE.test(t)) return timeSerial(t);
  const pct = /%$/.test(t);
  const n = parseFloat(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n)) throw new FormulaError(`not a number: ${t}`);
  return pct ? n / 100 : n;
}

function toStr(v: Val): string {
  const x = single(v);
  if (x === null) return "";
  if (typeof x === "boolean") return x ? "TRUE" : "FALSE";
  return String(x);
}

function toBool(v: Val): boolean {
  const x = single(v);
  if (typeof x === "boolean") return x;
  if (x === null || x === "") return false;
  if (typeof x === "number") return x !== 0;
  const t = String(x).trim().toUpperCase();
  if (t === "TRUE") return true;
  if (t === "FALSE") return false;
  return toNum(x) !== 0;
}

/**
 * Whether a value should be compared as a number.
 *
 * A time counts: the sheet writes its cut-offs as plain times ("15:25:00" in
 * O4) and compares them against TIMEVALUE(NOW()). Compared as text, "0.65" sorts
 * before "15:25:00" and the afternoon never ends.
 */
function looksNumeric(v: Val): boolean {
  const x = single(v);
  if (typeof x === "number" || typeof x === "boolean") return true;
  if (x === null) return false;
  const t = String(x).trim();
  return /^-?[\d.,]+%?$/.test(t) || TIME_LIKE.test(t);
}

function compare(a: Val, b: Val, op: string): boolean {
  const bothNumeric = looksNumeric(a) && looksNumeric(b);
  const x: number | string = bothNumeric ? toNum(a) : toStr(a).toLowerCase();
  const y: number | string = bothNumeric ? toNum(b) : toStr(b).toLowerCase();
  switch (op) {
    case "=": return x === y;
    case "<>": return x !== y;
    case "<": return x < y;
    case "<=": return x <= y;
    case ">": return x > y;
    case ">=": return x >= y;
    default: throw new FormulaError(`unknown comparison ${op}`);
  }
}

/* ------------------------------------------------------------------ *
 * The parser — plain recursive descent over the token list
 * ------------------------------------------------------------------ */

class Parser {
  private i = 0;

  constructor(private toks: Tok[], private ctx: Ctx) {}

  parse(): Val {
    const v = this.expr();
    if (this.i < this.toks.length) throw new FormulaError("trailing input");
    return v;
  }

  private peek(): Tok | undefined { return this.toks[this.i]; }

  private eat(text: string): boolean {
    const t = this.peek();
    if (t && t.kind === "op" && t.text === text) { this.i += 1; return true; }
    return false;
  }

  private expect(text: string): void {
    if (!this.eat(text)) throw new FormulaError(`expected ${text}`);
  }

  private expr(): Val {
    let left = this.concat();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== "op" || !["=", "<>", "<", "<=", ">", ">="].includes(t.text)) return left;
      this.i += 1;
      left = compare(left, this.concat(), t.text);
    }
  }

  private concat(): Val {
    let left = this.additive();
    while (this.eat("&")) left = toStr(left) + toStr(this.additive());
    return left;
  }

  private additive(): Val {
    let left = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== "op" || (t.text !== "+" && t.text !== "-")) return left;
      this.i += 1;
      const right = this.multiplicative();
      left = t.text === "+" ? toNum(left) + toNum(right) : toNum(left) - toNum(right);
    }
  }

  private multiplicative(): Val {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== "op" || (t.text !== "*" && t.text !== "/")) return left;
      this.i += 1;
      const right = toNum(this.unary());
      if (t.text === "/" && right === 0) throw new FormulaError("divide by zero");
      left = t.text === "*" ? toNum(left) * right : toNum(left) / right;
    }
  }

  private unary(): Val {
    if (this.eat("-")) return -toNum(this.unary());
    if (this.eat("+")) return this.unary();
    return this.power();
  }

  private power(): Val {
    let left = this.postfix();
    while (this.eat("^")) left = toNum(left) ** toNum(this.postfix());
    return left;
  }

  private postfix(): Val {
    const v = this.primary();
    if (this.eat("%")) return toNum(v) / 100;
    return v;
  }

  private primary(): Val {
    const t = this.peek();
    if (!t) throw new FormulaError("unexpected end");
    if (t.kind === "num") { this.i += 1; return /%$/.test(t.text) ? parseFloat(t.text) / 100 : parseFloat(t.text); }
    if (t.kind === "str") { this.i += 1; return t.text; }
    if (t.kind === "ref") { this.i += 1; return this.resolve(t.text); }
    if (t.kind === "op" && t.text === "(") { this.i += 1; const v = this.expr(); this.expect(")"); return v; }
    if (t.kind === "name") {
      this.i += 1;
      const upper = t.text.toUpperCase();
      if (upper === "TRUE") { if (this.eat("(")) this.expect(")"); return true; }
      if (upper === "FALSE") { if (this.eat("(")) this.expect(")"); return false; }
      this.expect("(");
      const args: (() => Val)[] = [];
      if (!this.eat(")")) {
        for (;;) {
          const start = this.i;
          this.skipArg();
          const end = this.i;
          const toks = this.toks.slice(start, end);
          args.push(() => new Parser(toks, this.ctx).parse());
          if (this.eat(",") || this.eat(";")) continue;
          this.expect(")");
          break;
        }
      }
      return this.call(upper, args);
    }
    throw new FormulaError(`unexpected ${t.text}`);
  }

  /** Skip to the end of one argument, so IF() can leave its branches unrun. */
  private skipArg(): void {
    let depth = 0;
    for (; this.i < this.toks.length; this.i += 1) {
      const t = this.toks[this.i];
      if (t.kind !== "op") continue;
      if (t.text === "(" || t.text === "{") depth += 1;
      else if (t.text === ")" || t.text === "}") { if (depth === 0) return; depth -= 1; }
      else if ((t.text === "," || t.text === ";") && depth === 0) return;
    }
  }

  private resolve(text: string): Val {
    let sheet = this.ctx.sheet || "";
    let rest = text;
    const bang = text.lastIndexOf("!");
    if (bang >= 0) {
      sheet = text.slice(0, bang).replace(/^'|'$/g, "");
      rest = text.slice(bang + 1);
    }
    if (!sheet) throw new FormulaError(`no tab for ${text}`);
    const parts = rest.split(":").map((p) => p.replace(/\$/g, ""));
    const one = (p: string) => {
      const m = p.match(/^([A-Za-z]{1,3})(\d+)?$/);
      if (!m) throw new FormulaError(`bad reference ${p}`);
      return { col: colToNumber(m[1]), row: m[2] ? parseInt(m[2], 10) : null };
    };
    const a = one(parts[0]);
    if (parts.length === 1) {
      if (a.row === null) throw new FormulaError("a bare column needs a range");
      return cellAt(this.ctx, sheet, a.row, a.col);
    }
    const b = one(parts[1]);
    const top = a.row ?? 1;
    const bottom = b.row ?? sheetBottom(this.ctx, sheet);
    if (!bottom) throw new FormulaError(`${sheet} has no rows the board reads`);
    const out: Matrix = [];
    for (let r = Math.min(top, bottom); r <= Math.max(top, bottom); r += 1) {
      const row: Val[] = [];
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c += 1) {
        // A range may run past what the board reads; those cells are blank.
        try { row.push(cellAt(this.ctx, sheet, r, c)); } catch { row.push(""); }
      }
      out.push(row);
    }
    return out;
  }

  private call(name: string, args: (() => Val)[]): Val {
    const arg = (i: number): Val => {
      if (i >= args.length) throw new FormulaError(`${name} wants more arguments`);
      return args[i]();
    };
    const opt = (i: number, dflt: Val): Val => (i < args.length ? args[i]() : dflt);
    const all = (): Val[] => args.map((f) => f());
    const flat = (): Val[] => {
      const out: Val[] = [];
      for (const v of all()) {
        if (isMatrix(v)) for (const row of v) out.push(...row);
        else out.push(v);
      }
      return out;
    };

    switch (name) {
      case "IF": return toBool(arg(0)) ? arg(1) : opt(2, "");
      case "IFS": {
        for (let i = 0; i + 1 < args.length; i += 2) if (toBool(args[i]())) return args[i + 1]();
        throw new FormulaError("IFS matched nothing");
      }
      case "IFERROR": try { return arg(0); } catch { return opt(1, ""); }
      case "IFNA": try { return arg(0); } catch { return opt(1, ""); }
      case "AND": return flat().every((v) => toBool(v));
      case "OR": return flat().some((v) => toBool(v));
      case "NOT": return !toBool(arg(0));
      case "NOW": return toSerial(this.ctx.now);
      case "TODAY": return Math.floor(toSerial(this.ctx.now));
      case "TIMEVALUE": {
        const v = single(arg(0));
        if (typeof v === "number") return v - Math.floor(v);
        return timeSerial(String(v ?? ""));
      }
      case "HOUR": return Math.floor((toNum(arg(0)) % 1) * 24 + 1e-9);
      case "MINUTE": return Math.floor(((toNum(arg(0)) % 1) * 1440 + 1e-9) % 60);
      case "WEEKDAY": {
        const serial = Math.floor(toNum(arg(0)));
        const type = args.length > 1 ? toNum(arg(1)) : 1;
        const dow = (((serial - 1) % 7) + 7) % 7; // serial 1 = Sunday
        if (type === 1) return dow + 1;
        if (type === 2) return ((dow + 6) % 7) + 1;
        if (type === 3) return (dow + 6) % 7;
        throw new FormulaError("WEEKDAY type");
      }
      case "DAY": case "MONTH": case "YEAR": {
        const d = new Date(EPOCH + Math.floor(toNum(arg(0))) * DAY_MS);
        if (name === "DAY") return d.getUTCDate();
        if (name === "MONTH") return d.getUTCMonth() + 1;
        return d.getUTCFullYear();
      }
      case "INDEX": {
        const m = arg(0);
        if (!isMatrix(m)) return args.length > 1 ? m : m;
        const r = args.length > 1 ? toNum(arg(1)) : 1;
        const c = args.length > 2 ? toNum(arg(2)) : 1;
        const row = m[Math.max(1, r) - 1] || [];
        return row[Math.max(1, c) - 1] ?? "";
      }
      case "MATCH": {
        const needle = arg(0);
        const hay = arg(1);
        if (!isMatrix(hay)) throw new FormulaError("MATCH wants a range");
        const flatHay = hay.length > 1 && (hay[0] || []).length === 1 ? hay.map((r) => r[0]) : hay[0] || [];
        const i = flatHay.findIndex((v) => compare(v, needle, "="));
        if (i < 0) throw new FormulaError("MATCH found nothing");
        return i + 1;
      }
      case "HLOOKUP": case "VLOOKUP": {
        const needle = arg(0);
        const table = arg(1);
        if (!isMatrix(table)) throw new FormulaError(`${name} wants a range`);
        const idx = toNum(arg(2));
        if (name === "VLOOKUP") {
          const row = table.find((r) => compare((r || [])[0] ?? "", needle, "="));
          if (!row) throw new FormulaError("VLOOKUP found nothing");
          return row[idx - 1] ?? "";
        }
        const c = (table[0] || []).findIndex((v) => compare(v ?? "", needle, "="));
        if (c < 0) throw new FormulaError("HLOOKUP found nothing");
        return (table[idx - 1] || [])[c] ?? "";
      }
      case "LEFT": return toStr(arg(0)).slice(0, args.length > 1 ? toNum(arg(1)) : 1);
      case "RIGHT": { const n = args.length > 1 ? toNum(arg(1)) : 1; const s = toStr(arg(0)); return n <= 0 ? "" : s.slice(-n); }
      case "MID": return toStr(arg(0)).substr(Math.max(0, toNum(arg(1)) - 1), toNum(arg(2)));
      case "LEN": return toStr(arg(0)).length;
      case "TRIM": return toStr(arg(0)).replace(/\s+/g, " ").trim();
      case "UPPER": return toStr(arg(0)).toUpperCase();
      case "LOWER": return toStr(arg(0)).toLowerCase();
      case "PROPER": return toStr(arg(0)).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      case "CONCATENATE": case "CONCAT": return flat().map((v) => toStr(v)).join("");
      case "SUBSTITUTE": return toStr(arg(0)).split(toStr(arg(1))).join(toStr(arg(2)));
      case "VALUE": return toNum(arg(0));
      case "N": return looksNumeric(arg(0)) ? toNum(arg(0)) : 0;
      case "ISBLANK": { const v = single(arg(0)); return v === null || v === ""; }
      case "ISNUMBER": return looksNumeric(arg(0));
      case "ISTEXT": { const v = single(arg(0)); return typeof v === "string" && v !== "" && !looksNumeric(v); }
      case "COUNTA": return flat().filter((v) => toStr(v) !== "").length;
      case "SUM": return flat().reduce((n: number, v) => n + (looksNumeric(v) ? toNum(v) : 0), 0);
      case "MIN": return Math.min(...flat().filter(looksNumeric).map(toNum));
      case "MAX": return Math.max(...flat().filter(looksNumeric).map(toNum));
      case "ROUND": { const p = args.length > 1 ? toNum(arg(1)) : 0; const f = 10 ** p; return Math.round(toNum(arg(0)) * f) / f; }
      case "ABS": return Math.abs(toNum(arg(0)));
      case "INT": case "FLOOR": return Math.floor(toNum(arg(0)));
      case "IMAGE": case "HYPERLINK": return toStr(arg(0));
      case "CHAR": return String.fromCharCode(toNum(arg(0)));
      default: throw new FormulaError(`unsupported function ${name}`);
    }
  }
}

/**
 * Evaluate one cell's formula at the board's clock.
 *
 * `formula` is the cell as the sheet stores it ("=IF(...)"); a cell that holds
 * a plain value comes back unchanged. Throws when the formula reaches past what
 * this understands or past the ranges the board reads.
 */
export function evaluateFormula(formula: string, ctx: Ctx): string {
  const src = String(formula || "").trim();
  if (!src.startsWith("=")) return src;
  const v = new Parser(tokenize(src.slice(1)), ctx).parse();
  const one = single(v);
  if (one === null) return "";
  if (typeof one === "number") return Number.isInteger(one) ? String(one) : String(one);
  return toStr(one);
}

/** The same, but a formula out of its depth returns the sheet's own value. */
export function evaluateOr(formula: string, fallback: string, ctx: Ctx): string {
  try { return evaluateFormula(formula, ctx); } catch { return fallback; }
}
