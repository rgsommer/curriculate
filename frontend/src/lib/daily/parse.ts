// Pure parsing for the /daily board. No I/O, no DOM — so it can be unit-tested
// with plain node. Input is the raw cell grid of the DisplayAI tab (plus a few
// Setup cells); output is the JSON the page renders from.

/** A handout, form or reference linked from a lesson cell. */

import { evaluateOr, type Book } from "./formula";
export type LessonLink = { label: string; url: string };

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
  links: LessonLink[]; // handouts and forms named in the lesson text, and on Lessons
  page: string; // Lessons E — the starting page reference
  homework: string; // Lessons F
  image: string; // Lessons I — the lesson picture
};

export type Points = {
  numbers: number[] | null;
  percents: number[] | null;
  entered: boolean | null;
  writing: string[]; // classes owed a corrective writing assignment
  writingNote: string; // how that was worked out, for ?debug=1
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
  dismissalReadyMin: number;
  washroomBefore: number;
  snacksB2Min: number;
  seatMin: number; // how long the free seat is on the table at the top of a class
  anthemMin: number; // how long O Canada holds the screen after the announcements
  openMin: number;
  picSeconds: number;
};

/**
 * Setup's "For Dismissal Messages" block: the times at which the end-of-day
 * package comes up (lunch, lunch recess, dismissal) and how many minutes
 * before each of them it starts showing.
 */
export type Dismissal = { advanceMin: number; times: { label: string; at: number }[] };

export type Payload = {
  fetchedAt: string;
  meta: {
    greeting: string;
    line: string;
    verse: string;
    puzzle: string;
    plans: string;
    headout: string[];
    blessing: string;
    tomorrow: string;
    riddle: string;
    feature: string;
    featureImage: string;
    pray: { text: string; url: string } | null;
    other: string;
  };
  periods: Period[];
  points: Points;
  setup: Setup;
  // The end-of-day package: when the dismissal messages come up (Setup N/O/Q)
  // and the Kiss & Ride waiting list they show alongside.
  dismissal: Dismissal;
  waiting: string[];
  // Setup column M: who the greeting addresses, Monday to Friday.
  audiences: string[];
  // Every period start on Vertical column A: the day's actual bell schedule.
  dayTimes: number[];
  // The day's classes as written on VerticalAi, one entry per weekday, for when
  // DisplayAI's lesson column has not been filled in yet.
  dayPlan: Record<number, DayClass[]>;
  picture: { url: string; seconds: number } | null;
  sources: Sources;
  // Setup!T1:AA8 as values and formulas, shown by ?debug=1 so the cells that
  // decide what E1 displays can be read without opening the sheet.
  slotBlock: string[][];
  slotBlockFormulas: string[][];
};

export const DEFAULT_SETUP: Setup = {
  nextAdvance: 15,
  remindersAdvance: 2,
  redAt: 5,
  homeworkAt: 1,
  blankFrom: null,
  blankTo: null,
  dismissalAt: null,
  riddleUntil: null,
  graceMin: 15,
  dismissalReadyMin: 5,
  washroomBefore: 10,
  snacksB2Min: 5,
  seatMin: 5,
  anthemMin: 5,
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

/** A URL an <img> can show: a picture file, a Google-hosted image, or a Drive/Photos link. */
export function isImageUrl(u: string): boolean {
  const s = String(u || "");
  if (!/^https?:\/\//i.test(s)) return false;
  if (isVideoUrl(s) && !/drive\.google\.com\/file\//i.test(s)) return false;
  return (
    /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)(\?|#|$)/i.test(s) ||
    /googleusercontent\.com\//i.test(s) ||
    /drive\.google\.com\/(file\/d\/|uc\?|open\?|thumbnail\?)/i.test(s) ||
    /photos\.(google|app\.goo)\./i.test(s) ||
    /\/image|image\//i.test(s)
  );
}

/**
 * When a cell holds `=IMAGE(Setup!Z4)` or simply `=Setup!Z4`, the picture's URL is in
 * that other cell, not in this formula. Returns the A1 reference to follow, or "".
 * Only a plain single-cell reference qualifies; anything else is left alone.
 */
export function refFromFormula(formula: string): string {
  const f = String(formula || "").trim();
  if (!f.startsWith("=")) return "";
  const inner = (f.match(/^=\s*(?:IMAGE|HYPERLINK)\s*\(\s*([^,)]+?)\s*[,)]/i) || f.match(/^=\s*([^,()]+?)\s*$/) || [, ""])[1] || "";
  const ref = inner.trim();
  return /^'?[A-Za-z0-9_ .\-]*'?!?\$?[A-Z]{1,3}\$?\d{1,5}$/.test(ref) ? ref : "";
}

/** Rewrite Drive share links into a form an <img> tag can actually load. */
export function normalizeImageUrl(u: string): string {
  const s = String(u || "");
  const byPath = s.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (byPath) return `https://lh3.googleusercontent.com/d/${byPath[1]}`;
  const byQuery = s.match(/drive\.google\.com\/(?:uc|open|thumbnail)\?[^"']*[?&]?id=([^&"'#]+)/i);
  if (byQuery) return `https://lh3.googleusercontent.com/d/${byQuery[1]}`;
  return s;
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
// Long enough for a real handout name, short enough to sit on one chip.
const LABEL_MAX = 56;

/**
 * The Lessons tab, keyed by lesson code.
 *
 * The student-facing tabs (Display, DisplayAI, Vertical, VerticalAi) deliberately
 * leave out the teacher's own material, so the handouts, the lesson picture and
 * the video are not there to be read. They are on Lessons, one row per lesson
 * code: C the code (written "~H001" or "H001"), E the starting page reference,
 * F the homework — the cell whose links the board has been picking up — I the
 * lesson picture and J the video.
 */
export type Lesson = {
  code: string;
  page: string;
  homework: string;
  image: string;
  video: string;
  links: LessonLink[];
};

/** "~H001", " h001 " and "H001" are the same lesson. */
export function normalizeCode(raw: string): string {
  return String(raw || "").trim().replace(/^~+/, "").toUpperCase();
}

const LESSON_CODE = /^~?[A-Za-z]\d{3}$/;

export function parseLessons(
  values: string[][],
  formulas: string[][] = [],
  linkRuns: { text: string; url: string }[][][] = [],
  images: CellImages = {}
): Record<string, Lesson> {
  const out: Record<string, Lesson> = {};
  (values || []).forEach((row, r) => {
    const raw = ((row || [])[0] || "").trim(); // C
    if (!LESSON_CODE.test(raw)) return;
    const code = normalizeCode(raw);
    if (out[code]) return; // first row for a code wins
    const f = formulas[r] || [];
    const cell = (i: number) => String((row || [])[i] || "").trim();
    const formula = (i: number) => String(f[i] || "").trim();

    const pick = (i: number, want: (u: string) => boolean) => {
      const candidates = [urlFromFormula(formula(i)), ...(cell(i).match(URL_RE) || [])];
      return candidates.find((u) => u && want(u)) || "";
    };
    // The picture and the video live at the end of the row, and the sheet may or
    // may not carry a mirror column between them — so the columns are read for
    // what they hold rather than by position. A link attached to the cell's text
    // (Insert > Link) counts too: the cell then has neither a value nor a
    // formula to read. This is what lets a column be inserted or removed there
    // without the board showing a video where a picture should be.
    const runOf = (i: number) => (((linkRuns[r] || [])[i] || [])[0] || {}).url || "";
    const urlsAt = (i: number) => [urlFromFormula(formula(i)), ...(cell(i).match(URL_RE) || []), runOf(i - 2)]
      .filter(Boolean) as string[];
    const tail: string[] = [];
    for (let i = 6; i <= 8; i += 1) tail.push(...urlsAt(i)); // I to K
    // The read starts at C, so this row of the grid is the same row of the sheet.
    const video = tail.find(isVideoUrl) || "";
    const image = tail.find((u) => isImageUrl(u) && u !== video)
      || images[cellImageKey(`Lessons!I${r + 1}`)]
      // A Drive link written "open?id=…" passes no image test at all, so
      // anything left that is not the video is taken as the picture.
      || tail.find((u) => u !== video)
      || "";
    const page = cell(2); // E
    const homework = cell(3); // F

    // Handouts: written into the homework or page cells, or attached to a phrase
    // in them with Insert > Link.
    const links: LessonLink[] = [];
    const seen = new Set<string>();
    const add = (l: LessonLink) => {
      const key = canonicalUrl(l.url);
      if (l.url && !seen.has(key)) { seen.add(key); links.push(l); }
    };
    extractLinks(homework).links.forEach(add);
    extractLinks(page).links.forEach(add);
    ((linkRuns[r] || [])[0] || []).forEach((l) => add({ label: l.text || "Handout", url: l.url })); // E
    ((linkRuns[r] || [])[1] || []).forEach((l) => add({ label: l.text || "Handout", url: l.url })); // F

    out[code] = {
      code,
      page,
      homework: extractLinks(homework).clean,
      image: image ? normalizeImageUrl(image) : "",
      video,
      links: links.filter((l) => !isVideoUrl(l.url)),
    };
  });
  return out;
}

/**
 * The day's classes as written on the VerticalAi tab.
 *
 * DisplayAI's lesson column is filled from the sheet's own clock, so before the
 * day starts it can be empty and the board has nothing to show. The same
 * lessons are written out one column per weekday on VerticalAi (F to J), run
 * together in one cell, so this finds each class header in that text and parses
 * the chunk that follows it.
 */
export type DayClass = {
  subj: string; room: string; code: string; today: string; q: string;
  plan: string[]; assign: string[]; remind: string;
  links: LessonLink[]; page: string; homework: string; image: string; video: string;
  start: number | null; // from Vertical column A, when the row carries a time
};

// One word before the section, not several: the day's plan runs classes together
// with duty words between them, and a greedier subject swallowed the word before
// it ("Playground CE 8A").
const CLASS_HEAD = /([A-Z][A-Za-z]*) (\d[A-C]) \((\d+)\) -? ?(\d{3})\b/g;

/** Fold a lesson row's material into a class parsed from the day's text. */
function withLesson<T extends { code: string; links: LessonLink[] }>(c: T, lessons: Record<string, Lesson>) {
  const l = lessons[normalizeCode(c.code)];
  const seen = new Set(c.links.map((x) => canonicalUrl(x.url)));
  const links = c.links.concat(
    (l ? l.links : []).filter((x) => {
      const key = canonicalUrl(x.url);
      return seen.has(key) ? false : seen.add(key);
    })
  );
  return {
    ...c, links,
    page: l ? l.page : "",
    homework: l ? l.homework : "",
    image: l ? l.image : "",
    video: l ? l.video : "",
  };
}

export function classesFromText(text: string, lessons: Record<string, Lesson> = {}): DayClass[] {
  // Horizontal runs only: the line breaks carry the Vertical tab's lesson shape.
  const t = String(text || "").replace(/[^\S\n]+/g, " ");
  const starts: number[] = [];
  const re = new RegExp(CLASS_HEAD.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) starts.push(m.index);
  const out: DayClass[] = [];
  const seen = new Set<string>();
  starts.forEach((from, i) => {
    const chunk = t.slice(from, i + 1 < starts.length ? starts[i + 1] : undefined);
    const c = parseClassText(chunk);
    if (c.duty || !c.subj) return;
    const key = `${c.subj}|${c.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      ...withLesson(
        {
          subj: c.subj, room: c.room, code: c.code, today: c.today, q: c.q,
          plan: c.plan, assign: c.assign, remind: c.remind, links: c.links,
        },
        lessons
      ),
      start: null,
    });
  });
  return out;
}

/**
 * The day's plan, by weekday.
 *
 * Two tabs carry it. Vertical is laid out a row per period — column A the time,
 * columns F to J Monday to Friday — so when a row has both a time and a class in
 * the weekday's column, the class gets its time. VerticalAi holds the same
 * columns without the times (its range starts at D, so the weekday number is the
 * column index there; Vertical starts at A, so it is the weekday plus three).
 *
 * A row that yields several classes gives its time to the first of them; if no
 * row pairs up at all, the whole column is read as one run of text, which is how
 * it worked before any times were available.
 */
export function dayPlanByWeekday(
  verticalAi: string[][],
  lessons: Record<string, Lesson> = {},
  vertical: string[][] = []
): Record<number, DayClass[]> {
  const out: Record<number, DayClass[]> = {};
  for (let wd = 2; wd <= 6; wd += 1) {
    // The AI-written column does not always keep the lesson code, but the
    // column it was written from does. Collect the codes that appear for each
    // subject on Vertical, in order, and hand them to any class that arrives
    // without one — a subject that runs twice in a day gets its two codes in
    // the order they are written.
    const codes = new Map<string, string[]>();
    for (const row of vertical || []) {
      const text = String((row || [])[wd + 3] || "");
      if (!text) continue;
      for (const c of classesFromText(text)) {
        if (!c.code) continue;
        const list = codes.get(c.subj) || [];
        if (!list.includes(c.code)) list.push(c.code);
        codes.set(c.subj, list);
      }
    }
    const takeCode = (subj: string) => {
      const list = codes.get(subj);
      return list && list.length ? (list.shift() as string) : "";
    };

    // Vertical is the spine — it carries the times and the codes — but it is the
    // teacher's shorthand. VerticalAi is the same lessons written for the room,
    // so where both describe the same class the AI wording is what gets shown.
    const written = new Map<string, DayClass>();
    for (const row of verticalAi || []) {
      const text = String((row || [])[wd] || "");
      if (!text) continue;
      for (const c of classesFromText(text)) {
        if (!c.today) continue;
        const byBoth = `${c.subj}|${c.code}`;
        if (!written.has(byBoth)) written.set(byBoth, c);
        if (!written.has(c.subj)) written.set(c.subj, c);
      }
    }
    const asWritten = (c: DayClass): DayClass => {
      const a = written.get(`${c.subj}|${c.code}`) || written.get(c.subj);
      if (!a || !a.today || a.today === c.today) return c;
      const seenUrl = new Set(c.links.map((x) => canonicalUrl(x.url)));
      return {
        ...c,
        today: a.today,
        q: a.q || c.q,
        plan: a.plan.length ? a.plan : c.plan,
        assign: a.assign.length ? a.assign : c.assign,
        links: c.links.concat(
          a.links.filter((x) => {
            const k = canonicalUrl(x.url);
            return seenUrl.has(k) ? false : seenUrl.add(k);
          })
        ),
      };
    };

    const rows: DayClass[] = [];
    const seen = new Set<string>();
    const n = Math.max((vertical || []).length, (verticalAi || []).length);
    // Rows that carry a time go first, so that when the same class also appears
    // in a run-together cell it is the timed copy that survives the dedupe.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let r = 0; r < n; r += 1) {
        const vRow = (vertical || [])[r] || [];
        const aiRow = (verticalAi || [])[r] || [];
        const start = parseTime(String(vRow[0] || ""));
        if (pass === 0 ? start == null : start != null) continue;
        const text = String(vRow[wd + 3] || "") || String(aiRow[wd] || "");
        if (!text) continue;
        classesFromText(text).forEach((raw, i) => {
          const code = raw.code || takeCode(raw.subj);
          const key = `${raw.subj}|${code}`;
          if (seen.has(key)) return;
          // The same class can appear twice, once with its code and once
          // without, when both tabs carry the day. A subject can genuinely run
          // twice in a day, but only when the two carry different codes, so a
          // second copy with no code at all is an echo.
          if (!code && seen.has(`subj:${raw.subj}`)) return;
          seen.add(key);
          seen.add(`subj:${raw.subj}`);
          // The lesson's own material is looked up once the code is settled.
          const c = withLesson(asWritten({ ...raw, code }), lessons);
          rows.push({ ...c, start: i === 0 ? start : null });
        });
      }
    }
    if (rows.length) out[wd] = rows.some((c) => c.start != null)
      ? rows.slice().sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9))
      : rows;
  }
  return out;
}

/**
 * A key that identifies the thing a link points at, not the link's spelling.
 *
 * The same handout reaches the board by several routes — written into the lesson
 * text, on the Lessons row, attached to a phrase — and each copy can carry a
 * different query string ("/edit?tab=t.0", "/edit?usp=sharing", "/edit"). Google
 * files are identified by the id in the path, so the query is dropped for those;
 * everywhere else it is kept, since it usually names a different page.
 */
export function canonicalUrl(url: string): string {
  const u = String(url || "").trim().replace(/[.,;:)\]]+$/, "");
  const g = u.match(/^https?:\/\/(?:docs|drive)\.google\.com\/([a-z]+)\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]+)/i);
  if (g) return `google:${g[1].toLowerCase()}:${g[2]}`;
  const f = u.match(/^https?:\/\/forms\.gle\/([A-Za-z0-9_-]+)/i);
  if (f) return `forms.gle:${f[1]}`;
  return u
    .replace(/#.*$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** A readable name for a link when the words around it give nothing away. */
function linkKind(url: string): string {
  const u = String(url || "");
  if (/docs\.google\.com\/document/i.test(u)) return "Google Doc";
  if (/docs\.google\.com\/presentation/i.test(u)) return "Slides";
  if (/docs\.google\.com\/spreadsheets/i.test(u)) return "Sheet";
  if (/docs\.google\.com\/forms|forms\.gle/i.test(u)) return "Form";
  if (/\.pdf(\?|$)/i.test(u)) return "PDF";
  if (/drive\.google\.com/i.test(u)) return "Drive file";
  const host = (u.match(/^https?:\/\/([^/]+)/i) || [, ""])[1] || "";
  return host.replace(/^www\./i, "") || "Link";
}

/**
 * The handouts named in a lesson cell.
 *
 * The teacher writes them inline — "Complete the Introduction worksheet (or from
 * this link: https://…)" — so the URL is pulled out into something clickable and
 * the words that introduced it become its name. The text is handed back without
 * the URLs, which is also how the lesson bullets stop being half address bar.
 */
export function extractLinks(text: string): { links: LessonLink[]; clean: string } {
  const t = String(text || "");
  const links: LessonLink[] = [];
  const re = new RegExp(URL_RE.source, "g");
  let m: RegExpExecArray | null;
  let prevEnd = 0;
  while ((m = re.exec(t)) !== null) {
    const url = m[0].replace(/[.,;:)\]]+$/, "");
    // The words just before this link: since the previous link, back to the
    // last sentence break. Reading from the start of the sentence instead gave
    // every link in a long run the same opening words for a name.
    const before = t.slice(prevEnd, m.index);
    prevEnd = m.index + m[0].length;
    // A sentence break needs whitespace after it, or "p.7" splits mid-reference.
    let label = (before.split(/(?:[.!?•]\s+|\n|\s-\s|[[\];]\s*)/).pop() || "")
      .replace(/\(?\s*(?:or\s+)?(?:you\s+can\s+)?(?:get\s+it\s+|print\s+it\s+|available\s+)?(?:from\s+|use\s+|at\s+|via\s+)?(?:this\s+|the\s+)?link[s]?\s*:?\s*$/i, "")
      .replace(/\b(?:here|below|online|posted)\s*:?\s*$/i, "")
      .replace(/[\s(:,–—-]+$/, "")
      .replace(/\s+(?:at|from|via|on|in|to|of|for)\s*:?\s*$/i, "")
      .replace(/^[\s\-–—•)]+/, "")
      // "…by Wed List of all assignments" — the due date belongs to the link
      // before this one, not to this link's name.
      .replace(/^by\s+\S+(?:\s+\d{1,2})?\s+(?=[A-Z])/i, "")
      .replace(/^\s*(?:Assign|Reminders)\s*:\s*/i, "")
      .trim();
    if (label.length < 4) label = linkKind(url);
    links.push({ label: truncateWords(label, LABEL_MAX), url });
  }
  // Line breaks are kept: the Vertical tab writes a lesson over several lines
  // and the shape is what tells its title from its activities.
  const clean = t
    .replace(new RegExp(URL_RE.source, "g"), "")
    .replace(/\(\s*(?:or\s+)?(?:from\s+)?(?:this\s+)?link[s]?\s*:?\s*\)/gi, "")
    .replace(/\(?\s*(?:or\s+)?(?:from\s+)?this\s+link[s]?\s*:?/gi, "")
    .replace(/[^\S\n]*\(\s*\)/g, "")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .replace(/[^\S\n]+([.,;:])/g, "$1")
    .trim();
  // Same handout named twice in one cell is one handout.
  const seen = new Set<string>();
  return {
    links: links.filter((l) => {
      const key = canonicalUrl(l.url);
      return seen.has(key) ? false : seen.add(key);
    }),
    clean,
  };
}

/**
 * A lesson as the Vertical tab writes it: the header line, then a line carrying
 * the lesson code and the lesson's title after a colon, then the activities, and
 * finally an "[Assign: …]" block. The code is marked with a bullet or a tilde
 * rather than wrapped in brackets, which is why the DisplayAI header pattern
 * does not see it.
 */
function verticalLesson(rest: string, known: string): { code: string; today: string; plan: string[]; assign: string[] } {
  // Emoji out, bullet characters kept: the assignment block uses them to
  // separate its points.
  const body0 = rest.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uFE0F\u200D\u2600-\u27BF]/g, " ").trim();
  const cm = body0.match(/^[^\n]*?[\u25CF\u25CB\u25AA\u2022~*]?\s*([A-Z]\d{3})\s*:?\s*/);
  const code = cm ? cm[1] : known;
  let body = cm ? body0.slice(cm[0].length) : body0;

  // The assignment block runs to the last bracket.
  let assign: string[] = [];
  const open = body.search(/\[\s*Assign/i);
  if (open >= 0) {
    const close = body.lastIndexOf("]");
    const inner = body.slice(open, close > open ? close : undefined).replace(/^\[\s*Assign:?\s*/i, "");
    assign = inner
      .split(/\n|(?=[\u25CF\u25CB\u25AA\u2022]\s*[A-Z])/)
      .map((x) => x.replace(/^[\s\-\u2013\u2014\u2022\u25CF\u25CB\u25AA]+/, "").replace(/[\s:;,]+$/, "").trim())
      .filter((x) => x.length > 2);
    body = body.slice(0, open);
  }

  const lines = body.split("\n").map((x) => x.replace(/[\s;:,-]+$/, "").trim()).filter((x) => x.length > 1);
  return { code, today: lines.shift() || "", plan: lines, assign };
}

export function parseClassText(text: string) {
  // Handouts come out first: the lesson text reads better without the addresses,
  // and a URL's own "?" no longer gets mistaken for the lesson's question.
  const { links, clean } = extractLinks(String(text || ""));
  const raw = clean;                       // line breaks kept, for the Vertical shape
  const t = clean.replace(/\s+/g, " ").trim();
  // "Math 7B (23) 207 (J001)" — the lesson code is optional, because the day's
  // plan on the VerticalAi tab writes some classes without one.
  const m = t.match(/^(.+?) \((\d+)\) -? ?(\d{3})(?: \(([A-Z]\d{3}))?/);
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
      links,
    };
  }
  // With a code the header runs on into "J003 📷 📿)", so the rest starts after
  // that bracket; without one it starts straight after the room, and eating to
  // the next ")" would swallow the lesson.
  const afterHeader = t.slice(m[0].length);
  const rest = m[4] ? afterHeader.replace(/^[^)]*\)\s*/, "") : afterHeader.trim();
  const today = (rest.match(/(Today we[^.?!]*[.?!])/) || [, ""])[1] || "";
  const q = ((rest.match(/([^.?!]*\?)/) || [, ""])[1] || "").trim();
  const body = (rest.match(/\?(.*?)(?:Reminders:|$)/) || [, ""])[1] || "";
  const bullets = body
    .split(/\s-\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  const remind = ((rest.match(/Reminders:\s*(.*)$/) || [, ""])[1] || "").trim();
  const sec = (m[1].match(/(\d[A-C])\b/) || [, ""])[1] || "";
  const plan = bullets.filter((b) => !/^Assign:/i.test(b));
  const assign = bullets.filter((b) => /^Assign:/i.test(b)).map((b) => b.replace(/^Assign:\s*/i, ""));

  // The Vertical tab writes a lesson in a different shape from DisplayAI's, over
  // several lines rather than one:
  //   Math 7A (23) 202
  //   ●J001  : Introduction: Overview, expectations, textbook, etc.
  //   Slides presentation on Math [Assign: … ]🔍
  // Nothing above finds anything in that, so it is read here instead.
  const restRaw = raw.slice(m[0].length);
  // A line carrying the code after a bullet, or an "[Assign: …]" block, is the
  // Vertical shape saying so. Waiting for the DisplayAI patterns to find nothing
  // was not enough: a title that ends in a question mark was being read as the
  // lesson's question, leaving the code and its emoji on screen as the heading.
  const looksVertical =
    /^[^\n]{0,40}[\u25CF\u25CB\u25AA\u2022~*]\s*[A-Za-z]\d{3}/.test(restRaw.trim())
    || /\[\s*Assign:/i.test(restRaw);
  const bare = !today && !plan.length && !assign.length;
  const v = looksVertical || bare ? verticalLesson(restRaw, m[4] || "") : null;

  return {
    duty: false,
    rec: false,
    subj: m[1].trim(),
    sec,
    room: "Rm " + m[3],
    code: (v ? v.code : "") || m[4] || "",
    today: v ? v.today : today,
    q: v ? "" : q,
    plan: v ? v.plan : plan,
    assign: v ? v.assign : assign,
    remind,
    links,
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
  // A code with no text label ("A-1000") is the digits themselves, in the order
  // the legend beside the points table lists the benefits: Benefit 1, Benefit 2,
  // Benefit 3. Without this they all read as "no benefits".
  const digits = label.match(/^([01])([01])([01])[01]?$/);
  const f = digits
    ? [digits[3] === "1", digits[1] === "1", digits[2] === "1"] as [boolean, boolean, boolean]
    : map[label] || [false, false, false];
  return { rec: false, letter: m[1] || "", grace: !!m[2], FD: f[0], B1: f[1], B2: f[2], extra: !!m[4], raw };
}

/**
 * What each benefit actually is, in the sheet's own words.
 *
 * From the legend beside the points table: Benefit 1 is earned by two days in a
 * row at that level and is "Sit Anywhere" or a snack; Benefit 2 is the washroom
 * pass, one at a time, on a single day; Benefit 3 is an extra Formal Discussion
 * for a week's average at that level. The trailing 4 on a code is the bonus of
 * two for being perfect the whole class.
 */
export const BENEFIT_WORDS = { B1: "Free seat", B2: "Free pass", FD: "Extra FD" };

/** The sheet's own name for a set of benefits, so its colour rules still apply. */
export function benefitLabel(on: { B1: boolean; B2: boolean; FD: boolean }): string {
  if (on.B1 && on.B2 && on.FD) return "All 3";
  if (on.B1 && on.B2) return "B1 & B2";
  if (on.FD && on.B1) return "FD & B1";
  if (on.FD && on.B2) return "FD & B2";
  if (on.FD) return "FD Only";
  if (on.B1) return "B1";
  if (on.B2) return "B2";
  return "";
}

/**
 * The privilege code as words.
 *
 * "AB1 & B2" is the sheet's shorthand, and the colour is what the room reads
 * from the back — but the words are what a student acts on, so the badge carries
 * those and keeps the code in its tooltip.
 */
export function statusWords(
  status: string,
  when?: { elapsed: number; seatMin: number; laterMin: number }
): { letter: string; words: string; grace: boolean; code: string } | null {
  const st = parseStatus(status);
  if (!st) return null;
  if (st.rec) return { letter: "", words: "Recess", grace: false, code: st.raw };
  // Each benefit has its moment in the period. The free seat belongs to the
  // first few minutes — change seats, settle, and the lesson can start — while
  // the pass and the extra Formal Discussion wait out the teaching at the top of
  // the class and then stay for the rest of it. All three together is the whole
  // class's reward and shows from the first minute.
  const all = st.B1 && st.B2 && st.FD;
  const on = {
    B1: st.B1 && (all || !when || when.elapsed <= when.seatMin),
    B2: st.B2 && (all || !when || when.elapsed >= when.laterMin),
    FD: st.FD && (all || !when || when.elapsed >= when.laterMin),
  };
  const label = benefitLabel(on);
  const words = label === "All 3"
    ? "All 3"
    : [on.B1 && BENEFIT_WORDS.B1, on.B2 && BENEFIT_WORDS.B2, on.FD && BENEFIT_WORDS.FD]
      .filter(Boolean).join(" + ");
  // Rebuilt in the sheet's own shorthand so its conditional formatting colours
  // what is actually on offer, rather than what was earned but is not available.
  const code = label ? `${st.letter}${st.grace ? "-" : ""}${label}${st.extra ? " 4" : ""}` : "";
  return { letter: st.letter, words: words && st.extra ? `${words} +2` : words, grace: st.grace, code };
}

/**
 * "Plans for Thursday, Sep 10, 2026...   -660--871--220--820--290-" → title
 * and one point value per class.
 *
 * Each class's value is written "-value-", so two neighbours share the run of
 * dashes between them: two dashes when both wrappers are written out, one when
 * the sheet joins them, and three when the value itself is negative ("--871").
 * Splitting on the dash and counting the empty pieces tells those apart. A
 * regex could not: matching "-660-" ate the dash that started "-871-", so on a
 * sheet written with single dashes every second class vanished from the strip
 * — four classes showed as two.
 */
export function parsePlansLine(s: string) {
  const t = String(s || "");
  const title = (t.match(/^((?:Plans|That's it) for [^.]*\.{3})/) || [, t.trim()])[1] || t.trim();
  const tail = t.slice(title.length);
  const values: number[] = [];
  let percent = false;
  let gap = 0;
  for (const raw of tail.split("-")) {
    const piece = raw.trim();
    if (!piece) { gap += 1; continue; }
    // The first value can carry a marker — the sheet writes "*10" on a day it
    // wants flagged — and dropping the piece dropped that class and shifted
    // every later one a place to the left.
    const m = piece.match(/^[*+~!#\u2020]?\s*(\d+(?:\.\d+)?)(%?)$/);
    if (m) {
      if (m[2] === "%") percent = true;
      values.push(parseFloat(m[1]) * (gap >= 2 ? -1 : 1));
    }
    gap = 0;
  }
  if (!values.length) return { title, kind: null as null | "numbers" | "percents", values: [] as number[] };
  return { title, kind: (percent ? "percents" : "numbers") as "numbers" | "percents", values };
}

/**
 * Each class's points, from the cells the sheet's own plans line is built out of.
 *
 * That line reads `Setup!F35 & Setup!K35 & "-"` for each class, using K on an odd
 * minute and L on an even one — the alternation is only because one cell can
 * hold one number at a time. Reading F, K and L directly gives the board the
 * label, the total and the percentage together, so both can be on screen at once
 * and neither has to be caught on the right minute.
 *
 * A class counts only when its column in Points row 2 has something in it, which
 * is the same test the line makes: G, T, AG, AT, BG, BT — every thirteenth
 * column, the blocks the Points tab is laid out in.
 */
export type ClassPoints = { name: string; total: number | null; percent: number | null };

const POINTS_PRESENT_COLS = [7, 20, 33, 46, 59, 72]; // G, T, AG, AT, BG, BT
const PLANS_FIRST_ROW = 35; // Setup rows 35 to 40, one per class

export function pointsFromSetup(setup: string[][], pointsGrid: string[][]): ClassPoints[] {
  const cell = (rows: string[][], row: number, col: number) =>
    String(((rows || [])[row - 1] || [])[col - 1] ?? "").trim();
  const value = (s: string): number | null => {
    const n = parseFloat(s.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const out: ClassPoints[] = [];
  for (let i = 0; i < POINTS_PRESENT_COLS.length; i += 1) {
    if (!cell(pointsGrid, 2, POINTS_PRESENT_COLS[i])) continue; // no such class this year
    const row = PLANS_FIRST_ROW + i;
    const name = cell(setup, row, 6).replace(/[\s:.\-]+$/, ""); // F
    // Which of the pair is the percentage is decided by the cell that says so,
    // not by which column it sits in — a sheet is free to keep them the other
    // way round, and a total rendered as "660%" would be nonsense.
    const k = cell(setup, row, 11);
    const l = cell(setup, row, 12);
    const kPct = k.includes("%");
    const lPct = l.includes("%");
    const total = value(kPct && !lPct ? l : k);
    const percent = value(kPct && !lPct ? k : l);
    if (!name && total == null && percent == null) continue;
    out.push({ name, total, percent });
  }
  return out;
}

/**
 * The class names from Points row 3, left to right — the order the plans line
 * writes its values in. Reading them from the sheet is what lets the strip
 * name the sections actually taught this year rather than a fixed 7A…8C list,
 * which mislabelled every chip after a dropped section.
 */
export function pointsLabels(row3: string[]): string[] {
  return POINTS_NAME_COLS.map((c) => String((row3 || [])[c - 1] || "").trim()).filter(Boolean);
}

function num(s: string, d: number): number {
  const n = parseFloat(String(s || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : d;
}

/**
 * The "Before you head out today…" cell (DisplayAI C15). Its shape varies —
 * "1) … 2) …", "① … ② …", or " - " separated — and it ends with a blessing
 * introduced by "receive this blessing:" or "before you go today…". The list
 * and the blessing are wanted in different places on the board, so they are
 * split apart here.
 */
export function splitHeadout(text: string): { items: string[]; blessing: string } {
  const body = String(text || "").replace(/^[^:]{0,80}?:\s*/, "").trim();
  const marker = body.match(/(?:and as you go,?\s*)?(?:receive this blessing:|before you go today[.\s]*)/i);
  const listPart = marker ? body.slice(0, marker.index) : body;
  const blessing = marker ? body.slice((marker.index || 0) + marker[0].length).trim() : "";
  // Items are separated by "1)", "\u2460", or " - ". Whatever sits before the first
  // of those is a lead-in ("Make sure \u2026"), not an item, so it is dropped.
  const chunks = listPart.split(/(?:^|\s)(?:\d[).]|[\u2460-\u2473]|-)\s+/);
  const items = (chunks.length > 1 ? chunks.slice(1) : chunks)
    .map((x) => x.replace(/\s*(?:\.{2,}|\u2026)\s*$/, "").trim())
    .filter((x) => x.length > 2);
  return { items, blessing };
}

/**
 * Setup's "For Dismissal Messages" block (columns N to Q): a label and a time
 * per row — Lunch, Lunch Recess, Dismissal — and, in column Q, how many
 * minutes before each of them the end-of-day package starts showing.
 */
export function parseDismissal(rows: string[][]): Dismissal {
  const out: Dismissal = { advanceMin: 5, times: [] };
  for (const r of rows || []) {
    const label = (r[0] || "").trim();
    const at = parseTime(r[1] || "");
    if (label && at !== null && !/^for /i.test(label)) out.times.push({ label, at });
    const q = (r[3] || "").trim();
    if (/^\d+$/.test(q)) out.advanceMin = parseInt(q, 10);
  }
  out.times.sort((a, b) => a.at - b.at);
  return out;
}

/**
 * The Kiss & Ride tab's "Waiting (Recent First)…" column: the header cell is
 * found by its text rather than a fixed address, then the names below it are
 * taken until the column runs out.
 */
export function parseWaiting(rows: string[][]): string[] {
  let hr = -1;
  let hc = -1;
  for (let r = 0; r < (rows || []).length && hr < 0; r += 1) {
    for (let c = 0; c < (rows[r] || []).length; c += 1) {
      if (/waiting/i.test((rows[r][c] || "").trim())) { hr = r; hc = c; break; }
    }
  }
  if (hr < 0) return [];
  const out: string[] = [];
  let blanks = 0;
  for (let r = hr + 1; r < rows.length && out.length < 12 && blanks < 3; r += 1) {
    const v = ((rows[r] || [])[hc] || "").trim();
    if (!v) { blanks += 1; continue; }
    blanks = 0;
    out.push(v);
  }
  return out;
}

/**
 * The bell schedule from Vertical column A.
 *
 * The column is read for 200 rows and only the first block of it is the day's
 * timetable — further down it can hold anything. So a time is taken only while
 * it is a school-day time and later than the one before it; the first value
 * that breaks that run ends the schedule. A stray value must never become a
 * bell, because a bell cuts a class short.
 */
export function bellSchedule(rows: string[][]): number[] {
  const out: number[] = [];
  for (const r of rows || []) {
    const at = parseTime(String((r || [])[0] || ""));
    if (at == null) continue;
    if (at < 5 * 60 || at > 21 * 60) continue;
    if (out.length && at <= out[out.length - 1]) break;
    out.push(at);
  }
  return out;
}

/**
 * The greeting, evaluated against the board's clock.
 *
 * A1 is a NOW() formula like every other display cell:
 *   before noon  \u2014 "Enjoy your lunch, " past 11:55, otherwise "Good morning, "
 *   after noon   \u2014 "Good afternoon, " up to the dismissal time, then "Goodbye, "
 * followed by the name for the weekday from Setup column M ("everyone",
 * "hard-workers", "JH Students" \u2026). Reading its result would freeze it to the
 * sheet's clock, so the board works it out itself and the scrubber moves it.
 *
 * Returns "" when column M has nothing for the day, so the caller can fall back
 * to A1 as read.
 */
export function evaluateGreeting(
  audiences: string[],
  minutes: number,
  dismissalAt: number | null,
  weekday: number
): string {
  const who = String(audiences[weekday - 2] || "").trim();
  if (!who) return "";
  const opening = minutes < 12 * 60
    ? (minutes > 11 * 60 + 55 ? "Enjoy your lunch" : "Good morning")
    : (dismissalAt != null && minutes <= dismissalAt ? "Good afternoon" : "Goodbye");
  return `${opening}, ${who}!`;
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
    // No such row in the sheet yet; add one labelled "Stand ready for dismissal"
    // with the minutes in column C to change it from five.
    else if (/^(stand ready|get ready|dismissal ready)/.test(label)) out.dismissalReadyMin = num(c, out.dismissalReadyMin);
    else if (label.startsWith("show pregnancy weeks")) out.graceMin = num(d, out.graceMin);
    else if (label.startsWith("can go to washroom")) out.washroomBefore = num(d, out.washroomBefore);
    else if (label.startsWith("snacks are allowed")) out.snacksB2Min = num(c, out.snacksB2Min);
    // No such row in the sheet yet; add one labelled "Free seat for" with the
    // minutes in column C to change it from five.
    else if (/^(free seat|seat change|sit anywhere)/.test(label)) out.seatMin = num(c, out.seatMin);
    // No such row in the sheet yet; add one labelled "O Canada for" with the
    // minutes in column C to change it from five.
    else if (/^(o canada|anthem)/.test(label)) out.anthemMin = num(c, out.anthemMin);
  }
  return out;
}

export type RawInputs = {
  display: string[][]; // DisplayAI!A1:F40 formatted values
  displayD: string[][]; // DisplayAI!D1:D40 formulas
  displayC: string[][]; // DisplayAI!C1:C40 formulas (hyperlinks inside lesson cells)
  setup: string[][]; // Setup!A1:F20 values
  slots: string[][]; // Setup!U1:AB8 values
  slotFormulas: string[][]; // Setup!U4:AB4 formulas
  feature: string; // Display!E1 (or DisplayAI!E1) formatted value
  featureFormula?: string; // the same cell as a formula — an =IMAGE() has no text value
  // Ingredients for the sheet's own display rules, so the board can evaluate
  // them against its own clock (see evaluateFeature / evaluateDailyText).
  poems?: string[][]; // Poems!F1:J3 values
  poemFormulas?: string[][]; // Poems!F1:J3 formulas
  vertical?: string[][]; // VerticalAi!D1:J200 values
  riddles?: string[][]; // Riddles!D1:D400 values
  master?: string[][]; // Master!B1:B2 values
  pointsGrid?: string[][]; // Points!A1:BV46 — row 3 the class names, row 46 the flags, the days in between
  pointsRow3?: string[]; // Points row 3 — class names
  pointsRow46?: string[]; // Points row 46 — four flags per class
  slotBlock?: string[][]; // Setup!S1:AB8 values — the whole block, S2 included
  slotBlockFormulas?: string[][]; // Setup!S1:AB8 formulas — what the board evaluates itself
  displayLinks?: string[][]; // DisplayAI!A1:F40 cell links (rich text and HYPERLINK alike)
  displayCRuns?: { text: string; url: string }[][]; // every link inside each DisplayAI!C cell
  setupMessages?: string[][]; // Setup!M1:Q8 — column M the weekday names, N to Q the message block
  waiting?: string[][]; // the Kiss & Ride tab, for its "Waiting (Recent First)" column
  verticalTimes?: string[][]; // Vertical!A1:J200 — column A the period times
  lessons?: string[][]; // Lessons!C1:K400 values — the teacher's own material by code
  lessonFormulas?: string[][]; // Lessons!C1:K400 formulas
  lessonLinkRuns?: { text: string; url: string }[][][]; // links inside Lessons E to K
  verses?: string[][]; // Verses!A1:A400 — the source A5 picks the day's verse from
  verseWeek?: string[][]; // Vertical!B4 — the week number A5 indexes with
  // The tabs the Setup slot rules reach into, so the board can run them itself.
  displayTab?: string[][]; // Display!A1:F20
  poemsAB?: string[][]; // Poems!A1:B60
  memoryCards?: string[][]; // MemoryCards!H1:H40
  vocab?: string[][]; // Vocab!A1:B60
  masterWide?: string[][]; // Master!A1:K2
  subjects?: string[][]; // Subjects!U1:U40
  mathChallenge?: string[][]; // MathChallenge!A1:C60
  cellImages?: string[][]; // BoardImages!A2:B200 — cell address, durable picture address
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
    blessing: "",
    tomorrow: "",
    riddle: "",
    feature: isErr(inp.feature || "") ? "" : (inp.feature || "").trim(),
    featureImage: "",
    pray: null as null | { text: string; url: string },
    other: "",
  };

  // E1 may hold a picture rather than words: =IMAGE("…"), a hyperlink to one, or a
  // bare image URL. An =IMAGE() cell has no text value at all, so the formula is
  // the only place the URL shows up. When there is a picture, the board gives it
  // the big slot and does not also print the URL as text.
  const cellImages = buildCellImages(inp.cellImages || []);
  {
    const fromFormula = urlFromFormula(inp.featureFormula || "");
    const fromValue = (meta.feature.match(URL_RE) || [])[0] || "";
    // A picture put into E1 itself has neither, so the sheet's script records it.
    const recorded = cellImages[cellImageKey("Display!E1")] || cellImages[cellImageKey("DisplayAI!E1")] || "";
    const url = [fromFormula, fromValue].find((u) => u && isImageUrl(u)) || recorded;
    if (url) {
      meta.featureImage = normalizeImageUrl(url);
      if (!meta.feature || meta.feature === url) meta.feature = "";
    }
  }
  const points: Points = { numbers: null, percents: null, entered: null, ...writingOwed(inp.pointsGrid || [], inp.pointsRow3 || []) };
  // The cells the sheet builds its own plans line from carry the total and the
  // percentage side by side, so the board takes them from there rather than
  // reading whichever of the two the line happened to be showing at the moment
  // it was fetched. The line itself is still parsed, as the fallback.
  const classPoints = pointsFromSetup(inp.setup || [], inp.pointsGrid || []);

  // ---- header cells (rows above the first time row) ----
  const firstTimeRow = rows.findIndex((r) => parseTime(r[0] || "") !== null);
  const headerRows = firstTimeRow < 0 ? rows : rows.slice(0, firstTimeRow);
  headerRows.forEach((r, i) => {
    const a = (r[0] || "").trim();
    const c = (r[2] || "").trim();
    // "Pray for Albania" — the nation of the day. The link may be a HYPERLINK()
    // formula, a rich-text link on the cell (which lives in neither the value
    // nor the formula), or a bare URL in the text, so all three are tried.
    if (!meta.pray) {
      for (let col = 0; col < 6; col += 1) {
        const text = (r[col] || "").trim();
        if (!/^pray\b/i.test(text)) continue;
        const formula = col === 2 ? cell(inp.displayC, i, 0) : "";
        const url =
          cell(inp.displayLinks || [], i, col) ||
          urlFromFormula(formula) ||
          (text.match(URL_RE) || [])[0] ||
          "";
        meta.pray = { text: text.replace(URL_RE, "").trim(), url };
        break;
      }
    }
    // "Tomorrow: MAPS Roster Due" — merged across A:C, so any column may carry it.
    if (!meta.tomorrow) {
      for (let col = 0; col < 6; col += 1) {
        const text = (r[col] || "").trim();
        if (/^Tomorrow\s*:/i.test(text)) { meta.tomorrow = text.replace(/^Tomorrow\s*:\s*/i, "").trim(); break; }
      }
    }
    if (!meta.greeting && /^Good (morning|afternoon|evening)/i.test(a)) meta.greeting = a;
    else if (!meta.line && /^Week\s*\d+/i.test(a)) meta.line = a.split(/\s{2,}/).join(" · ");
    else if (!meta.verse && a.length > 40 && !/^Q:/.test(a)) meta.verse = a;
    else if (!meta.riddle && /^Q:/.test(a)) meta.riddle = a;
    if (/UNSCRAMBLE/i.test(c)) meta.puzzle = c.replace(/\s*(_\s*)+$/g, "").trim();
    // Past four o'clock the same cell says "That's it for …" instead.
    if (/^(Plans|That's it) for/i.test(c)) {
      const p = parsePlansLine(c);
      meta.plans = p.title;
      if (p.kind === "numbers") points.numbers = p.values;
      if (p.kind === "percents") points.percents = p.values;
      const d = (r[3] || "").trim();
      if (d !== "") points.entered = d === "1" || /^true$/i.test(d);
    }
    if (/^Q:/.test(c) && !meta.riddle) meta.riddle = c;
  });

  // Whatever the line was showing when it was read, the paired cells are the
  // better answer: both numbers at once, for the classes that exist this year.
  if (classPoints.length) {
    if (classPoints.some((c) => c.total != null)) points.numbers = classPoints.map((c) => c.total ?? 0);
    if (classPoints.some((c) => c.percent != null)) points.percents = classPoints.map((c) => c.percent ?? 0);
  }

  // ---- period rows ----
  const lessons = parseLessons(inp.lessons || [], inp.lessonFormulas || [], inp.lessonLinkRuns || [], cellImages);
  const periods: Period[] = [];
  for (let i = firstTimeRow; i >= 0 && i < rows.length; i++) {
    const r = rows[i] || [];
    const start = parseTime(r[0] || "");
    if (start === null) continue;
    const text = (r[2] || "").trim();
    if (/^Before you head out/i.test(text) || /^Make sure\s*\.\.\./i.test(text)) {
      const parsed = splitHeadout(text);
      meta.headout = parsed.items;
      meta.blessing = parsed.blessing;
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
    const parsed = parseClassText(text);
    const candidates = [urlFromFormula(dFormula), urlFromFormula(cFormula), ...(text.match(URL_RE) || [])].filter(Boolean);
    // The row's own link wins; otherwise the video on the lesson's Lessons row.
    const video = candidates.find(isVideoUrl) || (lessons[normalizeCode(parsed.code)] || { video: "" }).video || "";
    // A handout can be a rich-text link on the lesson cell rather than a URL in
    // its words; those live in neither the value nor the formula, so they come
    // from the grid and are merged in here.
    const runLinks = ((inp.displayCRuns || [])[i] || [])
      .filter((l) => l.url && !isVideoUrl(l.url))
      .map((l) => ({ label: truncateWords(l.text || linkKind(l.url), 44), url: l.url }));
    const seenLink = new Set(parsed.links.map((l) => canonicalUrl(l.url)));
    const links = parsed.links.concat(
      runLinks.filter((l) => {
        const key = canonicalUrl(l.url);
        return seenLink.has(key) ? false : seenLink.add(key);
      })
    );
    // The teacher's own material for this lesson code: handouts, the starting
    // page, the homework, the picture and the video, none of which the
    // student-facing tabs carry.
    const withMat = withLesson({ code: parsed.code, links }, lessons);
    periods.push({
      start,
      end,
      text,
      status: (r[3] || "").trim(),
      flag: (r[5] || "").trim(),
      video,
      empty: text === "",
      ...parsed,
      links: withMat.links,
      page: withMat.page,
      homework: withMat.homework,
      image: withMat.image,
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

  return {
    fetchedAt: now.toISOString(), meta, periods, points, setup, picture,
    dismissal: parseDismissal((inp.setupMessages || []).map((r) => (r || []).slice(1))),
    audiences: (inp.setupMessages || []).map((r) => String((r || [])[0] || "").trim()),
    dayTimes: bellSchedule(inp.verticalTimes || []),
    dayPlan: dayPlanByWeekday(inp.vertical || [], lessons, inp.verticalTimes || []),
    waiting: parseWaiting(inp.waiting || []),
    sources: buildSources(inp),
    slotBlock: inp.slotBlock || [],
    slotBlockFormulas: inp.slotBlockFormulas || [],
  };
}

/* ------------------------------------------------------------------ *
 * Live evaluation of the sheet's own display formulas
 *
 * The Display tab computes two cells from NOW(): the daily-update text and
 * the feature cell E1. Reading their results would freeze the board to the
 * sheet's clock, so the board reads the *ingredients* instead and evaluates
 * the same rules against its own clock — which is what makes the scrubber
 * move them, and what lets an =IMAGE() slot be seen at all.
 * ------------------------------------------------------------------ */

export type Slot = {
  priority: number | null;
  name: string;
  value: string; // row 4 as the sheet computed it, at the sheet's clock
  formula: string; // row 4's rule, which the board re-runs at its own clock
  content: string; // row 3 — the condition that decides whether the rule fires
  contentFormula: string;
  generator: string; // row 5 — a rule that writes row 4 when row 4 is only a value
};

export type Sources = {
  windowStart: number | null; // Setup!C12
  windowEnd: number | null; // Setup!D12
  offsetHours: number; // A7 — the hours the feature cell subtracts from NOW()
  b7: boolean; // manual-message checkbox
  d7: boolean; // lesson-picture checkbox
  a9: number | null; // DisplayAI!A9 — the verse shows in full for 20 min from here
  a11: number | null; // first time row; the daily text shortens past it
  poemRow: string[]; // Poems!F2:J2, Monday to Friday
  poemF3: string; // Poems!F3
  poemF3Formula: string;
  poemGrid: string[][]; // Poems!F1:J3 values — the anthem's flag and words by weekday
  poemGridFormulas: string[][]; // the same as formulas, where an =IMAGE() hides
  verticalRow: string[]; // VerticalAi row keyed 1, columns D to J
  slots: Slot[]; // Setup!U1:AB4
  book: Book; // the grids a Setup formula may reach, for evaluating it here
  riddle: string; // Riddles!D at the week in Master!B2
  verses: string[]; // Verses!A — the whole column, indexed the way A5 indexes it
  verseWeek: number | null; // Vertical!B4
  pointsClasses: PointsClass[]; // for the D-column status rule
  pointsLabels: string[]; // Points row 3 — the classes taught this year, in order
  cellImages: CellImages; // the pictures the API cannot see, by cell
};

export const EMPTY_SOURCES: Sources = {
  windowStart: null, windowEnd: null, offsetHours: 0, b7: false, d7: false, a9: null, a11: null,
  poemRow: [], poemF3: "", poemF3Formula: "", poemGrid: [], poemGridFormulas: [],
  verticalRow: [], slots: [], riddle: "",
  verses: [], verseWeek: null, pointsClasses: [], pointsLabels: [], book: {}, cellImages: {},
};

const truthy = (s: string) => /^(TRUE|1|YES)$/i.test(String(s || "").trim());

/** The picture inside a cell, if it holds one. */
function imageOf(value: string, formula: string): string {
  const url = [urlFromFormula(formula), (String(value || "").match(URL_RE) || [])[0]].find((u) => u && isImageUrl(u));
  return url ? normalizeImageUrl(url) : "";
}

export type FeatureResult = { text: string; image: string; source: string };

/**
 * The E1 rule, in the sheet's own order:
 *   poem window → manual message (B7) → lesson picture (D7) → the Setup slot
 *   table by priority 1..6 → the riddle before the window → nothing.
 *
 * Each slot's row 4 is its own timing rule — "the memory verse for the first
 * ten minutes of CE, but the picture in S2 on the last teaching day of the
 * week" — written against NOW(). Reading the cell's value gives the answer for
 * the moment of the read, so the scrubber could not move it; `at` re-runs the
 * rule at the time on the board instead. A formula the evaluator cannot follow
 * falls back to the value the sheet computed.
 *
 * One deliberate difference: the sheet tests each slot with `<>""`, and an
 * =IMAGE() cell has no text value, so the sheet skips its own picture slots.
 * Here a cell holding a picture counts as filled, which is why a flag put in
 * a slot reaches the board.
 */
export function evaluateFeature(src: Sources, minutes: number, at?: Date): FeatureResult {
  const ctx = at && src.book && Object.keys(src.book).length
    ? { book: src.book, now: at, sheet: "Setup", images: src.cellImages || {} }
    : null;
  // The slot as it reads at the time on the board, not at the time of the read.
  const live = (s: { value: string; formula: string; generator?: string }): string => {
    if (!ctx) return s.value.trim();
    // A slot whose row 4 is only a value keeps its rule in row 5; running that
    // is what makes the cell current rather than as last pasted.
    const rule = s.formula || (s.generator && !s.formula ? s.generator : "");
    return (rule ? evaluateOr(rule, s.value, ctx) : s.value).trim();
  };
  const out = (value: string, formula: string, source: string): FeatureResult => ({
    text: imageOf(value, formula) ? "" : String(value || "").trim(),
    image: imageOf(value, formula),
    source,
  });
  const t = minutes - (src.offsetHours || 0) * 60;

  if (src.windowStart != null && src.windowEnd != null && t >= src.windowStart && t <= src.windowEnd) {
    return out(src.poemF3, src.poemF3Formula, "Poems!F3 (poem window)");
  }
  const slotAt = (i: number) =>
    src.slots[i] || { priority: null, name: "", value: "", formula: "", content: "", contentFormula: "", generator: "" };
  if (src.b7) return out(live(slotAt(1)), slotAt(1).formula, "Setup!V4 (B7 ticked)");
  if (src.d7) {
    const z = slotAt(5);
    const zv = live(z);
    return zv || imageOf(zv, z.formula)
      ? out(zv, z.formula, "Setup!Z4 (D7 ticked)")
      : { text: "No class", image: "", source: "D7 ticked, Z4 empty" };
  }
  for (let p = 1; p <= 6; p += 1) {
    const s = src.slots.find((c) => c.priority === p);
    if (!s) continue;
    const value = live(s);
    const picture = imageOf(value, s.formula);
    const filled = picture ? true : value !== "" && !(p === 2 && value === "-");
    if (filled) return out(value, s.formula, `${s.name || "slot"} (priority ${p})`);
  }
  if (src.windowStart != null && minutes < src.windowStart && src.riddle) {
    return { text: src.riddle, image: "", source: "Riddles (before the window)" };
  }
  return { text: "", image: "", source: "nothing selected" };
}

/**
 * Cut a long line at a word boundary rather than mid-word.
 *
 * The sheet's A5 does LEFT(verse, 85), which lands wherever it lands — "in your
 * own strength you will fail? H". Here the cut backs up to the last space and
 * ends with an ellipsis instead.
 */
export function truncateWords(text: string, max: number): string {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const onBoundary = /\s/.test(t[max] || "");
  const sp = cut.lastIndexOf(" ");
  const kept = (onBoundary || sp <= max * 0.5 ? cut : cut.slice(0, sp)).replace(/[\s,;:.\u2014-]+$/, "");
  return `${kept}\u2026`;
}

/**
 * A value the sheet has already cut short, tidied.
 *
 * Used when the Verses tab cannot be read and the board only has A5's own
 * LEFT(…, 85) result: if it ends mid-word, back up to the last whole word.
 */
export function tidyTruncated(text: string, max = 85): string {
  const t = String(text || "").trim();
  if (t.length < max - 5 || /[.!?\u2026\u201d"\u2019']\s*$/.test(t)) return t;
  const sp = t.lastIndexOf(" ");
  if (sp <= 0) return t;
  return `${t.slice(0, sp).replace(/[\s,;:.\u2014-]+$/, "")}\u2026`;
}

/**
 * The verse rule from A5, evaluated against the board's clock.
 *
 * A5 picks a row of the Verses tab from the week (Vertical!B4) and the weekday,
 * wrapping round when it runs past the end of the column, and shows it in full
 * for twenty minutes from A9 and again for twenty minutes from A11 - otherwise
 * LEFT(..., 85), which lands mid-word.
 *
 * This returns the whole row and whether the full form is called for, leaving
 * the shortening to the caller: the board strips the cell's lead-in at "~"
 * first, so what gets cut is the scripture rather than the introduction.
 *
 * `text` is "" when the Verses tab cannot be read, so the caller can fall back
 * to the value of A5 itself.
 */
export function evaluateVerse(src: Sources, minutes: number, weekday: number): { text: string; open: boolean } {
  const shut = { text: "", open: false };
  if (!src.verses.length || src.verseWeek == null) return shut;
  const count = src.verses.filter((v) => String(v || "").trim() !== "").length;
  if (!count) return shut;
  const wanted = src.verseWeek * 5 + weekday - 1;
  const n = wanted > count ? wanted - count : wanted;
  const text = String(src.verses[n - 1] || "").trim();
  if (!text) return shut;
  const { a9, a11 } = src;
  const open =
    a9 != null &&
    minutes >= a9 &&
    (minutes < a9 + 20 || (a11 != null && minutes > a11 && minutes < a11 + 20));
  return { text, open };
}

/**
 * The daily-update rule: the weekday's poem inside the poem window, otherwise
 * the VerticalAi text for the weekday — its first two lines once the day has
 * started (past A11), in full before that. "Skip 7A " and friends come out.
 */
export function evaluateDailyText(src: Sources, minutes: number, weekday: number, inClass = false): string {
  const strip = (s: string) => String(s || "").replace(/Skip \d[A-C]\s*/g, "").trim();
  const t = minutes - (src.offsetHours || 0) * 60;

  if (src.windowStart != null && src.windowEnd != null && t >= src.windowStart && t < src.windowEnd) {
    return strip(src.poemRow[weekday - 2] || "");
  }
  const full = strip(src.verticalRow[weekday] || "");
  // The cell can be the whole day's plan, one class after another. Shortened to
  // its first lines that is always the *first* class of the day, so the History
  // screen carried Math's blurb in a panel headed "Today". Each class has its
  // own screen, so during one the day's plan has nothing to add.
  const isDayPlan = new RegExp(`^${CLASS_HEAD.source}`).test(full);
  if (isDayPlan) return inClass ? "" : full;
  if (src.a11 != null && minutes > src.a11) {
    const lines = full.split("\n");
    return strip(lines.slice(0, 2).join("\n"));
  }
  return full;
}

/**
 * The grids a Setup formula is allowed to reach.
 *
 * Only what the board already reads, and only what is small enough to travel in
 * the payload — a reference past these throws and the board falls back to the
 * value the sheet computed, which is what it did before it evaluated anything.
 */
function buildBook(inp: RawInputs): Book {
  return {
    setup: [
      { top: 1, left: 1, width: 16, height: 40, values: inp.setup || [] }, // A1:P40
      { top: 1, left: 13, width: 5, height: 8, values: inp.setupMessages || [] }, // M1:Q8
      { top: 1, left: 19, width: 10, height: 8, values: inp.slotBlock || [], formulas: inp.slotBlockFormulas || [] }, // S1:AB8
    ],
    master: (inp.masterWide || []).length
      ? [{ top: 1, left: 1, width: 11, height: 2, values: inp.masterWide || [] }] // A1:K2
      : [{ top: 1, left: 2, width: 1, height: 2, values: inp.master || [] }], // B1:B2
    display: [{ top: 1, left: 1, width: 6, height: 20, values: inp.displayTab || [] }], // A1:F20
    poems: [
      { top: 1, left: 1, width: 2, height: 60, values: inp.poemsAB || [] }, // A1:B60
      { top: 1, left: 6, width: 5, height: 3, values: inp.poems || [], formulas: inp.poemFormulas || [] }, // F1:J3
    ],
    memorycards: [{ top: 1, left: 8, width: 1, height: 40, values: inp.memoryCards || [] }], // H1:H40
    vocab: [{ top: 1, left: 1, width: 2, height: 60, values: inp.vocab || [] }], // A1:B60
    // The heads of Vertical and VerticalAi, out of reads the board already
    // makes: B4 is the week number several of the slot rules index with, and
    // F6:J14 is the day's plan the daily update is written from.
    vertical: [{ top: 1, left: 1, width: 11, height: 20, values: (inp.verticalTimes || []).slice(0, 20) }],
    verticalai: [{ top: 1, left: 4, width: 7, height: 20, values: (inp.vertical || []).slice(0, 20) }],
    subjects: [{ top: 1, left: 21, width: 1, height: 40, values: inp.subjects || [] }], // U1:U40
    mathchallenge: [{ top: 1, left: 1, width: 3, height: 60, values: inp.mathChallenge || [] }], // A1:C60
  };
}

/** Gather everything the two rules need out of the raw grids. */
export function buildSources(inp: RawInputs): Sources {
  const setupRow12 = inp.setup[11] || [];
  const row7 = inp.display[6] || [];
  const priorities = inp.slots[0] || [];
  const names = inp.slots[1] || [];
  const content = inp.slots[2] || []; // row 3 — the slot's own material
  const values = inp.slots[3] || []; // row 4 — the same, gated by the sheet's clock
  // The whole formula block when the route sent it, so row 3 comes through as
  // well as row 4; older payloads carry only row 4.
  const block = (inp.slotBlockFormulas || []).map((r) => (r || []).slice(2));
  const formulas = block[3] || (inp.slotFormulas || [])[0] || [];
  const contentFormulas = block[2] || [];
  // Row 5 is where a slot keeps the rule that writes its row 4 — the daily
  // update is generated there and pasted into row 4, so reading row 4 alone
  // gives whatever was pasted last, which can be a term out of date.
  const generators = block[4] || [];
  const slots: Slot[] = [];
  for (let i = 0; i < 8; i += 1) {
    const p = parseInt(String(priorities[i] || "").trim(), 10);
    slots.push({
      priority: Number.isFinite(p) ? p : null,
      name: (names[i] || "").trim(),
      value: (values[i] || "").trim(),
      formula: (formulas[i] || "").trim(),
      content: (content[i] || "").trim(),
      contentFormula: (contentFormulas[i] || "").trim(),
      generator: (generators[i] || "").trim(),
    });
  }
  const poems = inp.poems || [];
  const week = parseInt(String(((inp.master || [])[1] || [])[0] || "").trim(), 10);
  const riddleRows = inp.riddles || [];

  return {
    windowStart: parseTime(setupRow12[2] || ""),
    windowEnd: parseTime(setupRow12[3] || ""),
    offsetHours: parseFloat(String(row7[0] || "").replace(/[^\d.-]/g, "")) || 0,
    b7: truthy(row7[1] || ""),
    d7: truthy(row7[3] || ""),
    a9: parseTime((inp.display[8] || [])[0] || ""),
    a11: parseTime((inp.display[10] || [])[0] || ""),
    poemRow: (poems[1] || []).map((s) => String(s || "")),
    poemF3: String((poems[2] || [])[0] || ""),
    poemF3Formula: String(((inp.poemFormulas || [])[2] || [])[0] || ""),
    poemGrid: (poems || []).map((r) => (r || []).map((c) => String(c || ""))),
    poemGridFormulas: (inp.poemFormulas || []).map((r) => (r || []).map((c) => String(c || ""))),
    verticalRow: (inp.vertical || []).find((r) => String((r || [])[0] || "").trim() === "1") || [],
    slots,
    riddle: Number.isFinite(week) ? String((riddleRows[week - 1] || [])[0] || "") : "",
    verses: (inp.verses || []).map((r) => String((r || [])[0] || "")),
    verseWeek: (() => {
      const n = parseInt(String(((inp.verseWeek || [])[0] || [])[0] || "").trim(), 10);
      return Number.isFinite(n) ? n : null;
    })(),
    pointsClasses: buildPointsClasses(inp.pointsRow3 || [], inp.pointsRow46 || []),
    // The plans line's own labels name the classes that exist this year; Points
    // row 3 is the fallback for a sheet that does not carry them.
    pointsLabels: (() => {
      const named = pointsFromSetup(inp.setup || [], inp.pointsGrid || []).map((c) => c.name);
      return named.some(Boolean) ? named : pointsLabels(inp.pointsRow3 || []);
    })(),
    book: buildBook(inp),
    cellImages: buildCellImages(inp.cellImages || []),
  };
}

/* ------------------------------------------------------------------ *
 * The D-column status rule (the one in D9, copied down the period rows)
 *
 * Inside the period it prints a class letter and four flags taken from
 * Points row 46, then substitutes the four digits for a label. Outside the
 * grace window at each end of the period (Setup!D16 minutes) it prints the
 * dashed form, which forces B2 off. Evaluating it here rather than reading
 * the cell is what makes the chips follow the scrubber.
 * ------------------------------------------------------------------ */

export type PointsClass = { name: string; letter: string; digits: string[] };

/** Where the class names sit in Points row 3, left to right. */
export const POINTS_NAME_COLS = [4, 17, 30, 43, 56];

/**
 * Which classes are owed a corrective writing assignment.
 *
 * The rule from the legend beside the points table: a poor day — five points or
 * fewer — more than once inside the last five school days.
 *
 * The daily scores live in the Points tab in a block of columns per class, and
 * the sheet does not compute this, so the block's score column is worked out
 * here: the column under the class's own name first, since that is where a table
 * with the class as its heading puts them, otherwise whichever column in the
 * block actually carries a day's worth of small numbers. `writingNote` says what
 * it settled on, which is what ?debug=1 prints when the answer looks wrong.
 */
export function writingOwed(grid: string[][], row3: string[]): { writing: string[]; writingNote: string } {
  const rows = grid || [];
  if (rows.length < 10) return { writing: [], writingNote: "no Points grid" };
  const at = (r: number, c1: number) => String(((rows[r - 1] || [])[c1 - 1] ?? "")).trim();
  const score = (r: number, c1: number): number | null => {
    const v = at(r, c1);
    if (!/^-?\d+(?:\.\d+)?$/.test(v)) return null;
    const n = parseFloat(v);
    return n >= 0 && n <= 20 ? n : null;
  };
  // The day rows are the ones between the heading and the flags that carry a
  // score for any class at all; the last five of those are the week in question.
  const NAME_ROW = 3;
  const FLAG_ROW = 46;
  const cols = POINTS_NAME_COLS.filter((c) => at(NAME_ROW, c));
  if (!cols.length) return { writing: [], writingNote: "no class names in row 3" };

  const pick = (base: number): number => {
    let best = 0;
    let bestCol = 0;
    for (let off = 0; off <= 8; off += 1) {
      let n = 0;
      for (let r = NAME_ROW + 1; r < FLAG_ROW; r += 1) if (score(r, base + off) !== null) n += 1;
      // The class's own column wins any tie, so a block of equally plausible
      // columns does not come down to the order they happen to sit in.
      if (n > best || (off === 0 && n === best && n > 0)) { best = n; bestCol = base + off; }
    }
    return best >= 3 ? bestCol : 0;
  };

  const picked = cols.map((base) => ({ name: at(NAME_ROW, base), base, col: pick(base) }));
  const scored = picked.filter((p) => p.col);
  if (!scored.length) return { writing: [], writingNote: "no column in any class block reads as daily scores" };

  // A day counts only once it has actually been scored. Rows waiting for the
  // rest of the year read as a column of noughts, and counting those made every
  // class look like it had had a run of poor days before the year began.
  const dayRows: number[] = [];
  for (let r = NAME_ROW + 1; r < FLAG_ROW; r += 1) {
    if (scored.some((p) => (score(r, p.col) ?? 0) > 0)) dayRows.push(r);
  }
  const week = dayRows.slice(-5);
  const writing: string[] = [];
  for (const p of scored) {
    const poor = week.filter((r) => { const n = score(r, p.col); return n !== null && n <= 5; }).length;
    if (poor > 1) writing.push(p.name);
  }
  const where = scored.map((p) => `${p.name}=${columnName(p.col)}`).join(" ");
  return { writing, writingNote: `rows ${week[0] ?? "—"}-${week[week.length - 1] ?? "—"} | ${where}` };
}

/** 1-based column number to its letters, for the debug view. */
export function columnName(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

/**
 * The pictures the API cannot see, by the cell they are in.
 *
 * A picture put into a cell with Insert > Image has no value and no formula —
 * the Sheets API has no image field at all — so the sheet's own script records a
 * durable address for each one on a helper tab, and the board reads that. The
 * keys are plain A1 references, "Poems!F3", tidied so a stray dollar or a
 * lower-case column still matches.
 */
export type CellImages = Record<string, string>;

export function cellImageKey(ref: string): string {
  const t = String(ref || "").trim().replace(/\$/g, "").replace(/'/g, "");
  const bang = t.lastIndexOf("!");
  if (bang < 0) return t.toUpperCase();
  return `${t.slice(0, bang).trim().toLowerCase()}!${t.slice(bang + 1).trim().toUpperCase()}`;
}

export function buildCellImages(rows: string[][]): CellImages {
  const out: CellImages = {};
  for (const r of rows || []) {
    const ref = String((r || [])[0] || "").trim();
    const url = String((r || [])[1] || "").trim();
    if (ref && /^https?:\/\//.test(url)) out[cellImageKey(ref)] = normalizeImageUrl(url);
  }
  return out;
}

/**
 * O Canada: the flag and the words, from the day's column of Poems!F1:J3.
 *
 * F is Monday and J Friday, and the column carries the anthem in whichever
 * language that day sings it. The flag is a picture in row 3; the words are
 * whatever text the column holds. A picture put in the cell with Insert >
 * Image > Image in cell has no value and no formula the API can read, so the
 * URL has to be in the cell — `=IMAGE("…")`, a link, or the address itself.
 */
export function anthemOfDay(
  poems: string[][],
  formulas: string[][],
  weekday: number,
  images: CellImages = {}
): { image: string; lines: string[] } {
  const col = weekday - 2; // Sheets counts Sunday as 1, so Monday is column F
  if (col < 0 || col > 4) return { image: "", lines: [] };
  const letter = String.fromCharCode(70 + col); // F to J
  const at = (row: number, grid: string[][]) => String(((grid || [])[row] || [])[col] || "").trim();
  let image = "";
  const lines: string[] = [];
  for (let row = 0; row < 3; row += 1) {
    const value = at(row, poems);
    const formula = at(row, formulas);
    const url = [urlFromFormula(formula), (value.match(URL_RE) || [])[0]].find((u) => u && isImageUrl(u))
      || images[cellImageKey(`Poems!${letter}${row + 1}`)]
      || "";
    if (url && !image) image = normalizeImageUrl(url);
    const text = value.replace(URL_RE, "").trim();
    if (text) lines.push(text);
  }
  return { image, lines };
}

/** Points row 3 holds the class names; row 46 holds four flags per class. */
export function buildPointsClasses(row3: string[], row46: string[]): PointsClass[] {
  // Column bases, in the order the formula tests them. The name sits nine
  // columns to the left of each block of four flags.
  const blocks: [number, string][] = [[26, "B"], [39, "C"], [13, "A"], [52, "A"], [65, "B"]];
  const at = (row: string[], col1: number) => String((row || [])[col1 - 1] || "").trim();
  return blocks
    .map(([base, letter]) => ({
      name: at(row3, base - 9),
      letter,
      digits: [0, 1, 2, 3].map((k) => at(row46, base + k)),
    }))
    .filter((c) => c.name);
}

const STATUS_LABELS: [string, string][] = [
  ["1110", "All 3"], ["1100", "B1 & B2"], ["0100", "B2"], ["1001", "B1"],
  ["1010", "FD & B1"], ["0010", "FD Only"], ["0110", "FD & B2"],
];

export function evaluateStatus(
  classes: PointsClass[],
  period: { start: number; end: number; text: string },
  minutes: number,
  graceMin: number
): string {
  if (!period || minutes < period.start || minutes > period.end) return "";
  const text = String(period.text || "");
  if (/Recess|Lunch/i.test(text)) return "REC";
  if (text.trim().startsWith("*")) return "";

  const hit = classes.find((c) => c.name && text.includes(c.name));
  if (!hit) return "";
  const [d1, d2, d3, d4] = hit.digits;
  const mid = minutes > period.start + graceMin && minutes <= period.end - graceMin;
  const code = mid ? `${d1}${d2}${d4}${d3}` : `${d1}0${d4}${d3}`;
  const label = (STATUS_LABELS.find(([digits]) => digits === code) || [, code])[1];
  return `${hit.letter}${mid ? "" : "-"}${label}`;
}

/* ------------------------------------------------------------------ *
 * Status colours
 *
 * The D-column status is a privilege code, and the sheet's conditional
 * formatting on D9/D11/D13 is what makes it readable across the room. The
 * same rules are mirrored here so the board carries the colour rather than
 * a plain label — including codes like "A-1000" that have no text label and
 * exist only to be coloured.
 *
 * First match wins, exactly as Sheets applies them. Specific rules (a "-"
 * prefix, a pair such as "B1 & B2") therefore come before the general ones.
 * ------------------------------------------------------------------ */

export type StatusStyle = { bg: string; fg: string; border?: string };

const STATUS_RULES: { test: (s: string) => boolean; style: StatusStyle }[] = [
  // The order is the sheet's own (D8:D9, D11:D13), first match winning. Note
  // that "ends with 1" sits at the very top, so a code ending in 1 — "AB1",
  // "AFD & B1" — is magenta and never reaches the dark-green rules below.
  { test: (s) => /1$/.test(s), style: { bg: "#EE22EE", fg: "#111111" } },
  { test: (s) => s.includes("REC"), style: { bg: "#5BE55B", fg: "#14532D" } },
  { test: (s) => s.includes("B1 & B2"), style: { bg: "#E8912D", fg: "#FFFFFF" } },
  { test: (s) => /4$/.test(s), style: { bg: "#A0522D", fg: "#FFFFFF" } },
  { test: (s) => s.includes("FD & B1"), style: { bg: "#3D6B2E", fg: "#FF6B5E" } },
  { test: (s) => s.includes("B1"), style: { bg: "#3D6B2E", fg: "#FFFFFF" } },
  { test: (s) => s.includes("FD & B2"), style: { bg: "#6FF0F0", fg: "#C4231A" } },
  { test: (s) => s.includes("B2"), style: { bg: "#6FF0F0", fg: "#0B4A4A" } },
  { test: (s) => s.includes("All 3"), style: { bg: "#F0993E", fg: "#C4231A" } },
  { test: (s) => s.includes("-FD Only"), style: { bg: "transparent", fg: "#C4231A", border: "#C4231A" } },
  { test: (s) => s.includes("FD Only"), style: { bg: "#66EE55", fg: "#C4231A" } },
  { test: (s) => s.includes("-000"), style: { bg: "transparent", fg: "#AFAFAF", border: "#CFCFCF" } },
  { test: (s) => s.includes("000"), style: { bg: "#66EE55", fg: "#DCDCDC" } },
];

export function statusStyle(status: string): StatusStyle | null {
  const s = String(status || "").trim();
  if (!s) return null;
  const hit = STATUS_RULES.find((r) => r.test(s));
  return hit ? hit.style : null;
}

/**
 * A friendlier heading for the non-teaching rows. The sheet labels these for
 * the teacher ("Recess Duty"), but the room is reading them, so the board says
 * what the students are doing. Returns "" when the row has no better wording,
 * in which case the cell's own text is used.
 */
export function friendlyDutyTitle(text: string): string {
  const t = String(text || "").toLowerCase();
  if (/lunch/.test(t)) return "Enjoy your lunch";
  if (/recess/.test(t)) return "Out for recess";
  if (/playground/.test(t)) return "Out on the playground";
  if (/dismiss/.test(t)) return "Dismissal";
  if (/assembl/.test(t)) return "Assembly";
  if (/chapel/.test(t)) return "Chapel";
  if (/no school/.test(t)) return "No school today";
  return "";
}

/* ------------------------------------------------------------------ *
 * Colour that carries meaning
 *
 * The board changes class every period, and a room notices a colour change
 * long before it reads a word. Each subject therefore gets its own accent,
 * taken from the lesson code's leading letter (J Math, H History, B CE,
 * G Geography), with a stable fallback hue for any code not listed so a new
 * subject is never colourless.
 * ------------------------------------------------------------------ */

export type SubjectTheme = { key: string; accent: string; deep: string };

const SUBJECT_ACCENTS: Record<string, [string, string]> = {
  J: ["#2F6BD8", "#1B3E80"], // Math — blue
  H: ["#C2571A", "#7A340B"], // History — rust
  B: ["#7C5CD6", "#472F86"], // Christian Education — violet
  G: ["#2E8B4A", "#1A5730"], // Geography — green
};

/** A stable hue for any code with no accent of its own. */
function hashedAccent(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return [`hsl(${h} 55% 42%)`, `hsl(${h} 60% 26%)`];
}

export function subjectTheme(code: string, subject: string): SubjectTheme {
  const letter = String(code || "").trim().charAt(0).toUpperCase();
  const pair = SUBJECT_ACCENTS[letter] || hashedAccent(String(subject || code || "board"));
  return { key: letter || "?", accent: pair[0], deep: pair[1] };
}

/**
 * The weekday's colour, taken from the sheet's own conditional formatting on
 * the day names so the board speaks the same visual language.
 * Sheets counts Sunday as 1.
 */
export function weekdayColour(weekday: number): { name: string; colour: string } | null {
  const days: Record<number, [string, string]> = {
    2: ["Monday", "#5CE1E6"],
    3: ["Tuesday", "#F9CB9C"],
    4: ["Wednesday", "#F6C388"],
    5: ["Thursday", "#B4A7D6"],
    6: ["Friday", "#E6D5E0"],
  };
  const hit = days[weekday];
  return hit ? { name: hit[0], colour: hit[1] } : null;
}
