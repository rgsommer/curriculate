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
// DAILY_ACCESS_KEY is set; ?pic=left|off moves or hides the lesson picture.

import { useEffect, useMemo, useRef, useState } from "react";

const CLASS_LABELS = ["7A", "7B", "7C", "8A", "8B", "8C"];
const FLAGS = ["FD", "B1", "B2"];
const POLL_MS = 10_000;
const FETCH_TIMEOUT_MS = 25_000;
const SCRUB_RESET_MS = 45_000;

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
function driveId(url) {
  const m = /drive\.google\.com\/file\/d\/([^/]+)/.exec(url || "");
  return m ? m[1] : null;
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

function Chips({ period, left, setup }) {
  if (!period) return null;
  const st = parseStatus(period.status);
  if (period.duty) return st && st.rec ? <div className="points"><span className="chip rec">REC</span></div> : null;
  const items = [];
  if (st) {
    items.push(<span key="l" className="lbl">Class {st.letter}{st.grace ? " –" : ""}</span>);
    FLAGS.forEach((name, i) => {
      const on = !!st.on[i];
      const cls = on ? "on" : st.grace && i === 2 ? "grace" : "off";
      items.push(<span key={name} className={`chip ${cls}`}>{name}</span>);
    });
  }
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
              <div className="bar"><i style={{ width: `${Math.min(100, (pct || 0) / 3)}%` }} /></div>
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
  const [opts, setOpts] = useState({ t: null, k: "", pic: "right" });
  const [scrub, setScrub] = useState(null);
  const scrubTouched = useRef(0);

  // URL options (client only)
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    setOpts({ t: parseHHMM(u.get("t")), k: u.get("k") || "", pic: u.get("pic") === "left" ? "left" : u.get("pic") === "off" ? "off" : "right" });
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
    const P = data.periods;
    const classes = P.filter((p) => !p.duty && !p.empty);
    let cur = null;
    for (const p of P) if (t >= p.start && t < p.end) { cur = p; break; }
    const nextClass = (after) => classes.find((c) => c.start >= after) || null;
    if (cur) cur = { ...cur, elapsed: t - cur.start, left: cur.end - t };
    return { P, classes, cur, nextClass };
  }, [data, t]);

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
  const verse = meta.verse.replace(/^.*?~/, "").trim() || meta.verse;
  const challenge = (meta.other.match(/Math Challenge Question[^:]*:\s*(.*)$/) || [, ""])[1];
  const lastClass = classes[classes.length - 1];
  const dayMin = P.length ? Math.max(0, P[0].start - 60) : 8 * 60;
  const dayMax = P.length ? Math.min(24 * 60 - 1, P[P.length - 1].end + 30) : 16 * 60;

  const header = ({ title, chips, when, leftHtml, pct, red, period }) => (
    <>
      <div className="top">
        <div>
          <div className="title"><span className="subj">{title}</span>{chips}</div>
          {period && <Chips period={period} left={period.left} setup={setup} />}
          <div className="when">{when}</div>
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
  const footer = (showPuzzle) => (
    <>
      <PointsStrip points={points} currentSec={cur && !cur.duty ? cur.sec : ""} />
      <div className="bottom">
        <span>{meta.line}{error ? <span className="stale"> · {error}</span> : null}</span>
        {showPuzzle && puzzleWord
          ? <span className="puzzle">Unscramble for a treat: <b>{puzzleWord}</b></span>
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
  const agenda = () => (
    <div className="agenda">
      {classes.map((p) => [<span key={`t${p.start}`} className="t">{fmt(p.start)}</span>, <span key={`s${p.start}`}>{p.subj} · {p.room}</span>])}
    </div>
  );
  const featureBlock = () => (meta.feature
    ? <div className="block feature quiet"><p>{meta.feature}</p></div>
    : meta.riddle ? <div className="block quiet"><h3>Riddle</h3><p>{meta.riddle.replace(/^Q:\s*/, "")}</p></div> : null);

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
  } else if (!cur && classes.length && t < classes[0].start) {
    body = (
      <>
        {header({ title: "Good morning", chips: null, when: meta.plans, leftHtml: <>First class at <b>{fmt(classes[0].start)}</b></>, pct: 0 })}
        <div className="main center">
          <div>
            <p className="script">{meta.greeting || "Good morning"}</p>
            <p className="question">{verse}</p>
            {agenda()}
            {featureBlock()}
          </div>
        </div>
        {footer(false)}
      </>
    );
  } else if (setup.dismissalAt != null && t >= setup.dismissalAt) {
    body = (
      <>
        {header({ title: "Dismissal", chips: null, when: `From ${fmt(setup.dismissalAt)}`, leftHtml: <b>{cur && !cur.duty ? `${cur.left} min left` : "Day complete"}</b>, pct: 100 })}
        <div className="main center">
          <div>
            <p className="script">Well done, {(meta.greeting.match(/,\s*(.*?)!?$/) || [, "everyone"])[1]}.</p>
            {meta.headout.length > 0 && (
              <div className="block alert" style={{ textAlign: "left", display: "inline-block" }}>
                <h3>Before you head out</h3>{list(meta.headout)}
              </div>
            )}
          </div>
        </div>
        {footer(true)}
      </>
    );
  } else if (!cur || cur.duty || cur.empty) {
    const nx = nextClass(cur ? cur.start : t);
    const mins = nx ? nx.start - t : 0;
    const title = cur && !cur.empty ? cur.subj : "Change of class";
    body = (
      <>
        {header({
          title, chips: null, when: cur ? `${fmt(cur.start)} to ${fmt(cur.end)}` : "",
          leftHtml: nx ? <><b>{nx.subj}</b> in {mins} min</> : <b>Day complete</b>,
          pct: cur ? ((t - cur.start) / (cur.end - cur.start)) * 100 : 0, period: cur,
        })}
        <div className="main center">
          {nx ? (
            <div>
              <p className="eyebrow">Up next</p>
              <p className="big">{nx.subj}</p>
              <p className="question">{nx.room} · starts at {fmt(nx.start)}</p>
              <p className="summary">{nx.today}</p>
            </div>
          ) : (
            <div><p className="script">{title}</p></div>
          )}
        </div>
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
    const picOn = opts.pic !== "off" && data.picture && elapsed * 60 < setup.picSeconds;

    const leftCol = (
      <div>
        <p className="eyebrow">Today</p>
        <p className="question">{cur.q || cur.subj}</p>
        <p className="summary">{cur.today}</p>
        {phase === "open" ? null : list(cur.plan, "plan")}
      </div>
    );

    let side;
    if (picOn) {
      const picLeft = Math.ceil((setup.picSeconds - elapsed * 60) / 60);
      side = (
        <div className="picture">
          <div className="frame"><img src={data.picture.url} alt="Lesson picture" /></div>
          <div className="capline"><span>Lesson picture · {cur.code}</span><span>{picLeft} min left on screen</span></div>
        </div>
      );
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
      if (left <= setup.remindersAdvance && cur.remind) blocks.push(<div key="r" className="block navy"><h3>Reminders</h3><p>{cur.remind}</p></div>);
      if (left <= setup.homeworkAt) blocks.push(<div key="h" className="block alert"><h3>Write in your agenda</h3><p>{cur.assign.length ? cur.assign.join("; ") : cur.remind}</p></div>);
      else if (phase !== "open" && cur.assign.length) blocks.push(<div key="a" className="block sun"><h3>Assign</h3>{list(cur.assign)}</div>);
      if (left <= setup.nextAdvance && nx) blocks.push(<div key="n" className="block quiet"><h3>After this</h3><p>{nx.subj} · {nx.room} · {fmt(nx.start)}</p></div>);
      if (isLast && left <= setup.nextAdvance && meta.headout.length) blocks.push(<div key="x" className="block alert"><h3>Before you head out</h3>{list(meta.headout)}</div>);
      side = <div className="panel">{blocks}</div>;
    }

    body = (
      <>
        {header({
          title: cur.subj,
          chips: <><span className="chip">{cur.room}</span><span className="chip">{cur.code}</span></>,
          when: `${fmt(cur.start)} to ${fmt(cur.end)} · ${cur.end - cur.start} min`,
          leftHtml: <><b>{left} min</b> left</>, pct, red: redState, period: cur,
        })}
        <div className={`main${picOn ? ` pic-${opts.pic}` : ""}`}>
          {picOn && opts.pic === "left" ? <>{side}{leftCol}</> : <>{leftCol}{side}</>}
        </div>
        {footer(left <= setup.nextAdvance)}
      </>
    );
  }

  return <div className={`board${redState ? " red" : ""}${scrub != null ? " previewing" : ""}`} data-tick={tick}>{body}</div>;
}
