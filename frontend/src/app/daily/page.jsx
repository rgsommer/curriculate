"use client";

// /daily — the classroom day board.
//
// Reads /api/daily (the DisplayAI tab, parsed) every 10 s and renders one
// class per screen. Every part of the screen is gated by the clock and by the
// timing rules in the Setup tab (next class shown N minutes before the end,
// red at N minutes, washroom cut-off, and so on). Nothing here is typed twice:
// the lesson text, status chips, points and feature cell all come from the sheet.
//
// The slim bar along the bottom lets the teacher scrub the day's time forward
// or back to preview a period; it snaps back to the live clock after 45 s.
//
// URL options: ?t=11:05 freezes the clock; ?k=... passes the access key when
// DAILY_ACCESS_KEY is set; ?pic=left|off moves or hides pictures (the lesson
// picture and any image the sheet puts in the feature cell E1).

import { useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_SOURCES, evaluateDailyText, evaluateFeature, evaluateStatus, evaluateVerse, canonicalUrl, friendlyDutyTitle, statusStyle, subjectTheme, tidyTruncated, truncateWords, weekdayColour } from "@/lib/daily/parse";

const CLASS_LABELS = ["7A", "7B", "7C", "8A", "8B", "8C"];
const FLAGS = ["FD", "B1", "B2"];
const POLL_MS = 10_000;
const FETCH_TIMEOUT_MS = 25_000;
const SCRUB_RESET_MS = 45_000;
// The bottom bar holds one line, so the verse is shortened to about the length
// the sheet's own A5 uses — but at a word boundary.
const VERSE_MAX = 85;
// How far the lesson type may be scaled to fill the screen, and how much slack
// is left alone rather than triggering another search.
const FIT_MIN = 0.75;
const FIT_MAX = 1.9;
const FIT_SLACK = 0.05;
// A riddle for the bottom bar at the end of the day, for the days the sheet has
// none of its own. Picked by the date so it does not change while it is up.
const HOUSE_RIDDLES = [
  "What has to be broken before you can use it?",
  "I am tall when I am young and short when I am old. What am I?",
  "What has many keys but cannot open a single lock?",
  "What goes up but never comes down?",
  "What can travel around the world while staying in a corner?",
  "The more of me you take, the more you leave behind. What am I?",
  "What has hands but cannot clap?",
  "What gets wetter the more it dries?",
];

function fmt(m) {
  const h = Math.floor(m / 60), mm = Math.floor(m % 60), ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${mm < 10 ? "0" : ""}${mm} ${ap}`;
}
function liveMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function youtubeId(url) {
  const m = /(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{6,})/.exec(url || "");
  return m ? m[1] : null;
}
function isVideoUrl(url) {
  return /youtu\.be\/|youtube\.com\/|youtube-nocookie\.com\/|drive\.google\.com\/file\/|\.(mp4|webm|m4v)(\?|$)/i.test(url || "");
}
function driveId(url) {
  const m = /drive\.google\.com\/file\/d\/([^/]+)/.exec(url || "");
  return m ? m[1] : null;
}
/**
 * Periods built from the day's plan, for the days DisplayAI has not filled in.
 *
 * Each planned class runs to the next boundary — the next planned class, or the
 * next time row DisplayAI does have, which is what keeps lunch and recess in the
 * right place. The rows DisplayAI carries are kept alongside, so the gaps
 * between classes still read as changes of class.
 */
function periodsFromPlan(rows, timed) {
  const bounds = Array.from(new Set([...rows.map((r) => r.start), ...timed.map((c) => c.start)])).sort((a, b) => a - b);
  const endAfter = (start) => bounds.find((b) => b > start) ?? start + 60;
  const planned = new Set(timed.map((c) => c.start));
  const out = timed.map((c) => ({
    start: c.start,
    end: endAfter(c.start),
    text: c.today,
    status: "",
    flag: "",
    video: c.video || "",
    empty: false,
    duty: false,
    rec: false,
    subj: c.subj,
    sec: (c.subj.match(/(\d[A-C])\b/) || [, ""])[1],
    room: c.room,
    code: c.code,
    today: c.today,
    q: c.q,
    plan: c.plan || [],
    assign: c.assign || [],
    remind: c.remind || "",
    links: c.links || [],
    page: c.page || "",
    homework: c.homework || "",
    image: c.image || "",
  }));
  for (const r of rows) if (!planned.has(r.start)) out.push({ ...r, end: endAfter(r.start) });
  return out.sort((a, b) => a.start - b.start);
}

function parseStatus(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^REC$/i.test(s)) return { rec: true };
  const m = /^([A-C])?(-)?\s*(.*?)(\s4)?$/.exec(s);
  if (!m) return null;
  const map = {
    "All 3": [1, 1, 1], "B1 & B2": [0, 1, 1], "B2": [0, 0, 1], "B1": [0, 1, 0],
    "FD & B1": [1, 1, 0], "FD Only": [1, 0, 0], "FD & B2": [1, 0, 1],
  };
  const f = map[(m[3] || "").trim()] || [0, 0, 0];
  return { rec: false, letter: m[1] || "", grace: !!m[2], on: f, extra: !!m[4] };
}

/* ---------- small pieces ---------- */

function Chips({ period, left, setup, status }) {
  if (!period) return null;
  const raw = (status || period.status || "").trim();
  const st = parseStatus(raw);
  const style = statusStyle(raw);
  // The code is a privilege signal the room reads by colour, so the badge
  // carries the sheet's own conditional formatting rather than a plain label.
  const badge = raw ? (
    <span
      key="badge"
      className="statusbadge"
      style={{ background: style ? style.bg : "var(--chip)", color: style ? style.fg : "var(--muted)", borderColor: style && style.border ? style.border : "transparent" }}
      title={`Privilege code ${raw}`}
    >
      {raw}
    </span>
  ) : null;
  if (period.duty) return badge ? <div className="points">{badge}</div> : null;
  const items = [badge];
  items.push(<span key="w" className={`chip ${left > setup.washroomBefore ? "on" : "off"}`}>Washroom</span>);
  if (st && st.on && st.on[2] && !st.grace && period.elapsed <= setup.graceMin + setup.snacksB2Min) {
    items.push(<span key="s" className="chip on">Snacks</span>);
  }
  return <div className="points">{items}</div>;
}

function VideoTile({ url, big, setBig }) {
  const hostRef = useRef(null);
  const yt = youtubeId(url);
  const drive = driveId(url);

  // YouTube: use the IFrame API so the tile shrinks when playback ends.
  useEffect(() => {
    if (!big || !yt || !hostRef.current) return undefined;
    let player = null, cancelled = false;
    const mount = () => {
      if (cancelled || !hostRef.current) return;
      const el = document.createElement("div");
      hostRef.current.innerHTML = "";
      hostRef.current.appendChild(el);
      player = new window.YT.Player(el, {
        videoId: yt,
        host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1 },
        events: { onStateChange: (e) => { if (e.data === window.YT.PlayerState.ENDED) setBig(false); } },
      });
    };
    if (window.YT && window.YT.Player) mount();
    else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); mount(); };
      if (!document.getElementById("yt-iframe-api")) {
        const s = document.createElement("script");
        s.id = "yt-iframe-api";
        s.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(s);
      }
    }
    return () => { cancelled = true; try { player && player.destroy(); } catch { /* noop */ } };
  }, [big, yt, setBig]);

  if (!url) return null;
  const label = yt ? "Video" : drive ? "Video (Drive)" : "Video";
  return (
    <div
      className={`vid${big ? " big" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={big ? "Close video" : "Play video"}
      onClick={() => { if (!big) setBig(true); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBig(!big); } }}
    >
      <div className="thumb">▶</div>
      <div className="cap">{label}</div>
      {big && yt && <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />}
      {big && !yt && drive && (
        <iframe title="Video" src={`https://drive.google.com/file/d/${drive}/preview`} allow="autoplay" />
      )}
      {big && !yt && !drive && (
        <video src={url} autoPlay controls onEnded={() => setBig(false)} />
      )}
      <button type="button" className="close" onClick={(e) => { e.stopPropagation(); setBig(false); }}>Close</button>
    </div>
  );
}

function PointsStrip({ points, currentSec }) {
  const nums = points.numbers || [], pcts = points.percents || [];
  const n = Math.max(nums.length, pcts.length);
  if (!n && points.entered == null) return null;
  return (
    <div className="ptsrow">
      <div className="pts">
        {Array.from({ length: n }).map((_, i) => {
          const label = CLASS_LABELS[i] || `#${i + 1}`;
          const pct = pcts[i];
          return (
            <div key={label} className={`pt${label === currentSec ? " cur" : ""}`}>
              <span className="c">{label}</span>
              <span className="n">{nums[i] != null ? nums[i] : "—"}</span>
              <span className="pc">{pct != null ? `${pct}%` : ""}</span>
              <div className="bar"><i className={pct >= 100 ? "met" : ""} style={{ width: `${Math.min(100, (pct || 0) / 3)}%` }} /></div>
            </div>
          );
        })}
        {points.entered != null && (
          <span className={`entered${points.entered ? "" : " no"}`} title="Yesterday's points entered">
            <i />{points.entered ? "Points in" : "Points missing"}
          </span>
        )}
      </div>
    </div>
  );
}

/* The slim time scrubber along the bottom. */
function Scrub({ min, max, value, live, onChange, onLive }) {
  const active = value != null;
  return (
    <div className={`scrub${active ? " active" : ""}`}>
      <span className="scrub-label">{active ? `Previewing ${fmt(value)}` : "Look ahead or back"}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={active ? value : Math.round(live)}
        aria-label="Preview another time of day"
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
      <button type="button" className="scrub-live" onClick={onLive} disabled={!active}>{active ? "Back to now" : "Live"}</button>
    </div>
  );
}

/* ---------- the page ---------- */

export default function DailyPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loadNote, setLoadNote] = useState("Contacting the sheet…");
  const [points, setPoints] = useState({ numbers: null, percents: null, entered: null });
  const [tick, setTick] = useState(0);
  const [vidBig, setVidBig] = useState(false);
  const [opts, setOpts] = useState({ t: null, k: "", pic: "right", debug: false });
  const [scrub, setScrub] = useState(null);
  const [badImages, setBadImages] = useState({});
  const [prayBig, setPrayBig] = useState(false);
  const scrubTouched = useRef(0);

  // URL options (client only)
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    setOpts({ t: parseHHMM(u.get("t")), k: u.get("k") || "", pic: u.get("pic") === "left" ? "left" : u.get("pic") === "off" ? "off" : "right", debug: u.get("debug") === "1" });
    document.title = "Daily Board";
  }, []);

  // Poll the sheet. Keep both numbers and percents as they alternate on the date line.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/daily${opts.k ? `?k=${encodeURIComponent(opts.k)}` : ""}`, { cache: "no-store", signal: ctrl.signal });
        const text = await res.text();
        let j;
        try { j = JSON.parse(text); } catch { j = { error: `Unexpected reply (${res.status}): ${text.slice(0, 120)}` }; }
        if (!alive) return;
        if (!res.ok || !j.periods) { setError(j.error || `HTTP ${res.status}`); return; }
        setData(j);
        setError(j.stale ? `Showing the last good copy. ${j.error || ""}` : "");
        setPoints((p) => ({
          numbers: (j.points && j.points.numbers) || p.numbers,
          percents: (j.points && j.points.percents) || p.percents,
          entered: j.points && j.points.entered != null ? j.points.entered : p.entered,
        }));
      } catch (e) {
        if (alive) setError(e.name === "AbortError" ? "The sheet took too long to answer; retrying." : e.message || "Could not reach the sheet");
      } finally {
        clearTimeout(timer);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    const note = setTimeout(() => setLoadNote("Still waiting… the first load after a quiet spell can take a few seconds."), 8000);
    return () => { alive = false; clearInterval(id); clearTimeout(note); };
  }, [opts.k]);

  // Clock tick every 5 s (the display only needs minute resolution, but the red phase should not lag)
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // Scrubbed previews snap back to the live clock after a while.
  useEffect(() => {
    if (scrub == null) return undefined;
    const id = setInterval(() => {
      if (Date.now() - scrubTouched.current > SCRUB_RESET_MS) setScrub(null);
    }, 1000);
    return () => clearInterval(id);
  }, [scrub]);

  const live = liveMinutes();
  const now = scrub != null ? scrub : opts.t != null ? opts.t : live;
  const t = Math.floor(now);
  const setup = data ? data.setup : null;

  const view = useMemo(() => {
    if (!data) return null;
    const rows = data.periods;
    // When DisplayAI has no lessons in it, the day's plan stands in for them, so
    // the board runs its ordinary class screens and the scrubber moves between
    // them — 11:00 AM shows the 11:00 AM class — instead of one static list.
    const wd = new Date().getDay() + 1;
    const timedPlan = ((data.dayPlan || {})[wd] || []).filter((c) => c.start != null);
    const P = rows.some((p) => !p.duty && !p.empty) || !timedPlan.length
      ? rows
      : periodsFromPlan(rows, timedPlan);
    const classes = P.filter((p) => !p.duty && !p.empty);
    let cur = null;
    for (const p of P) if (t >= p.start && t < p.end) { cur = p; break; }
    const nextClass = (after) => classes.find((c) => c.start >= after) || null;
    if (cur) cur = { ...cur, elapsed: t - cur.start, left: cur.end - t };
    return { P, classes, cur, nextClass };
  }, [data, t]);

  // Fill the screen. The lesson area grows its type until it just fits, so a
  // short lesson is not a page of white space and a long one still needs no
  // scrolling. Runs after every render but measures once and returns straight
  // away when the screen is already full.
  const boardRef = useRef(null);
  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") return undefined;
    let raf = 0;
    // How far down the real content reaches. The columns are grid items and
    // stretch to the row, so the container's own scrollHeight says nothing about
    // empty space below the text — the children have to be measured. A picture
    // column is elastic by design and is left out of the reckoning.
    const contentBottom = (main) => {
      let bottom = 0;
      for (const col of main.children) {
        if (col.classList.contains("picture")) continue;
        for (const kid of col.children) bottom = Math.max(bottom, kid.getBoundingClientRect().bottom);
        if (!col.children.length) bottom = Math.max(bottom, col.getBoundingClientRect().bottom);
      }
      return bottom;
    };
    const fit = () => {
      const main = board.querySelector(".main");
      if (!main) return;
      const limit = () => main.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(main).paddingBottom) || 0);
      const wide = () => main.scrollWidth > main.clientWidth + 1;
      const slack = limit() - contentBottom(main);
      if (slack >= 0 && slack < main.clientHeight * FIT_SLACK && !wide()) return;
      let lo = FIT_MIN;
      let hi = FIT_MAX;
      for (let i = 0; i < 9; i += 1) {
        const mid = (lo + hi) / 2;
        board.style.setProperty("--fit", String(mid));
        if (contentBottom(main) > limit() || wide()) hi = mid;
        else lo = mid;
      }
      board.style.setProperty("--fit", String(lo));
    };
    raf = requestAnimationFrame(fit);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(board);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  });

  // Shrink the video when the period changes.
  const curKey = view && view.cur ? view.cur.start : -1;
  useEffect(() => { setVidBig(false); }, [curKey]);

  if (!data) {
    return (
      <div className="board">
        <div className="notice">
          <div>
            <h1>Daily board</h1>
            {error ? (
              <>
                <p>The sheet could not be read. {error}</p>
                <p style={{ marginTop: "1vh" }}>Retrying every {POLL_MS / 1000} seconds. If this persists, check <code>DAILY_SHEETS_SERVICE_ACCOUNT</code> in Vercel and that the sheet is shared with that account.</p>
              </>
            ) : (
              <p>{loadNote}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { meta } = data;
  const { P, classes, cur, nextClass } = view;
  const puzzleWord = (meta.puzzle.match(/:\s*(\S+)/) || [, ""])[1];
  const challenge = (meta.other.match(/Math Challenge Question[^:]*:\s*(.*)$/) || [, ""])[1];
  const lastClass = classes[classes.length - 1];

  // The sheet computes its display cells from NOW(); the board recomputes the
  // same rules from its own clock, so the scrubber moves them too.
  const weekday = new Date().getDay() + 1; // Sheets counts Sunday as 1
  // A payload from an older build (or one a warm server is still caching) can be
  // missing these, and an exception here would freeze the whole board.
  const sources = { ...EMPTY_SOURCES, ...(data.sources || {}) };
  // A5 shortens the verse with LEFT(..., 85) and lands mid-word. With its source
  // in hand the board strips the lead-in at "~" first — so what gets shortened is
  // the scripture, not the introduction — and cuts at a word boundary. Without
  // it, the value as read is tidied back to the last whole word.
  const verseSrc = evaluateVerse(sources, t, weekday);
  const verseRaw = verseSrc.text || meta.verse;
  const verseQuote = verseRaw.replace(/^.*?~/, "").trim() || verseRaw;
  const verse = verseSrc.text
    ? (verseSrc.open ? verseQuote : truncateWords(verseQuote, VERSE_MAX))
    : tidyTruncated(verseQuote);
  const evaluated = evaluateFeature(sources, t);
  const dailyText = evaluateDailyText(sources, t, weekday);
  const peekNext = classes.find((c) => c.start >= (cur ? cur.end : t)) || null;
  // What actually happens at the bell, which is not always the next class: the
  // next row of the timetable, lunch and recess included. Used for the red
  // "what's next" line in the last few minutes of a period.
  // Setup's "For Dismissal Messages" block: the times the end-of-day material
  // comes forward (lunch, lunch recess, dismissal) and how far ahead of each.
  const dismissal = data.dismissal || { advanceMin: 5, times: [] };
  const waiting = data.waiting || [];
  // When the teaching day ends. The sheet says so in three places and any one of
  // them may be blank, so the first that is set wins: the DisplayAI dismissal
  // row, Setup's "Show Dismissal List" time, or the Dismissal entry in the
  // message block. Without this the board fell through to "No classes today"
  // once the last row had passed.
  const dismissalRow = P.find((p) => /dismiss/i.test(`${p.subj || ""} ${p.text || ""}`));
  const endOfDayAt = [
    dismissalRow ? dismissalRow.start : null,
    setup.dismissalAt,
    (dismissal.times.find((m) => /dismiss/i.test(m.label)) || {}).at,
  ].find((x) => x != null) ?? null;
  // The last few minutes of the day: E1 gives its side of the screen over to the
  // dismissal package. The nation of the day comes forward then and before each
  // of the sheet's other message times as well.
  const endOfDaySoon = endOfDayAt != null && t >= endOfDayAt - dismissal.advanceMin && t < endOfDayAt;
  const msgSoon = endOfDaySoon
    || !!dismissal.times.find((m) => t >= m.at - dismissal.advanceMin && t < m.at);
  const nextRow = P.find((p) => !p.empty && p.start >= (cur ? cur.end : t)) || null;
  const nextUp = nextRow
    ? {
        label: nextRow.duty ? friendlyDutyTitle(nextRow.text || nextRow.subj) || nextRow.subj : nextRow.subj,
        room: nextRow.duty ? "" : nextRow.room,
        start: nextRow.start,
      }
    : peekNext
      ? { label: peekNext.subj, room: peekNext.room, start: peekNext.start }
      : null;
  // Each subject carries its own accent, so the room sees the class change
  // before it reads the heading. Between classes the next one's colour is used.
  const themeOf = (p) => (p && p.code ? subjectTheme(p.code, p.subj) : null);
  const theme = themeOf(cur && !cur.duty ? cur : peekNext) || { key: "?", accent: "#1F3A5F", deep: "#122845" };
  const today = weekdayColour(weekday);
  // The D-column rule, recomputed from the board's clock so the grace window
  // and the chips move with the scrubber too.
  const statusOf = (p) => ((sources.pointsClasses || []).length
    ? evaluateStatus(sources.pointsClasses, p, t, setup.graceMin) || p.status
    : p.status);
  // The scrubber has to reach the whole school day, not just the teaching periods:
  // arrival and the announcements window come before the first class, and the
  // dismissal screen can run past the last one.
  const dayMin = Math.max(0, Math.min(...[
    P.length ? P[0].start - 90 : 8 * 60,
    setup.blankFrom != null ? setup.blankFrom - 10 : Infinity,
  ]));
  const dayMax = Math.min(24 * 60 - 1, Math.max(...[
    P.length ? P[P.length - 1].end + 30 : 16 * 60,
    setup.dismissalAt != null ? setup.dismissalAt + 45 : -Infinity,
  ]));

  const header = ({ title, chips, when, leftHtml, pct, red, period }) => (
    <>
      <div className="top">
        <div>
          <div className="title"><span className="subj">{title}</span>{chips}</div>
          {period && <Chips period={period} left={period.left} setup={setup} status={statusOf(period)} />}
          <div className="when">{when}</div>
          {red && nextUp ? (
            <div className="peek soon">
              {`Next in ${Math.max(0, nextUp.start - t)} min: `}
              <b>{nextUp.label}</b>{nextUp.room ? ` · ${nextUp.room}` : ""} · {fmt(nextUp.start)}
            </div>
          ) : red ? (
            <div className="peek soon">Next: <b>{setup.dismissalAt != null ? "Dismissal" : "End of the day"}</b></div>
          ) : peekNext ? (
            <div className="peek">Next: <b>{peekNext.subj}</b> · {peekNext.room} · {fmt(peekNext.start)}</div>
          ) : null}
        </div>
        {period && !period.duty ? <VideoTile url={period.video} big={vidBig} setBig={setVidBig} /> : <span />}
        <div className={`clockbox${red ? " red" : ""}`}>
          <div className="clock">{fmt(t)}</div>
          <div className="left">{leftHtml}</div>
        </div>
      </div>
      <div className="pbar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </>
  );
  // "Pray for Albania" from the header rows: a small player when it links to a
  // video, otherwise a link the teacher can open.
  const pray = meta.pray && meta.pray.text ? meta.pray : null;
  const prayEl = () => {
    if (!pray) return null;
    if (pray.url && isVideoUrl(pray.url)) {
      return (
        <span className="prayrow">
          <VideoTile url={pray.url} big={prayBig} setBig={setPrayBig} />
          <span className="pray">{pray.text}</span>
        </span>
      );
    }
    const cls = `pray${msgSoon ? " pop" : ""}`;
    return pray.url
      ? <a className={cls} href={pray.url} target="_blank" rel="noreferrer">{pray.text} ↗</a>
      : <span className={`${cls} nolink`} title="No link found on this cell">{pray.text}</span>;
  };
  // At the end of the day the verse is already large on the screen, so the bar
  // carries the unscramble if the sheet has one and a riddle otherwise.
  const riddleOfDay = () => {
    const own = (meta.riddle || "").replace(/^Q:\s*/, "").trim();
    if (own && own !== (featureText || "").replace(/^Q:\s*/, "").trim()) return own;
    const d = new Date();
    return HOUSE_RIDDLES[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % HOUSE_RIDDLES.length];
  };
  const footer = (showPuzzle, endOfDay) => (
    <>
      <PointsStrip points={points} currentSec={cur && !cur.duty ? cur.sec : ""} />
      <div className="bottom">
        <span>
          {today && (
            <span className="daychip" style={{ background: today.colour }}>{today.name}</span>
          )}
          {meta.line}{error ? <span className="stale"> · {error}</span> : null}
        </span>
        {prayEl()}
        {showPuzzle && puzzleWord
          ? <span className="puzzle">Unscramble for a treat: <b>{puzzleWord}</b></span>
          : endOfDay
            ? <span className="verse riddleline">Riddle: {riddleOfDay()}</span>
            : <span className="verse">{verse}</span>}
      </div>
      <Scrub
        min={dayMin}
        max={dayMax}
        value={scrub}
        live={opts.t != null ? opts.t : live}
        onChange={(v) => { scrubTouched.current = Date.now(); setScrub(v); }}
        onLive={() => setScrub(null)}
      />
    </>
  );
  const list = (items, cls) => <ul className={cls || ""}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  const linkChips = (links, label) => (links.length ? (
    <div className="handouts">
      {label ? <span className="hlabel">{label}</span> : null}
      {links.map((l) => (
        <a key={l.url} className="hlink" href={l.url} target="_blank" rel="noreferrer">
          {l.subj ? <b>{l.subj}</b> : null}{l.subj ? " · " : ""}{l.label} ↗
        </a>
      ))}
    </div>
  ) : null);
  // The day's classes as written on VerticalAi, used when DisplayAI's lesson
  // column has not been filled in yet.
  const dayPlan = (data.dayPlan || {})[weekday] || [];
  // Everything the day needs, gathered before it starts: each class's handouts,
  // named by the class, so they can be printed on the way in.
  const dayLinks = (() => {
    const seen = new Set();
    const out = [];
    for (const c of (classes.length ? classes : dayPlan)) {
      for (const l of c.links || []) {
        const key = canonicalUrl(l.url);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...l, subj: c.subj });
      }
    }
    return out;
  })();
  const agenda = () => (
    <div className="agenda">
      {classes.map((p) => [<span key={`t${p.start}`} className="t">{fmt(p.start)}</span>, <span key={`s${p.start}`}>{p.subj} · {p.room}</span>])}
    </div>
  );
  const featureText = evaluated.text || meta.feature;
  const featureBlock = () => (featureText
    ? <div className="block feature quiet"><p>{featureText.replace(/^Q:\s*/, "")}</p></div>
    : meta.riddle ? <div className="block quiet"><h3>Riddle</h3><p>{meta.riddle.replace(/^Q:\s*/, "")}</p></div> : null);
  const dailyBlock = () => (dailyText
    ? <div className="block navy"><h3>Today</h3><p className="daily">{dailyText}</p></div> : null);
  // The end-of-day package that takes over the feature side: what is on
  // tomorrow, the head-out list, and the Kiss & Ride names waiting outside.
  const dismissalPanel = (withHeadout) => (
    <div className="panel dismissalpanel">
      {meta.tomorrow ? <div className="block sun"><h3>Tomorrow</h3><p>{meta.tomorrow}</p></div> : null}
      {withHeadout && meta.headout.length > 0
        ? <div className="block alert"><h3>Before you head out</h3>{list(meta.headout)}</div> : null}
      {waiting.length > 0
        ? (
          <div className="block navy">
            <h3>Kiss &amp; Ride · waiting</h3>
            <ol className="waiting">{waiting.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ol>
          </div>
        ) : null}
      {withHeadout ? null : featureBlock()}
    </div>
  );

  // A picture in E1 outranks everything else on the right of the screen: while the
  // sheet is showing one, the board gives it the large slot.
  // A picture that will not load (a Drive link that is not shared, say) must not
  // leave a broken frame on the projector: the board drops it and shows the panel.
  const markBad = (url) => setBadImages((b) => (b[url] ? b : { ...b, [url]: true }));
  const usable = (url) => !!url && !badImages[url];
  const evaluatedImage = evaluated.image || meta.featureImage;
  const featureImage = opts.pic === "off" || !usable(evaluatedImage) ? "" : evaluatedImage;
  const bigPicture = (url, caption, note) => (
    <div className="picture">
      <div className="frame">
        <img src={url} alt={caption || "Picture on the board"} onError={() => markBad(url)} />
      </div>
      <div className="capline"><span>{caption}</span><span>{note}</span></div>
    </div>
  );
  // Between classes and before school there is no lesson column, so the picture
  // shares the screen with whatever text that screen carries.
  const withPicture = (content) => (featureImage
    ? <div className="main pic-right pic-feature">{content}{bigPicture(featureImage, "On screen now", "")}</div>
    : <div className="main center">{content}</div>);

  // /daily?debug=1 — what the board actually received from the sheet. Use it to
  // tell whether a picture or link is reaching the page at all.
  if (opts.debug) {
    const row = (k, v) => (
      <tr key={k}><th>{k}</th><td>{v === "" || v == null ? <em>empty</em> : String(v)}</td></tr>
    );
    return (
      <div className="board">
        <div className="debug">
          <h1>What the board sees</h1>
          <table>
            <tbody>
              {row("fetched", data.fetchedAt)}
              {row("version", data.version)}
              {row("stale", data.stale ? `yes — ${data.error || ""}` : "no")}
              {row("E1 picture (evaluated)", evaluated.image)}
              {row("E1 text (evaluated)", evaluated.text)}
              {row("E1 rule used", evaluated.source)}
              {row("daily text", dailyText)}
              {row("poem window", `${sources.windowStart == null ? "—" : fmt(sources.windowStart)} to ${sources.windowEnd == null ? "—" : fmt(sources.windowEnd)}`)}
              {row("B7 / D7", `${sources.b7} / ${sources.d7}`)}
              {row("status (evaluated)", cur ? statusOf(cur) : "")}
              {row("status (as read)", cur ? cur.status : "")}
              {row("points classes", (sources.pointsClasses || []).map((c) => `${c.name}=${c.letter}${c.digits.join("")}`).join("  "))}
              {row("slots", (sources.slots || []).filter((x) => x.name).map((x) => `${x.name}=${x.priority ?? "-"}${x.value || x.formula ? "*" : ""}`).join("  "))}
              {row("E1 picture (as read)", meta.featureImage)}
              {row("E1 text (as read)", meta.feature)}
              {row("pray text", meta.pray && meta.pray.text)}
              {row("pray link", meta.pray && meta.pray.url)}
              {row("lesson picture", data.picture && data.picture.url)}
              {row("picture seconds", setup.picSeconds)}
              {row("periods", `${P.length} rows, ${classes.length} classes`)}
              {row("now", `${fmt(t)} — ${cur ? cur.subj || "duty" : "no period"}`)}
              {row("tomorrow", meta.tomorrow)}
              {row("head out items", meta.headout.join(" | "))}
              {row("blessing", meta.blessing)}
              {row("end of day at", endOfDayAt == null ? "" : `${fmt(endOfDayAt)} (package from ${fmt(endOfDayAt - dismissal.advanceMin)})`)}
              {row("dismissal messages", dismissal.times.map((m) => `${m.label} ${fmt(m.at)}`).join("  ") + `  · ${dismissal.advanceMin} min before`)}
              {row("Kiss & Ride waiting", waiting.length ? waiting.join(" | ") : "")}
              {row("verse (as read)", meta.verse)}
              {row("verse (evaluated)", verseSrc.text ? `${verseSrc.open ? "full" : "short"} \u2014 ${verse}` : "Verses tab not read; using A5")}
              {row("lesson material", cur ? `page: ${cur.page || "—"} · homework: ${(cur.homework || "—").slice(0, 60)} · image: ${cur.image || "—"} · video: ${cur.video || "—"}` : "")}
              {row("handouts (current class)", cur && (cur.links || []).length ? cur.links.map((l) => `${l.label} \u2192 ${l.url}`).join("  |  ") : "")}
              {row("puzzle", meta.puzzle)}
              {row("riddle", meta.riddle)}
              {row("points", `${(points.numbers || []).join(", ") || "—"} | ${(points.percents || []).join(", ") || "—"} | entered: ${points.entered}`)}
            </tbody>
          </table>
          <h2>Setup!T1:AA8 — the cells that decide E1</h2>
          <table className="grid">
            <tbody>
              {(data.slotBlock || []).map((rowVals, r) => (
                <tr key={r}>
                  <th>{r + 1}</th>
                  {["T", "U", "V", "W", "X", "Y", "Z", "AA"].map((col, c) => {
                    const formula = ((data.slotBlockFormulas || [])[r] || [])[c] || "";
                    const value = (rowVals || [])[c] || "";
                    return (
                      <td key={col} title={`${col}${r + 1}`}>
                        {formula && formula !== value ? <code>{formula}</code> : value || <em>—</em>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="shots">
            {[["E1 picture", evaluated.image || meta.featureImage], ["Lesson picture", data.picture && data.picture.url]]
              .filter(([, url]) => url)
              .map(([label, url]) => (
                <figure key={label}>
                  <img src={url} alt={label} onError={() => markBad(url)} />
                  <figcaption>{label} — {badImages[url] ? "did NOT load" : "loaded"}</figcaption>
                </figure>
              ))}
            {!evaluated.image && !meta.featureImage && !(data.picture && data.picture.url) && <p>No picture URL came back from the sheet.</p>}
          </div>
          <p>A picture only reaches this page if the cell itself holds it, for example
            <code>=IMAGE(&quot;https://…&quot;)</code>. An image inserted over the grid
            (Insert &rsaquo; Image &rsaquo; Image in cell is fine; floating images are not)
            cannot be read by the sheet API and will always show as empty here.</p>
        </div>
      </div>
    );
  }

  let body;
  let redState = false;

  if (setup.blankFrom != null && setup.blankTo != null && t >= setup.blankFrom && t < setup.blankTo) {
    body = (
      <>
        {header({ title: "Announcements", chips: null, when: `Screen blank until ${fmt(setup.blankTo)}`, leftHtml: "", pct: 0 })}
        <div className="main blank"><p>Please listen</p></div>
        {footer(false)}
      </>
    );
  } else if (endOfDayAt != null && t >= endOfDayAt && (!cur || cur.duty || cur.empty)) {
    // Dismissal waits for the last class to finish. The dismissal time can fall
    // inside the final period, and the class has to hold the screen to its very
    // last minute rather than being pushed off early.
    body = (
      <>
        {header({ title: "Dismissal", chips: null, when: `From ${fmt(endOfDayAt)}`, leftHtml: <b>Day complete</b>, pct: 100 })}
        <div className={`main pic-right endofday${featureImage ? " pic-feature" : ""}`}>
          <div>
            <p className="script">Well done, {(meta.greeting.match(/,\s*(.*?)!?$/) || [, "everyone"])[1]}.</p>
            {verse ? <p className="question">{verse}</p> : null}
            {meta.headout.length > 0 && (
              <div className="block alert" style={{ textAlign: "left", display: "inline-block" }}>
                <h3>Before you head out</h3>{list(meta.headout)}
              </div>
            )}
            {meta.blessing ? <p className="summary blessing">{meta.blessing}</p> : null}
          </div>
          {featureImage ? bigPicture(featureImage, "On screen now", "") : dismissalPanel(false)}
        </div>
        {footer(true, true)}
      </>
    );
  } else if (!classes.length) {
    // No lesson text in any row. That is three different situations and only one
    // of them means the day is empty: the sheet may have the day's times with
    // nothing filled in yet, or the last read may simply have failed — in which
    // case this is an old copy and says nothing about today at all. Telling a
    // classroom "no classes today" in any of them is wrong.
    const note = dayPlan.length
      ? "Today's classes, from the day's plan."
      : error
        ? "The board could not read the sheet just now, so this is the last copy it has."
        : P.length
          ? "The day's times are here, but no lessons are filled in yet."
          : "Nothing is listed for today yet.";
    body = (
      <>
        {header({ title: meta.greeting || "Good morning", chips: null, when: meta.plans, leftHtml: "", pct: 0 })}
        <div className="main center">
          <div>
            <p className="script">{meta.greeting || "Good morning"}</p>
            <p className="question">{verse}</p>
            <p className="summary">{note}</p>
            {dayPlan.length > 0 ? (
              <div className="agenda">
                {dayPlan.map((c, i) => [
                  <span key={`t${i}`} className="t">{c.start != null ? fmt(c.start) : c.room || "—"}</span>,
                  <span key={`s${i}`}>
                    <b>{c.subj}</b>
                    {c.start != null && c.room ? ` · ${c.room}` : ""}
                    {c.page ? ` · ${c.page}` : ""}
                    {c.today ? ` · ${c.today}` : ""}
                  </span>,
                ])}
              </div>
            ) : P.length > 0 ? (
              <div className="agenda">
                {P.map((x) => [
                  <span key={`t${x.start}`} className="t">{fmt(x.start)}</span>,
                  <span key={`s${x.start}`}>{x.subj || x.text || "—"}</span>,
                ])}
              </div>
            ) : null}
            {linkChips(dayLinks, "Materials to print today")}
          </div>
        </div>
        {footer(false)}
      </>
    );
  } else if (!cur && classes.length && t < classes[0].start) {
    body = (
      <>
        {header({ title: "Good morning", chips: null, when: meta.plans, leftHtml: <>First class at <b>{fmt(classes[0].start)}</b></>, pct: 0 })}
        {withPicture(
          <div>
            <p className="script">{meta.greeting || "Good morning"}</p>
            <p className="question">{verse}</p>
            {agenda()}
            {linkChips(dayLinks, "Materials to print today")}
            {featureImage ? null : featureBlock()}
            {dailyBlock()}
          </div>
        )}
        {/* The verse is already large on this screen, so the bar carries the
            unscramble instead of repeating it. */}
        {footer(true)}
      </>
    );
  } else if (!cur || cur.duty || cur.empty) {
    const nx = nextClass(cur ? cur.start : t);
    const mins = nx ? nx.start - t : 0;
    const title = cur && !cur.empty
      ? friendlyDutyTitle(cur.text || cur.subj) || cur.subj
      : "Change of class";
    // Lunch and recess end in a change too, so the clock is highlighted for the
    // same last few minutes — measured to the end of this break, not to the next
    // class, which can be a whole recess away.
    redState = cur
      ? cur.end - t > 0 && cur.end - t <= setup.redAt
      : !!nx && mins > 0 && mins <= setup.redAt;
    body = (
      <>
        {header({
          title, chips: null, when: cur ? `${fmt(cur.start)} to ${fmt(cur.end)}` : "",
          leftHtml: nx ? <><b>{nx.subj}</b> in {mins} min</> : <b>Day complete</b>,
          pct: cur ? ((t - cur.start) / (cur.end - cur.start)) * 100 : 0, period: cur,
          red: redState,
        })}
        {withPicture(nx ? (
          <div>
            <p className="eyebrow">Up next</p>
            <p className="big">{nx.subj}</p>
            <p className="question">{nx.room} · starts at {fmt(nx.start)}</p>
            <p className="summary">{nx.today}</p>
          </div>
        ) : (
          <div><p className="script">{title}</p></div>
        ))}
        {footer(true)}
      </>
    );
  } else {
    const { elapsed, left } = cur;
    const pct = (elapsed / (cur.end - cur.start)) * 100;
    redState = left <= setup.redAt;
    const phase = elapsed < setup.openMin ? "open" : "work";
    const nx = nextClass(cur.end);
    const isLast = lastClass && lastClass.start === cur.start;
    // The picture for this lesson comes from its Lessons row when there is one;
    // the Setup slot picture is the fallback.
    const lessonPic = cur.image ? { url: cur.image, seconds: setup.picSeconds } : data.picture;
    const lessonPicOn = opts.pic !== "off" && lessonPic && usable(lessonPic.url) && elapsed * 60 < setup.picSeconds;
    const picOn = !!featureImage || lessonPicOn;

    // Handouts named in the lesson cell, so they can be opened and printed from
    // the board if they were not run off beforehand.
    const handouts = linkChips(cur.links || [], "Handouts");
    const leftCol = (
      <div>
        <p className="eyebrow">Today</p>
        <p className="question">{cur.q || cur.subj}</p>
        <p className="summary">{cur.today}</p>
        {phase === "open" ? null : list(cur.plan, "plan")}
        {handouts}
      </div>
    );

    let side;
    if (endOfDaySoon) {
      // The last few minutes of the day: E1 gives its side of the screen over to
      // the dismissal package.
      side = dismissalPanel(true);
    } else if (featureImage) {
      side = bigPicture(featureImage, `On screen now · ${cur.code}`, "");
    } else if (lessonPicOn) {
      const picLeft = Math.ceil((setup.picSeconds - elapsed * 60) / 60);
      side = bigPicture(lessonPic.url, `Lesson picture${cur.code ? ` · ${cur.code}` : ""}`, `${picLeft} min left on screen`);
    } else {
      const blocks = [];
      if (phase === "open") {
        let o;
        if (/^Math/.test(cur.subj) && challenge) o = { h: "Math challenge", p: `${challenge} Treat for the first correct answer in; max one win a week.` };
        else {
          const mv = cur.plan.find((b) => /memory verse/i.test(b));
          o = mv ? { h: "Memory verse", p: `${mv}. Practise it with the person beside you.` } : { h: "First up", p: cur.plan[0] || cur.today };
        }
        blocks.push(<div key="o" className="block sun"><h3>{o.h}</h3><p>{o.p}</p></div>);
      }
      const f = featureBlock();
      if (f) blocks.push(<div key="f">{f}</div>);
      const d = dailyBlock();
      if (d) blocks.push(<div key="d">{d}</div>);
      if (left <= setup.remindersAdvance && cur.remind) blocks.push(<div key="r" className="block navy"><h3>Reminders</h3><p>{cur.remind}</p></div>);
      const agendaText = cur.assign.length ? cur.assign.join("; ") : cur.homework || cur.remind;
      if (left <= setup.homeworkAt) blocks.push(<div key="h" className="block alert"><h3>Write in your agenda</h3><p>{agendaText}</p></div>);
      else if (phase !== "open" && cur.assign.length) blocks.push(<div key="a" className="block sun"><h3>Assign</h3>{list(cur.assign)}</div>);
      if (isLast && left <= setup.nextAdvance && meta.headout.length) blocks.push(<div key="x" className="block alert"><h3>Before you head out</h3>{list(meta.headout)}</div>);
      side = <div className="panel">{blocks}</div>;
    }

    body = (
      <>
        {header({
          title: cur.subj,
          chips: (
            <>
              <span className="chip">{cur.room}</span>
              {cur.code ? <span className="chip">{cur.code}</span> : null}
              {cur.page ? <span className="chip">{cur.page}</span> : null}
            </>
          ),
          when: `${fmt(cur.start)} to ${fmt(cur.end)} · ${cur.end - cur.start} min`,
          leftHtml: <><b>{left} min</b> left</>, pct, red: redState, period: cur,
        })}
        <div className={`main${picOn && !endOfDaySoon ? ` pic-${opts.pic}` : ""}${featureImage && !endOfDaySoon ? " pic-feature" : ""}`}>
          {picOn && !endOfDaySoon && opts.pic === "left" ? <>{side}{leftCol}</> : <>{leftCol}{side}</>}
        </div>
        {footer(left <= setup.nextAdvance)}
      </>
    );
  }

  return (
    <div
      ref={boardRef}
      className={`board${redState ? " red" : ""}${scrub != null ? " previewing" : ""}`}
      style={{ "--subj": theme.accent, "--subj-deep": theme.deep }}
      data-subject={theme.key}
      data-period={cur ? cur.start : "none"}
      data-tick={tick}
    >
      {body}
    </div>
  );
}
