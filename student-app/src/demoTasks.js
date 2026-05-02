// student-app/src/demoTasks.js
//
// Sample task data for the Conference Demo Mode.
// Each task is shaped exactly like what TaskRunner expects.
// Content is fun, conference-appropriate, and subject-neutral.

const DEMO_TASKS = [
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

  // 2. True/False
  {
    taskType: "true-false",
    title: "True or False?",
    prompt: "Test your knowledge!",
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

  // 4. Sort
  {
    taskType: "sort",
    title: "Sort It Out",
    prompt: "Drag items into the correct category.",
    categories: ["Fruits", "Vegetables"],
    items: [
      { text: "Tomato", category: "Fruits" },
      { text: "Carrot", category: "Vegetables" },
      { text: "Avocado", category: "Fruits" },
      { text: "Broccoli", category: "Vegetables" },
      { text: "Banana", category: "Fruits" },
      { text: "Spinach", category: "Vegetables" },
    ],
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

  // 7. Flashcards
  {
    taskType: "flashcards",
    title: "Flip & Learn",
    prompt: "Tap to flip each card!",
    cards: [
      { question: "What is the capital of Japan?", answer: "Tokyo" },
      { question: "How many continents are there?", answer: "7" },
      { question: "What gas do plants absorb?", answer: "Carbon dioxide (CO₂)" },
      { question: "Who painted the Mona Lisa?", answer: "Leonardo da Vinci" },
    ],
  },

  // 8. Flashcards Race
  {
    taskType: "flashcards-race",
    title: "Speed Round!",
    prompt: "Race to answer as fast as you can!",
    cards: [
      { question: "7 × 8 = ?", answer: "56" },
      { question: "Capital of France?", answer: "Paris" },
      { question: "Largest ocean?", answer: "Pacific" },
      { question: "H₂O is the formula for?", answer: "Water" },
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

  // 10. VennSort
  {
    taskType: "vennsort",
    title: "Venn Diagram",
    prompt: "Sort items into the correct region.",
    config: {
      leftLabel: "Can Fly",
      rightLabel: "Has Legs",
      items: [
        { text: "Eagle", zone: "both" },
        { text: "Snake", zone: "neither" },
        { text: "Airplane", zone: "left" },
        { text: "Spider", zone: "right" },
        { text: "Bat", zone: "both" },
        { text: "Fish", zone: "neither" },
      ],
    },
  },

  // 11. Brain Blitz (Jeopardy-style)
  {
    taskType: "brain-blitz",
    title: "Brain Blitz!",
    prompt: "Answer the clues!",
    config: {
      categories: [
        {
          name: "Science",
          clues: [
            { clue: "This force keeps you on the ground.", answer: "Gravity", points: 100 },
            { clue: "The closest star to Earth.", answer: "The Sun", points: 200 },
          ],
        },
        {
          name: "Geography",
          clues: [
            { clue: "The largest desert in the world.", answer: "Sahara", points: 100 },
            { clue: "The longest river in the world.", answer: "Nile", points: 200 },
          ],
        },
      ],
    },
  },

  // 12. Open Text
  {
    taskType: "open-text",
    title: "Share Your Thoughts",
    prompt: "What's one thing you'd like to see AI do for education in the next 5 years?",
  },

  // 13. Hangman Duel
  {
    taskType: "hangman-duel",
    title: "Hangman Duel",
    prompt: "Guess the word before your opponent!",
    config: {
      word: "CURRICULUM",
      hint: "A plan for teaching and learning",
      maxGuesses: 8,
    },
  },

  // 14. Speed Draw
  {
    taskType: "speed-draw",
    title: "Speed Draw",
    prompt: "Draw the prompt as fast as you can!",
    config: {
      drawPrompt: "A robot teaching a class",
      timeLimit: 45,
    },
  },

  // 15. Pet Feeding
  {
    taskType: "pet-feeding",
    title: "Feed the Pet!",
    prompt: "Answer correctly to feed the hungry pet!",
    config: {
      petName: "Pixel",
      petEmoji: "🐱",
      questions: [
        { question: "What planet is known as the Red Planet?", answer: "Mars", options: ["Mars", "Venus", "Jupiter", "Mercury"] },
        { question: "How many bones does an adult human have?", answer: "206", options: ["206", "300", "180", "250"] },
        { question: "What is the hardest natural substance?", answer: "Diamond", options: ["Diamond", "Gold", "Iron", "Quartz"] },
      ],
    },
  },

  // 16. Spinner
  {
    taskType: "spinner",
    title: "Spin the Wheel!",
    prompt: "Spin and see what you land on!",
    config: {
      segments: [
        "Tell a fun fact",
        "Do 5 jumping jacks",
        "Name 3 capitals",
        "Sing a line of a song",
        "Share a compliment",
        "Draw something in 10 seconds",
      ],
    },
  },

  // 17. Trivia
  {
    taskType: "trivia",
    title: "Trivia Time",
    prompt: "Test your general knowledge!",
    items: [
      { question: "In what year did the Titanic sink?", answer: "1912", options: ["1905", "1912", "1920", "1898"] },
      { question: "What is the smallest country in the world?", answer: "Vatican City", options: ["Monaco", "Vatican City", "San Marino", "Liechtenstein"] },
    ],
  },

  // 18. Riddle
  {
    taskType: "riddle",
    title: "Riddle Me This",
    prompt: "Can you solve this riddle?",
    config: {
      riddle: "I have cities, but no houses live there. I have mountains, but no trees grow there. I have water, but no fish swim there. What am I?",
      answer: "A map",
    },
  },

  // 19. Tower Builder
  {
    taskType: "tower-builder",
    title: "Tower Builder",
    prompt: "Answer questions to build your tower higher!",
    config: {
      questions: [
        { question: "What comes after a trillion?", options: ["Quadrillion", "Billion", "Pentillion", "Zillion"], correct: 0 },
        { question: "Which animal can sleep for 3 years?", options: ["Snail", "Sloth", "Koala", "Cat"], correct: 0 },
        { question: "What is the most common letter in English?", options: ["E", "A", "T", "S"], correct: 0 },
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

  // 21. Diff Detective
  {
    taskType: "diff-detective",
    title: "Spot the Difference",
    prompt: "Find what changed between the two versions!",
    config: {
      original: "The quick brown fox jumps over the lazy dog.",
      modified: "The quick brown cat leaps over the sleepy dog.",
      differences: [
        { word: "fox", replacement: "cat" },
        { word: "jumps", replacement: "leaps" },
        { word: "lazy", replacement: "sleepy" },
      ],
    },
  },

  // 22. Echo Chain
  {
    taskType: "echo-chain",
    title: "Echo Chain",
    prompt: "Pass the idea along and build on it!",
    config: {
      starterPrompt: "Name one way technology has changed education...",
      rounds: 3,
      buildPrompt: "Now add to what the last person said!",
    },
  },

  // 23. Word Weaver Duel
  {
    taskType: "word-weaver-duel",
    title: "Word Weaver",
    prompt: "Build the longest word chain!",
    config: {
      startWord: "LEARN",
      rules: "Each new word must start with the last letter of the previous word.",
      timeLimit: 30,
    },
  },

  // 24. Body Break
  {
    taskType: "body-break",
    title: "Body Break!",
    prompt: "Time to move!",
    config: {
      activity: "Stand up and do 10 jumping jacks, then touch your toes 5 times!",
      duration: 30,
    },
  },

  // 25. Mind Mapper
  {
    taskType: "mind-mapper",
    title: "Mind Map",
    prompt: "Build a mind map around the central idea.",
    config: {
      centralIdea: "Future of Education",
      branches: ["AI Tools", "Student Voice", "Movement", "Collaboration"],
    },
  },
];

export default DEMO_TASKS;
