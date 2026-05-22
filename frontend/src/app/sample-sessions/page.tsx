import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sample Sessions — what a Curriculate class actually looks like",
  description:
    "Five concrete classroom snapshots across grade bands and subjects — see exactly what students experience moment-by-moment in a Curriculate session.",
};

type Step = {
  time: string;
  title: string;
  body: string;
  tag?: string;
  highlight?: boolean;
};

type Session = {
  grade: string;
  subject: string;
  topic: string;
  duration: string;
  emoji: string;
  setup: string;
  modes: string[];
  steps: Step[];
  takeaway: string;
};

const SESSIONS: Session[] = [
  {
    grade: "Grade 4",
    subject: "Science",
    topic: "Photosynthesis",
    duration: "35 min",
    emoji: "🌱",
    setup:
      "Six teams of four scan the classroom's colored CurricQR stations to claim their starting spots. The taskset was generated this morning from a 3-sentence lesson description — including Quest Mode + Auto-Duels.",
    modes: ["Quest Mode", "What Am I?", "Auto-Duels"],
    steps: [
      {
        time: "0:00",
        title: "Mission briefing — Quest Mode",
        body: "Each team sees: 'Your classroom greenhouse is dying. To save the plants, your team must gather 3 supplies before the bell. You start with 0 coins.' The QuestHud lights up at the top of every student's device with a coin counter at 🪙 0.",
        tag: "Quest",
      },
      {
        time: "2:30",
        title: "Quick true/false set",
        body: "First task: 5 fast statements about plants. Each correct answer earns 4 coins. Team Green nails all 5 (🪙 0 → 🪙 20). Team Yellow gets 3 right (🪙 0 → 🪙 12).",
      },
      {
        time: "6:00",
        title: "What Am I? — Photosynthesis itself",
        body: '"I turn one form of energy into another." Team Green guesses right at clue 1 for 10 pts. Team Yellow taps "Reveal clue 2" → "I only happen where chlorophyll lives" → answers and gets 8 pts.',
        tag: "What Am I?",
      },
      {
        time: "9:00",
        title: "Resource shop opens",
        body: "Students tap the QuestHud to open the supply depot: 🪙 5 buys SUNLIGHT, 🪙 8 buys WATER, 🪙 10 buys CHLOROPHYLL. Team Green buys all three. Team Yellow has 🪙 6 — they need to earn more.",
        tag: "Quest",
      },
      {
        time: "13:00",
        title: "⚔️ AUTO-DUEL",
        body: 'Team Green has 32 pts, Team Yellow has 28 pts — gap of 4. The server fires a duel. Maya from Green vs Liam from Yellow. Both phones show a full-screen 3-2-1 countdown. Question: "True or False: Plants release oxygen as a byproduct of photosynthesis." Liam taps TRUE in 1.4s. Yellow wins +12 bonus, Green gets +2 consolation.',
        tag: "Duel",
        highlight: true,
      },
      {
        time: "16:00",
        title: "Body Break (built-in)",
        body: "Generator inserted a 60-second movement break. Whole class jumps, stretches, sits back down. Tasks resume.",
      },
      {
        time: "18:30",
        title: "Sort the inputs vs outputs (Sort task)",
        body: 'Drag-and-drop: sunlight, water, CO₂ → INPUTS · oxygen, sugar → OUTPUTS. Correct sorts award coins on top of points. Team Yellow finally hits 🪙 18 and buys CHLOROPHYLL.',
      },
      {
        time: "24:00",
        title: "Mission Launch (when all 3 supplies acquired)",
        body: "Team Green hits the LAUNCH MISSION button. Their HUD plays a celebration animation. Other teams race to gather their last supply.",
        tag: "Quest",
      },
      {
        time: "30:00",
        title: "Hidden task unlocks for fast finishers",
        body: 'Because Team Green completed the core mission with 5+ minutes left, a "Storm Before Harvest" hidden challenge appears: "Name TWO plants that survive in low-light conditions." Worth a Legendary Voyage badge.',
        tag: "Quest",
      },
      {
        time: "33:00",
        title: "Session ends → teacher's inbox",
        body: "Team scoreboard, Bloom's analysis (REMEMBER 30%, UNDERSTAND 40%, ANALYZE 30%), per-student feedback, Edsby-ready CSV, parent notes — all attached to one email. Maya's report shows: 'Strong cue-reading, fast at concept recall, contributed 4 of 7 quest decisions.'",
      },
    ],
    takeaway:
      "Quest Mode turned a 35-min photosynthesis lesson into a story. The duel kept Team Yellow in the game when they were falling behind. Every coin earned was an actual answered question — no busywork.",
  },
  {
    grade: "Grade 7",
    subject: "History",
    topic: "Canadian Confederation",
    duration: "55 min",
    emoji: "📜",
    setup:
      "An Escape Room taskset generated from the teacher's word list (Confederation, Loyalists, Responsible Government, War of 1812). Teams need to escape 'The Library' before the bell — but the door's password is locked behind curriculum understanding.",
    modes: ["Escape Room", "Whodunnit", "What Am I?"],
    steps: [
      {
        time: "0:00",
        title: "Whodunnit activates silently",
        body: 'One player (chosen randomly by the server) gets a private banner: "🤫 You\'re the SABOTEUR. Play it cool. Try to stay under the radar." No one else knows. The class starts a normal-looking taskset.',
        tag: "Whodunnit",
        highlight: true,
      },
      {
        time: "2:00",
        title: "Lock #1: The Library Door",
        body: 'Each team\'s screen shows: "A heavy oak door blocks your way. A keypad glows beside it." Hint: "Lord Durham\'s report was written in what year?" Teams need to earn the LIBRARY-CODE key. The key is granted by completing the next task correctly.',
        tag: "Escape Room",
      },
      {
        time: "4:00",
        title: "Short-answer: Confederation date",
        body: "Teams answer '1867'. The HUD adds 🗝 LIBRARY-CODE to their key chips. Lock #1 opens silently — narrative beat: 'You hear footsteps echoing far away…'",
      },
      {
        time: "9:00",
        title: "What Am I? — The Magna Carta",
        body: 'Inter-team mode. Server-locked ceiling drops together for all teams. "Without me, the idea that even kings answer to written law might never have taken hold." Team Red shouts the answer at clue 2 (8 pts).',
        tag: "What Am I?",
      },
      {
        time: "14:00",
        title: "📢 Whodunnit clue auto-released",
        body: 'Every team\'s clue board updates: "The suspect recently scanned at the Yellow station." This is TRUE — the saboteur (Marcus, in Team Blue) really did just scan there. So did 2 other students. Real deduction begins.',
        tag: "Whodunnit",
        highlight: true,
      },
      {
        time: "20:00",
        title: "Lock #2: requires 2 keys",
        body: 'Multi-path: teams need RESPONSIBLE-GOVT-KEY and 1812-WAR-KEY. They split: half the team works on a peer-editing task, half answers a Reading Comp passage.',
        tag: "Escape Room",
      },
      {
        time: "29:00",
        title: "Fragment earned: a code digit",
        body: 'Team Red hits 80% core progress. A bonus task unlocks: "Decode the Loyalist letter." Solving it grants a fragment — the 4th digit of the final code, revealed as 🟨 7.',
      },
      {
        time: "35:00",
        title: "Team Blue accuses Marcus",
        body: '🕵 Their HUD says "Make an accusation." Costs 50 pts. They pick Marcus. The server reveals: CORRECT. Suspect locked. +200 reward. The other teams see only "Team Blue made a correct accusation" — Marcus is never publicly named on the leaderboard.',
        tag: "Whodunnit",
        highlight: true,
      },
      {
        time: "42:00",
        title: "Final Lock: The Vault",
        body: 'Synthesis puzzle. Teams have collected 4 cipher-digits across the room (1, 8, 6, 7 — Confederation year). The final lock\'s display shows them 1 _ _ _ . They tap 1 → 8 → 6 → 7. The vault swings open.',
        tag: "Escape Room",
        highlight: true,
      },
      {
        time: "50:00",
        title: "Hidden challenge unlocks: 'The Storm Before Harbour'",
        body: 'Because Team Red completed with 5+ minutes remaining, an elite hidden challenge appears. 20 bonus points + the "Legendary Voyage" badge in their report.',
      },
      {
        time: "55:00",
        title: "Reports + reveal",
        body: "Teacher's inbox: per-team summary, who answered what, which curriculum terms each team showed mastery on. Marcus's report frames the saboteur reveal as a fun moment, not a stigma. Parent emails go out for Plus-tier accounts.",
      },
    ],
    takeaway:
      "Three overlays at once — students didn't notice the seams. Whodunnit added social deduction WITHOUT ever surfacing real bullying potential. Escape Room made every right answer matter physically (it opened a lock).",
  },
  {
    grade: "Grade 10",
    subject: "Math",
    topic: "Geometry — area, perimeter, angles",
    duration: "45 min",
    emoji: "📐",
    setup:
      "A 'Hole in One' physics-driven taskset paired with Careers discussion blocks. Generated from the spec 'Geometry review — visual, kinesthetic.' The teacher selects 'New mode: Hole in One.'",
    modes: ["Hole in One", "Careers (Pathway Builder)", "Brain Spark Notes"],
    steps: [
      {
        time: "0:00",
        title: "Brain Spark Notes intro",
        body: 'A short reading appears: "Geometry isn\'t just shapes — every bridge, every circuit board, every architectural plan rests on it. Today you\'ll feel that physically." Teams scan to acknowledge.',
      },
      {
        time: "3:00",
        title: "Hole in One — Earn phase",
        body: '15 quick geometry questions appear, one at a time. "What\'s the area of a 6×8 rectangle?" "If a triangle\'s angles are 50° and 70°, what\'s the third?" Correct answers award coins. Team Magenta nails 13 of 15 (🪙 65).',
        tag: "Hole in One",
      },
      {
        time: "12:00",
        title: "Hole in One — Build phase",
        body: 'Each team\'s device shows a board: ball in top-left, hole in bottom-right, two pre-placed walls. The team taps to drop straight rails (🪙 3), curved rails (🪙 5), bumpers (🪙 4) onto the grid. Team Magenta puts a "funnel" of rails around the hole. Team Olive builds an aggressive shortcut over a gap.',
        tag: "Hole in One",
        highlight: true,
      },
      {
        time: "20:00",
        title: "Hole in One — Tilter pick",
        body: '"Who\'s tilting this turn?" Server-suggested rotation: Devi hasn\'t tilted yet — pre-selected. Team confirms with a tap.',
      },
      {
        time: "22:00",
        title: "TILT! ⚽",
        body: "Phone tilts → ball rolls. Team Magenta's funnel works on the first try (+10). Team Olive's shortcut fails twice; they lose two balls and need to earn coins to buy more.",
      },
      {
        time: "28:00",
        title: "Auto-duel fires",
        body: "Team Magenta 73 pts, Team Olive 65 pts. Within the 10-pt threshold. ⚔️ Maya from Magenta vs Marcus from Olive. Question pulled from the taskset's MC bank: 'What's the sum of interior angles in a hexagon?' Marcus types 720 in 2.1s. Olive +15 bonus. Tide turns.",
        tag: "Duel",
        highlight: true,
      },
      {
        time: "34:00",
        title: "Switch to Careers — Pathway Builder",
        body: '"Careers in geometry-heavy fields" appears as a discussion task. Teams compare pathways for becoming an architect: 5-year program (~$80k), apprenticeship + cert (~$15k, 6 years), self-taught + portfolio (~$0, uncertain). Pick + justify. Team Olive picks apprenticeship and writes: "Maya\'s aunt did this and she designs houses now."',
        tag: "Careers",
      },
      {
        time: "41:00",
        title: "Hidden bonus: 'Master Tilter'",
        body: 'Because every team member tilted at least once this session, a class-wide bonus animates on every screen. +5 pts for each player who took a turn. The class cheers.',
      },
      {
        time: "44:00",
        title: "Reports go out",
        body: "Per-team report: who tilted, who placed which rails, who answered the geometry questions. Bloom's: APPLY 50%, ANALYZE 30%, EVALUATE 20% (the Careers justification scoring). Per-student improvement column for Plus tier.",
      },
    ],
    takeaway:
      "Geometry stopped being abstract — students literally USED area and angles to plan their courses. The pathway-builder discussion gave the lesson a future-tense ending: 'Why am I learning this?'",
  },
  {
    grade: "Grade 9",
    subject: "English Literature",
    topic: "Macbeth — Acts 1 & 2",
    duration: "50 min",
    emoji: "🎭",
    setup:
      "A discussion-heavy taskset combining Script Play (cold reads), What Am I?, and Current Events Connection (live-resolved). Generator was given 'Macbeth Acts 1-2 — ambition, prophecy, conscience' as the topic.",
    modes: ["Script Play", "What Am I?", "Current Events"],
    steps: [
      {
        time: "0:00",
        title: "Mood check-in",
        body: 'A soft opening task: "How are you feeling about Macbeth so far?" Five emoji buttons. The teacher dashboard shows the class mood — three students tap 😕 ("confused"). Teacher notes it.',
      },
      {
        time: "3:00",
        title: "Script Play — the witches' prophecy",
        body: 'Teams pass the device speaker-to-speaker. Each player reads one witch\'s line. "Fair is foul, and foul is fair." On-screen scene visualization shows who speaks next. Plays out for 4 minutes per team.',
      },
      {
        time: "12:00",
        title: "What Am I? — Lady Macbeth",
        body: '"I am the one who pushes when he hesitates." Team Plum guesses at clue 1 for 10 pts. Team Onyx waits for clue 2: "I sleepwalk later, washing imaginary blood from my hands" — answers and earns 8.',
        tag: "What Am I?",
      },
      {
        time: "18:00",
        title: "🌐 Current Events resolves LIVE",
        body: '📰 Loading state appears on every screen for 3 seconds. The server hits its web-search pipeline with topic "ambition, prophecy, conscience, Macbeth" and pulls THIS WEEK\'S story: a real news piece about a tech CEO\'s conscience-driven resignation. Lesson connection: "Ambition without conscience is the engine of Macbeth\'s tragedy."',
        tag: "Current Events",
        highlight: true,
      },
      {
        time: "22:00",
        title: "Discussion questions arrive",
        body: '"Is conscience a brake on ambition or fuel for it?" · "When in this week\'s story did the person look most like Macbeth — and what saved them from his fate?" · "Whose ambition counts as good? Whose as dangerous? Who decides?" Teams discuss in pairs.',
      },
      {
        time: "32:00",
        title: "Peer Editing — student-written paragraphs",
        body: 'Each student wrote a 3-sentence response to the Current Events questions. Now they swap and mark each other\'s with the peer-editing tool. The "x things to find" counter keeps it fair.',
      },
      {
        time: "40:00",
        title: "Auto-duel fires",
        body: "Top two teams (Plum 41, Onyx 39) — 2-pt gap. ⚔️ Quick literary head-to-head: 'What's the name of the play's main villain?' Both type 'macbeth' nearly simultaneously. Onyx beats Plum by 0.2s. +9 bonus.",
        tag: "Duel",
      },
      {
        time: "46:00",
        title: "Reports go out",
        body: "Bloom's analysis shows EVALUATE 35% — high because of the discussion + peer-editing weight. The student who tapped 😕 in the mood check got two affirming peer-edit comments — that's in the teacher's eyes-only summary.",
      },
    ],
    takeaway:
      "Current Events made a 400-year-old play feel current. The mood check-in flagged a student who'd been quiet — and the peer-edit caught them being praised by classmates. The teacher knew.",
  },
  {
    grade: "Grade 6",
    subject: "Bible Studies",
    topic: "David and Goliath — courage, fear, calling",
    duration: "40 min",
    emoji: "🪨",
    setup:
      "A Quest-Mode taskset themed around David's preparation for battle. Teacher's worldview profile is set to 'christian' — the AI weaves stewardship, courage, discernment, and humility through the lesson without forcing scripture into every prompt.",
    modes: ["Quest Mode", "What Am I?", "Current Events", "Auto-Duels"],
    steps: [
      {
        time: "0:00",
        title: "Mission briefing",
        body: '"Your team must prepare for a battle bigger than yourselves. You start with nothing but a sling. To win, you\'ll need: courage, wisdom, a clear voice, and trust." Quest HUD shows 🪙 0 with empty slots for each.',
        tag: "Quest",
      },
      {
        time: "3:00",
        title: "Reading Comp + Brain Spark Notes",
        body: "Short summary of 1 Samuel 17. Each correct answer awards coins. The COURAGE resource costs 🪙 8, WISDOM 🪙 10, VOICE 🪙 6, TRUST 🪙 12.",
      },
      {
        time: "10:00",
        title: "What Am I? — Goliath",
        body: '"I am the doubt that says \'you\'re too small for this.\' I have shown up in many forms across history." Team Bronze guesses at clue 2 ("I came from Gath") and earns 8 pts.',
        tag: "What Am I?",
      },
      {
        time: "15:00",
        title: "🌐 Current Events — Christian framing",
        body: 'Live web search pulls a story from this week — a teen who organized food drives at school despite being shy. Connection: "David wasn\'t the biggest. The story your faith tells is that being small isn\'t the disqualifier you think it is." Discussion questions weave in *discernment* (how do you know when to stand up?), *humility* (David refused Saul\'s armor — why?), and *stewardship* of voice (his shepherd skills mattered, even though they looked too small for the moment). Bible verses are NOT forced — the event itself is secular, the framing is faithful.',
        tag: "Current Events",
        highlight: true,
      },
      {
        time: "25:00",
        title: "Shop opens",
        body: 'Teams have 🪙 24-32 each. They tap to buy: COURAGE (8) + VOICE (6) leaves them short on WISDOM or TRUST. Team Cedar gets all four because they answered every Reading Comp question right.',
        tag: "Quest",
      },
      {
        time: "30:00",
        title: "Auto-duel",
        body: 'Cedar 38, Bronze 34. ⚔️ Quick: "Whose words gave David courage before he faced Goliath?" Two players race — Bronze types "God" in 0.9s. +12 bonus for Bronze, +2 consolation for Cedar.',
        tag: "Duel",
      },
      {
        time: "34:00",
        title: "Mission Launch",
        body: 'Team Cedar has all 4 supplies → they tap LAUNCH MISSION. Their HUD plays a celebration animation. The screen reads: "You enter the valley not because you are big, but because you came prepared."',
        tag: "Quest",
        highlight: true,
      },
      {
        time: "38:00",
        title: "Reports go out",
        body: 'Bloom\'s analysis (REMEMBER 30%, UNDERSTAND 30%, EVALUATE 25%, CREATE 15%) — high EVALUATE because of the moral discussion. Parent emails for the Plus-tier students include the Current Events discussion questions for dinner-table conversation.',
      },
    ],
    takeaway:
      "Christian framing without preachiness. The Current Events story was secular (a teen organizing food drives), but discussion questions invited faith reflection. Coins for COURAGE / WISDOM / VOICE / TRUST made an ancient story feel like a real preparation, not a sermon.",
  },
];

function Snapshot({ session, index }: { session: Session; index: number }) {
  return (
    <article
      id={`session-${index + 1}`}
      className="mt-12 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="bg-gradient-to-r from-violet-50 via-blue-50 to-indigo-50 px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="text-5xl leading-none">{session.emoji}</div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-700">
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5">{session.grade}</span>
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-blue-700">{session.subject}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">{session.duration}</span>
            </div>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{session.topic}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {session.modes.map((m) => (
                <span key={m} className="rounded-full border border-violet-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="px-6 py-6">
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          <strong className="text-slate-900">Setup: </strong>{session.setup}
        </p>

        <ol className="mt-6 space-y-3">
          {session.steps.map((s, i) => (
            <li
              key={i}
              className={[
                "flex gap-3 rounded-2xl border p-4 transition",
                s.highlight ? "border-violet-300 bg-violet-50/60" : "border-slate-200 bg-white",
              ].join(" ")}
            >
              <div className="flex-shrink-0">
                <div className="w-14 rounded-lg bg-slate-900 px-2 py-1 text-center text-xs font-bold text-white tabular-nums">
                  {s.time}
                </div>
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="font-bold text-slate-900">{s.title}</h3>
                  {s.tag ? (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                      {s.tag}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-2xl border-l-4 border-green-500 bg-green-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-green-700">Takeaway</div>
          <p className="mt-1 text-sm leading-relaxed text-green-900">{session.takeaway}</p>
        </div>
      </div>
    </article>
  );
}

export default function SampleSessionsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <section className="mx-auto max-w-4xl px-6 py-16">
        <div className="text-center">
          <div className="inline-flex items-center rounded-full bg-violet-100 px-3 py-1 text-sm font-bold text-violet-800">
            Sample Sessions
          </div>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
            What a Curriculate session actually looks like
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Five concrete classroom snapshots across grade bands and subjects.
            What students see on their screens. Which features fire when.
            Where the teacher's email lands at the end.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {SESSIONS.map((s, i) => (
              <Link
                key={i}
                href={`#session-${i + 1}`}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                {s.emoji} {s.grade} {s.subject}
              </Link>
            ))}
          </div>
        </div>

        {SESSIONS.map((s, i) => (
          <Snapshot key={i} session={s} index={i} />
        ))}

        <div className="mt-12 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-2xl font-extrabold text-slate-900">Ready to try it on your own lesson?</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-600">
            Generate a taskset for any subject, any grade, in under 30 seconds.
            No credit card. No app to install. The classroom you saw above is one prompt away.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/freetrial"
              className="rounded-full bg-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-violet-700"
            >
              Start a free trial
            </Link>
            <Link
              href="/features"
              className="rounded-full border border-slate-300 bg-white px-6 py-2.5 text-sm font-bold text-slate-900 shadow-sm hover:bg-slate-50"
            >
              See all features
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-slate-500">
          These narratives are composed from real Curriculate features. Specific clue text,
          coin amounts, and discussion questions reflect what the AI generators actually produce.
        </p>
      </section>
    </main>
  );
}
