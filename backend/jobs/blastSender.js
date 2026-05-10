// backend/jobs/blastSender.js
//
// Periodic worker that sends scheduled "blast" emails. Runs every 60s
// (started from index.js). Honors:
//   • per-campaign daily cap (default 50)
//   • global daily cap   (BLAST_GLOBAL_DAILY_CAP env, default 50)
//   • Resend hard cap    (BLAST_RESEND_CEILING env, default 90, leaving headroom on the 100/day free tier)
//   • only sends inside the campaign's send window (default Tue/Wed/Thu 7:30–8:30 ET)

import BlastCampaign  from "../models/BlastCampaign.js";
import BlastRecipient from "../models/BlastRecipient.js";
import BlastContact   from "../models/BlastContact.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

/* ──────────────────────────────────────────────────────────────────────
 * Time-zone helpers (no extra dependencies)
 * ────────────────────────────────────────────────────────────────────── */

/** Returns { year, month (1-12), day, hour, minute, weekday (0=Sun..6=Sat) }
 *  for a given Date `d` in the named time zone. */
export function tzParts(d, timeZone = "America/Toronto") {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
  });
  const obj = {};
  for (const p of fmt.formatToParts(d)) obj[p.type] = p.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year:    parseInt(obj.year, 10),
    month:   parseInt(obj.month, 10),
    day:     parseInt(obj.day, 10),
    hour:    parseInt(obj.hour, 10) % 24,
    minute:  parseInt(obj.minute, 10),
    second:  parseInt(obj.second, 10),
    weekday: weekdayMap[obj.weekday] ?? 0,
  };
}

/** Construct a UTC Date that, when viewed in `timeZone`, reads as the given
 *  wall-clock (year, month=1..12, day, hour=0..23, minute). */
export function tzWallClockToUtc(year, month, day, hour, minute, timeZone = "America/Toronto") {
  // First-pass guess: assume UTC ≈ wall-clock + 5h (EST).
  let utc = Date.UTC(year, month - 1, day, hour + 5, minute);
  for (let i = 0; i < 3; i++) {
    const seen = tzParts(new Date(utc), timeZone);
    const drift =
      (hour - seen.hour) * 60 + (minute - seen.minute) +
      // also align day-of-month in case our guess crossed midnight
      ((day - seen.day) * 24 * 60);
    if (drift === 0) break;
    utc += drift * 60_000;
  }
  return new Date(utc);
}

/** Returns true if `d` falls inside the campaign's send window (in TZ). */
function inSendWindow(d, c) {
  const p = tzParts(d, c.timezone);
  // Seasonal gate first — Field Day campaigns set enabledMonths: [4,5,6] to
  // ensure they never send outside spring even if the campaign overruns.
  if (Array.isArray(c.enabledMonths) && c.enabledMonths.length && !c.enabledMonths.includes(p.month)) {
    return false;
  }
  if (!c.sendDays.includes(p.weekday)) return false;
  const startMin = c.sendStartHour * 60 + c.sendStartMinute;
  const endMin   = c.sendEndHour   * 60 + c.sendEndMinute;
  const nowMin   = p.hour * 60 + p.minute;
  return nowMin >= startMin && nowMin <= endMin;
}

/** Returns yyyy-mm-dd in the given TZ — used for "sends today" counters. */
function tzDateKey(d, timeZone) {
  const p = tzParts(d, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/* ──────────────────────────────────────────────────────────────────────
 * Slot scheduler — called when a campaign is created
 *
 * Returns an array of `count` UTC Date objects, evenly spaced inside the
 * configured send window, across the next eligible Tue/Wed/Thu mornings.
 * ────────────────────────────────────────────────────────────────────── */
export function scheduleSlots({
  count, dailyCap, sendDays, startHour, startMinute, endHour, endMinute,
  timezone, startInDays = 0,
}) {
  const slots = [];
  const now = new Date();
  // Walk forward day-by-day in TZ wall-clock terms
  const startParts = tzParts(now, timezone);
  // Move to startInDays from "today" in the target TZ
  const baseY = startParts.year, baseM = startParts.month, baseD = startParts.day + startInDays;
  let dayCursor = 0;
  while (slots.length < count && dayCursor < 365) {
    // Synthesize the wall-clock date for "base + dayCursor"
    const candidate = new Date(Date.UTC(baseY, baseM - 1, baseD + dayCursor, 12, 0, 0));
    const p = tzParts(candidate, timezone);
    if (sendDays.includes(p.weekday)) {
      const winStart = startHour * 60 + startMinute;
      const winEnd   = endHour   * 60 + endMinute;
      const winMins  = Math.max(1, winEnd - winStart);
      const slotsToday = Math.min(dailyCap, count - slots.length);
      // Even spacing across the window. With slotsToday=50 and a 60-min window:
      //   step = 60 / 50 = 1.2 minutes/slot.
      // Each recipient gets a slot offset from winStart by step * i.
      for (let i = 0; i < slotsToday; i++) {
        const offsetMin = Math.floor((i + 0.5) * (winMins / slotsToday));
        const totalMin = winStart + offsetMin;
        const hh = Math.floor(totalMin / 60);
        const mm = totalMin % 60;
        const slot = tzWallClockToUtc(p.year, p.month, p.day, hh, mm, timezone);
        // Skip slots already in the past (e.g. when starting today after the window)
        if (slot.getTime() < now.getTime()) continue;
        slots.push(slot);
      }
    }
    dayCursor++;
  }
  return slots;
}

/* ──────────────────────────────────────────────────────────────────────
 * Variable substitution
 *
 * Supported variables:
 *   {{firstName}} {{lastName}} {{school}} {{board}} {{role}} {{level}}
 *   {{salutation}}            — auto "Hi {firstName}," / "Hello,"
 *   {{role_pitch}}            — role+product specific paragraph
 *   {{christian_perspective}} — only filled when isChristian=true AND
 *                               product is curriculate|pulse (blank for fieldday
 *                               and for non-Christian recipients)
 * ────────────────────────────────────────────────────────────────────── */

const VAR_PATTERN = /\{\{\s*(firstName|lastName|school|board|role|level|salutation|role_pitch|christian_perspective|credential_intro)\s*\}\}/g;

// Role bucketing — normalize whatever the CSV row says into one of four buckets
function bucketRole(role = "") {
  const r = String(role).toLowerCase();
  if (r.includes("athletic") || r.includes("phys ed") || r.includes("p.e.") || r.includes("athletics")) return "ad";
  if (r.includes("vice") || r.startsWith("vp")) return "vp";
  if (r.includes("principal")) return "principal";
  return "default";
}

const ROLE_PITCH = {
  curriculate: {
    principal: `<p>For principals I talk to, this is mostly a <strong>teacher-retention</strong> story — staff tell me it gives them back their evenings. It especially shines on <strong>review days, independent-work periods, and substitute-teacher days</strong> — dramatically reducing prep time on the days when coverage is hardest. Students in Grades 5–9 stay engaged in ways a worksheet doesn't quite manage.</p>`,
    vp:        `<p>For VPs the easiest wins are workflow — Curriculate handles station rotation and student management during a lesson so teachers can actually circulate and coach. Implementation is about <strong>10 minutes per teacher</strong> in my experience.</p>`,
    ad:        `<p>If your program runs eligibility check-ins, post-game reflections, or weekly accountability work, Curriculate's station templates turn that into a 5-minute classroom routine instead of paperwork.</p>`,
    default:   `<p>The teachers in our pilots are using it for review-day stations, end-of-unit consolidation, and substitute-day plans that don't fall apart.</p>`,
  },
  pulse: {
    principal: `<p>For principals, the question I always hear is <em>"will my staff actually adopt this?"</em> — so Curriculate Practice is structured to keep the <strong>teacher as final reviewer</strong>. It drafts feedback in seconds; you finalize in another few. Several teachers in our pilot tell me it's the reason they're still in the classroom.</p>`,
    vp:        `<p>The VP-facing win is parent-facing reports — students can no longer hide a missing or weak assignment because parents see a per-question breakdown automatically. Support conversations become much more evidence-based when everyone's looking at the same data.</p>`,
    ad:        `<p>For ADs running eligibility checks: Practice can grade weekly progress checks in under a minute per student, which means you can do eligibility cuts the day before a meet instead of three days before.</p>`,
    default:   `<p>It works for handwritten essays, math, video performances, audio (speeches, music, drama), and batch PDFs — whatever you're already collecting from kids.</p>`,
  },
  fieldday: {
    principal: `<p>For principals, this is the "how do we run field day without it being chaos" story — one PE lead, a handful of event leaders, real-time scoring on phones, no spreadsheets at midnight.</p>`,
    vp:        `<p>VP-facing: this removes the day-of triage. Heat sheets, scoring, ribbon printing all live in the app — your PE lead doesn't need to chase clipboards across a soccer field.</p>`,
    ad:        `<p>For athletics directors: hundredth-second timing, multi-runner stopwatch, automatic records & PBs with horn fanfare on the leader's phone. Built specifically for <strong>school field days</strong> — not a coaching app I bent into shape.</p>`,
    default:   `<p>Houses, divisions, heats, relays, Excel roster import, 1″×1″ Avery ribbon labels — all the field-day specifics, none of the clipboards.</p>`,
  },
};

// Sender credential — the very first sentence after "Hey! It's Richard.".
// Christian-school recipients get the Papua New Guinea + leadership-roles
// framing (resonates with OACS / mission-school audiences); everyone else
// gets the broader "25+ years in education, teaching and leadership" line.
const CREDENTIAL_INTRO = {
  default: {
    en: `After <strong>more than 25 years in education across Ontario and international schools</strong> — including teaching and school leadership roles — I went back into the classroom.`,
    fr: `Après <strong>plus de 25 ans en éducation en Ontario et dans des écoles internationales</strong> — y compris en enseignement et en direction scolaire — je suis retourné en classe.`,
  },
  christian: {
    en: `After <strong>more than 25 years in education across Ontario and Papua New Guinea</strong>, including school leadership roles, I went back into the classroom.`,
    fr: `Après <strong>plus de 25 ans en éducation en Ontario et en Papouasie-Nouvelle-Guinée</strong>, y compris en direction scolaire, je suis retourné en classe.`,
  },
};

// Christian-school perspective overlay — only for Curriculate + Pulse
const CHRISTIAN_PERSPECTIVE = {
  curriculate: {
    en: `<div style="border-left:3px solid #2563eb;padding:10px 14px;background:#f8fafc;margin:14px 0;font-size:14px;">
            <strong>For Christian schools:</strong> Curriculate has a built-in option to thread your school's Christian worldview through every activity — virtue-based feedback voices, scripture-aligned discussion prompts, and reflection stations that build moral reasoning alongside content learning. Several OACS pilot schools are using this to align Curriculate with their faith-integration plan.
          </div>`,
    fr: `<div style="border-left:3px solid #2563eb;padding:10px 14px;background:#f8fafc;margin:14px 0;font-size:14px;">
            <strong>Pour les écoles chrétiennes :</strong> Curriculate offre une option intégrée pour intégrer votre vision chrétienne dans chaque activité — voix de rétroaction basées sur les vertus, prompts de discussion alignés sur les Écritures, et stations de réflexion qui construisent le raisonnement moral en parallèle de l'apprentissage.
          </div>`,
  },
  pulse: {
    en: `<div style="border-left:3px solid #2563eb;padding:10px 14px;background:#f8fafc;margin:14px 0;font-size:14px;">
            <strong>For Christian schools:</strong> Curriculate Practice includes faith-integrated feedback voices — encouragement grounded in virtues like perseverance, charity, and humility — that meet Ontario curriculum expectations while reinforcing your school's Christian worldview. Pilot schools in OACS are shaping this with us.
          </div>`,
    fr: `<div style="border-left:3px solid #2563eb;padding:10px 14px;background:#f8fafc;margin:14px 0;font-size:14px;">
            <strong>Pour les écoles chrétiennes :</strong> Curriculate Practice propose des voix de rétroaction intégrant la foi — encouragement enraciné dans les vertus de persévérance, de charité et d'humilité — tout en respectant les attentes du curriculum.
          </div>`,
  },
  fieldday: { en: "", fr: "" }, // not applicable
};

export function renderTemplate(html, vars, opts = {}) {
  const { product = "curriculate", isChristian = false, language = "en" } = opts;
  const roleBucket = bucketRole(vars.role);
  const rolePitch = (ROLE_PITCH[product] && ROLE_PITCH[product][roleBucket]) || ROLE_PITCH[product]?.default || "";
  const christian = isChristian
    ? (CHRISTIAN_PERSPECTIVE[product]?.[language] || "")
    : "";
  const credIntro = (isChristian
    ? (CREDENTIAL_INTRO.christian[language] || CREDENTIAL_INTRO.christian.en)
    : (CREDENTIAL_INTRO.default[language]   || CREDENTIAL_INTRO.default.en));

  return String(html || "").replace(VAR_PATTERN, (_m, key) => {
    const v = vars[key];
    if (key === "salutation") return v || (vars.firstName ? `Hi ${vars.firstName},` : "Hello,");
    if (key === "role_pitch") return rolePitch;
    if (key === "christian_perspective") return christian;
    if (key === "credential_intro") return credIntro;
    return v == null ? "" : String(v);
  });
}

export function detectLanguageForBoard(board) {
  const b = String(board || "").toLowerCase();
  if (b === "viamonde" || b === "monavenir") return "fr";
  return "en";
}

/* ──────────────────────────────────────────────────────────────────────
 * Default templates (per product × language)
 * Users can overwrite these on the campaign-create form.
 * ────────────────────────────────────────────────────────────────────── */

// Plain, low-branding email shell. Per anti-spam recommendations: no giant
// header bar, no big images, no excessive logos. Looks like a real email
// from a real person, not a marketing template.
function wrap(bodyHtml) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:18px;color:#1e293b;font-size:15px;line-height:1.6;">
  ${bodyHtml}
  <p style="margin:24px 0 6px;color:#475569;font-size:14px;line-height:1.5;">
    Richard Sommer<br/>
    Classroom teacher · Curriculate (Ontario)<br/>
    <a href="https://www.curriculate.net" style="color:#2563eb;text-decoration:none;">curriculate.net</a>
  </p>
  <p style="margin:18px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
    If this isn't relevant to your school, please feel free to ignore — I won't follow up further.
    Prefer not to hear from me again? Just reply with "no thanks" and I'll remove you.
    &nbsp;·&nbsp; <a href="https://www.curriculate.net/unsubscribe?email={{email}}" style="color:#94a3b8;">Unsubscribe</a>
  </p>
</div>`;
}

// Shared mini-block: the parent testimonial (anonymized) + the "graded N papers" stat.
// Used by both Curriculate and Pulse templates.
const PROOF_BLOCK_EN = `
  <p style="margin:18px 0 6px;font-size:14px;color:#475569;">Last week an Ontario parent wrote in after seeing her daughter's first report:</p>
  <blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155;font-style:italic;font-size:14px;">
    "I really appreciate the idea of uploading test papers — it's very helpful to clearly see where she needs improvement. This visibility will definitely help us support her better at home."
  </blockquote>
  <p style="margin:0 0 14px;font-size:14px;color:#475569;">Happy to share a sample graded paper or a 60-second video on request.</p>
`;
const PROOF_BLOCK_FR = `
  <p style="margin:18px 0 6px;font-size:14px;color:#475569;">La semaine dernière, un parent ontarien m'a écrit après avoir vu le premier rapport de sa fille :</p>
  <blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155;font-style:italic;font-size:14px;">
    « J'apprécie vraiment l'idée de téléverser les copies — il est très utile de voir clairement où elle a besoin de s'améliorer. Cette visibilité nous aidera à mieux la soutenir à la maison. »
  </blockquote>
  <p style="margin:0 0 14px;font-size:14px;color:#475569;">Je peux vous envoyer un exemple de copie corrigée ou une vidéo de 60 secondes sur demande.</p>
`;

// Templates are written in the voice of Richard, an Ontario junior-high
// classroom teacher. Per the strategy notes:
//   • personal opening ("Hey! It's Richard!")
//   • pilot/R&D framing, not "finished commercial product"
//   • parent testimonial + concrete stat as proof
//   • role-specific paragraph injected via {{role_pitch}}
//   • Christian-perspective paragraph injected for Christian schools via {{christian_perspective}}
//   • real signature + gentle opt-out built into wrap()
//   • no "revolutionary"/"disrupting"/"LIMITED TIME"/hype
const DEFAULT_TEMPLATES = {
  curriculate: {
    en: {
      subject: "What I wished I'd had as both a teacher and a school leader",
      body: wrap(`
        <p>Hey! It's Richard. I just ran <strong>Curriculate</strong> scavenger-hunt activities (think station-based learning) with my own Ontario junior-high classes and wanted to share it with one or two principals I respect in the area.</p>
        <p>Quick context: {{credential_intro}} <em>Curriculate is what I wished I'd had — both as a school leader and now as a teacher.</em> It's in an active pilot phase: we're inviting a small number of schools to use it free of charge during R&D in exchange for thoughtful feedback from teachers and students.</p>
        <p>In practice, teachers type a lesson topic, Curriculate generates a station-based activity in about 30 seconds, students rotate through it on phones or Chromebooks, and the teacher gets a live view of participation, progress, and misconceptions.</p>
        <p style="margin:14px 0;padding:10px 14px;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:14px;">
          Concrete example: last month my Grade 7 students worked through a <em>War of 1812</em> station activity — teams rotating through QR-directed historical challenges while I monitored progress live from my laptop. By the end of the period every student had hit every station. That doesn't happen with a worksheet.
        </p>
        <p>And at the end of every activity, the teacher receives a detailed per-student report and grade — ready to drop into the gradebook. I've personally used Curriculate on more than 1,500 student submissions this year.</p>
        {{role_pitch}}
        {{christian_perspective}}
        <p style="margin:14px 0 0;font-size:14px;color:#475569;">You can explore a live demo and sample student work at <a href="https://www.curriculate.net" style="color:#2563eb;">curriculate.net</a>. If it seems like a fit for your staff, teachers can begin trying it free immediately during this R&D phase.</p>
      `),
    },
    fr: {
      subject: "Ce que j'aurais voulu avoir — comme enseignant et comme directeur",
      body: wrap(`
        <p>Bonjour ! Je m'appelle Richard. Je viens d'utiliser <strong>Curriculate</strong> avec mes propres élèves du premier cycle du secondaire en Ontario et je voulais en parler à quelques directions que j'estime.</p>
        <p>Contexte rapide : {{credential_intro}} <em>Curriculate est l'outil que j'aurais voulu avoir — comme directeur, et maintenant comme enseignant.</em> Nous sommes en phase pilote : nous invitons un petit nombre d'écoles à l'utiliser gratuitement durant cette phase de R&D, en échange de commentaires réfléchis.</p>
        <p>En pratique, l'enseignant tape un sujet, Curriculate génère une activité par stations en environ 30 secondes, les élèves circulent sur téléphones ou Chromebooks, et l'enseignant obtient une vue en direct de la participation, des progrès et des conceptions erronées.</p>
        <p style="margin:14px 0;padding:10px 14px;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:14px;">
          Exemple concret : le mois dernier, mes élèves de 7<sup>e</sup> année ont fait une activité par stations sur la <em>Guerre de 1812</em> — des équipes circulaient entre des défis historiques accessibles par codes QR pendant que je suivais leurs progrès depuis mon ordinateur. À la fin de la période, chaque élève avait visité chaque station.
        </p>
        <p>Et à la fin de chaque activité, l'enseignant reçoit automatiquement un rapport détaillé avec une note par élève — prêt à être intégré au carnet de notes. J'ai personnellement utilisé Curriculate avec plus de 1 500 travaux d'élèves cette année.</p>
        {{role_pitch}}
        {{christian_perspective}}
        <p style="margin:14px 0 0;font-size:14px;color:#475569;">Vous pouvez explorer une démonstration et des exemples sur <a href="https://www.curriculate.net" style="color:#2563eb;">curriculate.net</a>. Si cela vous semble pertinent pour votre équipe, vos enseignants peuvent commencer à l'essayer gratuitement dès maintenant durant cette phase de R&D.</p>
      `),
    },
  },
  pulse: {
    en: {
      subject: "A grading tool designed to give teachers their evenings back",
      body: wrap(`
        <p>Hey! It's Richard. I just tried <strong>Curriculate Practice</strong> on my own students' work this week and wanted to write to one or two thoughtful schools about it.</p>
        <p>Quick context: {{credential_intro}} I've now personally graded over 1,500 student papers with Curriculate Practice — <em>it's what I wished I'd had both as a school leader watching teacher workload, and now as a teacher facing that same workload myself.</em></p>
        <p style="margin:14px 0;padding:10px 14px;background:#eef2ff;border-left:3px solid #818cf8;border-radius:4px;color:#3730a3;font-size:13.5px;">
          <strong>Pilot Program:</strong> active R&D phase — inviting a small number of schools to use Practice free of charge in exchange for thoughtful feedback from teachers, students, and parents.
        </p>
        <p>How it works: snap a photo (or upload a PDF, video, or audio file) of student work and you get rubric-aligned feedback plus a score in about ten seconds. The teacher stays the final reviewer — Practice drafts, you finalize.</p>
        {{role_pitch}}
        {{christian_perspective}}
        ${PROOF_BLOCK_EN}
        <p style="margin:14px 0 0;font-size:14px;color:#475569;">You can explore a live demo and sample student reports at <a href="https://www.curriculate.net/pulse" style="color:#2563eb;">curriculate.net/pulse</a>. If it seems like a fit, please feel free to encourage your teachers to pilot it free during this R&D phase — or just reply if you'd rather see a sample graded paper first.</p>
      `),
    },
    fr: {
      subject: "Un outil de correction conçu pour rendre leurs soirées aux enseignants",
      body: wrap(`
        <p>Bonjour ! Je m'appelle Richard. Je viens d'essayer <strong>Curriculate Practice</strong> sur les travaux de mes propres élèves et je tenais à écrire à quelques écoles que j'estime.</p>
        <p>Contexte rapide : {{credential_intro}} J'ai personnellement corrigé plus de 1 500 travaux d'élèves avec Curriculate Practice — <em>c'est l'outil que j'aurais voulu avoir comme directeur en observant la charge de mes enseignants, et maintenant comme enseignant moi-même.</em></p>
        <p style="margin:14px 0;padding:10px 14px;background:#eef2ff;border-left:3px solid #818cf8;border-radius:4px;color:#3730a3;font-size:13.5px;">
          <strong>Programme pilote :</strong> phase de R&D active — nous invitons un petit nombre d'écoles à utiliser Practice gratuitement en échange de commentaires réfléchis d'enseignants, d'élèves et de parents.
        </p>
        <p>Comment ça marche : on prend une photo (ou téléverse un PDF, une vidéo ou un audio) du travail d'un élève, et on obtient une rétroaction alignée à la grille d'évaluation plus une note en environ dix secondes. L'enseignant reste responsable de la décision finale — Practice propose, vous validez.</p>
        {{role_pitch}}
        {{christian_perspective}}
        ${PROOF_BLOCK_FR}
        <p style="margin:14px 0 0;font-size:14px;color:#475569;">Vous pouvez explorer une démonstration et des exemples de rapports sur <a href="https://www.curriculate.net/pulse" style="color:#2563eb;">curriculate.net/pulse</a>. Si cela vous semble pertinent, n'hésitez pas à encourager vos enseignants à l'essayer gratuitement durant cette phase de R&D — ou répondez simplement à cet e-mail si vous préférez d'abord voir un exemple de copie corrigée.</p>
      `),
    },
  },
  fieldday: {
    en: {
      subject: "Free field-day app — built after too many field days run on spreadsheets",
      body: wrap(`
        <p>Hey! It's Richard. {{credential_intro}} I built <strong>Curriculate Field Day</strong> after running too many of my own schools' field days on spreadsheets — <em>it's what I wished I'd had every June.</em></p>
        <p>It's in active pilot phase. We're inviting a small number of schools to use it free during R&D in exchange for thoughtful feedback after their field day.</p>
        <p>What it actually does (the stuff that matters on field-day morning):</p>
        <ul style="padding-left:20px;margin:6px 0 14px;">
          <li>Multi-runner stopwatch, hundredth-second precision, taps to start/stop heats</li>
          <li>Placement scoring and standards-based scoring side-by-side</li>
          <li>New records & PBs trigger an air-horn on the leader's phone — kids love it</li>
          <li>Houses, divisions, heats, relays — out of the box</li>
          <li>Import your Excel roster, print 1″×1″ Avery ribbon labels</li>
        </ul>
        <p style="margin:6px 0 14px;font-size:14px;color:#475569;">Most schools can be fully set up in under 20 minutes from an Excel roster.</p>
        {{role_pitch}}
        <p style="margin:14px 0 0;font-size:14px;color:#475569;">There's a short demo and free pilot access at <a href="https://www.curriculate.net/meet-fieldday" style="color:#2563eb;">curriculate.net/meet-fieldday</a>. If it looks useful, please feel free to encourage your athletics team or PE department to pilot it free before this year's field day.</p>
      `),
    },
    fr: {
      subject: "Application gratuite pour journée des jeux — bâtie après trop de journées sur feuilles de calcul",
      body: wrap(`
        <p>Bonjour ! Je m'appelle Richard. {{credential_intro}} J'ai bâti <strong>Curriculate Field Day</strong> après avoir organisé trop de journées des jeux à l'aide de feuilles de calcul — <em>c'est l'outil que j'aurais voulu avoir chaque mois de juin.</em></p>
        <p>L'application est en phase pilote. Nous invitons un petit nombre d'écoles à l'utiliser gratuitement en échange de commentaires réfléchis après leur journée des jeux.</p>
        <p>Ce que ça fait (l'essentiel pour la matinée) :</p>
        <ul style="padding-left:20px;margin:6px 0 14px;">
          <li>Chronomètre multi-coureurs au centième de seconde</li>
          <li>Pointage par classement et selon des barèmes, côte à côte</li>
          <li>Nouveaux records et meilleurs résultats déclenchent une fanfare</li>
          <li>Maisons, divisions, vagues, relais — prêts à l'emploi</li>
          <li>Importation Excel et étiquettes Avery 1″×1″ pour les rubans</li>
        </ul>
        <p style="margin:6px 0 14px;font-size:14px;color:#475569;">La plupart des écoles peuvent être entièrement configurées en moins de 20 minutes à partir d'une liste Excel.</p>
        {{role_pitch}}
        <p style="margin:14px 0 0;font-size:14px;color:#475569;">Une démonstration et un accès pilote gratuit sont disponibles sur <a href="https://www.curriculate.net/meet-fieldday" style="color:#2563eb;">curriculate.net/meet-fieldday</a>. Si cela vous semble utile, n'hésitez pas à encourager votre équipe sportive ou votre département d'éducation physique à l'essayer gratuitement avant la journée des jeux.</p>
      `),
    },
  },
};

export function defaultTemplateForProduct(product) {
  const t = DEFAULT_TEMPLATES[product] || DEFAULT_TEMPLATES.curriculate;
  return {
    subjectEn: t.en.subject,
    bodyEn:    t.en.body,
    subjectFr: t.fr.subject,
    bodyFr:    t.fr.body,
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * The worker
 * ────────────────────────────────────────────────────────────────────── */

const GLOBAL_DAILY_CAP = parseInt(process.env.BLAST_GLOBAL_DAILY_CAP || "50", 10);
const RESEND_CEILING   = parseInt(process.env.BLAST_RESEND_CEILING   || "90", 10);

let running = false;

export async function blastWorkerTick() {
  if (running) return;        // never overlap
  running = true;
  try {
    const now = new Date();

    // 1. Find campaigns that are scheduled or running
    const camps = await BlastCampaign.find({
      status: { $in: ["scheduled", "running"] },
    }).lean();
    if (!camps.length) return;

    // 2. Global cap check — count all sends today across every campaign
    //    (in any active campaign's TZ; we use the first campaign's TZ for the global key
    //    since they're all expected to be Toronto)
    const tz = camps[0].timezone || "America/Toronto";
    const todayKey = tzDateKey(now, tz);

    // Count sends today (UTC start-of-day in tz)
    const startOfDayUtc = tzWallClockToUtc(
      tzParts(now, tz).year, tzParts(now, tz).month, tzParts(now, tz).day,
      0, 0, tz
    );
    const sentToday = await BlastRecipient.countDocuments({
      status: "sent",
      sentAt: { $gte: startOfDayUtc },
    });

    if (sentToday >= GLOBAL_DAILY_CAP || sentToday >= RESEND_CEILING) {
      // We're done sending blasts for today
      return;
    }

    let remainingGlobal = Math.min(GLOBAL_DAILY_CAP, RESEND_CEILING) - sentToday;

    // 3. For each campaign, if it's in its window, dispatch up to its
    //    remaining cap (and the global cap)
    for (const c of camps) {
      if (remainingGlobal <= 0) break;
      if (!inSendWindow(now, c)) continue;

      // How many has this campaign sent today?
      const campSentToday = await BlastRecipient.countDocuments({
        campaignId: c._id,
        status: "sent",
        sentAt: { $gte: startOfDayUtc },
      });
      let campRemaining = c.dailyCap - campSentToday;
      if (campRemaining <= 0) continue;

      // Pull due, queued recipients
      const limit = Math.min(campRemaining, remainingGlobal, 5); // never send more than 5/tick → keeps spacing visible
      const due = await BlastRecipient
        .find({ campaignId: c._id, status: "queued", scheduledFor: { $lte: now } })
        .sort({ scheduledFor: 1 })
        .limit(limit);

      if (!due.length) {
        // Mark running on first tick that fires for the campaign
        if (c.status === "scheduled") {
          await BlastCampaign.findByIdAndUpdate(c._id, { status: "running" });
        }
        continue;
      }

      // Hand-roll the campaign object for status updates
      if (c.status === "scheduled") {
        await BlastCampaign.findByIdAndUpdate(c._id, { status: "running" });
      }

      for (const r of due) {
        if (remainingGlobal <= 0 || campRemaining <= 0) break;

        // Atomic claim — guards against multiple workers (deployed instances)
        const claimed = await BlastRecipient.findOneAndUpdate(
          { _id: r._id, status: "queued" },
          { status: "sending", attempts: r.attempts + 1 },
          { new: true }
        );
        if (!claimed) continue;

        const subject = r.language === "fr" ? c.subjectFr : c.subjectEn;
        const body    = r.language === "fr" ? c.bodyFr    : c.bodyEn;
        const vars = {
          firstName: r.firstName,
          lastName:  r.lastName,
          school:    r.school,
          board:     r.board,
          role:      r.role,
          level:     r.level,
        };
        const opts = {
          product: c.product,
          isChristian: !!r.isChristian,
          language: r.language || "en",
        };
        const html = renderTemplate(body, vars, opts)
          .replace(/\{\{\s*email\s*\}\}/g, encodeURIComponent(r.email));
        const renderedSubject = renderTemplate(subject, vars, opts);

        try {
          const sendResult = await sendSystemEmail({
            to: r.email,
            subject: renderedSubject,
            html,
          });
          const sentAt = new Date();
          await BlastRecipient.findByIdAndUpdate(r._id, {
            status: "sent",
            sentAt,
            resendId: sendResult?.id || "",
            errorMessage: "",
          });
          await BlastCampaign.findByIdAndUpdate(c._id, { $inc: { sentCount: 1 } });

          // Update master contact list — stamp lastContactedAt + flip the
          // matching history entry from "queued" → "sent". The history entry
          // is the most-recent one for THIS campaign.
          await BlastContact.updateOne(
            { email: r.email },
            {
              $set: {
                lastContactedAt: sentAt,
                lastCampaignId: c._id,
                lastProduct: c.product,
                lastStatus: "sent",
              },
              $inc: { sentCount: 1 },
            }
          );
          await BlastContact.updateOne(
            { email: r.email, "history.campaignId": c._id },
            {
              $set: {
                "history.$[h].status": "sent",
                "history.$[h].sentAt": sentAt,
              },
            },
            { arrayFilters: [{ "h.campaignId": c._id, "h.status": "queued" }] }
          );

          campRemaining--;
          remainingGlobal--;
          console.log(`[blast] sent campaign=${c._id} to=${r.email}`);
        } catch (sendErr) {
          const errMsg = String(sendErr?.message || sendErr).slice(0, 500);
          await BlastRecipient.findByIdAndUpdate(r._id, {
            status: "failed",
            errorMessage: errMsg,
          });
          await BlastCampaign.findByIdAndUpdate(c._id, { $inc: { failedCount: 1 } });
          await BlastContact.updateOne(
            { email: r.email },
            {
              $set: { lastStatus: "failed" },
              $inc: { failedCount: 1 },
            }
          );
          await BlastContact.updateOne(
            { email: r.email, "history.campaignId": c._id },
            {
              $set: {
                "history.$[h].status": "failed",
                "history.$[h].errorMessage": errMsg,
              },
            },
            { arrayFilters: [{ "h.campaignId": c._id, "h.status": "queued" }] }
          );
          console.error(`[blast] FAIL campaign=${c._id} to=${r.email}: ${sendErr?.message}`);
        }
      }

      // If no queued recipients remain → mark complete
      const remainingQueued = await BlastRecipient.countDocuments({
        campaignId: c._id,
        status: "queued",
      });
      if (remainingQueued === 0) {
        await BlastCampaign.findByIdAndUpdate(c._id, { status: "completed" });
      }
    }
  } catch (e) {
    console.error("[blast] worker tick error:", e);
  } finally {
    running = false;
  }
}

/** If the process died after claiming a recipient ("sending") but before
 *  the send result was recorded, the row is stuck. On boot we reset any
 *  rows that have been "sending" for more than `staleMin` minutes back to
 *  "queued" so the next tick picks them up cleanly. */
export async function recoverStaleSends(staleMin = 10) {
  const cutoff = new Date(Date.now() - staleMin * 60_000);
  const r = await BlastRecipient.updateMany(
    { status: "sending", updatedAt: { $lt: cutoff } },
    { status: "queued" }
  );
  if (r.modifiedCount > 0) console.log(`[blast] recovered ${r.modifiedCount} stuck 'sending' rows → queued`);
  return r.modifiedCount;
}

let intervalHandle = null;
export function startBlastWorker(periodMs = 60_000) {
  if (intervalHandle) return;
  // Recover from interrupted runs before resuming.
  recoverStaleSends().catch(e => console.error("[blast] recovery failed:", e));
  // Fire one tick after 5s (DB connection settled).
  setTimeout(() => blastWorkerTick(), 5_000);
  intervalHandle = setInterval(() => blastWorkerTick(), periodMs);
  intervalHandle.unref?.();
  console.log(`[blast] worker started (period=${periodMs}ms, globalCap=${GLOBAL_DAILY_CAP}/day, ceiling=${RESEND_CEILING})`);
}

export function stopBlastWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
