// student-app/src/demoTasks.js
//
// Sample task data for the Conference Demo / Student Practice Mode.
// Each task is shaped exactly like what TaskRunner expects.
// Content is fun, conference-appropriate, and subject-neutral.
//
// IMPORTANT: Field names in each task MUST match what the corresponding
// component in components/tasks/types/ actually reads from the `task` prop.
// This file was audited against every component on 2026-05-02.

const DEMO_TASKS = [

  // =========================================================================
  // ON-SCREEN QUIZ / KNOWLEDGE TASKS
  // =========================================================================

  // 1. Multiple Choice
  {
    taskType: "multiple-choice",
    title: "Quick Quiz",
    prompt: "Try a multiple-choice question!",
    items: [
      {
        prompt: "Which country has the most official languages?",
        choices: ["India", "South Africa", "Bolivia", "Papua New Guinea"],
        correctIndex: 1,
      },
      {
        prompt: "What is the most spoken language in the world by native speakers?",
        choices: ["English", "Hindi", "Spanish", "Mandarin Chinese"],
        correctIndex: 3,
      },
    ],
  },

  // 2. True/False (uses task.items with statement + correct).
  // Prompt rewritten to explicitly point at the statements below —
  // tester Amelia: "What are we trueing or falseing".
  {
    taskType: "true-false",
    title: "True or False?",
    prompt: "Decide whether each statement below is TRUE or FALSE.",
    items: [
      { statement: "Honey never spoils — archaeologists have found 3,000-year-old edible honey.", correct: true },
      { statement: "The Great Wall of China is visible from space with the naked eye.", correct: false },
      { statement: "Octopuses have three hearts.", correct: true },
    ],
  },

  // 3. Short Answer
  {
    taskType: "short-answer",
    title: "Think Fast!",
    prompt: "Answer in a few words.",
    items: [
      { prompt: "Name one planet in our solar system that has rings.", answer: "Saturn" },
      { prompt: "What element does 'O' represent on the periodic table?", answer: "Oxygen" },
    ],
  },

  // 4. Sort (uses config.categories + config.items with bucketIndex)
  {
    taskType: "sort",
    title: "Sort It Out",
    prompt: "Drag items into the correct category.",
    config: {
      categories: ["Fruits", "Vegetables"],
      items: [
        { text: "Tomato", bucketIndex: 0 },
        { text: "Carrot", bucketIndex: 1 },
        { text: "Avocado", bucketIndex: 0 },
        { text: "Broccoli", bucketIndex: 1 },
        { text: "Banana", bucketIndex: 0 },
        { text: "Spinach", bucketIndex: 1 },
      ],
    },
  },

  // 5. Sequence
  {
    taskType: "sequence",
    title: "Put It in Order",
    prompt: "Arrange these from smallest to largest.",
    items: [
      { text: "Tennis ball", order: 1 },
      { text: "Basketball", order: 2 },
      { text: "Beach ball", order: 3 },
      { text: "Hot air balloon", order: 4 },
    ],
  },

  // 6. Matching
  {
    taskType: "matching",
    title: "Match 'Em Up",
    prompt: "Match each item with its pair.",
    pairs: [
      { left: "Peanut butter", right: "Jelly" },
      { left: "Salt", right: "Pepper" },
      { left: "Lock", right: "Key" },
      { left: "Thunder", right: "Lightning" },
    ],
  },

  // 7. Flashcards (uses task.cards with question + answer)
  {
    taskType: "flashcards",
    title: "Flip & Learn",
    prompt: "Tap to flip each card!",
    cards: [
      { question: "What is the capital of Japan?", answer: "Tokyo" },
      { question: "How many continents are there?", answer: "7" },
      { question: "What gas do plants absorb?", answer: "Carbon dioxide (CO2)" },
      { question: "Who painted the Mona Lisa?", answer: "Leonardo da Vinci" },
    ],
  },

  // 8. Flashcards Race
  {
    taskType: "flashcards-race",
    title: "Speed Round!",
    prompt: "Race to answer as fast as you can!",
    cards: [
      { question: "7 x 8 = ?", answer: "56" },
      { question: "Capital of France?", answer: "Paris" },
      { question: "Largest ocean?", answer: "Pacific" },
      { question: "H2O is the formula for?", answer: "Water" },
      { question: "How many sides does a hexagon have?", answer: "6" },
    ],
  },

  // 9. Timeline
  {
    taskType: "timeline",
    title: "Time Traveler",
    prompt: "Arrange these events in chronological order.",
    items: [
      { text: "First Moon landing", year: 1969, order: 1 },
      { text: "World Wide Web invented", year: 1989, order: 2 },
      { text: "First iPhone released", year: 2007, order: 3 },
      { text: "ChatGPT launched", year: 2022, order: 4 },
    ],
  },

  // 10. VennSort (uses config.categories array + config.items with text)
  {
    taskType: "vennsort",
    title: "Venn Diagram",
    prompt: "Sort items into the correct region of the Venn diagram.",
    config: {
      categories: ["Can Fly", "Has Legs"],
      items: [
        { text: "Eagle" },
        { text: "Snake" },
        { text: "Airplane" },
        { text: "Spider" },
        { text: "Bat" },
        { text: "Fish" },
      ],
    },
    correctAnswer: {
      "item-0-Eagle": ["Can Fly", "Has Legs"],
      "item-1-Snake": [],
      "item-2-Airplane": ["Can Fly"],
      "item-3-Spider": ["Has Legs"],
      "item-4-Bat": ["Can Fly", "Has Legs"],
      "item-5-Fish": [],
    },
  },

  // 11. Brain Blitz (uses flat config.clues array with clue + answer)
  {
    taskType: "brain-blitz",
    title: "Brain Blitz!",
    prompt: "Shout the answer as a question!",
    config: {
      clues: [
        { clue: "This force keeps you on the ground.", answer: "Gravity" },
        { clue: "The closest star to Earth.", answer: "The Sun" },
        { clue: "The largest desert in the world.", answer: "Sahara" },
        { clue: "The longest river in the world.", answer: "Nile" },
        { clue: "This element has the symbol 'Au' on the periodic table.", answer: "Gold" },
        { clue: "The planet known as the Red Planet.", answer: "Mars" },
      ],
    },
  },

  // 12. Open Text
  {
    taskType: "open-text",
    title: "Share Your Thoughts",
    prompt: "What's one thing you'd like to see AI do for education in the next 5 years?",
  },

  // 13. Hangman Duel — wordBank gives the Rematch button a new word
  // to pick (tester: "It was the same word when we rematched").
  // HangmanDuelTask.pickNewWord() filters the current word out and
  // picks at random from the rest.
  {
    taskType: "hangman-duel",
    title: "Hangman Duel",
    prompt: "Guess the word before your opponent!",
    config: {
      word: "CURRICULUM",
      hint: "A plan for teaching and learning",
      maxGuesses: 8,
      wordBank: [
        "CURRICULUM",
        "PRACTICE",
        "TEACHER",
        "STUDENT",
        "SCHOOL",
        "HOMEWORK",
        "LIBRARY",
        "RECESS",
        "CLASSROOM",
        "ASSEMBLY",
      ],
    },
  },

  // 14. Speed Draw (uses task.word or task.config.word)
  {
    taskType: "speed-draw",
    title: "Speed Draw",
    prompt: "Draw the word as fast as you can!",
    config: {
      word: "Robot Teacher",
      difficulty: "MEDIUM",
    },
  },

  // 15. Pet Feeding (uses config.foodItems with label + good)
  //
  // Tester feedback: "the pro/con statements are not supposed to be
  // obviously good and bad foods! they are supposed to be pro/con/meh
  // in connection with a topic related to the taskset. the link
  // between the feeding and the feed items is once-removed."
  //
  // So the pet is a stand-in for a topic (here: a student's brain at
  // study time), and the "foods" are study habits.  Pro habits make
  // the brain thrive, con habits sap it, and meh habits (good: null)
  // are neutral.  The decision is about the topic, not about literal
  // junk food vs. carrots — the metaphor is one step removed.
  {
    taskType: "pet-feeding",
    title: "Feed Your Study Brain",
    prompt:
      "This pet is your brain at study time. Feed it habits that help you learn — skip the ones that drain it. Some are clearly neutral.",
    topic: "Healthy study habits",
    config: {
      pack: "classic",
      goal: 4,
      maxMistakes: 3,
      foodItems: [
        // PRO (good: true) — habits that genuinely help learning.
        { label: "Eight hours of sleep", good: true, emoji: "😴" },
        { label: "Practice problems", good: true, emoji: "📝" },
        { label: "Asking 'why?' out loud", good: true, emoji: "❓" },
        { label: "Spacing study across days", good: true, emoji: "📅" },
        { label: "Teaching a friend the concept", good: true, emoji: "🧑‍🏫" },
        // CON (good: false) — habits that look like studying but hurt it.
        { label: "All-night cramming", good: false, emoji: "🌙" },
        { label: "Scrolling TikTok during 'study time'", good: false, emoji: "📱" },
        { label: "Re-reading notes 10 times without testing", good: false, emoji: "🔁" },
        { label: "Studying with the TV on", good: false, emoji: "📺" },
        // MEH (good: null) — neutral; neither dramatically helps nor hurts.
        { label: "Studying at a desk vs. a couch", good: null, emoji: "💺" },
        { label: "Highlighter colour choice", good: null, emoji: "🖍️" },
      ],
    },
  },

  // 16. Spinner (uses config.wedges array of objects)
  {
    taskType: "spinner",
    title: "Spin the Wheel!",
    prompt: "Spin and see what you land on!",
    config: {
      wedges: [
        { label: "Tell a fun fact", points: 50, type: "perk" },
        { label: "+100 pts", points: 100, type: "points" },
        { label: "Do 5 jumping jacks", points: 25, type: "perk" },
        { label: "+200 pts", points: 200, type: "points" },
        { label: "Name 3 capitals", points: 75, type: "perk" },
        { label: "JACKPOT +500!", points: 500, type: "jackpot" },
      ],
    },
  },

  // 17. Trivia (uses config.rounds array)
  {
    taskType: "trivia",
    title: "Trivia Time",
    prompt: "Test your general knowledge!",
    config: {
      rounds: [
        {
          mode: "bluff",
          category: "subject",
          facts: [
            "The Eiffel Tower can grow up to 6 inches taller in the summer heat.",
            "Bananas are technically berries, but strawberries are not.",
            "Goldfish only have a 3-second memory.",
          ],
          fakeIndex: 2,
          explanation: "Goldfish can actually remember things for months!",
        },
        {
          mode: "truefalse",
          category: "pop",
          statement: "A group of flamingos is called a 'flamboyance'.",
          answer: true,
          explanation: "Yes! A group of flamingos is indeed called a flamboyance.",
        },
      ],
    },
  },

  // 18. Riddle — pool so repeat encounters surface a different one.
  // RiddleTask picks by _taskIndex % pool.length (see RiddleTask.jsx).
  {
    taskType: "riddle",
    title: "Riddle Me This",
    prompt: "Can you solve this riddle?",
    config: {
      riddles: [
        {
          text: "I have cities, but no houses live there. I have mountains, but no trees grow there. I have water, but no fish swim there. What am I?",
          answer: "A map",
        },
        {
          text: "The more you take, the more you leave behind. What am I?",
          answer: "Footsteps",
        },
        {
          text: "I'm tall when I'm young, and short when I'm old. What am I?",
          answer: "A candle",
        },
        {
          text: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?",
          answer: "An echo",
        },
        {
          text: "What has hands but cannot clap?",
          answer: "A clock",
        },
        {
          text: "I have keys but no locks. I have space but no room. You can enter, but not go inside. What am I?",
          answer: "A keyboard",
        },
      ],
      // Legacy single-riddle fields kept as a hard fallback if a
      // future generator strips the pool.
      riddle:
        "I have cities, but no houses live there. I have mountains, but no trees grow there. I have water, but no fish swim there. What am I?",
      answer: "A map",
    },
  },

  // 18b. What Am I? — deduction game with progressive clue reveal + decaying point ceiling.
  // Demo uses a pool so repeat practice surfaces a different concept. The component
  // picks one entry per session via `_taskIndex % pool.length` (same pattern as RiddleTask).
  // The non-pool fields (answer/clues/etc) serve as a hard fallback if the pool is ever empty.
  {
    taskType: "what-am-i",
    title: "What Am I? — Deduction Challenge",
    prompt: "Guess what I am — earlier guesses earn more points.",
    config: {
      // Pool — rotated per practice session
      pool: [
        {
          answer: "Photosynthesis",
          acceptableAnswers: ["photosynthesis", "photo synthesis"],
          clues: [
            { level: 1, text: "I turn one form of energy into another that living things can use." },
            { level: 2, text: "I only happen where chlorophyll lives." },
            { level: 3, text: "I need sunlight, water, and a gas you exhale." },
            { level: 4, text: "Plants use me to make their own food." },
          ],
        },
        {
          answer: "The Nile",
          acceptableAnswers: ["nile", "river nile", "the nile river"],
          clues: [
            { level: 1, text: "Without me, an ancient civilization would not have grown crops in a desert." },
            { level: 2, text: "I am the lifeline of the world's longest political subdivision named after sand." },
            { level: 3, text: "I flow northward through 11 modern nations." },
            { level: 4, text: "Cleopatra's people built their kingdom on my banks." },
          ],
        },
        {
          answer: "Gravity",
          acceptableAnswers: ["gravity", "gravitational force", "gravitational attraction"],
          clues: [
            { level: 1, text: "I am the reason planets stay in their orbits and your feet stay on the ground." },
            { level: 2, text: "I shape the very curvature of space-time near massive objects." },
            { level: 3, text: "I was famously theorized after a falling fruit." },
            { level: 4, text: "Without me there would be no tides." },
          ],
        },
        {
          answer: "Mitochondria",
          acceptableAnswers: ["mitochondria", "mitochondrion"],
          clues: [
            { level: 1, text: "I am inside almost every one of your trillions of body parts." },
            { level: 2, text: "I convert what you eat into a chemical your cells can spend like cash." },
            { level: 3, text: "Biology textbooks famously call me the powerhouse of something tiny." },
            { level: 4, text: "I have my own ring of DNA, passed from your mother." },
          ],
        },
        {
          answer: "The Magna Carta",
          acceptableAnswers: ["magna carta", "the magna carta", "great charter"],
          clues: [
            { level: 1, text: "Without me, the idea that even kings answer to written law might never have taken hold." },
            { level: 2, text: "I was signed in a meadow in England in 1215." },
            { level: 3, text: "Rebellious barons forced King John to seal me." },
            { level: 4, text: "My name is Latin for the 'Great Charter'." },
          ],
        },
        {
          answer: "A Solar Eclipse",
          acceptableAnswers: ["solar eclipse", "a solar eclipse", "eclipse of the sun"],
          clues: [
            { level: 1, text: "I briefly turn day into twilight, and ancient peoples often feared me as an omen." },
            { level: 2, text: "I happen when one celestial body steps directly between another and you." },
            { level: 3, text: "I can be partial, annular, or total — and the total kind reveals a glowing corona." },
            { level: 4, text: "I only happen during a new moon." },
          ],
        },
      ],
      // Hard-fallback fields used if pool is empty
      answer: "Photosynthesis",
      acceptableAnswers: ["photosynthesis", "photo synthesis"],
      clues: [
        { level: 1, text: "I turn one form of energy into another that living things can use." },
        { level: 2, text: "I only happen where chlorophyll lives." },
        { level: 3, text: "I need sunlight, water, and a gas you exhale." },
        { level: 4, text: "Plants use me to make their own food." },
      ],
      difficulty: "medium",
      mode: "solo",
      scoring: { perClueCurve: [10, 8, 6, 4, 2] },
      penalties: { wrongAnswer: "lockout", lockoutMs: 8000 },
    },
  },

  // 18c. Quest — mini expedition with one objective + one resource shop.
  // Practice mode bypasses the room-scoped coin economy, so the QuestTask
  // renderer reads coins from its local state (granted by the demo runner)
  // and Buy buttons just decrement the local counter.
  {
    taskType: "quest",
    title: "Quest: The Sea Voyage",
    prompt: "Outfit a small ship before winter sets in.",
    config: {
      title: "Launch the Sea Voyage",
      scenario: "Your team must prepare a fishing vessel before the storms arrive. Without rope and water, the voyage fails.",
      objectives: [
        { id: "launch", description: "Launch with adequate supplies.", requiredResources: { rope: 2, water: 1 } },
      ],
      resources: [
        { id: "rope", name: "Rope", acquisitionOptions: [{ type: "coins", amount: 5 }], prerequisites: [] },
        { id: "water", name: "Fresh water cask", acquisitionOptions: [{ type: "coins", amount: 8 }], prerequisites: [] },
      ],
      premiumResources: {
        reinforcedRope: { bonusPoints: 5, replaces: "rope" },
      },
      ranks: [
        { id: "completed", label: "Voyage Completed", min: 0 },
        { id: "prepared", label: "Well Prepared", min: 1 },
        { id: "master", label: "Master Voyage", min: 2 },
      ],
    },
  },

  // 18d. Careers — best-fit mode with a small, anti-stereotype career card.
  {
    taskType: "careers",
    title: "Best Fit: Marine Biologist",
    prompt: "Read the role. Discuss as a team. Who would thrive — and why?",
    config: {
      mode: "best-fit",
      career: {
        name: "Marine Biologist",
        description: "Studies ocean life — from microscopic plankton to whale migrations. Long hours, real fieldwork, careful data, public science writing.",
        traits: ["curiosity", "patience with data", "comfort in or near water", "communication", "stamina for long days outdoors"],
      },
      teammates: ["Maya", "Aiko", "Liam"],
    },
  },

  // 18e. Current Events — practice mode uses the evergreen library entry tagged "general".
  // The runtime resolver only fires in live sessions; in demo we ship a pre-resolved block.
  {
    taskType: "current-events",
    title: "Current Events: This Week's Connection",
    prompt: "Connect today's lesson to a real story this week.",
    config: {
      lessonTopic: "Today's lesson",
      subject: "general",
      gradeLevel: 7,
      worldviewProfile: "general",
      // Pre-baked evergreen — bypasses the live resolver for practice
      resolved: {
        title: "Curiosity Beyond the Textbook",
        currentEventHeadline: "Scientists keep finding surprises in places we thought we knew.",
        eventSummary: "Ordinary scientists keep revising what we thought we knew — new species in well-studied forests, fresh insights from old experiments. The pattern: curiosity + careful observation + willingness to revisit assumptions.",
        connectionToLesson: "Today's lesson is one more chance to ask what assumption you haven't questioned yet.",
        studentTask: "In pairs, name ONE 'common knowledge' fact from today. List one reason it might still be incomplete.",
        discussionQuestions: [
          "What's the difference between 'something we don't know' and 'something we got wrong'?",
          "Whose curiosity counted in this lesson — and whose was ignored?",
          "If today's lesson turned out to be partly mistaken, how would we find out?",
        ],
        extensionActivity: "Write a 3-sentence note to a scientist or thinker who would have loved today's lesson.",
        teacherNotes: "Demo / practice mode uses the evergreen library directly.",
        estimatedMinutes: 12,
        sourceName: "Curriculate evergreen library",
        fallbackTier: "evergreen-demo",
      },
    },
  },

  // 18g. Legends — 5W deduction. Marie Curie's 10 facts (2/2/2/1 + 3 decoys).
  // Portrait sourced from Wikimedia Commons (public domain photograph c.1920).
  {
    taskType: "legends",
    title: "Legends — A Pioneer of Radioactivity",
    prompt: "Sort the 10 facts below to identify this legendary figure.",
    config: {
      figure: {
        name: "Marie Curie",
        portraitUrl: "https://upload.wikimedia.org/wikipedia/commons/c/c8/Marie_Curie_c1920.jpg",
        era: "Late 1800s – early 1900s",
        summary: "Pioneering physicist and chemist who discovered radium and polonium; first person to win Nobel Prizes in two different sciences (Physics 1903, Chemistry 1911).",
      },
      facts: [
        { id: "f1",  text: "Was the first woman to win a Nobel Prize.", category: "what" },
        { id: "f2",  text: "Discovered two new elements: radium and polonium.", category: "what" },
        { id: "f3",  text: "Worked in a converted shed at the Sorbonne in Paris.", category: "where" },
        { id: "f4",  text: "Was born in Warsaw, then part of the Russian Empire.", category: "where" },
        { id: "f5",  text: "Believed scientific knowledge belonged to all humanity, not patent-holders.", category: "why" },
        { id: "f6",  text: "Wanted to relieve battlefield suffering by deploying mobile X-ray units in WWI.", category: "why" },
        { id: "f7",  text: "Lived from 1867 to 1934.", category: "when" },
        { id: "f8",  text: "Famously declined Lord Rutherford's invitation to a Cambridge banquet.", category: "decoy" },
        { id: "f9",  text: "Is sometimes confused with another scientist who studied bacteria.", category: "decoy" },
        { id: "f10", text: "Was rumored to have visited the Eiffel Tower 20 times in a single summer.", category: "decoy" },
      ],
    },
  },

  // 18h. Truth or Dare — solo practice rotation. The real session is
  // socket-driven; here we seed enough challenges that a single player can
  // experience the full 4-round loop in practice mode.
  {
    taskType: "truth-or-dare",
    title: "Truth or Dare — Practice Round",
    prompt: "Tap TRUTH or DARE, then perform. Self-judge at the end.",
    config: {
      subject: "general",
      unitName: "today's lesson",
      gradeLevel: 7,
      worldview: "general",
      physicalIntensityMax: 2,
      socialIntensityMax: 2,
      movementAllowed: true,
      noiseAllowed: true,
      totalRounds: 4,
      tierProgression: "linear",
      judgmentMode: "mixed",
      seedChallenges: [
        {
          id: "td-truth-recall",
          type: "truth",
          tier: "sprout",
          category: "recall",
          prompt: "Tell us one fact you learned in your last class — the more surprising, the better.",
          teacherHint: "Reward any honest, on-topic recall.",
          timeSeconds: 25,
          judgmentMode: "teacher",
          rewardTier: "small",
        },
        {
          id: "td-dare-mime",
          type: "dare",
          tier: "sprout",
          category: "mime",
          prompt: "Mime an animal from a habitat you're studying — no sound, 20 seconds. See who guesses first!",
          teacherHint: "Bonus for creative posture or movement.",
          timeSeconds: 30,
          judgmentMode: "class-vote",
          rewardTier: "medium",
        },
        {
          id: "td-truth-explain",
          type: "truth",
          tier: "stem",
          category: "explain",
          prompt: "Explain a concept from today's lesson like you're teaching a 5-year-old.",
          teacherHint: "Look for accurate analogy, not vocabulary.",
          timeSeconds: 35,
          judgmentMode: "teacher",
          rewardTier: "medium",
        },
        {
          id: "td-dare-narrate",
          type: "dare",
          tier: "stem",
          category: "narrate",
          prompt: "Narrate a 30-second nature-documentary about your pencil. Use your best documentary voice.",
          teacherHint: "Bonus for committing to the bit.",
          timeSeconds: 35,
          judgmentMode: "class-vote",
          rewardTier: "medium",
        },
        {
          id: "td-truth-reflect",
          type: "truth",
          tier: "sprout",
          category: "reflect",
          prompt: "What is one thing you'd like to get better at this week — and why?",
          teacherHint: "Any honest reflection earns points.",
          timeSeconds: 25,
          judgmentMode: "teacher",
          rewardTier: "small",
        },
      ],
    },
  },

  // 18f. Hole in One — minimal solvable board with two pre-placed obstacles.
  // No question bank (skips Earn phase). No team members → skips TilterPicker → goes straight to Tilt.
  {
    taskType: "hole-in-one",
    title: "Hole in One — Practice Course",
    prompt: "Tilt the device (or use WASD / on-screen joystick) to roll the ball into the hole.",
    config: {
      board: {
        width: 10,
        height: 14,
        gridSize: 26,
        startPosition: { x: 1, y: 1 },
        holePosition: { x: 8, y: 12, radius: 0.8 },
        obstacles: [
          { type: "wall", x: 3, y: 4, w: 4, h: 0.5 },
          { type: "wall", x: 1, y: 9, w: 5, h: 0.5 },
        ],
      },
      physics: { gravity: 0.35, friction: 0.95, bounciness: 0.6, ballRadius: 0.45 },
      scoring: { playPoints: 1, successPoints: 10 },
      controls: { tiltEnabled: true, fallbackControls: true, sensitivity: 1, smoothing: 0.85 },
    },
  },

  // 19. Tower Builder (uses config.statements with text + category)
  {
    taskType: "tower-builder",
    title: "Tower Builder",
    prompt: "Stack the true statements to build your tower!",
    config: {
      statements: [
        { text: "Water boils at 100 degrees Celsius at sea level.", category: "benefit" },
        { text: "The Earth is flat.", category: "harm" },
        { text: "Humans share about 60% of their DNA with bananas.", category: "benefit" },
        { text: "Lightning never strikes the same place twice.", category: "harm" },
        { text: "Sound travels faster in water than in air.", category: "benefit" },
        { text: "The sun revolves around the Earth.", category: "harm" },
      ],
    },
  },

  // 20. Reading Comprehension
  {
    taskType: "reading-comp",
    title: "Quick Read",
    prompt: "Read the passage and answer.",
    passage: "Curriculate uses AI to generate interactive scavenger-hunt task sets for classrooms. Teachers describe their lesson, and AI creates stations with movement, collaboration, and creative tasks. Students join on their phones by scanning CurricQR codes — no app download needed.",
    items: [
      { prompt: "What do students scan to join?", answer: "CurricQR codes" },
      { prompt: "Do students need to download an app?", answer: "No" },
    ],
  },

  // 21. Diff Detective (uses top-level original, modified, differences)
  {
    taskType: "diff-detective",
    title: "Spot the Difference",
    prompt: "Find what changed between the two versions!",
    original: "The quick brown fox jumps over the lazy dog.",
    modified: "The quick brown cat leaps over the sleepy dog.",
    differences: [
      { word: "fox", replacement: "cat" },
      { word: "jumps", replacement: "leaps" },
      { word: "lazy", replacement: "sleepy" },
    ],
  },

  // 22. Echo Chain (uses config.seedTerm)
  {
    taskType: "echo-chain",
    title: "Echo Chain",
    prompt: "Build a word chain! Each person adds a word and everyone recites the full chain.",
    config: {
      seedTerm: "Technology",
    },
  },

  // 23. Word Weaver Duel (uses config.words array)
  {
    taskType: "word-weaver-duel",
    title: "Word Weaver",
    prompt: "Place words on the grid — try to intersect for bonus points!",
    config: {
      words: ["LEARN", "TEACH", "SHARE", "THINK", "BUILD", "CREATE", "GROW"],
    },
  },

  // 24. Body Break (uses config.steps array with text)
  {
    taskType: "body-break",
    title: "Body Break!",
    prompt: "Time to move! Follow each step.",
    config: {
      steps: [
        { text: "Stand up and stretch your arms overhead", icon: "🙆" },
        { text: "Do 10 jumping jacks", icon: "⭐" },
        { text: "Touch your toes 5 times", icon: "🤸" },
        { text: "Balance on one foot for 10 seconds", icon: "🦩" },
        { text: "Take 3 deep breaths", icon: "🧘" },
      ],
      totalSeconds: 60,
    },
  },

  // 25. Mind Mapper (uses config.concepts array)
  {
    taskType: "mind-mapper",
    title: "Mind Map",
    prompt: "Build a mind map around the central idea: Future of Education",
    config: {
      concepts: ["AI Tools", "Student Voice", "Movement", "Collaboration", "Creativity", "Assessment"],
    },
  },

  // =========================================================================
  // PHYSICAL / MOVEMENT / PHOTO TASKS
  // =========================================================================

  // 26. Physical Multiple Choice (scan-based, uses task.items)
  {
    taskType: "physical-multiple-choice",
    title: "Station Dash Quiz",
    prompt: "Read the question, pick your answer, then scan the matching color station!",
    items: [
      {
        prompt: "What is the largest mammal on Earth?",
        options: ["Elephant", "Blue Whale", "Giraffe", "Hippopotamus"],
        correctAnswer: "Blue Whale",
      },
      {
        prompt: "Which gas do humans breathe out?",
        options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Helium"],
        correctAnswer: "Carbon Dioxide",
      },
    ],
  },

  // 27. Photo
  {
    taskType: "photo",
    title: "Photo Challenge",
    prompt: "Take a photo of something in the room that represents teamwork. Be creative!",
  },

  // 28. Make and Snap
  {
    taskType: "make-and-snap",
    title: "Make & Snap",
    prompt: "Using materials around you, build a mini tower. Then take a photo of your creation!",
    config: {
      makePrompt: "Using materials around you, build a mini tower. Then take a photo of your creation!",
      instructions: "Work together to build something creative using only what's nearby. Take a photo when done and explain your design.",
    },
  },

  // 29. Photo Journal
  {
    taskType: "photo-journal",
    title: "Photo Journal",
    prompt: "Take a photo of something interesting you notice in this space, then write a short explanation of why you chose it.",
  },

  // 30. Motion Mission
  {
    taskType: "motion-mission",
    title: "Motion Mission!",
    prompt: "Jump 10 times",
  },

  // 31. Musical Chairs (uses task.items with prompt + options + correctAnswer)
  {
    taskType: "musical-chairs",
    title: "Musical Chairs Quiz",
    prompt: "Answer the question, then tap SCAN to move to the next round!",
    roomCode: "DEMO",
    items: [
      { id: "mc1", prompt: "What color do you get mixing red and blue?", options: ["Green", "Purple", "Orange", "Brown"], correctAnswer: "Purple" },
      { id: "mc2", prompt: "How many legs does a spider have?", options: ["6", "8", "10", "12"], correctAnswer: "8" },
      { id: "mc3", prompt: "What is the freezing point of water in Celsius?", options: ["-10", "0", "32", "100"], correctAnswer: "0" },
      { id: "mc4", prompt: "Which planet is closest to the Sun?", options: ["Venus", "Mars", "Mercury", "Earth"], correctAnswer: "Mercury" },
      { id: "mc5", prompt: "What is the chemical symbol for gold?", options: ["Go", "Gd", "Au", "Ag"], correctAnswer: "Au" },
      { id: "mc6", prompt: "How many sides does a pentagon have?", options: ["4", "5", "6", "7"], correctAnswer: "5" },
      { id: "mc7", prompt: "What is the largest continent?", options: ["Africa", "North America", "Asia", "Europe"], correctAnswer: "Asia" },
    ],
  },

  // 32. Mad Dash (scan-based station run)
  {
    taskType: "mad-dash",
    title: "Mad Dash!",
    prompt: "Race to scan all the stations in the correct sequence!",
    config: {
      sequence: ["Red", "Blue", "Green", "Yellow"],
    },
  },

  // 33. Mad Dash Sequence — items[] + correctOrder give the task a
  // real sequence to reveal.  Without them, MadDashSequenceTask
  // skipped its mapping effect and the reveal screen rendered empty
  // (tester: "no color sequence is ever presented").
  {
    taskType: "mad-dash-sequence",
    title: "Mad Dash Sequence",
    prompt: "Scan the stations in the right order as fast as you can!",
    items: [
      "Sun rises",
      "Have breakfast",
      "Walk to school",
      "Lunch bell rings",
      "Sun sets",
    ],
    config: {
      // Items are already listed in correct chronological order
      // above, so correctOrder is the identity sequence 0..4.  The
      // task internally shuffles them for display and the reveal
      // shows the corresponding colours-in-correct-order.
      correctOrder: [0, 1, 2, 3, 4],
      revealMs: 8000,
    },
  },

  // 34. Team Selfie
  {
    taskType: "team-selfie",
    title: "Team Selfie!",
    prompt: "Gather your team and take a group selfie!",
    config: {
      allowThemed: false,
    },
  },

  // 35. Treasure Runner (gyroscope side-scroller game)
  {
    taskType: "treasure-runner",
    title: "Treasure Runner",
    prompt: "Tilt your phone to collect coins and dodge obstacles!",
  },

  // 36. Hide N Seek — practice demo intentionally references "any
  // object around you" instead of a textbook page so practicers at
  // home (no schoolbook) can still play.  In a real classroom the
  // teacher's taskset supplies pageReference + cluueSource.
  {
    taskType: "hidenseek",
    title: "Hide & Seek",
    prompt:
      "Find an object near you (in your room, kitchen, anywhere) that fits one of the clues below. Take a photo and explain in 2+ sentences why it fits.",
    config: {
      clueSource: "the clues below",
      clues: [
        "Something that represents change",
        "An object with more than one purpose",
        "Something older than you are",
        "Something that holds another thing inside",
      ],
      // pageReference intentionally omitted — see HideNSeekTask.jsx.
    },
  },

  // =========================================================================
  // MOOD / CHECK-IN
  // =========================================================================

  // 37. Mood Check-In
  {
    taskType: "mood-checkin",
    title: "How Are You Feeling?",
    prompt: "Pick the emoji that best matches your mood right now!",
  },

  // =========================================================================
  // GAME / COMPETITIVE TASKS
  // =========================================================================

  // 38. True/False Tic-Tac-Toe (uses task.statements or task.items)
  //
  // Statements are CLAIMS for the student to evaluate as true or
  // false.  Avoid wording that reads as a confident assertion of an
  // urban myth (e.g. "Dolphins are fish") — testers misread those
  // as the game claiming the falsehood is true, and got mad at us
  // instead of at the claim.  Prefer either obviously-checkable
  // facts or claims framed as common myths.
  {
    taskType: "true-false-tictactoe",
    title: "T/F Tic-Tac-Toe",
    prompt:
      "Each tile holds a claim. Decide if the claim is TRUE or FALSE, then place your piece!",
    statements: [
      { text: "The Amazon is the world's longest river.", correct: false },
      { text: "Venus is the hottest planet in our solar system.", correct: true },
      { text: "Many people think dolphins are fish — but they're actually mammals. (True or false: dolphins are mammals.)", correct: true },
      { text: "An ostrich's eye is bigger than its brain.", correct: true },
      { text: "Light travels at about 300,000 km/s in a vacuum.", correct: true },
      { text: "Common myth: humans only use 10% of their brains.", correct: false },
      { text: "A day on Venus is longer than a year on Venus.", correct: true },
      { text: "The Great Barrier Reef is in the Atlantic Ocean.", correct: false },
      { text: "Common myth: bats are blind.", correct: false },
    ],
  },

  // 39. True/False Connect Four (uses task.statements or task.items)
  {
    taskType: "true-false-connect-four",
    title: "T/F Connect Four",
    prompt: "Answer true or false to drop your disc! Get 4 in a row to win!",
    statements: [
      { text: "The human body has 206 bones.", correct: true },
      { text: "Mount Everest is in Africa.", correct: false },
      { text: "Photosynthesis produces oxygen.", correct: true },
      { text: "The Moon has its own light.", correct: false },
      { text: "DNA stands for Deoxyribonucleic Acid.", correct: true },
      { text: "Penguins can fly.", correct: false },
      { text: "There are 7 continents on Earth.", correct: true },
      { text: "The Sahara is the largest desert by area.", correct: false },
      { text: "Water is made of hydrogen and oxygen.", correct: true },
      { text: "Mars has two moons.", correct: true },
      { text: "Spiders are insects.", correct: false },
      { text: "The Pacific Ocean is the largest ocean.", correct: true },
    ],
  },

  // =========================================================================
  // CREATIVE / PERFORMANCE TASKS
  // =========================================================================

  // 40. Draw (standalone draw, rendered by DrawMimeTask)
  // clues[] gives the wizard a real list of subjects to cycle through;
  // without it the parser falls back to either the task title or the
  // generic "Draw or Mime" string, which testers flagged as nonsense.
  {
    taskType: "draw",
    title: "Draw It!",
    prompt: "Sketch the subject below. Your team guesses what it is!",
    clues: ["elephant", "spaceship", "umbrella", "lighthouse", "treehouse"],
    config: {
      durationSeconds: 60,
    },
  },

  // 41. Mime (standalone mime, rendered by DrawMimeTask)
  {
    taskType: "mime",
    title: "Act It Out!",
    prompt: "Without speaking, act out the subject below. Your team guesses!",
    clues: ["brushing teeth", "fishing", "yawning", "tying a shoe", "carrying a heavy box"],
    config: {
      durationSeconds: 45,
    },
  },

  // 42. Draw-Mime (combined competitive mode)
  {
    taskType: "draw-mime",
    title: "Draw vs Mime!",
    prompt: "One person draws, another acts — who can get the team to guess first?",
    clues: ["volcano", "pizza", "robot dance", "fireworks", "snorkelling"],
    config: {
      durationSeconds: 60,
    },
  },

  // 43. Guess Who (uses config.secretAnswers)
  {
    taskType: "guess-who",
    title: "Guess Who?",
    prompt: "Ask yes/no questions to figure out the secret answer!",
    config: {
      secretAnswers: ["Albert Einstein", "Cleopatra"],
      category: "Famous Historical Figures",
      maxGuesses: 10,
      timerSeconds: 90,
    },
  },

  // =========================================================================
  // TEAM / COLLABORATION TASKS
  // =========================================================================

  // 44. Collaboration
  {
    taskType: "collaboration",
    title: "Team Collab",
    prompt: "Should schools replace textbooks with AI tutors? Write your team's best argument (2-5 bullets).",
  },

  // 45. Live Debate
  {
    taskType: "live-debate",
    title: "Live Debate",
    prompt: "Debate time!",
    postulate: "AI will make teachers more effective, not replace them.",
    turnsPerTeam: 2,
  },

  // 46. AI Debate Judge (needs socket, show placeholder in demo)
  {
    taskType: "ai-debate-judge",
    title: "AI Debate Judge",
    prompt: "Debate the resolution, then summon the AI judge for a verdict!",
    config: {
      topic: "Resolved: Students should be allowed to use AI tools for schoolwork.",
      debateSeconds: 120,
    },
  },

  // 47. Brainstorm Battle
  {
    taskType: "brainstorm-battle",
    title: "Brainstorm Battle!",
    prompt: "List as many uses for a paperclip as you can in 90 seconds!",
    timeLimitSeconds: 90,
  },

  // 48. Mystery Clues (reveal phase)
  {
    taskType: "mystery-clues",
    title: "Mystery Clue!",
    prompt: "Memorize these clues — you'll need them later!",
    config: {
      clues: ["🚀", "🧠", "🌟"],
      revealMs: 8000,
      isFinal: false,
    },
  },

  // 49. Fake Out (Balderdash-style, uses config.rounds)
  {
    taskType: "fake-out",
    title: "Fake Out!",
    prompt: "Can you spot the real answer among the fakes?",
    config: {
      playerCount: 4,
      rounds: [
        {
          statement: "What is the term for a group of owls?",
          options: ["A wisdom", "A parliament", "A hoot", "A conspiracy"],
          correctIndex: 1,
          joke: "A conspiracy",
        },
        {
          statement: "What does 'defenestration' mean?",
          options: [
            "The act of throwing someone out a window",
            "Removing fences from property",
            "A loud sneeze in public",
            "Building a fence around a castle",
          ],
          correctIndex: 0,
          joke: "A loud sneeze in public",
        },
      ],
    },
  },

  // 50. Brain Spark Notes (uses task.notes object)
  {
    taskType: "brain-spark-notes",
    title: "Brain Spark Notes",
    prompt: "Copy these key notes into your notebook!",
    notes: {
      heading: "Fun Facts About Learning",
      keyTerms: [
        { term: "Neuroplasticity", definition: "The brain's ability to reorganize itself by forming new connections.", points: ["Happens throughout life", "Enhanced by learning new skills"] },
        { term: "Spaced Repetition", definition: "Reviewing information at increasing intervals to improve memory.", points: ["More effective than cramming"] },
      ],
      mainPoints: [
        "The brain uses about 20% of the body's energy",
        "Sleep is essential for memory consolidation",
      ],
      summary: ["Learning changes your brain physically — every new skill creates new neural pathways!"],
    },
  },

  // =========================================================================
  // SPEAKING / AUDIO TASKS
  // =========================================================================

  // 51. Narration Synthesize (uses config.prompts)
  {
    taskType: "narration-synthesize",
    title: "Teach It Back",
    prompt: "Take turns explaining these concepts to your team!",
    config: {
      playerCount: 3,
      perTurnSeconds: 45,
      prompts: [
        { id: "p1", concept: "Photosynthesis", prompt: "Explain how plants convert sunlight into food." },
        { id: "p2", concept: "Gravity", prompt: "Explain why things fall to the ground." },
        { id: "p3", concept: "Ecosystems", prompt: "Explain how living things depend on each other." },
      ],
      ratingScale: { min: 1, max: 5, label: "Clarity / Accuracy / Quality" },
    },
  },

  // 52. Role Play Deck (uses config.roles + config.scenario)
  //
  // Tester (Ranbir, Fun 1/5, Clarity 1/5): "If you are playing on
  // your own it should only give you one player tasks".  Removed the
  // hard playerCount:4 override — the component now falls back to
  // memberNames.length, which is 1 in practice, so the player gets
  // one card and a solo-playable scenario.  Real classroom tasksets
  // can still pass playerCount via the AI generator.
  {
    taskType: "role-play-deck",
    title: "Role Play",
    prompt: "Pick a card and act out the role solo (or with friends).",
    config: {
      scenario:
        "You're a detective interviewing a nervous witness at the scene of a missing-cookie investigation. Improvise the conversation aloud — switch between detective voice and witness voice. (Got friends nearby? Each of you take a different card.)",
      roles: [
        { name: "The Detective", description: "Calm, methodical. Asks careful questions. Wants the truth.", gender: "any" },
        { name: "The Nervous Witness", description: "Knows something but is afraid to say. Stalls a lot.", gender: "any" },
        { name: "The Cookie's Owner", description: "Outraged but secretly relieved (they were on a diet anyway).", gender: "any" },
        { name: "The Bakery Cat", description: "Silent. Eyes everyone suspiciously. Maybe meow.", gender: "any" },
      ],
      mode: "choose",
      // playerCount intentionally omitted — defaults to
      // memberNames.length (1 in practice mode) so solo players
      // only get one role.
    },
  },

  // 53. Script Play (uses config.scenes with turns)
  {
    taskType: "script-play",
    title: "Script Play",
    prompt: "Perform this scene with your team!",
    config: {
      scenes: [
        {
          title: "The Big Presentation",
          contextBefore: "Two students are about to present their science project to the class.",
          turns: [
            { speakerIndex: 0, line: "Are you ready? I'm so nervous!", tone: "anxious" },
            { speakerIndex: 1, line: "We practiced a hundred times. We've got this!", tone: "confident" },
            { speakerIndex: 0, line: "But what if they ask questions we didn't prepare for?", tone: "worried" },
            { speakerIndex: 1, line: "Then we improvise! That's what real scientists do.", tone: "encouraging" },
            { speakerIndex: 0, line: "You're right. Let's show them what we've got!", tone: "determined" },
          ],
          contextAfter: "They walk up to the front of the class together.",
        },
      ],
    },
  },

  // 54. Pronunciation (uses task.referenceText)
  {
    taskType: "pronunciation",
    title: "Say It Right",
    prompt: "Practice saying this sentence clearly!",
    referenceText: "The quick brown fox jumps gracefully over the lazy sleeping dog near the riverbank.",
    language: "English",
    accentOptions: ["american", "british", "australian"],
  },

  // 55. Speech Recognition (uses task.config.referenceText or task.prompt)
  {
    taskType: "speech-recognition",
    title: "Speech Challenge",
    prompt: "Read the following passage aloud as clearly as you can.",
    config: {
      referenceText: "Technology in education helps students learn at their own pace. Interactive tools make lessons engaging and fun for everyone.",
      language: "en-US",
    },
  },

  // 56. Record Audio
  {
    taskType: "record-audio",
    title: "Record Your Voice",
    prompt: "Record a 20-second audio clip explaining your favorite thing about school. Speak clearly!",
    config: {
      minSeconds: 15,
    },
  },

  // =========================================================================
  // WRITING / REFLECTION TASKS
  // =========================================================================

  // 57. Letter (uses config.character + config.topicContext)
  {
    taskType: "letter",
    title: "Write a Letter",
    prompt: "Write a letter to a historical figure!",
    config: {
      character: "Leonardo da Vinci",
      characterDescription: "Italian polymath of the Renaissance — painter, inventor, scientist, and visionary.",
      letterStyle: "friendly",
      topicContext: "You want to tell him about modern technology and ask what he would invent today.",
      relevantConcepts: ["Renaissance", "invention", "curiosity", "art", "science"],
    },
  },

  // 58. Case Study (uses config.scenario + config.expertRole)
  {
    taskType: "case-study",
    title: "Case Study",
    prompt: "Analyze this scenario!",
    config: {
      scenario: "A small island nation is running out of fresh water. They have ocean water, solar panels, and a limited budget. The government needs to decide between building a desalination plant or importing water by ship.",
      expertRole: "Environmental Consultant",
      expertDescription: "You advise governments on sustainable resource management.",
      relevantConcepts: ["sustainability", "desalination", "resources", "cost-benefit analysis"],
    },
  },

  // 59. Storytelling (uses config.setting + config.genre + config.vocabWords)
  {
    taskType: "storytelling",
    title: "Story Time!",
    prompt: "Build characters and generate a collaborative story!",
    config: {
      setting: "a futuristic school in the year 2150",
      genre: "adventure",
      topicContext: "Technology and learning in the future",
      vocabWords: ["hologram", "robot", "discovery", "teamwork"],
      showNationality: false,
    },
  },

  // =========================================================================
  // VISUAL ANALYSIS TASKS
  // =========================================================================

  // 60. Art View (uses config.imageUrl + config.focusHints)
  {
    taskType: "art-view",
    title: "Art View",
    prompt: "Study the artwork carefully, then share your observations!",
    config: {
      // Local bundled asset — external Wikimedia URLs were unreliable in
      // classroom networks (hotlink/CORS), so the demo never rendered art.
      imageUrl: "/demo-images/great-wave.svg",
      imageTitle: "The Great Wave off Kanagawa",
      imageArtist: "Katsushika Hokusai",
      imageYear: "c. 1831",
      viewingSeconds: 45,
      responseSeconds: 90,
      minObservations: 3,
      focusHints: ["Look at the wave's shape", "Notice Mount Fuji in the background", "Observe the colors and movement"],
    },
  },

  // 61. Historical Document (uses config.imageUrl + config.analysisPrompts)
  {
    taskType: "historical-doc",
    title: "Historical Document",
    prompt: "Examine this historical document and analyze its significance.",
    config: {
      // Local bundled asset (see art-view note) — guaranteed to render.
      imageUrl: "/demo-images/emancipation-proclamation.svg",
      docTitle: "The Emancipation Proclamation",
      docAuthor: "Abraham Lincoln",
      docYear: "1863",
      imageDescription: "The Emancipation Proclamation, issued by President Abraham Lincoln on January 1, 1863, declaring enslaved people in the Confederate states to be free.",
      historicalContext: "Issued during the Civil War, the Emancipation Proclamation reframed the war as a fight against slavery and paved the way for the 13th Amendment.",
      viewingSeconds: 40,
      responseSeconds: 90,
      analysisPrompts: [
        "What symbols or images do you notice on this coin?",
        "Why do you think Lincoln was chosen for this honor?",
        "What does this tell us about American values at the time?",
      ],
    },
  },

  // ── PEER EDITING (on-screen) ──
  {
    taskType: "peer-editing",
    title: "Peer Edit: Photosynthesis Paragraph",
    prompt: "Read this paragraph written by a classmate. Tap each word that has an error, then fix it.",
    passage: "Photosynthesis is the proccess by which plants converts sunlight into energey. The leafs absorb carbon dioxide from the air and water from the soil. Inside the chloroplast, light energy is used to brake apart water molecules. Oxygen is than released as a byproduct, and glucose is produced four the plant to use as food.",
    mode: "on-screen",
    errors: [
      { wordIndex: 3, type: "typo", correct: "process" },
      { wordIndex: 7, type: "grammar", correct: "convert" },
      { wordIndex: 10, type: "typo", correct: "energy" },
      { wordIndex: 12, type: "typo", correct: "leaves" },
      { wordIndex: 32, type: "typo", correct: "break" },
      { wordIndex: 38, type: "grammar", correct: "then" },
      { wordIndex: 47, type: "typo", correct: "for" },
    ],
  },

  // ── PEER EDITING (timed — inter-team race) ──
  {
    taskType: "peer-editing",
    title: "Speed Edit: History Essay",
    prompt: "Race the clock! Find and fix as many errors as you can in 3 minutes.",
    passage: "The Rennaissance began in Itally during the 14th century and spreaded across Europe. Artists like Leonardo da Vinci and Michelangelo creates masterpieces that still inspires people today. The period was marked by a renewed intrest in classical Greek and Roman culture. Many importent discoveries in science and art was made during this era, changing the corse of history forever.",
    mode: "timed",
    errors: [
      { wordIndex: 1, type: "typo", correct: "Renaissance" },
      { wordIndex: 4, type: "typo", correct: "Italy" },
      { wordIndex: 10, type: "grammar", correct: "spread" },
      { wordIndex: 20, type: "grammar", correct: "created" },
      { wordIndex: 24, type: "grammar", correct: "inspire" },
      { wordIndex: 34, type: "typo", correct: "interest" },
      { wordIndex: 42, type: "typo", correct: "important" },
      { wordIndex: 48, type: "grammar", correct: "were" },
      { wordIndex: 55, type: "typo", correct: "course" },
    ],
  },

  // ── PEER EDITING (paper mode) ──
  {
    taskType: "peer-editing",
    title: "Peer Edit: Water Cycle (Paper)",
    prompt: "Read the paragraph below, then write your corrections on paper and snap a photo.",
    passage: "Water evaporates form the ocean and rises into the atmosfere. As it cools, it condences into tiny dropplets that form clouds. When the clouds becomes to heavy, precipitation falls as rain or snow. The water then flowes back into rivers and lakes, completeing the cycle all over again.",
    mode: "paper",
    errors: [
      { wordIndex: 2, type: "typo", correct: "from" },
      { wordIndex: 9, type: "typo", correct: "atmosphere" },
      { wordIndex: 14, type: "typo", correct: "condenses" },
      { wordIndex: 17, type: "typo", correct: "droplets" },
      { wordIndex: 24, type: "grammar", correct: "become" },
      { wordIndex: 25, type: "grammar", correct: "too" },
      { wordIndex: 36, type: "typo", correct: "flows" },
      { wordIndex: 42, type: "typo", correct: "completing" },
    ],
  },
  // =========================================================================
  // INTERVIEW (live AI conversation)
  // =========================================================================

  // ── INTERVIEW (history — ancient world) ──
  {
    taskType: "interview",
    title: "Interview a Historical Figure",
    prompt: "Choose a famous figure from the ancient world and ask them about their life and achievements.",
    minTurns: 3,
    maxTurns: 5,
    candidates: [
      {
        name: "Cleopatra VII",
        era: "Ancient Egypt, 69–30 BCE",
        description: "The last active ruler of the Ptolemaic Kingdom of Egypt, known for her intelligence, political alliances, and legendary charisma.",
        greeting: "Welcome, young scholar. I am Cleopatra, Queen of Egypt. I have ruled alongside Rome's most powerful men and kept my kingdom alive through wit and diplomacy. What would you like to know?",
        systemPrompt: "You are Cleopatra VII, the last pharaoh of Egypt. You are proud, highly educated (you speak nine languages), and politically shrewd. You reference your alliances with Julius Caesar and Mark Antony, your efforts to preserve Egyptian independence, and your knowledge of science and philosophy. Speak with regal confidence but warmth toward students.",
      },
      {
        name: "Leonardo da Vinci",
        era: "Renaissance Italy, 1452–1519",
        description: "A true Renaissance polymath — painter, inventor, scientist, and engineer whose curiosity knew no bounds.",
        greeting: "Ah, buongiorno! I am Leonardo, from the little town of Vinci. I have spent my life sketching, building, and wondering why birds can fly but men cannot. Ask me anything — I love a good question!",
        systemPrompt: "You are Leonardo da Vinci, the Renaissance polymath. You are endlessly curious, warm, and enthusiastic about every subject — art, anatomy, engineering, flight, water, optics. Reference your paintings (Mona Lisa, Last Supper), your inventions, your notebooks. You often answer questions with more questions because curiosity is your greatest trait.",
      },
      {
        name: "Harriet Tubman",
        era: "United States, 1822–1913",
        description: "An escaped enslaved woman who became the most famous conductor of the Underground Railroad, leading dozens to freedom.",
        greeting: "I'm Harriet Tubman. Some folks called me Moses. I led over 70 people to freedom and never lost a single one. What do you want to know about the road to liberty?",
        systemPrompt: "You are Harriet Tubman. You speak plainly and with deep conviction. Reference your escape from slavery, your many trips on the Underground Railroad, your work as a Union spy during the Civil War, and your later activism for women's suffrage. You are brave, practical, and guided by faith. Keep language accessible for students.",
      },
    ],
  },

  // ── INTERVIEW (science — modern pioneers) ──
  {
    taskType: "interview",
    title: "Meet a Science Pioneer",
    prompt: "Interview a groundbreaking scientist about their discoveries and what drives them.",
    minTurns: 3,
    maxTurns: 5,
    candidates: [
      {
        name: "Marie Curie",
        era: "Poland/France, 1867–1934",
        description: "The first woman to win a Nobel Prize, and the only person to win Nobel Prizes in two different sciences — physics and chemistry.",
        greeting: "Bonjour! I am Marie Curie. My husband Pierre and I spent long hours in our laboratory discovering the secrets of radioactivity. What would you like to ask me?",
        systemPrompt: "You are Marie Curie. You are modest, fiercely dedicated to science, and passionate about education. Reference your discovery of radium and polonium, your Nobel Prizes, the challenges you faced as a woman in science, and your belief that science should serve humanity. Speak with warmth and a slight formality.",
      },
      {
        name: "Albert Einstein",
        era: "Germany/United States, 1879–1955",
        description: "Theoretical physicist who developed the theory of relativity and won the Nobel Prize in Physics for his work on the photoelectric effect.",
        greeting: "Hello there! I am Albert Einstein. People think I am very smart, but really I am just very curious. Imagination is more important than knowledge, you know. What shall we discuss?",
        systemPrompt: "You are Albert Einstein. You are playful, philosophical, and love thought experiments. Reference relativity, E=mc², your early struggles in school, your time as a patent clerk, and your views on imagination and creativity. You enjoy humor and often use simple analogies to explain complex ideas.",
      },
    ],
  },
  // =========================================================================
  // CLOZE (fill-in-the-blank)
  // =========================================================================

  // ── CLOZE (science — no distractors, younger students) ──
  {
    taskType: "cloze",
    title: "Water Cycle Blanks",
    prompt: "Drag the correct words into the blanks to complete the passage about the water cycle.",
    passage: "Water from oceans and lakes is heated by the ___ and turns into water vapor through a process called ___. The vapor rises into the atmosphere and cools, forming ___ in a process called condensation. When the clouds become heavy, water falls back to Earth as ___. This water collects in rivers and ___, and the cycle begins again.",
    blanks: [
      { answer: "Sun" },
      { answer: "evaporation" },
      { answer: "clouds" },
      { answer: "precipitation" },
      { answer: "oceans" },
    ],
    distractors: [],
  },

  // ── CLOZE (history — with distractors, older students) ──
  {
    taskType: "cloze",
    title: "American Revolution Blanks",
    prompt: "Fill in the blanks to complete this passage about the American Revolution.",
    passage: "The American Revolution began in ___ when colonists grew frustrated with British ___. The famous protest known as the Boston ___ Party showed colonial anger over taxation without ___. In 1776, Thomas ___ drafted the Declaration of Independence, declaring the colonies free from British rule. General George ___ led the Continental Army through harsh winters and decisive ___. The war officially ended with the Treaty of ___ in 1783.",
    blanks: [
      { answer: "1775" },
      { answer: "taxation" },
      { answer: "Tea" },
      { answer: "representation" },
      { answer: "Jefferson" },
      { answer: "Washington" },
      { answer: "battles" },
      { answer: "Paris" },
    ],
    distractors: ["London", "Adams", "1812"],
  },

  // ── TEACH-BACK ──
  {
    taskType: "teach-back",
    title: "Teach: The Water Cycle",
    prompt: "Explain these concepts as if teaching a 2nd grader. Use simple words and real-world examples!",
    concepts: ["evaporation", "condensation", "precipitation", "collection"],
    targetAge: "a 2nd grader",
    config: { rubric: "Award points for clear, accurate, age-appropriate explanations that build on teammates' contributions." },
    priorEntries: [
      {
        playerName: "Alex",
        explanation: "Evaporation is when water gets really hot from the sun and turns into steam that goes up into the sky. Like when you see steam coming off a puddle on a hot day!",
        score: 15,
      },
    ],
  },
  {
    taskType: "teach-back",
    title: "Teach: Parts of a Plant",
    prompt: "Explain these plant parts as if teaching a kindergartner. Make it fun and simple!",
    concepts: ["roots", "stem", "leaves", "flower", "seeds"],
    targetAge: "a kindergartner",
    config: { rubric: "Award points for simple, accurate explanations with relatable analogies." },
    priorEntries: [],
  },
];

export default DEMO_TASKS;
