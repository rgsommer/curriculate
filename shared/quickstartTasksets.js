// shared/quickstartTasksets.js
//
// One-click onboarding presets. Four hand-curated 8-task sets, one per
// grade band, each tied to a single high-recognition topic. Teachers
// pick from a small grid and launch instantly — no topic typing, no AI
// wait, no generation cost. Designed for new users who find the full
// "Generate a New Set" flow intimidating.
//
// Structure:
//   QUICKSTART_TASKSETS: { [key]: { key, title, subject, gradeBand,
//                                   gradeLevel, topic, summary,
//                                   estimatedMinutes, tasks: [...] } }
//
// Each `tasks` entry mirrors the demoTasks.js shape — same renderer
// contract, so all the audit work / content verification still applies.

export const QUICKSTART_TASKSETS = {
  // ────────────────────────────────────────────────────────────────────
  // K-2 — Science: Living vs Non-living
  // ────────────────────────────────────────────────────────────────────
  "k2-science-living-things": {
    key: "k2-science-living-things",
    title: "Living vs Non-living",
    subject: "Science",
    gradeBand: "K-2",
    gradeLevel: 2,
    topic: "What makes something alive",
    summary: "Identify living things, name their needs, and sort everyday objects into living and non-living. 8 short tasks for K-2 scientists.",
    estimatedMinutes: 18,
    tasks: [
      {
        taskType: "mood-checkin",
        title: "How are you feeling?",
        prompt: "Tap the face that shows how you feel today.",
      },
      {
        taskType: "multiple-choice",
        title: "Spot the Living Thing",
        prompt: "Pick the living thing in each question.",
        items: [
          { prompt: "Which one is alive?", choices: ["A rock", "A tree", "A pencil", "A backpack"], correctIndex: 1 },
          { prompt: "Which one grows?", choices: ["A car", "A puppy", "A spoon", "A balloon"], correctIndex: 1 },
          { prompt: "Which one needs water to live?", choices: ["A robot", "A flower", "A toy block", "A book"], correctIndex: 1 },
        ],
      },
      {
        taskType: "sort",
        title: "Sort: Living or Not?",
        prompt: "Drag each thing into the right group.",
        config: {
          buckets: ["Living", "Not Living"],
          items: [
            { text: "🌳 Tree", bucketIndex: 0 },
            { text: "🪨 Rock", bucketIndex: 1 },
            { text: "🐠 Fish", bucketIndex: 0 },
            { text: "🚗 Car", bucketIndex: 1 },
            { text: "🌼 Flower", bucketIndex: 0 },
            { text: "📚 Book", bucketIndex: 1 },
            { text: "🐝 Bee", bucketIndex: 0 },
            { text: "⚽ Ball", bucketIndex: 1 },
          ],
        },
      },
      {
        taskType: "true-false",
        title: "True or False?",
        prompt: "Tap TRUE if the sentence is right.",
        items: [
          { statement: "All living things need food and water.", correct: true },
          { statement: "Rocks can grow bigger over time by eating.", correct: false },
          { statement: "Plants are alive even though they don't move around.", correct: true },
          { statement: "A teddy bear is a living thing because it has eyes.", correct: false },
        ],
      },
      {
        taskType: "body-break",
        title: "Move Like an Animal!",
        prompt: "Stand up and act it out!",
        config: {
          steps: [
            { text: "Hop like a bunny 5 times", icon: "🐰" },
            { text: "Wiggle like a fish for 10 seconds", icon: "🐟" },
            { text: "Flap your arms like a bird", icon: "🐦" },
            { text: "Stretch tall like a sunflower growing", icon: "🌻" },
          ],
          totalSeconds: 60,
        },
      },
      {
        taskType: "riddle",
        title: "Riddle Me This",
        prompt: "Can you guess what it is?",
        config: {
          riddles: [
            { text: "I am green and I drink water through my roots. What am I?", answer: "A plant" },
            { text: "I have feathers, I lay eggs, and I sing in the morning. What am I?", answer: "A bird" },
            { text: "I'm furry, I purr, and I love to chase string. What am I?", answer: "A cat" },
          ],
          riddle: "I am green and I drink water through my roots. What am I?",
          answer: "A plant",
        },
      },
      {
        taskType: "short-answer",
        title: "What Do Living Things Need?",
        prompt: "Name one thing every living creature needs to stay alive.",
        items: [
          { prompt: "Name one thing all living things need.", answer: "Water", acceptableAnswers: ["water", "food", "air", "sunlight", "shelter"] },
          { prompt: "Name a place a fish lives.", answer: "Water", acceptableAnswers: ["water", "ocean", "lake", "river", "pond", "sea", "fish tank", "aquarium"] },
        ],
      },
      {
        taskType: "draw",
        title: "Draw Your Favourite Animal",
        prompt: "Draw an animal you like on your screen. Then show your team!",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // 3-5 — English: Similes & Metaphors
  // ────────────────────────────────────────────────────────────────────
  "g35-english-figurative-language": {
    key: "g35-english-figurative-language",
    title: "Similes & Metaphors",
    subject: "English",
    gradeBand: "3-5",
    gradeLevel: 4,
    topic: "Figurative language",
    summary: "Spot the comparison, write your own simile, and tell a metaphor from a literal sentence. 8 tasks for grade 3-5 wordsmiths.",
    estimatedMinutes: 20,
    tasks: [
      {
        taskType: "mood-checkin",
        title: "How are you feeling?",
        prompt: "Tap the face that shows how you feel today.",
      },
      {
        taskType: "brain-spark-notes",
        title: "Quick Notes: Similes vs Metaphors",
        prompt: "Read these notes — you'll use them in the next tasks.",
        notes: {
          heading: "Similes & Metaphors",
          keyTerms: [
            { term: "Simile", definition: "Comparison using \"like\" or \"as\".", points: ["Example: She runs like the wind.", "Example: As brave as a lion."] },
            { term: "Metaphor", definition: "Comparison that says one thing IS another.", points: ["Example: Time is a thief.", "Example: My brother is a wizard at chess."] },
            { term: "Figurative language", definition: "Language that means something different from a strict word-for-word reading.", points: ["Helps writers paint pictures with words.", "Similes and metaphors are two of the most common types."] },
          ],
          mainPoints: [
            { heading: "How to spot a simile", bullets: ["Look for the word \"like\" or \"as\".", "It compares TWO different things."] },
            { heading: "How to spot a metaphor", bullets: ["No \"like\" or \"as\".", "Says one thing IS another, even when it can't really BE that."] },
            { heading: "Why writers use them", bullets: ["They make writing more vivid and fun to read.", "They help readers picture what's happening."] },
          ],
          summary: ["A simile uses LIKE or AS.", "A metaphor says one thing IS another."],
        },
      },
      {
        taskType: "true-false",
        title: "Simile or Not?",
        prompt: "TRUE if it's a simile, FALSE if it's something else.",
        items: [
          { statement: "\"She sings like a bird.\" — this is a simile.", correct: true },
          { statement: "\"He is a couch potato.\" — this is a simile.", correct: false },
          { statement: "\"The classroom was as quiet as a library.\" — this is a simile.", correct: true },
          { statement: "\"Time is money.\" — this is a simile.", correct: false },
          { statement: "\"Her laugh was like music.\" — this is a simile.", correct: true },
        ],
      },
      {
        taskType: "multiple-choice",
        title: "Pick the Metaphor",
        prompt: "Which sentence is a metaphor?",
        items: [
          { prompt: "Which is a metaphor?", choices: ["She runs like a cheetah.", "The classroom is a zoo.", "His hands were as cold as ice.", "She smiles like the sun."], correctIndex: 1 },
          { prompt: "Which is a metaphor?", choices: ["He is as quick as lightning.", "Life is a journey.", "She fights like a tiger.", "It's raining like crazy."], correctIndex: 1 },
          { prompt: "Which is a metaphor?", choices: ["Time is a thief.", "Her cheeks were like roses.", "He worked like a horse.", "The wind howled like a wolf."], correctIndex: 0 },
        ],
      },
      {
        taskType: "body-break",
        title: "Act It Out",
        prompt: "Stand up and act out each comparison.",
        config: {
          steps: [
            { text: "Move LIKE the wind — sway side to side.", icon: "🌬️" },
            { text: "Stand AS TALL as a giraffe.", icon: "🦒" },
            { text: "BE a statue for 5 seconds.", icon: "🗿" },
            { text: "Pretend YOU ARE a busy bee buzzing around your desk.", icon: "🐝" },
          ],
          totalSeconds: 60,
        },
      },
      {
        taskType: "open-text",
        title: "Write Your Own Simile",
        prompt: "Write 2 similes about your school day. Each one must use the word \"like\" or \"as\". Example: \"My backpack felt as heavy as an elephant.\"",
        config: { gradeLevel: 4, difficulty: "EASY" },
      },
      {
        taskType: "matching",
        title: "Match the Comparison",
        prompt: "Match each metaphor with what it really means.",
        leftItems: [
          "The classroom was a zoo.",
          "Time is money.",
          "She is a night owl.",
          "His memory is a steel trap.",
          "He has a heart of gold.",
        ],
        rightItems: [
          "Loud and full of energy",
          "Time is valuable, don't waste it",
          "She stays up late",
          "He remembers everything",
          "He is very kind",
        ],
        correctMatches: { "L1": "R1", "L2": "R2", "L3": "R3", "L4": "R4", "L5": "R5" },
      },
      {
        taskType: "short-answer",
        title: "Finish the Simile",
        prompt: "Finish each one!",
        items: [
          { prompt: "Complete the simile: \"As busy as a … (what animal)?\"", answer: "bee", acceptableAnswers: ["bee", "beaver", "ant"] },
          { prompt: "Complete the simile: \"As cold as … (what)?\"", answer: "ice", acceptableAnswers: ["ice", "snow", "winter"] },
          { prompt: "Complete the simile: \"As quiet as a … (what animal)?\"", answer: "mouse", acceptableAnswers: ["mouse", "whisper"] },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // 6-8 — History: War of 1812
  // ────────────────────────────────────────────────────────────────────
  "g68-history-war-of-1812": {
    key: "g68-history-war-of-1812",
    title: "The War of 1812",
    subject: "History",
    gradeBand: "6-8",
    gradeLevel: 7,
    topic: "Causes, battles, and outcomes of the War of 1812",
    summary: "From impressment to Fort McHenry — 8 tasks covering the war's causes, key figures, major battles, and how it shaped North America.",
    estimatedMinutes: 25,
    tasks: [
      {
        taskType: "mood-checkin",
        title: "How are you feeling?",
        prompt: "Tap the face that shows how you feel today.",
      },
      {
        taskType: "brain-spark-notes",
        title: "Quick Background",
        prompt: "Read these notes before you start.",
        notes: {
          heading: "The War of 1812",
          keyTerms: [
            { term: "Impressment", definition: "British navy forcing American sailors to serve on British ships.", points: ["A major cause of the war.", "Roughly 6,000 American sailors were impressed before 1812."] },
            { term: "Treaty of Ghent", definition: "The 1814 treaty that officially ended the war.", points: ["Signed December 24, 1814.", "Restored the pre-war border between the U.S. and British North America."] },
            { term: "Sir Isaac Brock", definition: "British general killed at Queenston Heights, 1812.", points: ["Helped defend Upper Canada.", "Became a Canadian hero after his death."] },
          ],
          mainPoints: [
            { heading: "Why the war started", bullets: ["British impressment of American sailors", "British trade restrictions on the U.S.", "American interest in expansion into Canada and Indigenous lands"] },
            { heading: "Key battles to remember", bullets: ["Queenston Heights (1812) — Brock killed defending Canada", "Battle of Lake Erie (1813) — U.S. naval victory", "Fort McHenry (1814) — inspired the Star-Spangled Banner"] },
            { heading: "How it ended", bullets: ["Treaty of Ghent restored pre-war borders", "Battle of New Orleans (Jan 1815) was fought AFTER the treaty was signed", "Led to long-term peace between the U.S. and British North America"] },
          ],
          summary: ["Causes: impressment, trade restrictions, expansion", "Ended with the Treaty of Ghent in late 1814", "Reshaped Canadian and American identity"],
        },
      },
      {
        taskType: "multiple-choice",
        title: "Quick Quiz: Causes & Players",
        prompt: "Pick the best answer.",
        items: [
          { prompt: "Which British practice was a major cause of the War of 1812?", choices: ["Impressment of American sailors", "Banning all American books", "Demanding tea taxes", "Building forts in Mexico"], correctIndex: 0 },
          { prompt: "Who was the British general killed at Queenston Heights in 1812?", choices: ["Sir George Prevost", "Sir Isaac Brock", "Tecumseh", "James Madison"], correctIndex: 1 },
          { prompt: "Which song was inspired by the bombardment of Fort McHenry?", choices: ["America the Beautiful", "The Star-Spangled Banner", "Yankee Doodle", "God Save the King"], correctIndex: 1 },
          { prompt: "Which Indigenous leader allied with the British against the United States?", choices: ["Sitting Bull", "Geronimo", "Tecumseh", "Crazy Horse"], correctIndex: 2 },
        ],
      },
      {
        taskType: "true-false",
        title: "True or False?",
        prompt: "True or false — Treaty of Ghent edition.",
        items: [
          { statement: "The Treaty of Ghent was signed in December 1814.", correct: true },
          { statement: "The Battle of New Orleans took place before the Treaty of Ghent was signed.", correct: false },
          { statement: "Sir Isaac Brock helped defend Canada from American invasion.", correct: true },
          { statement: "The War of 1812 was fought mainly in California and Texas.", correct: false },
          { statement: "The Star-Spangled Banner was written during the War of 1812.", correct: true },
        ],
      },
      {
        taskType: "sequence",
        title: "Put the Events in Order",
        prompt: "Drag these events into chronological order.",
        items: [
          { text: "U.S. declares war on Britain (June 1812)", order: 1 },
          { text: "Death of Brock at Queenston Heights (October 1812)", order: 2 },
          { text: "Battle of Lake Erie (September 1813)", order: 3 },
          { text: "British burn Washington, D.C. (August 1814)", order: 4 },
          { text: "Bombardment of Fort McHenry (September 1814)", order: 5 },
          { text: "Treaty of Ghent signed (December 1814)", order: 6 },
        ],
      },
      {
        taskType: "matching",
        title: "Match the Figure to the Role",
        prompt: "Match each person with what they did.",
        leftItems: [
          "Sir Isaac Brock",
          "Tecumseh",
          "James Madison",
          "Francis Scott Key",
          "Laura Secord",
        ],
        rightItems: [
          "British general killed at Queenston Heights",
          "Shawnee leader allied with the British",
          "U.S. president during the war",
          "Wrote the Star-Spangled Banner after Fort McHenry",
          "Canadian heroine who warned the British of an American attack at Beaver Dams",
        ],
        correctMatches: { "L1": "R1", "L2": "R2", "L3": "R3", "L4": "R4", "L5": "R5" },
      },
      {
        taskType: "short-answer",
        title: "Explain in a Sentence",
        prompt: "Answer each in one short sentence.",
        items: [
          { prompt: "Why was Fort McHenry significant to the war?", answer: "Its defence inspired the Star-Spangled Banner", acceptableAnswers: ["inspired the Star-Spangled Banner", "Francis Scott Key wrote the national anthem after the battle", "U.S. successfully defended Baltimore harbour"] },
          { prompt: "Name one outcome of the Treaty of Ghent.", answer: "Restored the pre-war border", acceptableAnswers: ["restored pre-war borders", "ended the war", "status quo ante bellum", "no territorial changes", "neither side lost territory"] },
        ],
      },
      {
        taskType: "upvote",
        title: "UpVote — Queenston Heights",
        prompt: "Read the proposition, then vote For or Against. One sentence to defend your side.",
        config: {
          proposition: "Sir Isaac Brock should not have personally led the charge at Queenston Heights.",
          subject: "History",
          unitName: "War of 1812",
          gradeLevel: 7,
          worldview: "general",
          voteTimeSeconds: 120,
          showRunningTally: true,
          requireReasoningOnSubmit: false,
        },
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // 9-12 — Math: Linear Equations
  // ────────────────────────────────────────────────────────────────────
  "g912-math-linear-equations": {
    key: "g912-math-linear-equations",
    title: "Linear Equations",
    subject: "Math",
    gradeBand: "9-12",
    gradeLevel: 9,
    topic: "Solving linear equations in one variable",
    summary: "Isolate the variable, balance both sides, and read off slope-intercept. 8 tasks for grade 9-12 algebra warm-up or review.",
    estimatedMinutes: 22,
    tasks: [
      {
        taskType: "mood-checkin",
        title: "How are you feeling?",
        prompt: "Tap the face that shows how you feel today.",
      },
      {
        taskType: "brain-spark-notes",
        title: "Quick Refresher",
        prompt: "Skim before you start.",
        notes: {
          heading: "Solving Linear Equations",
          keyTerms: [
            { term: "Variable", definition: "A letter representing an unknown number (usually x).", points: ["The thing you're solving for.", "Both sides of the equation must remain equal as you solve."] },
            { term: "Coefficient", definition: "The number in front of a variable (e.g., the 3 in 3x).", points: ["Tells you how many of the variable you have.", "Divide both sides by the coefficient to isolate the variable."] },
            { term: "Slope-intercept form", definition: "y = mx + b, where m is slope and b is the y-intercept.", points: ["m = rise over run", "b = where the line crosses the y-axis"] },
          ],
          mainPoints: [
            { heading: "Step-by-step solving", bullets: ["Move all variables to one side", "Move all constants to the other side", "Divide by the coefficient to isolate the variable", "Check your answer by substituting back"] },
            { heading: "Common mistakes", bullets: ["Forgetting to apply operations to BOTH sides", "Sign errors when moving terms across the equals sign", "Dividing only part of an expression by the coefficient"] },
          ],
          summary: ["Keep both sides balanced.", "Isolate the variable.", "Always check by substituting back."],
        },
      },
      {
        taskType: "multiple-choice",
        title: "Solve It",
        prompt: "Pick the value of x that makes each equation true.",
        items: [
          { prompt: "Solve: 3x + 5 = 20", choices: ["x = 3", "x = 5", "x = 7", "x = 15"], correctIndex: 1 },
          { prompt: "Solve: 2(x − 4) = 10", choices: ["x = 1", "x = 7", "x = 9", "x = 14"], correctIndex: 2 },
          { prompt: "Solve: 4x − 7 = 2x + 9", choices: ["x = 4", "x = 8", "x = 16", "x = 1"], correctIndex: 1 },
          { prompt: "What is the slope of y = −3x + 4?", choices: ["4", "−3", "3", "−4"], correctIndex: 1 },
        ],
      },
      {
        taskType: "true-false",
        title: "Algebra Truths",
        prompt: "TRUE or FALSE?",
        items: [
          { statement: "If a + 5 = 12, then a = 7.", correct: true },
          { statement: "The equation y = 2x + 1 has a y-intercept of 2.", correct: false },
          { statement: "Multiplying both sides of an equation by the same number keeps the equation true.", correct: true },
          { statement: "The equation 3x = 0 has no solution.", correct: false },
          { statement: "Two equations with the same slope and different y-intercepts have NO solution in common.", correct: true },
        ],
      },
      {
        taskType: "body-break",
        title: "Reset & Stretch",
        prompt: "Stand up, shake out, get back into it.",
        config: {
          steps: [
            { text: "Roll your shoulders backward 5 times", icon: "💪" },
            { text: "Do 10 jumping jacks", icon: "⭐" },
            { text: "Take 3 deep breaths", icon: "🧘" },
            { text: "Stretch both arms overhead and hold for 10 seconds", icon: "🙆" },
          ],
          totalSeconds: 60,
        },
      },
      {
        taskType: "short-answer",
        title: "Show Your Work",
        prompt: "Solve and write the value of x.",
        items: [
          { prompt: "Solve for x: 5x − 8 = 17", answer: "5", acceptableAnswers: ["5", "x = 5", "x=5"] },
          { prompt: "Solve for x: 7 − 2x = 1", answer: "3", acceptableAnswers: ["3", "x = 3", "x=3"] },
          { prompt: "Solve for x: 4(x + 2) = 24", answer: "4", acceptableAnswers: ["4", "x = 4", "x=4"] },
        ],
      },
      {
        taskType: "matching",
        title: "Match Equation to Slope",
        prompt: "Match each line to its slope.",
        leftItems: [
          "y = 2x + 3",
          "y = −x + 5",
          "y = (1/2)x − 4",
          "y = 7",
          "y = −3x + 1",
        ],
        rightItems: [
          "Slope = 2",
          "Slope = −1",
          "Slope = 1/2",
          "Slope = 0",
          "Slope = −3",
        ],
        correctMatches: { "L1": "R1", "L2": "R2", "L3": "R3", "L4": "R4", "L5": "R5" },
      },
      {
        taskType: "open-text",
        title: "Explain a Mistake",
        prompt: "A classmate wrote: \"To solve 2x + 6 = 14, divide both sides by 2 first to get x + 6 = 7, then subtract 6 to get x = 1.\" Explain what went wrong and write the correct answer. Use at least 3 sentences.",
        config: { gradeLevel: 9, difficulty: "MEDIUM" },
      },
    ],
  },
};

export const QUICKSTART_KEYS = Object.keys(QUICKSTART_TASKSETS);

export function getQuickstartTaskset(key) {
  return QUICKSTART_TASKSETS[String(key || "").trim()] || null;
}

export function listQuickstartTasksetsByBand() {
  const out = {};
  for (const t of Object.values(QUICKSTART_TASKSETS)) {
    if (!out[t.gradeBand]) out[t.gradeBand] = [];
    out[t.gradeBand].push({
      key: t.key,
      title: t.title,
      subject: t.subject,
      topic: t.topic,
      summary: t.summary,
      gradeLevel: t.gradeLevel,
      estimatedMinutes: t.estimatedMinutes,
      taskCount: Array.isArray(t.tasks) ? t.tasks.length : 0,
    });
  }
  return out;
}
