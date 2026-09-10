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
/** A LAMBDA, as LET binds it: the parameter names and the body's tokens. */
type Fn = { lambda: true; params: string[]; body: Tok[]; scope: Scope };
type Val = string | number | boolean | null | Matrix | Fn;
type Scope = Map<string, Val>;
type Arg = { toks: Tok[]; run: () => Val };

const isFn = (v: Val): v is Fn => !!v && typeof v === "object" && !Array.isArray(v) && (v as Fn).lambda === true;

const isMatrix = (v: Val): v is Matrix => Array.isArray(v);

/** Apply a scalar operation element by element, the way Sheets spreads one. */
function broadcast(a: Val, b: Val, op: (x: Val, y: Val) => Val): Val {
  if (!isMatrix(a) && !isMatrix(b)) return op(a, b);
  const rows = Math.max(isMatrix(a) ? a.length : 1, isMatrix(b) ? b.length : 1);
  const cols = Math.max(
    isMatrix(a) ? Math.max(...a.map((r) => r.length)) : 1,
    isMatrix(b) ? Math.max(...b.map((r) => r.length)) : 1
  );
  const cell = (m: Val, r: number, c: number) =>
    (isMatrix(m) ? (m[Math.min(r, m.length - 1)] || [])[Math.min(c, (m[0] || []).length - 1)] ?? "" : m);
  const out: Matrix = [];
  for (let r = 0; r < rows; r += 1) {
    const row: Val[] = [];
    for (let c = 0; c < cols; c += 1) row.push(op(cell(a, r, c), cell(b, r, c)));
    out.push(row);
  }
  return out;
}

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
  if (isFn(v)) throw new FormulaError("a LAMBDA is not a value");
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

function compare(a: Val, b: Val, op: string): Val {
  if (isMatrix(a) || isMatrix(b)) return broadcast(a, b, (x, y) => compareOne(x, y, op));
  return compareOne(a, b, op);
}

function compareOne(a: Val, b: Val, op: string): boolean {
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

  constructor(private toks: Tok[], private ctx: Ctx, private scope: Scope = new Map()) {}

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
      const right = this.unary();
      // Two arrays of conditions multiplied together is how the sheet says AND
      // across a range, so the operators have to spread the way Sheets does.
      left = broadcast(left, right, (x, y) => {
        const d = toNum(y);
        if (t.text === "/" && d === 0) throw new FormulaError("divide by zero");
        return t.text === "*" ? toNum(x) * d : toNum(x) / d;
      });
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
      // A name LET has bound, used on its own rather than called.
      const bound = this.scope.get(upper);
      if (bound !== undefined && !(this.peek() && this.peek()!.kind === "op" && this.peek()!.text === "(")) return bound;
      this.expect("(");
      const args: Arg[] = [];
      if (!this.eat(")")) {
        for (;;) {
          const start = this.i;
          this.skipArg();
          const end = this.i;
          const toks = this.toks.slice(start, end);
          args.push({ toks, run: () => new Parser(toks, this.ctx, this.scope).parse() });
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

  /** The rows and columns a reference covers, for ROW() and COLUMN(). */
  private refSpan(text: string): { top: number; bottom: number; left: number; right: number } {
    let sheet = this.ctx.sheet || "";
    let rest = text;
    const bang = text.lastIndexOf("!");
    if (bang >= 0) { sheet = text.slice(0, bang).replace(/^'|'$/g, ""); rest = text.slice(bang + 1); }
    const parts = rest.split(":").map((x) => x.replace(/\$/g, ""));
    const one = (x: string) => {
      const m = x.match(/^([A-Za-z]{1,3})(\d+)?$/);
      if (!m) throw new FormulaError(`bad reference ${x}`);
      return { col: colToNumber(m[1]), row: m[2] ? parseInt(m[2], 10) : null };
    };
    const a = one(parts[0]);
    const b = parts.length > 1 ? one(parts[1]) : a;
    const bottom = b.row ?? sheetBottom(this.ctx, sheet);
    const top = a.row ?? 1;
    return {
      top: Math.min(top, bottom), bottom: Math.max(top, bottom),
      left: Math.min(a.col, b.col), right: Math.max(a.col, b.col),
    };
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

  private call(name: string, args: Arg[]): Val {
    const arg = (i: number): Val => {
      if (i >= args.length) throw new FormulaError(`${name} wants more arguments`);
      return args[i].run();
    };
    const opt = (i: number, dflt: Val): Val => (i < args.length ? args[i].run() : dflt);
    const all = (): Val[] => args.map((f) => f.run());
    const flat = (): Val[] => {
      const out: Val[] = [];
      for (const v of all()) {
        if (isMatrix(v)) for (const row of v) out.push(...row);
        else out.push(v);
      }
      return out;
    };
    // A LAMBDA that LET bound: upcoming(1) rather than a built-in.
    const fn = this.scope.get(name);
    if (isFn(fn)) {
      const inner: Scope = new Map(fn.scope);
      fn.params.forEach((pname, i) => inner.set(pname, i < args.length ? args[i].run() : ""));
      return new Parser(fn.body, this.ctx, inner).parse();
    }

    switch (name) {
      case "IF": return toBool(arg(0)) ? arg(1) : opt(2, "");
      case "IFS": {
        for (let i = 0; i + 1 < args.length; i += 2) if (toBool(args[i].run())) return args[i + 1].run();
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
        if (!isMatrix(m)) return m;
        // An omitted row or column means the whole of that column or row —
        // INDEX(range, , col) is how the sheet takes one weekday's column.
        const blank = (i: number) => i >= args.length || args[i].toks.length === 0;
        const r = blank(1) ? 0 : toNum(arg(1));
        const c = blank(2) ? 0 : toNum(arg(2));
        if (r === 0 && c === 0) return m;
        if (r === 0) return m.map((row) => [row[Math.max(1, c) - 1] ?? ""]);
        if (c === 0) return [(m[Math.max(1, r) - 1] || []).slice()];
        return (m[Math.max(1, r) - 1] || [])[Math.max(1, c) - 1] ?? "";
      }
      case "LET": {
        // LET(name, value, …, result), each name visible to the ones after it.
        const inner: Scope = new Map(this.scope);
        for (let i = 0; i + 1 < args.length; i += 2) {
          const nameToks = args[i].toks;
          if (nameToks.length !== 1 || nameToks[0].kind !== "name") throw new FormulaError("LET wants a name");
          inner.set(nameToks[0].text.toUpperCase(), new Parser(args[i + 1].toks, this.ctx, inner).parse());
        }
        const last = args[args.length - 1];
        if (!last) throw new FormulaError("LET with no result");
        return new Parser(last.toks, this.ctx, inner).parse();
      }
      case "LAMBDA": {
        const params: string[] = [];
        for (let i = 0; i + 1 < args.length; i += 1) {
          const toks = args[i].toks;
          if (toks.length !== 1 || toks[0].kind !== "name") throw new FormulaError("LAMBDA wants names");
          params.push(toks[0].text.toUpperCase());
        }
        return { lambda: true, params, body: args[args.length - 1].toks, scope: this.scope };
      }
      case "FILTER": {
        const src = arg(0);
        if (!isMatrix(src)) throw new FormulaError("FILTER wants a range");
        let keep: boolean[] = src.map(() => true);
        for (let i = 1; i < args.length; i += 1) {
          const cond = args[i].run();
          const rows = isMatrix(cond) ? cond.map((r) => toBool((r || [])[0] ?? "")) : src.map(() => toBool(cond));
          keep = keep.map((k, r) => k && (rows[r] ?? false));
        }
        const out = src.filter((_, r) => keep[r]);
        if (!out.length) throw new FormulaError("FILTER kept nothing");
        return out;
      }
      case "ROW": case "COLUMN": {
        const toks = args[0] ? args[0].toks : [];
        if (toks.length !== 1 || toks[0].kind !== "ref") throw new FormulaError(`${name} wants a reference`);
        const span = this.refSpan(toks[0].text);
        const out: Matrix = [];
        if (name === "ROW") for (let r = span.top; r <= span.bottom; r += 1) out.push([r]);
        else for (let c = span.left; c <= span.right; c += 1) out.push([c]);
        return out;
      }
      case "RANDBETWEEN": {
        // Deterministic for the day: a projector re-renders every few seconds
        // and a fresh number each time would make the line jump about.
        const lo = Math.ceil(toNum(arg(0)));
        const hi = Math.floor(toNum(arg(1)));
        if (hi < lo) throw new FormulaError("RANDBETWEEN backwards");
        const seed = Math.floor(toSerial(this.ctx.now));
        return lo + (((seed * 2654435761) >>> 0) % (hi - lo + 1));
      }
      case "DATEVALUE": {
        const v = single(arg(0));
        if (typeof v === "number") return Math.floor(v);
        const t = String(v ?? "").trim();
        const ms = Date.parse(t.replace(/-/g, "/"));
        if (!Number.isFinite(ms)) throw new FormulaError(`not a date: ${t}`);
        const d = new Date(ms);
        return Math.floor(toSerial(d));
      }
      case "DAYS": return Math.floor(toNum(arg(0))) - Math.floor(toNum(arg(1)));
      case "MOD": {
        const b = toNum(arg(1));
        if (b === 0) throw new FormulaError("MOD by zero");
        return ((toNum(arg(0)) % b) + b) % b;
      }
      case "TEXT": return formatSerial(toNum(arg(0)), toStr(arg(1)));
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
      case "JOIN": {
        const sep = toStr(arg(0));
        const rest: Val[] = [];
        for (let i = 1; i < args.length; i += 1) {
          const v = args[i].run();
          if (isMatrix(v)) for (const row of v) rest.push(...row);
          else rest.push(v);
        }
        // Sheets keeps the blanks, and the rules downstream tidy up after it.
        return rest.map((v) => toStr(v)).join(sep);
      }
      case "INDIRECT": {
        // The slot rules build a reference out of text — indirect("Display!"&Z3).
        const ref = toStr(arg(0)).trim();
        if (!ref) throw new FormulaError("INDIRECT with nothing to point at");
        return this.resolve(ref);
      }
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
 * TEXT()'s date and time patterns, enough of them for the sheet's own use:
 * "dddd, mmm d h:mm" and its neighbours.
 */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatSerial(serial: number, pattern: string): string {
  const ms = EPOCH + Math.round(serial * DAY_MS);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ampm = /am\/pm|a\/p/i.test(pattern);
  const hour24 = d.getUTCHours();
  const hour = ampm ? ((hour24 % 12) || 12) : hour24;
  let out = "";
  let i = 0;
  let seenHour = false;
  while (i < pattern.length) {
    const rest = pattern.slice(i);
    const run = (rest.match(/^(d+|m+|y+|h+|s+|am\/pm|a\/p)/i) || [])[0];
    if (!run) {
      if (rest[0] === '"') { const end = rest.indexOf('"', 1); out += rest.slice(1, end < 0 ? undefined : end); i += end < 0 ? rest.length : end + 1; continue; }
      out += rest[0];
      i += 1;
      continue;
    }
    const key = run.toLowerCase();
    if (key[0] === "d") out += key.length >= 4 ? DAY_NAMES[d.getUTCDay()] : key.length === 3 ? DAY_NAMES[d.getUTCDay()].slice(0, 3) : key.length === 2 ? pad(d.getUTCDate()) : String(d.getUTCDate());
    else if (key[0] === "y") out += key.length <= 2 ? pad(d.getUTCFullYear() % 100) : String(d.getUTCFullYear());
    else if (key[0] === "h") { out += key.length >= 2 ? pad(hour) : String(hour); seenHour = true; }
    else if (key[0] === "s") out += key.length >= 2 ? pad(d.getUTCSeconds()) : String(d.getUTCSeconds());
    else if (key === "am/pm" || key === "a/p") out += hour24 < 12 ? (key === "a/p" ? "A" : "AM") : (key === "a/p" ? "P" : "PM");
    else if (key[0] === "m") {
      // "mm" is minutes when it follows an hour, months otherwise — the same
      // rule Sheets uses.
      if (seenHour) { out += key.length >= 2 ? pad(d.getUTCMinutes()) : String(d.getUTCMinutes()); seenHour = false; }
      else out += key.length >= 4 ? MONTH_NAMES[d.getUTCMonth()] : key.length === 3 ? MONTH_NAMES[d.getUTCMonth()].slice(0, 3) : key.length === 2 ? pad(d.getUTCMonth() + 1) : String(d.getUTCMonth() + 1);
    }
    i += run.length;
  }
  return out;
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
