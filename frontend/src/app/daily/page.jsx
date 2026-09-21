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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_SOURCES, evaluateDailyText, evaluateFeature, evaluateGreeting, evaluateStatus, evaluateVerse, evaluateNotice, firstClassStart, formalDiscussion, testWeekday, birthdaysToday, birthdaysForSection, joinNames, specialDays, calendarEvents, columnName, canonicalUrl, friendlyDutyTitle, anthemOfDay, statusStyle, statusWords, subjectTheme, tidyTruncated, truncateWords, weekdayColour } from "@/lib/daily/parse";

const CLASS_LABELS = ["7A", "7B", "7C", "8A", "8B", "8C"];
// The Setup slot table's own columns, for ?debug=1.
const SLOT_COLS = ["U", "V", "W", "X", "Y", "Z", "AA", "AB"];
const FLAGS = ["FD", "B1", "B2"];
const POLL_MS = 10_000;
const FETCH_TIMEOUT_MS = 25_000;
// A read that fails waits longer each time rather than hammering a sheet that
// is already struggling, up to a minute; and nothing is said on screen until
// it has failed this many times running (a minute or so of real trouble).
const MAX_POLL_MS = 60_000;
const FAIL_QUIET = 3;
// How long a scrubbed preview holds before the board snaps back to now. Long
// enough to look through the afternoon and talk about it: the old 45 s took
// the screen back mid-sentence.
const SCRUB_RESET_MS = 300_000;
const LAST_COPY_KEY = "daily:last";
// Which groups have had their earned Formal Discussion, and when. Once it has
// been on the screen it has been had, so it does not come round again that
// month — but it stays up for the rest of the day it appeared on rather than
// vanishing part way through the class.
const FD_HAD_KEY = "daily:fd-extra";
// Vendored in public/daily — see the note at the top of that file.
const FLAG_CA = "/daily/flag-ca.svg";
// How old what is on screen has to be before the board says anything about it.
const STALE_AFTER_MS = 600_000;
// The bottom bar holds one line, so the verse is shortened to about the length
// the sheet's own A5 uses — but at a word boundary.
const VERSE_MAX = 85;
// How far the lesson type may be scaled to fill the screen, and how much slack
// is left alone rather than triggering another search.
const FIT_MIN = 0.66;
const FIT_MAX = 1.9;
const FIT_SLACK = 0.05;
// The shortest a period may be cut to by the bell schedule.
const MIN_PERIOD_MIN = 10;
// A riddle for the bottom bar at the end of the day, for the days the sheet has
// none of its own. Picked by the date so it does not change while it is up.
// Said before lunch, where the end-of-day benediction used to appear.
const LUNCH_GRACE =
  "For food in a world where many walk in hunger, for faith in a world where many walk in fear, "
  + "and for friends in a world where many walk alone \u2014 we give You thanks.";
const HOUSE_RIDDLES = [
  ["What has to be broken before you can use it?", "An egg."],
  ["I am tall when I am young and short when I am old. What am I?", "A candle."],
  ["What has many keys but cannot open a single lock?", "A piano."],
  ["What goes up but never comes down?", "Your age."],
  ["What can travel around the world while staying in a corner?", "A stamp."],
  ["The more of me you take, the more you leave behind. What am I?", "Footsteps."],
  ["What has hands but cannot clap?", "A clock."],
  ["What gets wetter the more it dries?", "A towel."],
];

// A joke to end the day on, one per day of the year. Classroom-safe, groan-
// worthy by design: the screen that says "Well done" should not end on a
// footnote about a verse the room has already had all day.
const HOUSE_JOKES = [
  ["Why did the math book look so sad?", "It had too many problems."],
  ["What do you call a fish with no eyes?", "Fsh."],
  ["Why did the student eat his homework?", "The teacher said it was a piece of cake."],
  ["What is a snake's favourite subject?", "Hiss-tory."],
  ["Why was the equals sign so humble?", "It knew it was neither greater than nor less than anyone else."],
  ["What did one wall say to the other?", "I'll meet you at the corner."],
  ["Why did the scarecrow win an award?", "He was outstanding in his field."],
  ["What do you call cheese that is not yours?", "Nacho cheese."],
  ["Why can't you trust an atom?", "They make up everything."],
  ["What is a teacher's favourite nation?", "Expla-nation."],
  ["Why did the geography book break up with the atlas?", "It needed more space."],
  ["What did the triangle say to the circle?", "You're pointless."],
  ["Why did the music teacher need a ladder?", "To reach the high notes."],
  ["What do you call a dinosaur with an extensive vocabulary?", "A thesaurus."],
  ["Why was the calendar nervous?", "Its days were numbered."],
  ["What is the king of all school supplies?", "The ruler."],
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
function periodsFromPlan(rows, plan, bell) {
  const timed = plan.filter((c) => c.start != null);
  const planned = new Set(timed.map((c) => c.start));
  // A class the plan gives no time to still has to appear. The day's blank time
  // rows are the slots left for them, taken in order — without this the
  // afternoon simply vanished whenever Vertical carried times for the morning
  // only.
  // Slots a class with no time can go in: a bell time that no timed class has
  // taken and that DisplayAI has not named (lunch, recess, dismissal keep theirs).
  const named = new Set(rows.filter((r) => !r.empty).map((r) => r.start));
  const spare = Array.from(new Set([...bell, ...rows.filter((r) => r.empty).map((r) => r.start)]))
    .filter((at) => !planned.has(at) && !named.has(at))
    .sort((a, b) => a - b);
  const all = [];
  let cursor = 0;
  let lastAt = -1;
  for (const c of plan) {
    if (c.start != null) {
      lastAt = c.start;
      all.push(c);
      continue;
    }
    // The next blank slot after the class before it, so an untimed afternoon
    // does not land back in the morning.
    while (cursor < spare.length && spare[cursor] <= lastAt) cursor += 1;
    if (cursor >= spare.length) continue;
    lastAt = spare[cursor];
    all.push({ ...c, start: spare[cursor] });
    cursor += 1;
  }
  const used = new Set(all.map((c) => c.start));

  // Every period runs to the next bell, not to the next row DisplayAI happens
  // to carry — that is what stretched a twenty-minute recess over an hour.
  const bounds = Array.from(new Set([...bell, ...rows.map((r) => r.start), ...all.map((c) => c.start)])).sort((a, b) => a - b);
  const endAfter = (start) => bounds.find((b) => b > start) ?? start + 60;
  // DisplayAI is the live, AI-written version of any class it does carry, so it
  // wins for that period; the plan only fills in what that row does not have.
  const live = new Map(rows.filter((r) => !r.empty && !r.duty && r.subj).map((r) => [r.start, r]));
  const out = all.map((c) => {
    const l = live.get(c.start);
    if (l) {
      return {
        ...l,
        end: endAfter(c.start),
        code: l.code || c.code,
        page: l.page || c.page,
        image: l.image || c.image,
        links: (l.links || []).length ? l.links : (c.links || []),
      };
    }
    return {
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
    };
  });
  for (const r of rows) if (!used.has(r.start)) out.push({ ...r, end: endAfter(r.start) });
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

function Chips({ period, left, setup, status, writing }) {
  if (!period) return null;
  const raw = (status || period.status || "").trim();
  const st = parseStatus(raw);
  // The code is a privilege signal the room reads by colour, so the badge keeps
  // the sheet's own conditional formatting — but it says what the benefit is
  // ("Free pass", "All 3") rather than the sheet's shorthand, which only the
  // teacher can decode, and it says it only while that benefit is on the table.
  // The colour follows what is on offer, not what was earned earlier in the
  // period; the code itself stays in the tooltip.
  const said = statusWords(raw, period.duty
    ? undefined
    : { elapsed: period.elapsed, seatMin: setup.seatMin, laterMin: setup.graceMin });
  const style = statusStyle(said ? said.code : raw);
  const badge = said && said.words ? (
    <span
      key="badge"
      className="statusbadge"
      style={{ background: style ? style.bg : "var(--chip)", color: style ? style.fg : "var(--muted)", borderColor: style && style.border ? style.border : "transparent" }}
      title={`Privilege code ${raw}`}
    >
      {said.letter ? <i className="grp">{said.letter}</i> : null}
      {said.words}
    </span>
  ) : null;
  if (period.duty) return badge ? <div className="points">{badge}</div> : null;
  const items = [badge];
  // The pass is not usable during the lesson at the top of the period — nobody
  // walks out while the teaching is going on — nor in the last few minutes. The
  // opening window is the same one the sheet's own status rule uses to force the
  // pass off (Setup's grace minutes), so both move together. While it is shut at
  // the top the chip says when it opens, which is what a student wants to know.
  const opensIn = Math.max(0, Math.ceil(setup.graceMin - period.elapsed));
  const washroomOn = opensIn <= 0 && left > setup.washroomBefore;
  items.push(
    <span
      key="w"
      className={`chip ${washroomOn ? "on" : "off"}`}
      title={opensIn > 0 ? `The pass opens ${setup.graceMin} minutes into the class` : ""}
    >
      {opensIn > 0 ? `Washroom in ${opensIn} min` : "Washroom"}
    </span>
  );
  if (st && st.on && st.on[2] && !st.grace && period.elapsed <= setup.graceMin + setup.snacksB2Min) {
    items.push(<span key="s" className="chip on">Snacks</span>);
  }
  // A class that has had more than one poor day in the last five owes a
  // corrective writing assignment — the one rule in the legend the sheet does
  // not work out for itself.
  if (writing) {
    items.push(
      <span key="wr" className="chip writing" title="More than one day of five points or fewer in the last five days">
        Writing
      </span>
    );
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

function PointsStrip({ points, labels, currentSec, showPercent }) {
  const nums = points.numbers || [], pcts = points.percents || [];
  const n = Math.max(nums.length, pcts.length);
  // The sheet's own names (Points row 3) when it has them, so the chips follow
  // the sections taught this year; CLASS_LABELS is only the fallback.
  const names = (labels || []).length >= n ? labels : CLASS_LABELS;
  if (!n && points.entered == null) return null;
  // One number at a time, the way the sheet's own line does it — the strip has
  // six classes across the foot of the screen and two figures each is a row of
  // small print. Which one is showing is said once, at the left, rather than
  // marked on every chip.
  const havePct = pcts.some((v) => v != null);
  const haveNum = nums.some((v) => v != null);
  const percentNow = showPercent && havePct;
  return (
    <div className="ptsrow">
      <div className="pts">
        {haveNum && havePct ? (
          <span className="ptswhat">{percentNow ? "of target" : "points"}</span>
        ) : null}
        {Array.from({ length: n }).map((_, i) => {
          const label = names[i] || `#${i + 1}`;
          const pct = pcts[i];
          const shown = percentNow ? (pct != null ? `${pct}%` : "—") : (nums[i] != null ? nums[i] : "—");
          return (
            <div key={label} className={`pt${label === currentSec ? " cur" : ""}`}>
              <span className="c">{label}</span>
              <span className="n">{shown}</span>
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
function Scrub({ min, max, value, live, marks, onChange, onLive }) {
  const active = value != null;
  const span = Math.max(1, max - min);
  return (
    <div className={`scrub${active ? " active" : ""}`}>
      <span className="scrub-label">{active ? `Previewing ${fmt(value)}` : "Look ahead or back"}</span>
      {/* Each class is a dot on the line, and pressing one goes to the minute
          that class begins — finding 1:40 PM by dragging a slider across a
          school day is a poor way to look at the afternoon. */}
      <div className="scrub-track">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={active ? value : Math.round(live)}
          aria-label="Preview another time of day"
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
        />
        <div className="scrub-marks">
          {(marks || []).map((m) => (
            <button
              key={`${m.at}-${m.label}`}
              type="button"
              className={`scrub-mark${value != null && value === m.at ? " on" : ""}`}
              style={{ left: `${((m.at - min) / span) * 100}%` }}
              title={`${m.label} · ${fmt(m.at)}`}
              aria-label={`Go to ${m.label} at ${fmt(m.at)}`}
              onClick={() => onChange(m.at)}
            />
          ))}
        </div>
      </div>
      <button type="button" className="scrub-live" onClick={onLive} disabled={!active}>{active ? "Back to now" : "Live"}</button>
    </div>
  );
}

/* ---------- the page ---------- */

export default function DailyPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loadNote, setLoadNote] = useState("Contacting the sheet…");
  const [points, setPoints] = useState({ numbers: null, percents: null, entered: null, enteredCell: "", writing: [], writingNote: "", b3: [], b3Note: "", note: "" });
  const [tick, setTick] = useState(0);
  const [vidBig, setVidBig] = useState(false);
  const [opts, setOpts] = useState({ t: null, k: "", pic: "right", debug: false });
  const [scrub, setScrub] = useState(null);
  const [badImages, setBadImages] = useState({});
  const [prayBig, setPrayBig] = useState(false);
  const [copied, setCopied] = useState("");
  const [fdHad, setFdHad] = useState({});
  // What the render found on screen, for the effect above to record.
  const fdPending = useRef("");
  const scrubTouched = useRef(0);
  const debugRef = useRef(null);
  // When what is on screen was read from the sheet — not when it was fetched.
  const lastGood = useRef(0);
  const seenVersion = useRef(null);

  // The last copy this browser saw, shown at once if it is from today.
  //
  // A cold serverless instance plus a sheet read is several seconds, and the
  // board opens on a projector at the start of a lesson — "Contacting the
  // sheet…" is the wrong thing to have on the wall. Yesterday's copy is not
  // shown: it would put yesterday's lesson on the screen.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_COPY_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const when = new Date(saved.fetchedAt || 0);
      if (new Date().toDateString() !== when.toDateString()) return;
      lastGood.current = when.getTime();
      setData((d) => d || saved);
      if (saved.points) setPoints((p) => ({ ...p, ...saved.points }));
    } catch {
      /* private window, cleared storage, a copy too big to keep — no matter */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FD_HAD_KEY);
      if (raw) setFdHad(JSON.parse(raw) || {});
    } catch { /* storage off; the extra may then come round twice */ }
  }, []);

  // URL options (client only)
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    setOpts({ t: parseHHMM(u.get("t")), k: u.get("k") || "", pic: u.get("pic") === "left" ? "left" : u.get("pic") === "off" ? "off" : "right", debug: u.get("debug") === "1" });
    document.title = "Daily Board";
  }, []);

  // Poll the sheet. Keep both numbers and percents as they alternate on the date line.
  //
  // Reads do not overlap and they back off. The board used to fire one every
  // ten seconds whatever was happening, so a slow read — a cold function, a
  // sheet that takes its time — had two or three more piled up behind it, each
  // one making the next slower, each one timing out in turn and putting "the
  // sheet took too long to answer" across the bottom of the projector. One at
  // a time, and a failure waits longer before trying again, is most of the fix.
  useEffect(() => {
    let alive = true;
    let timer = null;
    // One read at a time, and how many have failed in a row — both belong to
    // this run of the effect, not to the page: kept on a ref, a remount finds
    // the previous run's read still in flight, declines to start its own, and
    // the board never polls again.
    let reading = false;
    let failures = 0;
    const load = async () => {
      if (!alive) return;
      if (reading) { timer = setTimeout(load, POLL_MS); return; }
      reading = true;
      const ctrl = new AbortController();
      const cutoff = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/daily${opts.k ? `?k=${encodeURIComponent(opts.k)}` : ""}`, { cache: "no-store", signal: ctrl.signal });
        const text = await res.text();
        let j;
        try { j = JSON.parse(text); } catch { j = { error: `Unexpected reply (${res.status}): ${text.slice(0, 120)}` }; }
        if (!alive) return;
        if (!res.ok || !j.periods) { fail(j.error || `HTTP ${res.status}`); return; }
        failures = 0;
        // How old what is on screen actually is: the server may itself be
        // serving a copy it read a while ago.
        lastGood.current = Date.now() - (Number(j.cachedFor) || 0) * 1000;
        setData(j);
        setError(j.stale ? `Showing the last good copy. ${j.error || ""}` : "");
        setPoints((p) => ({
          numbers: (j.points && j.points.numbers) || p.numbers,
          percents: (j.points && j.points.percents) || p.percents,
          entered: j.points && j.points.entered != null ? j.points.entered : p.entered,
          enteredCell: (j.points && j.points.enteredCell) || "",
          writing: (j.points && j.points.writing) || [],
          writingNote: (j.points && j.points.writingNote) || "",
          b3: (j.points && j.points.b3) || [],
          b3Note: (j.points && j.points.b3Note) || "",
          note: (j.points && j.points.note) || "",
        }));
        // A picture that failed once — a Drive link not yet shared, a blip —
        // was dropped for the life of the page, and a projector page runs all
        // day. A fresh read of the sheet is a fresh chance for it to load.
        if (j.version != null && j.version !== seenVersion.current) {
          seenVersion.current = j.version;
          setBadImages((b) => (Object.keys(b).length ? {} : b));
          // Kept for the next time this board is opened, not for this page.
          try {
            window.localStorage.setItem(LAST_COPY_KEY, JSON.stringify(j));
          } catch {
            /* over the quota, or storage turned off — the board does not care */
          }
        }
      } catch (e) {
        if (alive) fail(e.name === "AbortError" ? "The sheet took too long to answer." : e.message || "Could not reach the sheet");
      } finally {
        clearTimeout(cutoff);
        reading = false;
        if (alive) timer = setTimeout(load, nextDelay());
      }
    };
    // A failed read is not itself news. What the room needs to know is whether
    // what is on the screen has stopped being true — so the dot waits for the
    // copy on screen to be genuinely old, not merely for a fetch to have
    // failed. A cold instance behind the sheet can take half a minute to
    // answer while the board carries a copy from ten seconds ago; that is a
    // mark on a projector for nothing.
    const fail = (message) => {
      failures += 1;
      const stale = Date.now() - lastGood.current;
      if (failures < FAIL_QUIET || stale < STALE_AFTER_MS) return;
      const mins = Math.round(stale / 60000);
      setError(`${message} Nothing new for ${mins} minute${mins === 1 ? "" : "s"}.`);
    };
    const nextDelay = () => (failures
      ? Math.min(POLL_MS * 2 ** failures, MAX_POLL_MS)
      : POLL_MS);

    load();
    const note = setTimeout(() => setLoadNote("Still waiting… the first load after a quiet spell can take a few seconds."), 8000);
    return () => { alive = false; if (timer) clearTimeout(timer); clearTimeout(note); };
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
    const plan = (data.dayPlan || {})[wd] || [];
    const bell = data.dayTimes || [];
    // DisplayAI fills from the sheet's own clock, so first thing in the morning
    // it carries one class and the rest of the day is not in it yet. The plan is
    // therefore merged in rather than used only when DisplayAI is empty —
    // otherwise the board believed the day ended after the one class it had.
    const built = plan.length ? periodsFromPlan(rows, plan, bell) : rows;
    // Vertical column A is the school's own bell schedule, so nothing runs past
    // the next bell whatever the sheet's rows imply.
    const P = bell.length
      ? built.map((p) => {
          // Never shorten a period to less than a few minutes: a bell that close
          // to its start is not a bell, it is something else in that column.
          const next = bell.find((b) => b >= p.start + MIN_PERIOD_MIN);
          return next != null && next < p.end ? { ...p, end: next } : p;
        })
      : built;
    // A class cannot be a minute long. The time column carries bells left over
    // from years with a class in that minute, and each one turned into a sliver
    // of a period repeating the class before it — "10:00 Math 7A, 10:59 Math
    // 7A" on the agenda. The sliver goes and the class before it keeps the time.
    const kept = [];
    for (const p of P) {
      const prev = kept[kept.length - 1];
      if (!p.duty && !p.empty && p.end - p.start < MIN_PERIOD_MIN) {
        if (prev && prev.end <= p.start) prev.end = p.end;
        continue;
      }
      kept.push({ ...p });
    }
    // A class is not under way while the room is standing for the anthem. The
    // day's first teaching period therefore begins when the opening is over —
    // at the first bell in Vertical column A at or after it (9:05 in the
    // sheet), not at whatever earlier time its own row carries.
    const openEnd = data.setup && data.setup.blankTo != null
      ? data.setup.blankTo + (data.setup.anthemMin || 0)
      : null;
    const first = kept.find((p) => !p.duty && !p.empty);
    if (first) first.start = firstClassStart(first.start, first.end, openEnd, bell, MIN_PERIOD_MIN);
    const classes = kept.filter((p) => !p.duty && !p.empty);
    let cur = null;
    for (const p of kept) if (t >= p.start && t < p.end) { cur = p; break; }
    const nextClass = (after) => classes.find((c) => c.start >= after) || null;
    if (cur) cur = { ...cur, elapsed: t - cur.start, left: cur.end - t };
    return { P: kept, classes, cur, nextClass };
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
        // A picture is elastic by design, and an empty column is stretched to
        // the row — measuring either would report a full screen and stop the
        // type ever growing.
        if (col.classList.contains("picture") || !col.children.length) continue;
        for (const kid of col.children) bottom = Math.max(bottom, kid.getBoundingClientRect().bottom);
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


  // Once an earned Formal Discussion has been on the screen it has been had.
  // The render decides that — it is the render that knows which class is up —
  // and this flushes what it decided. No dependency list: it runs after each
  // render and does nothing unless the render left a group's name behind.
  useEffect(() => {
    const sec = fdPending.current;
    if (!sec) return;
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const day = now.toDateString();
    setFdHad((prev) => {
      if (prev[sec] && prev[sec].month === month) return prev;
      const next = { ...prev, [sec]: { month, day } };
      try { window.localStorage.setItem(FD_HAD_KEY, JSON.stringify(next)); } catch { /* storage off */ }
      return next;
    });
  });

  // The verse along the bottom bar is longer than the bar, so it sweeps across
  // and back — but once a minute, or when someone presses it, rather than
  // endlessly. A line that never stops moving in the corner of a projector is
  // something the room learns to ignore, and it kept the riddle's answer moving
  // past before anyone had read it.
  const liveMinute = Math.floor(live);
  const verseEl = useRef(null);
  const verseWatch = useRef(null);
  const [sweep, setSweep] = useState(0);
  const [verseOver, setVerseOver] = useState(0);
  const sweepNow = () => setSweep((n) => n + 1);
  const onSweepKey = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sweepNow(); }
  };
  const sweepTitle = "Press to read the whole line";

  // How far the line overruns the bar, measured rather than guessed, so a line
  // that fits sits still. Held in state rather than written onto the element by
  // hand: a class put on that way does not survive React rebuilding the node,
  // and the board rebuilds the bottom bar every few seconds.
  const measureVerse = useCallback(() => {
    const box = verseEl.current;
    const text = box && box.firstElementChild;
    if (!text) return;
    const over = Math.max(0, text.scrollWidth - box.clientWidth);
    setVerseOver((was) => (Math.abs(was - over) > 4 ? over : was));
  }, []);

  // Measured when the line itself arrives, not on a later tick. The board opens
  // on "Contacting the sheet…" with no bottom bar at all, so an effect that
  // only runs on the minute measured a line that was not on the screen yet and
  // called it a line that fits. The observer then catches the bar settling —
  // the verse is the flexible item in it, giving way to the week line and the
  // "Pray for …" link, so its width arrives a moment after the text does.
  const verseRef = useCallback((node) => {
    if (verseWatch.current) { verseWatch.current.disconnect(); verseWatch.current = null; }
    verseEl.current = node;
    if (!node) return;
    const ro = new ResizeObserver(measureVerse);
    ro.observe(node);
    verseWatch.current = ro;
    measureVerse();
  }, [measureVerse]);

  // And again on the minute, when the sweep itself comes round.
  useEffect(measureVerse, [measureVerse, sweep, liveMinute]);
  // The sweep is one run of the animation, and what restarts it is the inner
  // span being rebuilt: a fresh element starts its animation from the top.
  // The whole minute, not `live` itself — that carries the seconds as a
  // fraction, so the key changed on every tick and the sweep never got past
  // its first second. And the real clock rather than the board's, so dragging
  // the scrubber across an afternoon does not set the line sweeping on every
  // minute it passes.
  const sweepKey = `${sweep}-${liveMinute}`;
  const verseStyle = {
    "--over": `${verseOver}px`,
    "--dur": `${Math.min(34, Math.round(verseOver / 45) + 12)}s`,
  };

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
  // The bottom bar has one line for it, so rather than cut the quote short it
  // carries the whole thing and slides it across when it does not fit.
  const verseFull = verseSrc.text ? verseQuote : tidyTruncated(verseQuote);

  // The Setup slot rules are written against NOW(); handing the board's own
  // clock in is what lets the scrubber move them — otherwise E1 keeps showing
  // whatever was true at the moment the sheet was read.
  const clock = new Date();
  clock.setHours(Math.floor(t / 60), t % 60, 0, 0);
  const evaluated = evaluateFeature(sources, t, clock);
  // The anthem's own column of Poems: the flag and the words for today.
  const anthem = anthemOfDay(sources.poemGrid, sources.poemGridFormulas, weekday, sources.cellImages,
    { book: sources.book, now: clock });
  const notices = evaluateNotice(sources, clock);
  // Whose birthday it is today, and what grade they are in — the balloons go
  // over that grade's classes only. The rows come from the Bdays block the
  // sheet's own A2 rule already makes the board fetch.
  const birthdays = birthdaysToday(sources.book || {}, clock);
  // What the school's calendar carries for today and for tomorrow — the banner
  // across the top of every screen, so a day off or a dress-down is known about
  // the day before rather than on the morning.
  const special = specialDays(sources.book || {}, clock);
  // During a class the day's plan has nothing to add — that class is the screen.
  const dailyText = evaluateDailyText(sources, t, weekday, !!(cur && !cur.duty && !cur.empty));
  const peekNext = classes.find((c) => c.start >= (cur ? cur.end : t)) || null;
  // What actually happens at the bell, which is not always the next class: the
  // next row of the timetable, lunch and recess included. Used for the red
  // "what's next" line in the last few minutes of a period.
  // Setup's "For Dismissal Messages" block: the times the end-of-day material
  // comes forward (lunch, lunch recess, dismissal) and how far ahead of each.
  const dismissal = data.dismissal || { advanceMin: 5, times: [] };
  // A1 is a NOW() formula like the rest of the display cells, so the board works
  // it out from its own clock and the scrubber moves it with everything else.
  const greeting =
    evaluateGreeting(
      data.audiences || [],
      t,
      (dismissal.times.find((m) => /dismiss/i.test(m.label)) || {}).at ?? null,
      weekday
    ) || meta.greeting || "Good morning";
  const waiting = data.waiting || [];
  // When the teaching day ends. The sheet says so in three places and any one of
  // them may be blank, so the first that is set wins: the DisplayAI dismissal
  // row, Setup's "Show Dismissal List" time, or the Dismissal entry in the
  // message block. Without this the board fell through to "No classes today"
  // once the last row had passed.
  const dismissalRow = P.find((p) => /dismiss/i.test(`${p.subj || ""} ${p.text || ""}`));
  // What the sheet says about dismissal, in order of how plainly it says it. The
  // last bell comes last: Vertical's time column runs on past the school day, so
  // taking it ahead of the sheet's own "Dismissal" put the end of the day at
  // 4:25 and the class screens ran an hour past home time.
  const endOfDayAt = [
    dismissalRow ? dismissalRow.start : null,
    (dismissal.times.find((m) => /dismiss/i.test(m.label)) || {}).at,
    setup.dismissalAt,
    (data.dayTimes || []).length ? data.dayTimes[data.dayTimes.length - 1] : null,
  ].find((x) => x != null) ?? null;
  // The last few minutes of the day: E1 gives its side of the screen over to the
  // dismissal package. The nation of the day comes forward then and before each
  // of the sheet's other message times as well.
  // The minutes before the last bell: the class tidies up and stands ready for
  // the homeroom teacher. The end-of-day package comes up with it.
  const readyMin = Math.max(setup.dismissalReadyMin || 5, dismissal.advanceMin || 0);
  const endOfDaySoon = endOfDayAt != null && t >= endOfDayAt - readyMin && t < endOfDayAt;
  const msgNear = dismissal.times.find((m) => t >= m.at - dismissal.advanceMin && t < m.at) || null;
  const msgSoon = endOfDaySoon || !!msgNear;
  // The last minutes before lunch get a grace, not the end-of-day benediction.
  const lunchSoon = !endOfDaySoon && !!msgNear && /lunch/i.test(msgNear.label);
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
          {/* The course's deck for the year hangs off its own name: it is the
              thing most often wanted at the start of a lesson, and it sits in
              the sheet a row above the course's first lesson. */}
          <div className="title">
            {period && period.deck
              ? <a className="subj deck" href={period.deck} target="_blank" rel="noreferrer" title="Open this course's deck">{title}</a>
              : <span className="subj">{title}</span>}
            {chips}
          </div>
          {period && (
            <Chips
              period={period}
              left={period.left}
              setup={setup}
              status={statusOf(period)}
              writing={!!(period.sec && (points.writing || []).includes(period.sec))}
            />
          )}
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
  const jokeOfDay = () => {
    const d = new Date();
    return HOUSE_JOKES[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % HOUSE_JOKES.length];
  };
  const riddleOfDay = () => {
    const own = (meta.riddle || "").replace(/^Q:\s*/, "").trim();
    // The sheet's own riddle, with the answer from the column beside it.
    if (own && own !== (featureText || "").replace(/^Q:\s*/, "").trim()) {
      return { q: own, a: (sources.riddleAnswer || "").replace(/^A:\s*/, "").trim() };
    }
    const d = new Date();
    const pair = HOUSE_RIDDLES[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % HOUSE_RIDDLES.length];
    return { q: pair[0], a: pair[1] };
  };
  const footer = (showPuzzle, endOfDay) => (
    <>
      {/* The sheet swaps the two on the minute; the board follows the same beat,
          off its own clock so the scrubber moves it like everything else. */}
      <PointsStrip
        points={points}
        labels={sources.pointsLabels}
        currentSec={cur && !cur.duty ? cur.sec : ""}
        showPercent={Math.floor(t) % 2 === 0}
      />
      <div className="bottom">
        <span>
          {today && (
            <span className="daychip" style={{ background: today.colour }}>{today.name}</span>
          )}
          {meta.line}
          {/* The room does not need the wording of a Sheets error across the
              bottom of the projector — a dot it can ignore, and the whole
              message in the tooltip for whoever is standing at the board. */}
          {error ? <span className="stale" title={error} aria-label={error} role="img" /> : null}
        </span>
        {prayEl()}
        {showPuzzle && puzzleWord
          ? <span className="puzzle">Unscramble for a treat: <b>{puzzleWord}</b></span>
          : endOfDay
            ? (() => {
                const r = riddleOfDay();
                return (
                  <span
                    className={`verse riddleline${verseOver > 8 ? " scrolling" : ""}`}
                    ref={verseRef}
                    style={verseStyle}
                    title={sweepTitle}
                    onClick={sweepNow}
                    role="button"
                    tabIndex={0}
                    onKeyDown={onSweepKey}
                  >
                    <span className="vtext" key={sweepKey}>
                      Riddle: {r.q}
                      {/* The answer rides at the far end of the line: out of
                          sight until the sweep reaches it, so the room gets a
                          moment to think before it arrives. */}
                      {r.a ? <i className="answer">{r.a}</i> : null}
                    </span>
                  </span>
                );
              })()
            : (
              <span
                className={`verse${verseOver > 8 ? " scrolling" : ""}`}
                ref={verseRef}
                style={verseStyle}
                title={sweepTitle}
                onClick={sweepNow}
                role="button"
                tabIndex={0}
                onKeyDown={onSweepKey}
              >
                <span className="vtext" key={sweepKey}>{verseFull}</span>
              </span>
            )}
      </div>
      <Scrub
        min={dayMin}
        max={dayMax}
        value={scrub}
        live={opts.t != null ? opts.t : live}
        marks={classes.map((c) => ({ at: c.start, label: c.subj || c.sec || "Class" }))}
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
  // The lesson in one line — the same choice the class screen itself makes: the
  // question the lesson asks, else what it is about, else its first activity.
  // Before the first bell the agenda is the only place the day is laid out, and
  // "History 7A · Rm 202" says nothing about what the day holds.
  const lessonLine = (c) => (c ? (c.q || c.today || ((c.plan || [])[0] || "")).trim() : "");
  const agendaRow = (c, key, when) => [
    <span key={`t${key}`} className="t">{when}</span>,
    <span key={`s${key}`}>
      <b>{c.subj}</b>{c.room ? ` · ${c.room}` : ""}{c.page ? ` · ${c.page}` : ""}
      {lessonLine(c) ? <i className="lede">{lessonLine(c)}</i> : null}
    </span>,
  ];
  const agenda = () => (
    <div className="agenda">
      {classes.map((p) => agendaRow(p, p.start, fmt(p.start)))}
    </div>
  );
  const featureText = evaluated.text || meta.feature;
  const featureBlock = () => (featureText
    ? <div className="block feature quiet"><p>{featureText.replace(/^Q:\s*/, "")}</p></div>
    : meta.riddle ? <div className="block quiet"><h3>Riddle</h3><p>{meta.riddle.replace(/^Q:\s*/, "")}</p></div> : null);
  const dailyBlock = () => (dailyText
    ? <div className="block navy"><h3>Today</h3><p className="daily">{dailyText}</p></div> : null);
  // The Formal Discussion for the class on screen: the monthly one in the
  // second week, or the one the group earned with Benefit 3. Announced at the
  // start of the class in a box of its own, and it stays up for the period.
  const fdFor = (period) => {
    if (!period || period.duty || period.empty || !period.sec) return null;
    // The page's own reader: on = [Benefit 3, Benefit 1, Benefit 2].
    const st = parseStatus(statusOf(period));
    const had = fdHad[period.sec];
    const month = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, "0")}`;
    const day = clock.toDateString();
    const fd = formalDiscussion({
      sec: period.sec,
      subj: period.subj,
      at: clock,
      plan: data.dayPlan || {},
      // What the board actually has for that group today, in order.
      todaysSubjects: (view && view.classes ? view.classes : [])
        .filter((c) => c.sec === period.sec)
        .map((c) => c.subj),
      impromptu: sources.impromptu || [],
      // The privilege code carries B3 while the class is on, and the Points
      // tab's own flag column says it whether or not a code is showing.
      earnedExtra: !!(st && !st.rec && st.on && st.on[0])
        || (points.b3 || []).includes(period.sec),
      // Had it already — unless it was today, in which case it is still today's.
      extraAlreadyHad: !!(had && had.month === month && had.day !== day),
    });
    // Only the live board records one; a scrubbed preview of next week must not
    // use up a group's extra.
    if (fd && fd.extra && scrub == null && opts.t == null) fdPending.current = period.sec;
    return fd;
  };
  // A band of balloons across the top of the class, for a birthday in that
  // grade. Nothing at all when it is not one of theirs.
  const birthdayBand = (period) => {
    if (!period || period.duty || period.empty || !period.sec) return null;
    const mine = birthdaysForSection(birthdays, period.sec);
    if (!mine.length) return null;
    const notes = [...new Set(mine.map((b) => (b.note || "").trim()).filter(Boolean))];
    return (
      <div className="balloons">
        <span className="pops" aria-hidden="true">{"🎈🎈🎈🎈🎈🎈🎈🎈🎈🎈🎈🎈"}</span>
        <span className="hb">
          Happy birthday, {joinNames(mine.map((b) => b.name))}!
          {/* A birthday over a weekend is kept on a school day, and the sheet
              says in its own words which and why. */}
          {notes.length ? <i className="hbnote">{notes.join(" · ")}</i> : null}
        </span>
        <span className="pops" aria-hidden="true">{"🎈🎈🎈🎈🎈🎈🎈🎈🎈🎈🎈🎈"}</span>
      </div>
    );
  };
  // A banner across the top of the board for a special day: what is on today,
  // and what is on the next day the room is here — a day off on the way there
  // is said in its own right, because that is the one they want to hear about
  // on the Friday. The teacher's own diary — marks due, rosters, a colleague
  // out — is left out of it: this is read by the class.
  const calendarLine = (list, when) => (
    <span className="cal-day">
      <b>{when}</b>
      {list.map((e, i) => (
        <span key={i} className={`cal-ev${e.noSchool ? " off" : ""}`}>
          {e.noSchool ? "No school — " : ""}{e.label}
        </span>
      ))}
    </span>
  );
  const calendarBanner = () => {
    const today = special.today || [];
    const ahead = special.ahead || [];
    if (!today.length && !ahead.length) return null;
    const off = [...today, ...ahead.flatMap((b) => b.events)].some((e) => e.noSchool);
    return (
      <div className={`calbanner${off ? " off" : ""}`}>
        <span className="cal-icon" aria-hidden="true">📅</span>
        {today.length ? calendarLine(today, "Today") : null}
        {ahead.map((b, i) => <Fragment key={i}>{calendarLine(b.events, b.when)}</Fragment>)}
      </div>
    );
  };
  const fdBlock = (fd) => (fd
    ? (
      <div className="block fd">
        <h3>{fd.extra ? "Formal Discussion — earned" : "Formal Discussion"}</h3>
        {fd.extra ? <p className="won">Well done — Benefit 3. This one is yours.</p> : null}
        <p className="topic">{fd.topic}</p>
      </div>
    ) : null);
  // A2: whose birthday it is, what is on at school today and — past noon —
  // what is on tomorrow. The sheet has carried it all along and nothing on the
  // board showed it. Its rule turns over at noon, so it is run at the board's
  // clock rather than read (evaluateNotice), and the scrubber moves it.
  const noticeBlock = () => (notices
    ? (
      <div className="block sun notices">
        {notices.split("\n").map((l, i) => l.trim() && <p key={i}>{l.trim()}</p>)}
      </div>
    ) : null);
  // The end-of-day package that takes over the feature side: what is on
  // tomorrow, the head-out list, and the Kiss & Ride names waiting outside.
  const dismissalPanel = (withHeadout, readyAt) => (
    <div className="panel dismissalpanel">
      {readyAt != null ? (
        <div className="block alert ready">
          <h3>Get ready for dismissal</h3>
          <p>Tidy your area, tuck your chair in and stand behind it — ready for your homeroom teacher by {fmt(readyAt)}.</p>
        </div>
      ) : null}
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
  const bigPicture = (url, caption, note, cls = "") => (
    <div className={`picture${cls ? ` ${cls}` : ""}`}>
      <div className="frame">
        <img src={url} alt={caption || "Picture on the board"} onError={() => markBad(url)} />
      </div>
      <div className="capline"><span>{caption}</span><span>{note}</span></div>
    </div>
  );
  // The anthem screen: the words on one side, the flag on the other. Shown
  // through the announcements as well as the anthem itself.
  const anthemMain = () => (
    <div className={`main anthem${anthem.lines.length ? " pic-right" : " solo"}`}>
      {anthem.lines.length ? (
        <div className="words">{anthem.lines.map((l, i) => <p key={i}>{l}</p>)}</div>
      ) : null}
      {/* The sheet's flag if it has one, otherwise the board's own. Canada's
          flag does not change, and the room should not be short of one because
          a picture was pasted into a cell the API cannot see. */}
      {bigPicture(anthem.image && usable(anthem.image) ? anthem.image : FLAG_CA, "", "", "fill")}
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
        <div className="debug" ref={debugRef}>
          <h1>
            What the board sees
            {/* Every one of these lines has been read back to me off a
                photograph of the screen. One button beats six screenshots. */}
            <button
              type="button"
              className="copydiag"
              onClick={() => {
                const text = debugRef.current ? debugRef.current.innerText : "";
                if (navigator.clipboard) navigator.clipboard.writeText(text).then(
                  () => setCopied("Copied"),
                  () => setCopied("Select and copy by hand — the browser said no")
                );
                else setCopied("This browser will not copy for me");
                setTimeout(() => setCopied(""), 4000);
              }}
            >{copied || "Copy all of this"}</button>
          </h1>
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
              {row("points labels", (sources.pointsLabels || []).join(", ") || "—")}
              {row("recorded pictures", Object.entries(sources.cellImages || {}).map(([k, v]) => `${k} → ${v}`).join("  ·  ") || "none — run the Apps Script in apps-script/mirror-cell-images.gs")}
              {row("O Canada", `${setup.blankTo != null ? `${fmt(setup.blankTo)} for ${setup.anthemMin} min` : "no window"}  ·  flag: ${anthem.image || "none the API can read"}  ·  ${anthem.lines.length} line(s) of words`)}
              {row("O Canada column", (() => {
                const col = weekday - 2;
                if (col < 0 || col > 4) return "not a school day";
                const letter = String.fromCharCode(70 + col);
                return [1, 2, 3].map((r) => `${letter}${r}: ${(((sources.poemGridFormulas || [])[r - 1] || [])[col] || ((sources.poemGrid || [])[r - 1] || [])[col] || "—")}`).join("  ·  ");
              })())}
              {row("ranges the rules named", (sources.extraRanges || []).join(", ") || "none beyond the fixed reads")}
              {row("lesson picture", cur ? `${cur.image || "—"}  ·  shows for the first ${Math.round(setup.picSeconds / 60)} min, ${Math.round(cur.elapsed)} min in${cur.image && badImages[cur.image] ? "  ·  DID NOT LOAD" : ""}` : "—")}
              {row("lesson video", (cur && cur.video) || "—")}
              {row("SchoolCalendar rows read",
                (() => {
                  const grids = ((sources.book || {}).schoolcalendar || []);
                  if (!grids.length) return "the tab was not read at all";
                  return grids
                    .map((g) => `${(g.values || []).filter((r) => (r || []).some((c) => String(c ?? "").trim())).length} rows with something in them, from ${columnName(g.left)}${g.top}`)
                    .join("   ·   ");
                })())}
              {row("special days (SchoolCalendar)",
                [["today", special.today], ...(special.ahead || []).map((x) => [x.when.toLowerCase(), x.events])]
                  .map(([when, list]) => `${when}: ${(list || []).map((e) => `${e.label}${e.noSchool ? " (no school)" : ""}`).join(", ") || "nothing for the room"}`)
                  .join("   ·   "))}
              {row("calendar rows left out (the teacher's own diary)",
                [0, 1, 2, 3, 4, 5, 6, 7]
                  .flatMap((n) => calendarEvents(sources.book || {}, new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + n))
                    .filter((e) => e.staffOnly)
                    .map((e) => `${n === 0 ? "today" : `+${n}`}: ${e.label}`))
                  .join("   ·   ") || "none in the next week")}
              {/* "nothing today" and "the tab never arrived" look the same on a
                  projector, so say which. */}
              {row("BDays rows read",
                (() => {
                  const grids = ((sources.book || {}).bdays || []);
                  if (!grids.length) return "the tab was not read at all";
                  return grids
                    .map((g) => `${(g.values || []).filter((r) => (r || []).some((c) => String(c ?? "").trim())).length} rows with something in them, from ${columnName(g.left)}${g.top}`)
                    .join("   ·   ");
                })())}
              {row("birthdays today",
                (birthdays || []).map((b) => `${b.name || "?"} (grade ${b.grade || "not found in the row"})${b.note ? ` — ${b.note}` : ""}`).join("   ")
                  || "nothing in the BDays rows for today")}
              {row("Benefit 3 earned (the extra Formal Discussion)",
                `${(points.b3 || []).join(", ") || "none"}  ·  ${points.b3Note || "—"}`)}
              {row("reward thresholds (Setup D53:AE56)",
                Object.entries(sources.rewards || {}).map(([k, v]) => `${k}: ${v.points} pts · ${v.days} days · ${v.times}×`).join("   ") || "none read — using below 6, twice, in the last 7")}
              {row("writing owed", `${(points.writing || []).join(", ") || "none"}  ·  ${points.writingNote || "—"}`)}
              {(sources.slots || []).map((sl, i) => (sl.name || sl.formula || sl.content ? (
                <Fragment key={`slot${i}`}>
                  {row(`slot ${SLOT_COLS[i] || `#${i + 1}`} ${sl.name || ""}`.trim(),
                    `priority ${sl.priority == null ? "—" : sl.priority} | row3: ${sl.contentFormula || sl.content || "—"} | row4: ${sl.formula || "—"} | row5: ${sl.generator || "—"} | sheet said: ${sl.value || "—"}`)}
                </Fragment>
              ) : null))}
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
              {row("day plan", dayPlan.length ? dayPlan.map((c) => `${c.start == null ? "--:--" : fmt(c.start)} ${c.subj}${c.code ? ` (${c.code})` : ""}`).join("  |  ") : "")}
              {row("bell schedule", (data.dayTimes || []).map(fmt).join("  ") || "")}
              {row("periods in view", P.map((x) => `${fmt(x.start)}${x.subj ? ` ${x.subj}` : x.empty ? " —" : " duty"}`).join("  |  "))}
              {row("lesson material", cur ? `page: ${cur.page || "—"} · homework: ${(cur.homework || "—").slice(0, 60)} · image: ${cur.image || "—"} · video: ${cur.video || "—"}` : "")}
              {row("handouts (current class)", cur && (cur.links || []).length ? cur.links.map((l) => `${l.label} \u2192 ${l.url}`).join("  |  ") : "")}
              {row("puzzle", meta.puzzle)}
              {row("riddle", meta.riddle)}
              {row("points", `${(points.numbers || []).join(", ") || "—"} | ${(points.percents || []).join(", ") || "—"} | entered: ${points.entered}`)}
              {row("points source", points.note || "—")}
              {/* Both of these answer "the board is saying something the sheet
                  does not": the strip's flag and the privilege flags are the
                  sheet's own cells, and these say which cells and what was in
                  them at the moment of the read. */}
              {row("points entered flag (plans row, column D)",
                `${points.enteredCell === "" ? "empty" : `"${points.enteredCell}"`} → ${points.entered == null ? "nothing shown" : points.entered ? "Points in" : "Points missing"}`)}
              {row("privilege flags (Points row 46)",
                (sources.pointsClasses || []).map((c) => {
                  const at = (k) => `${columnName(c.flagsAt + k)}46=${c.digits[k] === "" ? "·" : c.digits[k]}`;
                  return `${c.name}: B1 ${at(0)} · B2 ${at(1)} · P1 ${at(2)} · B3 ${at(3)}`;
                }).join("      ") || "no class flags read")}
              {row("Setup rows 35-40 (F, K, L)", (sources.plansCells || []).map((r) => `${r[0] || "·"} | ${r[1] || "·"} | ${r[2] || "·"}`).join("    ") || "—")}
              {/* The Points tab itself, every cell of it that holds anything.
                  Whether the strip reads the wrong cells or the sheet is
                  genuinely empty is not a thing to answer from a photograph. */}
              {row(`Points!A1:BV46 — ${(sources.pointsCells || []).length} cells with something in them`,
                (sources.pointsCells || []).join("  ") || "the whole block is empty")}
            </tbody>
          </table>
          <h2>Setup!T1:AA8 — the cells that decide E1</h2>
          <table className="grid">
            <tbody>
              {(data.slotBlock || []).map((rowVals, r) => (
                <tr key={r}>
                  <th>{r + 1}</th>
                  {/* The block is read from S, so the first cell is S — it was
                      labelled T, and the last two columns were not shown. */}
                  {["S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB"].map((col, c) => {
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
            {[
              ["E1 picture", evaluated.image || meta.featureImage],
              ["Lesson picture", data.picture && data.picture.url],
              ["O Canada flag", anthem.image],
              // Every class's own picture, so "no pictures at all" can be told
              // from "today's class has none".
              ...classes.filter((c) => c.image).map((c) => [`${c.subj || c.sec || "class"} picture`, c.image]),
            ]
              .filter(([, url]) => url)
              .map(([label, url]) => (
                <figure key={label}>
                  <img src={url} alt={label} onError={() => markBad(url)} />
                  <figcaption>{label} — {badImages[url] ? "did NOT load" : "loaded"}</figcaption>
                </figure>
              ))}
            {!evaluated.image && !meta.featureImage && !anthem.image && !(data.picture && data.picture.url)
              && !classes.some((c) => c.image)
              && <p>No picture address came back from the sheet at all — not for E1, not for the flag, not for any class.</p>}
          </div>
          <p>A picture reaches this page only as an address in the cell —
            <code>=IMAGE(&quot;https://…&quot;)</code>, a link, or the address written out.
            A picture <em>put into</em> the cell (Insert &rsaquo; Image, either kind) cannot
            be read at all: the Sheets API has no image field anywhere in it, so such a
            cell has neither a value nor a formula and always shows as empty here.</p>
          <p>Two ways round it, both in the sheet rather than on this page.
            The quick one, for a handful of cells: write the address in instead of
            inserting the picture — <code>=IMAGE(&quot;https://…&quot;)</code> looks the
            same in the sheet and the board can read it.</p>
          <p>The general one, for pictures you go on pasting in:
            <code>frontend/src/app/daily/apps-script/mirror-cell-images.gs</code> in the
            repository. It finds the cells holding a picture, copies the bytes to a
            Drive folder shared with anyone who has the link, and records the durable
            address on a hidden <b>BoardImages</b> tab — <em>your cells are left exactly
            as they are</em>. The board reads that tab and uses it wherever the picture
            itself cannot be seen. Paste it into Extensions &rsaquo; Apps Script, run
            <code>recordCellImagesForBoard</code> once, and give it an hourly trigger.
            Until it has run, the <b>recorded pictures</b> line above says so.</p>
        </div>
      </div>
    );
  }

  let body;
  let redState = false;

  if (setup.blankFrom != null && setup.blankTo != null && t >= setup.blankFrom && t < setup.blankTo) {
    body = (
      <>
        {header({ title: "Announcements", chips: null, when: `Screen blank until ${fmt(setup.blankTo)}`, leftHtml: <b>Please listen</b>, pct: 0 })}
        {calendarBanner()}
        {/* The flag and the words stand through the announcements as well as
            the anthem that follows them — the room is already on its feet, and
            a blank screen for those minutes helps nobody. Failing an anthem, a
            picture in the feature cell takes the screen rather than being
            thrown away, which is what the blank screen used to do. */}
        {anthem.image || anthem.lines.length
          ? anthemMain()
          : featureImage
            ? <div className="main solo">{bigPicture(featureImage, "Please listen", "", "fill")}</div>
            : <div className="main blank"><p>Please listen</p></div>}
        {footer(false)}
      </>
    );
  } else if (setup.blankTo != null && t >= setup.blankTo && t < setup.blankTo + setup.anthemMin && (anthem.image || anthem.lines.length)) {
    // O Canada, straight after the announcements: the flag and the words, in
    // whichever language the day's column of Poems carries them.
    body = (
      <>
        {header({ title: "O Canada", chips: null, when: `Until ${fmt(setup.blankTo + setup.anthemMin)}`, leftHtml: <b>Please stand</b>, pct: 0 })}
        {calendarBanner()}
        {anthemMain()}
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
        {calendarBanner()}
        <div className={`main pic-right endofday${featureImage ? " pic-feature" : ""}`}>
          <div>
            {/* The goodbye, then the blessing — the verse has had the bottom
                bar all day and the last word of it belongs to the blessing —
                then the standing-ready note, and last what to take home. */}
            <p className="script">Well done, {(greeting.match(/,\s*(.*?)!?$/) || [, "everyone"])[1]}.</p>
            {meta.blessing
              ? <p className="question blessing">{meta.blessing}</p>
              : (() => {
                // A joke rather than the verse, which has had the bottom bar all
                // day. The day's own, picked by the date so the room gets the
                // same one all afternoon and a different one tomorrow.
                const [q, a] = jokeOfDay();
                return <p className="question joke"><span>{q}</span> <b>{a}</b></p>;
              })()}
            <p className="summary">Tidy your area, tuck your chair in and stand behind it, ready for your homeroom teacher.</p>
            {meta.headout.length > 0 && (
              <div className="block alert" style={{ textAlign: "left", display: "inline-block" }}>
                <h3>Before you head out</h3>{list(meta.headout)}
              </div>
            )}
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
        {header({ title: greeting, chips: null, when: meta.plans, leftHtml: "", pct: 0 })}
        {calendarBanner()}
        {withPicture(
          <div>
            <p className="script">{greeting}</p>
            <p className="question">{verse}</p>
            <p className="summary">{note}</p>
            {dayPlan.length > 0 ? (
              <div className="agenda">
                {dayPlan.map((c, i) => agendaRow(c, i, c.start != null ? fmt(c.start) : c.room || "—"))}
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
        )}
        {footer(false)}
      </>
    );
  } else if (!cur && classes.length && t < classes[0].start) {
    body = (
      <>
        {header({ title: greeting, chips: null, when: meta.plans, leftHtml: <>First class at <b>{fmt(classes[0].start)}</b></>, pct: 0 })}
        {calendarBanner()}
        {withPicture(
          <div>
            <p className="script">{greeting}</p>
            <p className="question">{verse}</p>
            {agenda()}
            {linkChips(dayLinks, "Materials to print today")}
            {noticeBlock()}
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
          leftHtml: nx
            ? <><b>{nx.subj}</b> in {mins} min</>
            : <b>{endOfDayAt != null && t >= endOfDayAt ? "Day complete" : "Nothing scheduled"}</b>,
          pct: cur ? ((t - cur.start) / (cur.end - cur.start)) * 100 : 0, period: cur,
          red: redState,
        })}
        {calendarBanner()}
        {withPicture(nx ? (
          <div>
            <p className="eyebrow">Up next</p>
            <p className="big">{nx.subj}</p>
            <p className="question">{nx.room} · starts at {fmt(nx.start)}</p>
            <p className="summary">{nx.today}</p>
          </div>
        ) : (
          // Nothing after this one. Rather than a lone caption on an empty
          // screen, the room gets the day: whatever the board does know, so it
          // is plain at a glance whether the gap is the timetable or the sheet.
          <div>
            <p className="script">{title}</p>
            {classes.length ? agenda() : dayPlan.length ? (
              <div className="agenda">
                {dayPlan.map((c, i) => [
                  <span key={`t${i}`} className="t">{c.start != null ? fmt(c.start) : c.room || "\u2014"}</span>,
                  <span key={`s${i}`}><b>{c.subj}</b>{c.room ? ` \u00b7 ${c.room}` : ""}</span>,
                ])}
              </div>
            ) : P.length ? (
              <div className="agenda">
                {P.map((x) => [
                  <span key={`t${x.start}`} className="t">{fmt(x.start)}</span>,
                  <span key={`s${x.start}`}>{x.subj || x.text || "\u2014"}</span>,
                ])}
              </div>
            ) : <p className="summary">The sheet has nothing listed for the rest of today.</p>}
          </div>
        ))}
        {footer(true)}
      </>
    );
  } else {
    const { elapsed, left } = cur;
    const pct = (elapsed / (cur.end - cur.start)) * 100;
    redState = left <= setup.redAt;
    const phase = elapsed < setup.openMin ? "open" : "work";
    // The first few minutes of a class: the week's memory verse in one column
    // and the week's poem or hymn in the other, both large enough to say
    // together. On the day the verse is tested — the last teaching day of the
    // week — it is not put up: that is the day they are asked for it.
    const testToday = testWeekday(data.dayPlan || {}) === weekday;
    const mv = testToday ? "" : (sources.memoryVerse || "");
    const openingScreen = phase === "open" && !!(mv || sources.poem);
    const nx = nextClass(cur.end);
    // The picture for this lesson comes from its Lessons row when there is one;
    // the Setup slot picture is the fallback.
    const lessonPic = cur.image ? { url: cur.image, seconds: setup.picSeconds } : data.picture;
    const lessonPicOn = opts.pic !== "off" && lessonPic && usable(lessonPic.url) && elapsed * 60 < setup.picSeconds;
    const picOn = !!featureImage || lessonPicOn;

    // Handouts named in the lesson cell, so they can be opened and printed from
    // the board if they were not run off beforehand.
    const handouts = linkChips(cur.links || [], "Handouts");
    // Some lessons are a title and an assignment and nothing else. The lesson
    // column is where the class looks, so the assignment goes there rather than
    // leaving that half of the screen empty and the panel overfull.
    const assignOnLeft = !cur.plan.length && cur.assign.length > 0;
    const lessonList = assignOnLeft ? cur.assign : cur.plan;
    const leftCol = (
      <div>
        <p className="eyebrow">Today</p>
        {/* A lesson written without a question leads with what it is about,
            rather than repeating the class name under the class name. */}
        <p className="question">{cur.q || cur.today || cur.subj}</p>
        {cur.q && cur.today ? <p className="summary">{cur.today}</p> : null}
        {phase === "open" ? null : list(lessonList, "plan")}
        {handouts}
      </div>
    );

    let side;
    if (endOfDaySoon) {
      // The last few minutes of the day: E1 gives its side of the screen over to
      // the dismissal package.
      side = dismissalPanel(true, endOfDayAt);
    } else if (featureImage) {
      side = bigPicture(featureImage, `On screen now · ${cur.code}`, "");
    } else if (lessonPicOn) {
      const picLeft = Math.ceil((setup.picSeconds - elapsed * 60) / 60);
      side = bigPicture(lessonPic.url, `Lesson picture${cur.code ? ` · ${cur.code}` : ""}`, `${picLeft} min left on screen`);
    } else {
      const blocks = [];
      // The class opens on the verse of the day while everyone settles — but
      // only when the opening screen itself is not up, which now carries the
      // week's memory verse and the poem instead.
      if (phase === "open" && verseFull && !openingScreen) {
        blocks.push(
          <div key="v" className="block versefocus">
            <h3>Verse of the day</h3>
            <p>{verseFull}</p>
          </div>
        );
      }
      if (phase === "open") {
        let o;
        if (/^Math/.test(cur.subj) && challenge) o = { h: "Math challenge", p: `${challenge} Treat for the first correct answer in; max one win a week.` };
        else {
          const mv = cur.plan.find((b) => /memory verse/i.test(b));
          o = mv ? { h: "Memory verse", p: `${mv}. Practise it with the person beside you.` } : { h: "First up", p: cur.plan[0] || cur.today };
        }
        blocks.push(<div key="o" className="block sun"><h3>{o.h}</h3><p>{o.p}</p></div>);
      }
      const fd = fdBlock(fdFor(cur));
      if (fd) blocks.push(<div key="fd">{fd}</div>);
      const n = noticeBlock();
      if (n) blocks.push(<div key="n">{n}</div>);
      const f = featureBlock();
      if (f) blocks.push(<div key="f">{f}</div>);
      const d = dailyBlock();
      if (d) blocks.push(<div key="d">{d}</div>);
      if (left <= setup.remindersAdvance && cur.remind) blocks.push(<div key="r" className="block navy"><h3>Reminders</h3><p>{cur.remind}</p></div>);
      const agendaText = cur.assign.length ? cur.assign.join("; ") : cur.homework || cur.remind;
      if (left <= setup.homeworkAt) blocks.push(<div key="h" className="block alert"><h3>Write in your agenda</h3><p>{agendaText}</p></div>);
      else if (phase !== "open" && cur.assign.length && !assignOnLeft) blocks.push(<div key="a" className="block sun"><h3>Assign</h3>{list(cur.assign)}</div>);
      // "Before you head out" belongs to the end of the day, and the end of the
      // day is the dismissal time — not simply the last class on the board,
      // which is what used to put the benediction up before lunch.
      if (lunchSoon) blocks.push(<div key="l" className="block sun"><h3>Before lunch</h3><p>{LUNCH_GRACE}</p></div>);
      side = blocks.length ? <div className="panel">{blocks}</div> : null;
    }

    const openingMain = (
      <div className={`main opening${mv && sources.poem ? "" : " solo"}`}>
        {mv ? (
          <div className="openpane">
            <h3>Memory verse — this week</h3>
            <p className="script-lg">{mv}</p>
          </div>
        ) : null}
        {sources.poem ? (
          <div className="openpane">
            <h3>{testToday ? "Poem of the week — verse test today" : "Poem of the week"}</h3>
            <p className="script-lg">{sources.poem}</p>
          </div>
        ) : null}
      </div>
    );

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
        {calendarBanner()}
        {birthdayBand(cur)}
        {openingScreen ? openingMain : (
          <div className={`main${side ? "" : " solo"}${picOn && !endOfDaySoon ? ` pic-${opts.pic}` : ""}${featureImage && !endOfDaySoon ? " pic-feature" : ""}`}>
            {picOn && !endOfDaySoon && opts.pic === "left" ? <>{side}{leftCol}</> : <>{leftCol}{side}</>}
          </div>
        )}
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
