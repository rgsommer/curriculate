// Pure parsing for the /daily board. No I/O, no DOM — so it can be unit-tested
// with plain node. Input is the raw cell grid of the DisplayAI tab (plus a few
// Setup cells); output is the JSON the page renders from.

export type Period = {
  start: number; // minutes after midnight
  end: number;
  text: string;
  status: string; // DisplayAI column D, e.g. "A-FD & B1", "REC"
  flag: string; // DisplayAI column F
  video: string; // URL when the row links to a video
  empty: boolean; // no lesson text at all
  duty: boolean; // lunch, recess, dismissal, anything without a class header
  rec: boolean; // lunch / recess
  subj: string;
  sec: string; // "7A"
  room: string;
  code: string;
  today: string;
  q: string;
  plan: string[];
  assign: string[];
  remind: string;
};

export type Points = {
  numbers: number[] | null;
  percents: number[] | null;
  entered: boolean | null;
};

export type Setup = {
  nextAdvance: number;
  remindersAdvance: number;
  redAt: number;
  homeworkAt: number;
  blankFrom: number | null;
  blankTo: number | null;
  dismissalAt: number | null;
  riddleUntil: number | null;
  graceMin: number;
  washroomBefore: number;
  snacksB2Min: number;
  openMin: number;
  picSeconds: number;
};

export type Payload = {
  fetchedAt: string;
  meta: {
    greeting: string;
    line: string;
    verse: string;
    puzzle: string;
    plans: string;
    headout: string[];
    riddle: string;
    feature: string;
    other: string;
  };
  periods: Period[];
  points: Points;
  setup: Setup;
  picture: { url: string; seconds: number } | null;
};

export const DEFAULT_SETUP: Setup = {
  nextAdvance: 15,
  remindersAdvance: 2,
  redAt: 3,
  homeworkAt: 1,
  blankFrom: null,
  blankTo: null,
  dismissalAt: null,
  riddleUntil: null,
  graceMin: 15,
  washroomBefore: 10,
  snacksB2Min: 5,
  openMin: 5,
  picSeconds: 600,
};

const cell = (rows: string[][], r: number, c: number) => ((rows[r] || [])[c] || "").trim();

/** "10:59 AM", "1:00 PM", "13:30", "08:55" → minutes after midnight, or null. */
export function parseTime(s: string): number | null {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "59 minutes" → 59, else null. */
export function parseDuration(s: string): number | null {
  const m = String(s || "").match(/^(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) : null;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

export function isVideoUrl(u: string): boolean {
  return /youtu\.be\/|youtube\.com\/|youtube-nocookie\.com\/|drive\.google\.com\/file\/|\.(mp4|webm|m4v)(\?|$)/i.test(u);
}

/** URL out of a =HYPERLINK("...") / =IMAGE("...") formula or a bare URL. */
export function urlFromFormula(f: string): string {
  const m = String(f || "").match(/(?:HYPERLINK|IMAGE)\(\s*"([^"]+)"/i);
  if (m) return m[1];
  const u = String(f || "").match(URL_RE);
  return u ? u[0] : "";
}

/**
 * Split one DisplayAI class cell. Shape produced by the AI update text:
 *   "Subject Sec (n) Room (Code) Today we ... Question? - bullet - bullet Reminders: ..."
 */
export function parseClassText(text: string) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.+?) \((\d+)\) -? ?(\d{3}) \(([A-Z]\d{3})/);
  if (!m) {
    return {
      duty: true,
      rec: /Recess|Lunch/i.test(t),
      subj: t.replace(/\s*\[.*$/, "").slice(0, 80),
      sec: "",
      room: "",
      code: "",
      today: "",
      q: "",
      plan: [] as string[],
      assign: [] as string[],
      remind: "",
    };
  }
  const rest = t.slice(m[0].length).replace(/^[^)]*\)\s*/, "");
  const today = (rest.match(/(Today we[^.?!]*[.?!])/) || [, ""])[1] || "";
  const q = ((rest.match(/([^.?!]*\?)/) || [, ""])[1] || "").trim();
  const body = (rest.match(/\?(.*?)(?:Reminders:|$)/) || [, ""])[1] || "";
  const bullets = body
    .split(/\s-\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  const remind = ((rest.match(/Reminders:\s*(.*)$/) || [, ""])[1] || "").trim();
  const sec = (m[1].match(/(\d[A-C])\b/) || [, ""])[1] || "";
  return {
    duty: false,
    rec: false,
    subj: m[1].trim(),
    sec,
    room: "Rm " + m[3],
    code: m[4],
    today,
    q,
    plan: bullets.filter((b) => !/^Assign:/i.test(b)),
    assign: bullets.filter((b) => /^Assign:/i.test(b)).map((b) => b.replace(/^Assign:\s*/i, "")),
    remind,
  };
}

/**
 * The D-column status text. Examples: "AB1 & B2", "A-FD & B1", "C-FD Only", "REC", "".
 * Letter = class group, "-" = grace window (B2 forced off), then the label.
 */
export function parseStatus(s: string) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  if (/^REC$/i.test(raw)) return { rec: true, letter: "", grace: false, FD: false, B1: false, B2: false, extra: false, raw };
  const m = raw.match(/^([A-C])?(-)?\s*(.*?)(\s4)?$/);
  if (!m) return null;
  const label = (m[3] || "").trim();
  const map: Record<string, [boolean, boolean, boolean]> = {
    "All 3": [true, true, true],
    "B1 & B2": [false, true, true],
    "B2": [false, false, true],
    "B1": [false, true, false],
    "FD & B1": [true, true, false],
    "FD Only": [true, false, false],
    "FD & B2": [true, false, true],
  };
  const f = map[label] || [false, false, false];
  return { rec: false, letter: m[1] || "", grace: !!m[2], FD: f[0], B1: f[1], B2: f[2], extra: !!m[4], raw };
}

/** "Plans for Thursday, Sep 10, 2026...   -660--871--220--820--290-" → title + point values. */
export function parsePlansLine(s: string) {
  const t = String(s || "");
  const title = (t.match(/^(Plans for [^.]*\.{3})/) || [, t.trim()])[1] || t.trim();
  const tail = t.slice(title.length);
  const re = /-(-?\d+(?:\.\d+)?)(%?)-/g;
  const vals: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail)) !== null) vals.push(m);
  if (!vals.length) return { title, kind: null as null | "numbers" | "percents", values: [] as number[] };
  const kind = vals.some((v) => v[2] === "%") ? "percents" : "numbers";
  return { title, kind, values: vals.map((v) => parseFloat(v[1])) };
}

function num(s: string, d: number): number {
  const n = parseFloat(String(s || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : d;
}

/** Setup!A1:D20 — matched by the label in column B so row shuffles do not break it. */
export function parseSetup(rows: string[][]): Setup {
  const out: Setup = { ...DEFAULT_SETUP };
  for (const r of rows) {
    const label = (r[1] || "").toLowerCase();
    const c = r[2] || "";
    const d = r[3] || "";
    if (label.startsWith("time in advance to show next")) out.nextAdvance = num(c, out.nextAdvance);
    else if (label.startsWith("time in advance to show remi")) out.remindersAdvance = num(c, out.remindersAdvance);
    else if (label.startsWith("change time to red")) out.redAt = num(c, out.redAt);
    else if (label.startsWith("show homework") && !label.includes("from")) out.homeworkAt = num(c, out.homeworkAt);
    else if (label.startsWith("show riddle answer until")) out.riddleUntil = parseTime(c);
    else if (label.startsWith("blank screen during")) {
      out.blankFrom = parseTime(c);
      out.blankTo = parseTime(d);
    } else if (label.startsWith("show dismissal list")) out.dismissalAt = parseTime(d) ?? parseTime(c);
    else if (label.startsWith("show pregnancy weeks")) out.graceMin = num(d, out.graceMin);
    else if (label.startsWith("can go to washroom")) out.washroomBefore = num(d, out.washroomBefore);
    else if (label.startsWith("snacks are allowed")) out.snacksB2Min = num(c, out.snacksB2Min);
  }
  return out;
}

export type RawInputs = {
  display: string[][]; // DisplayAI!A1:F40 formatted values
  displayD: string[][]; // DisplayAI!D1:D40 formulas
  displayC: string[][]; // DisplayAI!C1:C40 formulas (hyperlinks inside lesson cells)
  setup: string[][]; // Setup!A1:D20 values
  slots: string[][]; // Setup!U1:AA8 values
  slotFormulas: string[][]; // Setup!U4:AA4 formulas
  feature: string; // Display!E1 (or DisplayAI!E1) formatted value
};

const isErr = (s: string) => /^#(N\/A|REF!|VALUE!|ERROR!|DIV\/0!|NAME\?)/.test(s.trim());

export function buildPayload(inp: RawInputs, now = new Date()): Payload {
  const rows = inp.display;
  const meta = {
    greeting: "",
    line: "",
    verse: "",
    puzzle: "",
    plans: "",
    headout: [] as string[],
    riddle: "",
    feature: isErr(inp.feature || "") ? "" : (inp.feature || "").trim(),
    other: "",
  };
  const points: Points = { numbers: null, percents: null, entered: null };

  // ---- header cells (rows above the first time row) ----
  const firstTimeRow = rows.findIndex((r) => parseTime(r[0] || "") !== null);
  const headerRows = firstTimeRow < 0 ? rows : rows.slice(0, firstTimeRow);
  for (const r of headerRows) {
    const a = (r[0] || "").trim();
    const c = (r[2] || "").trim();
    if (!meta.greeting && /^Good (morning|afternoon|evening)/i.test(a)) meta.greeting = a;
    else if (!meta.line && /^Week\s*\d+/i.test(a)) meta.line = a.split(/\s{2,}/).join(" · ");
    else if (!meta.verse && a.length > 40 && !/^Q:/.test(a)) meta.verse = a;
    else if (!meta.riddle && /^Q:/.test(a)) meta.riddle = a;
    if (/UNSCRAMBLE/i.test(c)) meta.puzzle = c.replace(/\s*(_\s*)+$/g, "").trim();
    if (/^Plans for/i.test(c)) {
      const p = parsePlansLine(c);
      meta.plans = p.title;
      if (p.kind === "numbers") points.numbers = p.values;
      if (p.kind === "percents") points.percents = p.values;
      const d = (r[3] || "").trim();
      if (d !== "") points.entered = d === "1" || /^true$/i.test(d);
    }
    if (/^Q:/.test(c) && !meta.riddle) meta.riddle = c;
  }

  // ---- period rows ----
  const periods: Period[] = [];
  for (let i = firstTimeRow; i >= 0 && i < rows.length; i++) {
    const r = rows[i] || [];
    const start = parseTime(r[0] || "");
    if (start === null) continue;
    const text = (r[2] || "").trim();
    if (/^Before you head out/i.test(text)) {
      meta.headout = text
        .split(/\s-\s/)
        .slice(1)
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (/^Other Subjects\/Reminders/i.test(text)) {
      meta.other = text;
      continue;
    }
    // end = next time row's start; a "N minutes" row directly below can shorten it
    let end: number | null = null;
    for (let j = i + 1; j < rows.length; j++) {
      const t2 = parseTime((rows[j] || [])[0] || "");
      if (t2 !== null) {
        end = t2;
        break;
      }
    }
    const dur = parseDuration(cell(rows, i + 1, 0));
    if (dur !== null && (end === null || start + dur < end)) end = start + dur;
    if (end === null) end = start + 60;

    const dFormula = cell(inp.displayD, i, 0);
    const cFormula = cell(inp.displayC, i, 0);
    const candidates = [urlFromFormula(dFormula), urlFromFormula(cFormula), ...(text.match(URL_RE) || [])].filter(Boolean);
    const video = candidates.find(isVideoUrl) || "";

    const parsed = parseClassText(text);
    periods.push({
      start,
      end,
      text,
      status: (r[3] || "").trim(),
      flag: (r[5] || "").trim(),
      video,
      empty: text === "",
      ...parsed,
    });
  }

  // trailing "Other Subjects/Reminders" may live inside a class row's text; pull it out
  if (!meta.other) {
    for (const p of periods) {
      const m = p.text.match(/Other Subjects\/Reminders:.*$/);
      if (m) {
        meta.other = m[0];
        break;
      }
    }
  }

  // ---- lesson picture from the Setup slot table (Lesson Pic column) ----
  let picture: Payload["picture"] = null;
  const names = inp.slots[1] || [];
  const picCol = names.findIndex((n) => /lesson pic/i.test(n || ""));
  if (picCol >= 0) {
    const url = urlFromFormula(cell(inp.slotFormulas, 0, picCol)) || urlFromFormula(cell(inp.slots, 3, picCol));
    const secs = num(cell(inp.slots, 6, picCol), DEFAULT_SETUP.picSeconds);
    if (url && /^https?:\/\//.test(url)) picture = { url, seconds: secs > 0 ? secs : DEFAULT_SETUP.picSeconds };
  }

  const setup = parseSetup(inp.setup);
  if (picture) setup.picSeconds = picture.seconds;

  return { fetchedAt: now.toISOString(), meta, periods, points, setup, picture };
}
