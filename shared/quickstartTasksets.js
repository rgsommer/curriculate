// shared/quickstartTasksets.js
//
// One-click onboarding presets — the "launch a ready-made game" on-ramp.
// A matrix of hand-curated 8-task sets spanning four grade bands (K-2,
// 3-5, 6-8, 9-12) × four core subjects (Science, English, Math, Social
// Studies / History). Teachers pick a band, then a subject card, and
// launch instantly — no topic typing, no AI wait, no generation cost.
//
// ── Why builders (mc/sortTask/sequence/…) instead of raw literals ──
// Every task here must clear the SERVE-TIME PLAYABILITY GATE
// (shared/taskPlayability.js → assessTaskPlayability), which runs on the
// RAW task in backend/socket/roomEngine.js#sendTaskToTeam. A task that
// fails the gate is silently skipped mid-session — the exact opposite of
// the "100% success, nothing malformed" experience this on-ramp promises.
//
// The gate is strict about shape:
//   • multiple-choice → items[].options (≥2) + integer correctIndex
//   • sort            → config.categories (≥2) + config.items (≥4) + a
//                       correctAnswer OBJECT mapping (renderer scores off
//                       item.bucketIndex; the map is the gate's receipt)
//   • sequence        → items (≥4) + a truthy correctOrder
//   • brain-spark     → bullets (≥3)
//
// Hand-writing those shapes 128× is how malformed tasks creep in. The
// builders below emit the gate-passing shape BY CONSTRUCTION, so authors
// only supply content. backend/tests/validate-quickstart.mjs runs the
// gate over every task and fails CI if any set regresses.

/* ────────────────────────── Task builders ────────────────────────── */

// Always-playable opener. Reads the room before the game starts.
const moodCheckin = (
  prompt = "Tap the face that shows how you feel today. There are no wrong answers!"
) => ({ taskType: "mood-checkin", title: "How are you feeling?", prompt });

// Quick teach card. `bullets` is what the renderer AND the gate read.
const brainSpark = (title, prompt, bullets) => ({
  taskType: "brain-spark-notes",
  title,
  prompt,
  bullets,
});

// items: [ [question, [option, option, ...], correctIndex], ... ]
const mc = (title, prompt, items) => ({
  taskType: "multiple-choice",
  title,
  prompt,
  items: items.map(([question, options, correctIndex]) => ({
    prompt: question,
    options,
    correctIndex,
  })),
});

// items: [ [statement, isTrue], ... ]
const trueFalse = (title, prompt, items) => ({
  taskType: "true-false",
  title,
  prompt,
  items: items.map(([statement, correct]) => ({ statement, correct })),
});

// items: [ [question, answer, [acceptable...]], ... ]  (AI-scored)
const shortAnswer = (title, prompt, items) => ({
  taskType: "short-answer",
  title,
  prompt,
  items: items.map(([question, answer, acceptable = []]) => ({
    prompt: question,
    answer,
    correctAnswer: answer,
    acceptableAnswers: acceptable,
  })),
});

// categories: ["A","B"]   items: [ [text, bucketIndex], ... ] (≥4)
// Renderer scores off item.bucketIndex; we also emit a correctAnswer map
// (text → category name) purely to satisfy the gate.
const sortTask = (title, prompt, categories, items) => {
  const built = items.map(([text, bucketIndex]) => ({ text, bucketIndex }));
  const correctAnswer = {};
  for (const it of built) correctAnswer[it.text] = categories[it.bucketIndex];
  return {
    taskType: "sort",
    title,
    prompt,
    config: { categories, items: built },
    correctAnswer,
  };
};

// orderedItems: array of strings IN CORRECT ORDER (≥4). The renderer
// shuffles for play and scores against array order; correctOrder is
// emitted so the gate sees an explicit order key.
const sequence = (title, prompt, orderedItems) => ({
  taskType: "sequence",
  title,
  prompt,
  items: orderedItems.map((text, i) => ({ text, order: i + 1 })),
  correctOrder: orderedItems.map((_, i) => i),
});

// Light comic-relief closer. config.riddle + config.answer clear the gate.
const riddle = (title, prompt, pairs) => {
  const first = pairs[0] || ["", ""];
  return {
    taskType: "riddle",
    title,
    prompt,
    config: {
      riddles: pairs.map(([text, answer]) => ({ text, answer })),
      riddle: first[0],
      answer: first[1],
    },
  };
};

// Movement brain-break. Never filtered (not in MOVEMENT_REQUIRED_TYPES);
// passes the gate on title+prompt alone.
const bodyBreak = (title, prompt, steps, totalSeconds = 60) => ({
  taskType: "body-break",
  title,
  prompt,
  config: { steps, totalSeconds },
});

const drawIt = (title, prompt) => ({ taskType: "draw", title, prompt });

/* ────────────────────────── The presets ──────────────────────────── */

export const QUICKSTART_TASKSETS = {
  /* ==================================================================
   * K-2
   * ================================================================== */

  "k2-science-living-things": {
    key: "k2-science-living-things",
    title: "Living vs Non-living",
    subject: "Science",
    gradeBand: "K-2",
    gradeLevel: 2,
    topic: "What makes something alive",
    summary:
      "Spot living things, name what they need, and sort everyday objects into living and non-living. Eight short tasks for our youngest scientists.",
    estimatedMinutes: 18,
    tasks: [
      moodCheckin("Tap the face that shows how you feel today!"),
      brainSpark("Quick Notes: What's Alive?", "Read these together before we play.", [
        "Living things grow, need food and water, and can make more of themselves.",
        "Animals, plants, and people are all living things.",
        "Non-living things — like rocks, toys, and cars — do not grow or need food.",
        "If it breathes, eats, or grows, it's alive!",
      ]),
      mc("Spot the Living Thing", "Pick the living thing in each question.", [
        ["Which one is alive?", ["A rock", "A tree", "A pencil", "A backpack"], 1],
        ["Which one grows?", ["A car", "A puppy", "A spoon", "A balloon"], 1],
        ["Which one needs water to live?", ["A robot", "A flower", "A toy block", "A brick"], 1],
      ]),
      sortTask(
        "Sort: Living or Not?",
        "Drag each thing into the right group.",
        ["Living", "Not Living"],
        [
          ["🌳 Tree", 0], ["🪨 Rock", 1], ["🐠 Fish", 0], ["🚗 Car", 1],
          ["🌼 Flower", 0], ["📚 Book", 1], ["🐝 Bee", 0], ["⚽ Ball", 1],
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if the sentence is right.", [
        ["All living things need food and water.", true],
        ["Rocks grow bigger by eating.", false],
        ["A dog is a living thing.", true],
        ["A teddy bear is alive.", false],
      ]),
      bodyBreak("Move Like an Animal!", "Stand up and act it out!", [
        { text: "Hop like a bunny 5 times", icon: "🐰" },
        { text: "Wiggle like a fish for 10 seconds", icon: "🐟" },
        { text: "Flap your arms like a bird", icon: "🐦" },
        { text: "Stretch tall like a sunflower growing", icon: "🌻" },
      ]),
      shortAnswer("What Do Living Things Need?", "Answer in one or two words.", [
        ["Name one thing all living things need to stay alive.", "Water", ["water", "food", "air", "sunlight", "shelter"]],
        ["Where does a fish live?", "Water", ["water", "ocean", "lake", "river", "pond", "sea", "aquarium"]],
      ]),
      drawIt("Draw a Living Thing", "Draw an animal or plant you like. Then show your team!"),
    ],
  },

  "k2-english-rhyming-sounds": {
    key: "k2-english-rhyming-sounds",
    title: "Rhyming & Sounds",
    subject: "English",
    gradeBand: "K-2",
    gradeLevel: 1,
    topic: "Rhyming words and beginning sounds",
    summary:
      "Hear the rhyme, catch the first sound, and sort words that sound the same. A playful phonics warm-up for early readers.",
    estimatedMinutes: 16,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about reading today!"),
      brainSpark("Quick Notes: Rhymes", "Say these out loud together.", [
        "Words rhyme when they end with the same sound: cat, hat, bat.",
        "Listen to the END of the word to hear a rhyme.",
        "The beginning sound is the FIRST sound you hear: 'sun' starts with /s/.",
        "Reading is easier when we listen for sounds!",
      ]),
      mc("Which Word Rhymes?", "Pick the word that rhymes.", [
        ["Which word rhymes with CAT?", ["Dog", "Hat", "Sun", "Cup"], 1],
        ["Which word rhymes with BIG?", ["Pig", "Tree", "Car", "Ball"], 0],
        ["Which word rhymes with STAR?", ["Moon", "Car", "Fish", "Book"], 1],
      ]),
      sortTask(
        "Sort by First Sound",
        "Which sound does each word start with?",
        ["Starts with S", "Starts with B"],
        [
          ["🌞 Sun", 0], ["🏀 Ball", 1], ["🧦 Sock", 0], ["🐻 Bear", 1],
          ["🐍 Snake", 0], ["🚌 Bus", 1], ["⭐ Star", 0], ["🍌 Banana", 1],
        ]
      ),
      trueFalse("Do They Rhyme?", "Tap TRUE if the two words rhyme.", [
        ["'Frog' and 'log' rhyme.", true],
        ["'Cake' and 'fish' rhyme.", false],
        ["'Bee' and 'tree' rhyme.", true],
        ["'Moon' and 'ball' rhyme.", false],
      ]),
      bodyBreak("Sound It Out & Move!", "Stand up and make the sound!", [
        { text: "Buzz like a Bee — /b/ /b/ /b/", icon: "🐝" },
        { text: "Slither like a Snake — /s/ /s/ /s/", icon: "🐍" },
        { text: "Tick like a clock — /t/ /t/ /t/", icon: "⏰" },
        { text: "Clap once for every sound in your name", icon: "👏" },
      ]),
      shortAnswer("Make a Rhyme", "Type one word that rhymes.", [
        ["Type a word that rhymes with DOG.", "log", ["log", "frog", "hog", "jog", "fog", "cog", "bog"]],
        ["Type a word that rhymes with SUN.", "run", ["run", "fun", "bun", "gun", "one", "won", "ton", "none"]],
      ]),
      drawIt("Draw a Rhyme", "Draw two things that rhyme — like a cat and a hat!"),
    ],
  },

  "k2-math-shapes-patterns": {
    key: "k2-math-shapes-patterns",
    title: "Shapes, Counting & Patterns",
    subject: "Math",
    gradeBand: "K-2",
    gradeLevel: 1,
    topic: "Shapes, counting, and simple patterns",
    summary:
      "Name the shapes, count to ten, put numbers in order, and finish a pattern. Hands-on number sense for K-2 mathematicians.",
    estimatedMinutes: 16,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about math today!"),
      brainSpark("Quick Notes: Shapes & Patterns", "Look at these together.", [
        "A circle is round. A triangle has 3 sides. A square has 4 equal sides.",
        "A pattern repeats — like red, blue, red, blue…",
        "Counting up: 1, 2, 3, 4, 5…",
        "We can find shapes and patterns everywhere!",
      ]),
      mc("Name That Shape", "Pick the right answer.", [
        ["How many sides does a triangle have?", ["2", "3", "4", "5"], 1],
        ["Which shape is perfectly round?", ["Square", "Triangle", "Circle", "Rectangle"], 2],
        ["How many corners does a square have?", ["3", "4", "5", "6"], 1],
      ]),
      sequence("Count in Order", "Put these numbers in order from smallest to biggest.", [
        "1", "2", "3", "4", "5",
      ]),
      trueFalse("Math True or False?", "Tap TRUE if it's right.", [
        ["A triangle has three sides.", true],
        ["Two plus two makes five.", false],
        ["A circle has no corners.", true],
        ["Ten is smaller than five.", false],
      ]),
      bodyBreak("Count & Move!", "Stand up and count with your body!", [
        { text: "Jump 5 times and count out loud", icon: "🦘" },
        { text: "Clap your hands 3 times", icon: "👏" },
        { text: "Stomp your feet 4 times", icon: "🦶" },
        { text: "Spin around 2 times", icon: "🌀" },
      ]),
      shortAnswer("Finish the Pattern", "Type what comes next.", [
        ["Red, Blue, Red, Blue, ___ ? Type the colour.", "Red", ["red"]],
        ["What comes next: 2, 4, 6, ___ ?", "8", ["8", "eight"]],
      ]),
      sortTask(
        "Sort: Shapes vs Numbers",
        "Drag each one into the right box.",
        ["Shapes", "Numbers"],
        [
          ["🔺 Triangle", 0], ["7", 1], ["⭕ Circle", 0], ["3", 1],
          ["⬜ Square", 0], ["9", 1], ["▬ Rectangle", 0], ["5", 1],
        ]
      ),
    ],
  },

  "k2-social-community-helpers": {
    key: "k2-social-community-helpers",
    title: "Community Helpers",
    subject: "Social Studies",
    gradeBand: "K-2",
    gradeLevel: 2,
    topic: "People who help in our community",
    summary:
      "Meet the helpers who keep a community running, match them to their tools, and learn how we all pitch in. A friendly citizenship starter.",
    estimatedMinutes: 16,
    tasks: [
      moodCheckin("Tap the face that shows how you feel today!"),
      brainSpark("Quick Notes: Our Helpers", "Read these together.", [
        "A community is a place where people live, work, and help each other.",
        "Community helpers do important jobs — doctors, firefighters, teachers, and more.",
        "Each helper uses special tools to do their job.",
        "We can be helpers too by being kind and sharing!",
      ]),
      mc("Who Does This Job?", "Pick the right helper.", [
        ["Who helps you when you are sick?", ["A pilot", "A doctor", "A chef", "A farmer"], 1],
        ["Who puts out fires?", ["A firefighter", "A teacher", "A baker", "A painter"], 0],
        ["Who helps you learn at school?", ["A dentist", "A teacher", "A plumber", "A driver"], 1],
      ]),
      sortTask(
        "Sort: Helper or Tool?",
        "Drag each card into the right group.",
        ["Community Helper", "A Tool They Use"],
        [
          ["👩‍⚕️ Doctor", 0], ["🚒 Fire truck", 1], ["👨‍🚒 Firefighter", 0], ["🩺 Stethoscope", 1],
          ["👮 Police officer", 0], ["✏️ Pencil", 1], ["👩‍🏫 Teacher", 0], ["🚑 Ambulance", 1],
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if it's right.", [
        ["A firefighter helps put out fires.", true],
        ["A dentist flies airplanes.", false],
        ["Nurses help take care of sick people.", true],
        ["A mail carrier bakes bread.", false],
      ]),
      bodyBreak("Act Like a Helper!", "Stand up and act it out!", [
        { text: "Drive a fire truck — steer and say 'wee-oo!'", icon: "🚒" },
        { text: "Wave like a crossing guard", icon: "🛑" },
        { text: "Stir a big pot like a chef", icon: "👨‍🍳" },
        { text: "Type on a keyboard like an office helper", icon: "⌨️" },
      ]),
      shortAnswer("Name a Helper", "Answer in a few words.", [
        ["Name one community helper who works at a hospital.", "Doctor", ["doctor", "nurse", "surgeon", "paramedic"]],
        ["Who delivers letters and packages to your home?", "Mail carrier", ["mail carrier", "mailman", "postal worker", "mail person", "postman"]],
      ]),
      drawIt("Draw a Helper", "Draw a community helper you would like to be. Show your team!"),
    ],
  },

  /* ==================================================================
   * 3-5
   * ================================================================== */

  "g35-english-figurative-language": {
    key: "g35-english-figurative-language",
    title: "Similes & Metaphors",
    subject: "English",
    gradeBand: "3-5",
    gradeLevel: 4,
    topic: "Figurative language",
    summary:
      "Tell similes from metaphors, spot them in real sentences, and write your own. Eight tasks that make figurative language click.",
    estimatedMinutes: 18,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about writing today!"),
      brainSpark("Quick Notes: Similes vs Metaphors", "Read before you play.", [
        "A simile compares two things using 'like' or 'as': 'brave as a lion.'",
        "A metaphor says one thing IS another: 'the classroom was a zoo.'",
        "Both help writing paint a picture in the reader's mind.",
        "Trick: if you see 'like' or 'as', it's a simile.",
      ]),
      mc("Simile or Metaphor?", "Choose the best answer.", [
        ["'Her smile was as bright as the sun' is a…", ["Simile", "Metaphor", "Neither", "Rhyme"], 0],
        ["'Time is a thief' is a…", ["Simile", "Metaphor", "Neither", "Question"], 1],
        ["Which sentence is a simile?", ["He is a rock.", "The wind is a wolf.", "She runs like the wind.", "Life is a journey."], 2],
      ]),
      trueFalse("True or False?", "Tap TRUE if the statement is right.", [
        ["A simile uses the words 'like' or 'as'.", true],
        ["A metaphor always uses the word 'like'.", false],
        ["'The stars were diamonds' is a metaphor.", true],
        ["Figurative language means saying exactly what you mean.", false],
      ]),
      sortTask(
        "Sort: Simile or Metaphor",
        "Drag each sentence into the right group.",
        ["Simile", "Metaphor"],
        [
          ["Quiet as a mouse", 0],
          ["The world is a stage", 1],
          ["Cold like ice", 0],
          ["Her heart is stone", 1],
          ["Busy as a bee", 0],
          ["He is a night owl", 1],
        ]
      ),
      sequence(
        "Build a Better Sentence",
        "Put the words in order to make a simile.",
        ["The", "puppy", "was", "as", "fluffy", "as", "a", "cloud"]
      ),
      shortAnswer("Write Your Own", "Type a full sentence.", [
        ["Finish this simile: 'The pizza was as hot as ____.'", "fire", ["fire", "lava", "the sun", "an oven"]],
        ["Write a metaphor about the moon (say the moon IS something).", "The moon is a lantern", []],
      ]),
      mc("Spot the Meaning", "What does the figurative language mean?", [
        ["'The test was a breeze' means the test was…", ["Very hard", "Very easy", "Windy", "Cancelled"], 1],
        ["'She has a heart of gold' means she is…", ["Rich", "Very kind", "Wearing jewelry", "Cold"], 1],
        ["'He's a couch potato' means he…", ["Loves potatoes", "Is very active", "Sits around a lot", "Is a farmer"], 2],
      ]),
      riddle("Riddle Break", "Can you guess it?", [
        ["I'm a comparison that uses 'like' or 'as.' What am I?", "A simile"],
        ["I say one thing IS another, with no 'like' or 'as.' What am I?", "A metaphor"],
      ]),
    ],
  },

  "g35-science-states-of-matter": {
    key: "g35-science-states-of-matter",
    title: "States of Matter",
    subject: "Science",
    gradeBand: "3-5",
    gradeLevel: 4,
    topic: "Solids, liquids, and gases",
    summary:
      "Sort solids, liquids, and gases, follow water as it melts and boils, and explain how matter changes. A hands-on matter unit in eight tasks.",
    estimatedMinutes: 18,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about science today!"),
      brainSpark("Quick Notes: States of Matter", "Read before you play.", [
        "Matter comes in three main states: solid, liquid, and gas.",
        "Solids keep their shape. Liquids flow and take the shape of their container. Gases spread out to fill any space.",
        "Heat can change matter: ice (solid) melts into water (liquid) and boils into steam (gas).",
        "Cooling reverses it: steam cools to water, water freezes to ice.",
      ]),
      mc("Solid, Liquid, or Gas?", "Choose the best answer.", [
        ["Which one is a liquid?", ["A brick", "Milk", "The air", "A rock"], 1],
        ["Which state keeps its own shape?", ["Solid", "Liquid", "Gas", "None of them"], 0],
        ["When ice melts, it becomes a…", ["Gas", "Solid", "Liquid", "Powder"], 2],
      ]),
      sortTask(
        "Sort: Solid, Liquid, Gas",
        "Drag each thing into the right state of matter.",
        ["Solid", "Liquid", "Gas"],
        [
          ["🧊 Ice cube", 0], ["💧 Water", 1], ["💨 Steam", 2],
          ["🪵 Wood block", 0], ["🥤 Juice", 1], ["🎈 Air in a balloon", 2],
          ["🪨 Rock", 0], ["🍯 Honey", 1],
        ]
      ),
      sequence(
        "The Journey of Water",
        "Put the steps in order as ice heats up.",
        [
          "A solid ice cube sits in a pot",
          "The ice melts into liquid water",
          "The water gets hot and starts to bubble",
          "The water boils and turns into steam (gas)",
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if the statement is right.", [
        ["A gas spreads out to fill its container.", true],
        ["Liquids always keep the same shape.", false],
        ["Freezing turns a liquid into a solid.", true],
        ["Heating ice makes it colder.", false],
      ]),
      bodyBreak("Become the Matter!", "Stand up and move like matter!", [
        { text: "Solid: stand stiff and still, arms crossed", icon: "🧊" },
        { text: "Liquid: wiggle and flow slowly around your spot", icon: "💧" },
        { text: "Gas: wave your arms fast and bounce everywhere", icon: "💨" },
        { text: "Freeze back into a solid!", icon: "🥶" },
      ]),
      shortAnswer("Explain It", "Answer in a sentence.", [
        ["What is it called when a solid turns into a liquid?", "Melting", ["melting", "melt"]],
        ["Name one gas you breathe.", "Oxygen", ["oxygen", "air", "carbon dioxide", "nitrogen"]],
      ]),
      mc("Everyday Matter", "Pick the best answer.", [
        ["Steam on a bathroom mirror is water as a…", ["Solid", "Liquid", "Gas", "Metal"], 2],
        ["Which change makes water into ice?", ["Heating", "Cooling", "Stirring", "Shaking"], 1],
        ["A puddle drying up in the sun is water turning into…", ["Ice", "A gas (water vapour)", "A solid", "Nothing"], 1],
      ]),
    ],
  },

  "g35-math-fractions": {
    key: "g35-math-fractions",
    title: "Fractions",
    subject: "Math",
    gradeBand: "3-5",
    gradeLevel: 4,
    topic: "Understanding fractions",
    summary:
      "Read fractions, compare their size, order them on a line, and spot equivalents. Eight tasks that build real fraction sense.",
    estimatedMinutes: 18,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about math today!"),
      brainSpark("Quick Notes: Fractions", "Read before you play.", [
        "A fraction shows part of a whole, like 1/2 or 3/4.",
        "The bottom number (denominator) tells how many equal parts the whole is split into.",
        "The top number (numerator) tells how many parts you have.",
        "Bigger denominator = smaller pieces: 1/8 is smaller than 1/2.",
      ]),
      mc("Read the Fraction", "Choose the best answer.", [
        ["Which fraction means 'three out of four'?", ["4/3", "3/4", "1/4", "3/3"], 1],
        ["In the fraction 2/5, what is the denominator?", ["2", "5", "7", "10"], 1],
        ["Which is bigger?", ["1/2", "1/4", "1/8", "1/10"], 0],
      ]),
      sequence(
        "Order the Fractions",
        "Put these in order from smallest to largest.",
        ["1/8", "1/4", "1/2", "3/4", "1 whole"]
      ),
      trueFalse("Fraction True or False?", "Tap TRUE if it's right.", [
        ["1/2 is the same as 2/4.", true],
        ["1/4 is bigger than 1/2.", false],
        ["The numerator is the top number of a fraction.", true],
        ["3/3 is less than one whole.", false],
      ]),
      sortTask(
        "Sort: Bigger or Smaller than 1/2?",
        "Drag each fraction into the right group.",
        ["Less than 1/2", "More than 1/2"],
        [
          ["1/4", 0], ["3/4", 1], ["1/8", 0], ["2/3", 1],
          ["1/10", 0], ["5/6", 1], ["1/3", 0], ["7/8", 1],
        ]
      ),
      shortAnswer("Fraction Thinking", "Type your answer.", [
        ["If a pizza is cut into 8 equal slices and you eat 3, what fraction did you eat?", "3/8", ["3/8", "three eighths"]],
        ["What fraction is the same as 1/2 but has a denominator of 4?", "2/4", ["2/4", "two fourths"]],
      ]),
      mc("Fractions Around Us", "Pick the best answer.", [
        ["Half of a class of 20 students is…", ["5", "10", "15", "20"], 1],
        ["You colour 1/4 of a chocolate bar. How many parts are left?", ["1 of 4", "3 of 4", "4 of 4", "0"], 1],
        ["Which fraction equals one whole?", ["1/2", "2/3", "4/4", "3/5"], 2],
      ]),
      riddle("Fraction Riddle", "Can you guess it?", [
        ["I'm the top number of a fraction. I tell how many parts you have. What am I?", "The numerator"],
        ["Split a whole into two equal parts and take one. What fraction am I?", "One half"],
      ]),
    ],
  },

  "g35-social-map-skills": {
    key: "g35-social-map-skills",
    title: "Map Skills & Continents",
    subject: "Social Studies",
    gradeBand: "3-5",
    gradeLevel: 5,
    topic: "Reading maps and the seven continents",
    summary:
      "Use a compass rose, read a map key, name the continents and oceans, and place Canada on the globe. A world-geography warm-up in eight tasks.",
    estimatedMinutes: 18,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about exploring today!"),
      brainSpark("Quick Notes: Reading Maps", "Read before you play.", [
        "A compass rose shows directions: North, East, South, West.",
        "A map key (or legend) explains what the symbols mean.",
        "Earth has seven continents and five oceans.",
        "Canada is in North America — the second-largest country in the world.",
      ]),
      mc("Map Basics", "Choose the best answer.", [
        ["On a compass rose, which direction is opposite North?", ["East", "West", "South", "Up"], 2],
        ["What does a map key (legend) tell you?", ["The weather", "What the symbols mean", "The time", "Who drew the map"], 1],
        ["Which continent is Canada on?", ["Europe", "Asia", "North America", "Africa"], 2],
      ]),
      sortTask(
        "Sort: Continent or Ocean?",
        "Drag each name into the right group.",
        ["Continent", "Ocean"],
        [
          ["Africa", 0], ["Pacific", 1], ["Asia", 0], ["Atlantic", 1],
          ["Europe", 0], ["Indian", 1], ["Antarctica", 0], ["Arctic", 1],
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if it's right.", [
        ["There are seven continents on Earth.", true],
        ["The Pacific is a continent.", false],
        ["North means up on most maps.", true],
        ["Canada is the smallest country in the world.", false],
      ]),
      sequence(
        "Zoom Out",
        "Put these in order from smallest to largest.",
        ["Your school", "Your city", "Your province", "Canada", "The continent of North America"]
      ),
      shortAnswer("Name It", "Answer in a few words.", [
        ["Which direction is between North and East?", "Northeast", ["northeast", "north east", "ne"]],
        ["Name the largest ocean on Earth.", "Pacific", ["pacific", "pacific ocean"]],
      ]),
      mc("Which Continent?", "Pick the best answer.", [
        ["Which continent is the coldest and covered in ice?", ["Africa", "Antarctica", "Australia", "Asia"], 1],
        ["The Sahara Desert is on which continent?", ["Asia", "Europe", "Africa", "South America"], 2],
        ["Which is the largest continent?", ["Africa", "Asia", "Europe", "North America"], 1],
      ]),
      drawIt("Map Your Room", "Draw a simple map of your classroom. Add a compass rose showing North!"),
    ],
  },

  /* ==================================================================
   * 6-8
   * ================================================================== */

  "g68-history-war-of-1812": {
    key: "g68-history-war-of-1812",
    title: "The War of 1812",
    subject: "History",
    gradeBand: "6-8",
    gradeLevel: 7,
    topic: "Causes, key figures, and events of the War of 1812",
    summary:
      "Trace the causes, meet the key figures, and order the turning points of the war that helped shape Canada. Eight tasks for middle-years historians.",
    estimatedMinutes: 20,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about history today!"),
      brainSpark("Quick Background", "Read before you play.", [
        "The War of 1812 was fought between the United States and Britain (including its colonies in what is now Canada).",
        "Causes included trade restrictions, the seizure of American sailors, and American interest in expanding northward.",
        "Key figures: General Isaac Brock, the Shawnee leader Tecumseh, and Laura Secord.",
        "The war ended in 1815 with the Treaty of Ghent — and helped forge a Canadian identity.",
      ]),
      mc("Causes & Players", "Choose the best answer.", [
        ["The War of 1812 was mainly fought between the U.S. and…", ["France", "Britain", "Spain", "Russia"], 1],
        ["Which British general led the defence of Upper Canada?", ["Isaac Brock", "George Washington", "Napoleon", "James Wolfe"], 0],
        ["Which Indigenous leader allied with the British?", ["Sitting Bull", "Tecumseh", "Pontiac", "Crazy Horse"], 1],
      ]),
      trueFalse("True or False?", "Tap TRUE if the statement is right.", [
        ["Laura Secord walked far to warn the British of an American attack.", true],
        ["The War of 1812 was fought entirely at sea.", false],
        ["The Treaty of Ghent ended the war.", true],
        ["The United States successfully conquered Canada in the war.", false],
      ]),
      sequence(
        "Put the Events in Order",
        "Arrange these War of 1812 events from first to last.",
        [
          "The U.S. declares war on Britain (1812)",
          "General Brock and Tecumseh capture Detroit",
          "Brock dies at the Battle of Queenston Heights",
          "American forces burn York (now Toronto)",
          "The Treaty of Ghent ends the war (1815)",
        ]
      ),
      sortTask(
        "Sort: Which Side?",
        "Drag each figure to the side they fought for.",
        ["British / Canadian Side", "American Side"],
        [
          ["Isaac Brock", 0], ["James Madison", 1], ["Tecumseh", 0], ["William Hull", 1],
          ["Laura Secord", 0], ["Andrew Jackson", 1],
        ]
      ),
      shortAnswer("Explain in a Sentence", "Answer in a sentence or two.", [
        ["Name one cause of the War of 1812.", "Trade restrictions", ["trade", "impressment", "sailors", "expansion", "land", "shipping"]],
        ["Who was Laura Secord and why is she remembered?", "She warned the British of an American attack", ["warned", "warning", "spy", "message"]],
      ]),
      mc("Turning Points", "Pick the best answer.", [
        ["The burning of York later led the British to burn which American city?", ["New York", "Washington", "Boston", "Chicago"], 1],
        ["The War of 1812 is sometimes called a war that had…", ["A clear winner", "No real winner", "Only one battle", "No soldiers"], 1],
        ["Roughly when did the war end?", ["1776", "1815", "1867", "1900"], 1],
      ]),
      riddle("History Riddle", "Can you guess it?", [
        ["I walked nearly 30 km to warn of an attack, and now a chocolate brand bears my name. Who am I?", "Laura Secord"],
        ["I'm the 1815 treaty that ended the war. What am I?", "The Treaty of Ghent"],
      ]),
    ],
  },

  "g68-science-cells": {
    key: "g68-science-cells",
    title: "Cells & Body Systems",
    subject: "Science",
    gradeBand: "6-8",
    gradeLevel: 7,
    topic: "Cells, organs, and body systems",
    summary:
      "Build from cells to systems, match organs to their jobs, and trace how the body works together. Eight tasks for middle-years biologists.",
    estimatedMinutes: 20,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about science today!"),
      brainSpark("Quick Notes: From Cells to Systems", "Read before you play.", [
        "The cell is the basic unit of all living things.",
        "Cells group into tissues, tissues form organs, and organs work together as systems.",
        "The heart, lungs, brain, and stomach are all organs with specific jobs.",
        "Body systems (like the circulatory and respiratory systems) keep you alive by working together.",
      ]),
      mc("Cell & Body Basics", "Choose the best answer.", [
        ["What is the basic unit of all living things?", ["The atom", "The cell", "The organ", "The tissue"], 1],
        ["Which organ pumps blood around your body?", ["Lungs", "Heart", "Brain", "Liver"], 1],
        ["Which system carries oxygen from the air into your blood?", ["Digestive", "Respiratory", "Nervous", "Skeletal"], 1],
      ]),
      sequence(
        "Levels of Organization",
        "Order these from smallest to largest.",
        ["Cell", "Tissue", "Organ", "Organ system", "Whole organism"]
      ),
      trueFalse("True or False?", "Tap TRUE if the statement is right.", [
        ["The lungs are part of the respiratory system.", true],
        ["Cells are larger than organs.", false],
        ["The brain controls the nervous system.", true],
        ["The heart is part of the digestive system.", false],
      ]),
      sortTask(
        "Sort: Organ & Its System",
        "Drag each organ to the system it belongs to.",
        ["Circulatory System", "Digestive System"],
        [
          ["❤️ Heart", 0], ["🥩 Stomach", 1], ["🩸 Blood vessels", 0], ["Intestines", 1],
          ["Veins", 0], ["Liver", 1],
        ]
      ),
      shortAnswer("Explain It", "Answer in a sentence.", [
        ["What is the job of the lungs?", "To take in oxygen and release carbon dioxide", ["oxygen", "breathe", "breathing", "air", "gas exchange"]],
        ["What do we call a group of similar cells working together?", "Tissue", ["tissue", "tissues"]],
      ]),
      mc("Systems at Work", "Pick the best answer.", [
        ["The skeletal system's main job is to…", ["Digest food", "Support and protect the body", "Pump blood", "Think"], 1],
        ["Which organ is the control centre of the nervous system?", ["Heart", "Brain", "Stomach", "Kidney"], 1],
        ["Muscles help you move by…", ["Pumping blood", "Contracting and relaxing", "Filtering waste", "Making blood"], 1],
      ]),
      riddle("Body Riddle", "Can you guess it?", [
        ["I beat about 100,000 times a day and never take a break. What organ am I?", "The heart"],
        ["I'm the basic building block of every living thing. What am I?", "A cell"],
      ]),
    ],
  },

  "g68-math-integers-ratios": {
    key: "g68-math-integers-ratios",
    title: "Integers & Ratios",
    subject: "Math",
    gradeBand: "6-8",
    gradeLevel: 7,
    topic: "Integers, the number line, and ratios",
    summary:
      "Add and subtract integers, order positives and negatives, and reason with ratios. Eight tasks that sharpen middle-years number sense.",
    estimatedMinutes: 20,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about math today!"),
      brainSpark("Quick Notes: Integers & Ratios", "Read before you play.", [
        "Integers are whole numbers including negatives: … -2, -1, 0, 1, 2 …",
        "On a number line, numbers get smaller to the left and larger to the right.",
        "Adding a negative is the same as subtracting: 5 + (-3) = 2.",
        "A ratio compares two amounts, like 2:3 — for every 2 of one, there are 3 of the other.",
      ]),
      mc("Integer Practice", "Choose the best answer.", [
        ["What is -4 + 6?", ["-10", "2", "-2", "10"], 1],
        ["Which number is the smallest?", ["-5", "0", "3", "-1"], 0],
        ["What is 3 - 8?", ["5", "-5", "11", "-11"], 1],
      ]),
      sequence(
        "Order the Integers",
        "Put these in order from smallest to largest.",
        ["-7", "-3", "0", "2", "6"]
      ),
      trueFalse("True or False?", "Tap TRUE if it's right.", [
        ["-2 is greater than -5.", true],
        ["Adding a negative number makes the result larger.", false],
        ["A ratio of 2:4 is the same as 1:2.", true],
        ["Zero is a positive number.", false],
      ]),
      sortTask(
        "Sort: Positive or Negative?",
        "Drag each result into the right group.",
        ["Positive", "Negative"],
        [
          ["5 + 2", 0], ["-6 + 1", 1], ["10 - 3", 0], ["2 - 9", 1],
          ["-4 + 9", 0], ["-8 + 3", 1],
        ]
      ),
      shortAnswer("Ratio Reasoning", "Type your answer.", [
        ["A recipe uses 2 cups of flour for every 1 cup of sugar. How many cups of flour for 3 cups of sugar?", "6", ["6", "six", "6 cups"]],
        ["Simplify the ratio 4:8 to its lowest terms.", "1:2", ["1:2", "1 to 2", "1/2"]],
      ]),
      mc("Ratios in Action", "Pick the best answer.", [
        ["In a class, the ratio of cats to dogs owned is 3:2. If there are 6 cats, how many dogs?", ["2", "4", "6", "9"], 1],
        ["Which ratio is equivalent to 5:10?", ["1:2", "2:1", "5:5", "10:5"], 0],
        ["The temperature drops from 3°C to -4°C. How many degrees did it fall?", ["1", "7", "-7", "12"], 1],
      ]),
      riddle("Number Riddle", "Can you guess it?", [
        ["I'm the only integer that is neither positive nor negative. What am I?", "Zero"],
        ["I compare two quantities using a colon, like 3:1. What am I?", "A ratio"],
      ]),
    ],
  },

  "g68-english-parts-of-speech": {
    key: "g68-english-parts-of-speech",
    title: "Parts of Speech",
    subject: "English",
    gradeBand: "6-8",
    gradeLevel: 6,
    topic: "Nouns, verbs, adjectives, and adverbs",
    summary:
      "Name the parts of speech, sort words by their job, and fix real sentences. Eight tasks that make grammar make sense.",
    estimatedMinutes: 18,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about English today!"),
      brainSpark("Quick Notes: Parts of Speech", "Read before you play.", [
        "A noun names a person, place, thing, or idea: teacher, city, freedom.",
        "A verb shows action or a state of being: run, think, is.",
        "An adjective describes a noun: bright, tall, curious.",
        "An adverb describes a verb, often ending in -ly: quickly, softly, well.",
      ]),
      mc("Name That Part", "Choose the best answer.", [
        ["In 'The dog barked loudly,' which word is the verb?", ["dog", "barked", "loudly", "the"], 1],
        ["Which word is an adjective?", ["run", "happy", "quickly", "table"], 1],
        ["'She sang beautifully.' Which word is the adverb?", ["She", "sang", "beautifully", "none"], 2],
      ]),
      sortTask(
        "Sort by Part of Speech",
        "Drag each word into the right group.",
        ["Noun", "Verb", "Adjective"],
        [
          ["mountain", 0], ["jump", 1], ["shiny", 2],
          ["freedom", 0], ["whisper", 1], ["ancient", 2],
          ["river", 0], ["build", 1],
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if it's right.", [
        ["A noun can name an idea, like 'honesty'.", true],
        ["Every adverb ends in -ly.", false],
        ["A verb can show action.", true],
        ["An adjective describes a verb.", false],
      ]),
      sequence(
        "Build a Sentence",
        "Put the words in order to make a correct sentence.",
        ["The", "curious", "student", "quietly", "raised", "her", "hand"]
      ),
      shortAnswer("Grammar in Action", "Type your answer.", [
        ["Give one adjective that could describe a storm.", "powerful", ["powerful", "loud", "dark", "fierce", "scary", "wild", "strong", "violent"]],
        ["In 'They ran fast,' what part of speech is 'fast'?", "adverb", ["adverb", "an adverb"]],
      ]),
      mc("Spot the Error", "Which choice fixes the sentence?", [
        ["'He run to the store.' The correct verb form is…", ["run", "runs", "ran", "running"], 2],
        ["'She is a quick runner and moves quick.' Fix the last word to…", ["quick", "quickly", "quicker", "quickest"], 1],
        ["Which sentence uses an adjective correctly?", ["He sings good.", "The loud music played.", "She runs quick.", "They eat noisy."], 1],
      ]),
      riddle("Grammar Riddle", "Can you guess it?", [
        ["I name a person, place, thing, or idea. What part of speech am I?", "A noun"],
        ["I describe how an action happens and often end in -ly. What am I?", "An adverb"],
      ]),
    ],
  },

  /* ==================================================================
   * 9-12
   * ================================================================== */

  "g912-math-linear-equations": {
    key: "g912-math-linear-equations",
    title: "Linear Equations",
    subject: "Math",
    gradeBand: "9-12",
    gradeLevel: 9,
    topic: "Solving and graphing linear equations",
    summary:
      "Solve for x, read slope and intercept, and connect equations to their graphs. Eight tasks that lock in linear-relations fundamentals.",
    estimatedMinutes: 20,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about math today!"),
      brainSpark("Quick Refresher", "Read before you play.", [
        "A linear equation graphs as a straight line.",
        "Slope-intercept form is y = mx + b, where m is the slope and b is the y-intercept.",
        "Slope = rise over run — how steep the line is and which way it tilts.",
        "To solve for a variable, do the same operation to both sides of the equation.",
      ]),
      mc("Solve It", "Choose the correct answer.", [
        ["Solve: 2x + 3 = 11. What is x?", ["2", "4", "7", "8"], 1],
        ["In y = 3x + 2, what is the slope?", ["2", "3", "5", "x"], 1],
        ["In y = -x + 4, the y-intercept is…", ["-1", "1", "4", "-4"], 2],
      ]),
      trueFalse("Algebra Truths", "Tap TRUE if the statement is right.", [
        ["The graph of a linear equation is a straight line.", true],
        ["In y = mx + b, b is the slope.", false],
        ["A slope of 0 makes a horizontal line.", true],
        ["Adding the same number to both sides changes the solution.", false],
      ]),
      sequence(
        "Solve Step by Step",
        "Order the steps to solve 3x - 5 = 10.",
        [
          "Start: 3x - 5 = 10",
          "Add 5 to both sides: 3x = 15",
          "Divide both sides by 3: x = 5",
          "Check: 3(5) - 5 = 10 ✓",
        ]
      ),
      sortTask(
        "Sort by Slope",
        "Drag each equation into the right group.",
        ["Positive Slope", "Negative Slope"],
        [
          ["y = 2x + 1", 0], ["y = -3x + 4", 1], ["y = x - 5", 0], ["y = -x + 2", 1],
          ["y = 4x", 0], ["y = -0.5x + 3", 1],
        ]
      ),
      shortAnswer("Show Your Work", "Type your answer.", [
        ["Solve for x: 5x = 20.", "4", ["4", "x=4", "x = 4"]],
        ["What is the slope of the line through (0,0) and (2,4)?", "2", ["2", "m=2", "m = 2"]],
      ]),
      mc("Read the Line", "Pick the best answer.", [
        ["A line with slope 0 is…", ["Vertical", "Horizontal", "Diagonal up", "Diagonal down"], 1],
        ["Which equation crosses the y-axis at 5?", ["y = 2x + 5", "y = 5x", "y = x - 5", "y = 5x + 1"], 0],
        ["If x = 3 in y = 2x - 1, then y = …", ["3", "5", "6", "7"], 1],
      ]),
      riddle("Algebra Riddle", "Can you guess it?", [
        ["In y = mx + b, I'm the letter that stands for the slope. What am I?", "m"],
        ["I'm the point where a line crosses the y-axis. What am I?", "The y-intercept"],
      ]),
    ],
  },

  "g912-english-literary-devices": {
    key: "g912-english-literary-devices",
    title: "Literary Devices",
    subject: "English",
    gradeBand: "9-12",
    gradeLevel: 10,
    topic: "Literary devices and analysis",
    summary:
      "Identify irony, symbolism, and imagery, then spot each device in real text. Eight tasks that build literary-analysis muscle.",
    estimatedMinutes: 20,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about English today!"),
      brainSpark("Quick Notes: Literary Devices", "Read before you play.", [
        "Imagery is vivid description that appeals to the senses.",
        "Symbolism uses an object to stand for a bigger idea (a dove = peace).",
        "Irony is a contrast between expectation and reality.",
        "Foreshadowing hints at events that will happen later in the story.",
      ]),
      mc("Name the Device", "Choose the best answer.", [
        ["'The wind whispered through the trees' is an example of…", ["Irony", "Personification", "Alliteration", "Hyperbole"], 1],
        ["'I've told you a million times!' is…", ["Hyperbole", "Symbolism", "Simile", "Irony"], 0],
        ["A fire station burning down is an example of…", ["Metaphor", "Situational irony", "Imagery", "Rhyme"], 1],
      ]),
      sortTask(
        "Sort the Devices",
        "Drag each example to the device it shows.",
        ["Simile", "Personification", "Hyperbole"],
        [
          ["Brave as a lion", 0], ["The clock stared at me", 1], ["I could sleep for a year", 2],
          ["Quiet as a mouse", 0], ["The wind danced", 1], ["This bag weighs a ton", 2],
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if the statement is right.", [
        ["Symbolism uses an object to represent a larger idea.", true],
        ["Imagery appeals only to the sense of sight.", false],
        ["Foreshadowing hints at what will happen later.", true],
        ["Hyperbole is a mild understatement.", false],
      ]),
      sequence(
        "Analyze a Passage",
        "Order the steps of a strong literary analysis.",
        [
          "Read the passage closely",
          "Identify the literary device being used",
          "Explain what effect the device creates",
          "Connect the effect to the theme or meaning",
        ]
      ),
      shortAnswer("Analyze It", "Answer in a sentence.", [
        ["Name the device: 'Her smile was a ray of sunshine.'", "metaphor", ["metaphor", "a metaphor"]],
        ["What larger idea might a storm symbolize in a story?", "Conflict or turmoil", ["conflict", "turmoil", "chaos", "anger", "danger", "trouble", "change"]],
      ]),
      mc("Effect & Meaning", "Pick the best answer.", [
        ["Why do writers use imagery?", ["To confuse the reader", "To create a vivid picture in the reader's mind", "To make text longer", "To rhyme"], 1],
        ["Dramatic irony is when…", ["The audience knows something a character doesn't", "Two characters argue", "A poem rhymes", "The setting changes"], 0],
        ["A recurring symbol across a novel most helps to develop the…", ["Page count", "Theme", "Font", "Title"], 1],
      ]),
      riddle("Literary Riddle", "Can you guess it?", [
        ["I give human traits to non-human things — the sun smiled, the leaves danced. What device am I?", "Personification"],
        ["I'm a contrast between what is expected and what actually happens. What am I?", "Irony"],
      ]),
    ],
  },

  "g912-science-chemistry-basics": {
    key: "g912-science-chemistry-basics",
    title: "Atoms & the Periodic Table",
    subject: "Science",
    gradeBand: "9-12",
    gradeLevel: 9,
    topic: "Atomic structure and the periodic table",
    summary:
      "Break down the atom, read the periodic table, and tell elements from compounds. Eight tasks that ground introductory chemistry.",
    estimatedMinutes: 20,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about chemistry today!"),
      brainSpark("Quick Notes: Atoms & Elements", "Read before you play.", [
        "An atom has a nucleus (protons and neutrons) with electrons around it.",
        "Protons carry a positive charge; electrons carry a negative charge; neutrons are neutral.",
        "An element is made of one kind of atom; the periodic table organizes all known elements.",
        "A compound forms when two or more elements chemically bond, like water (H₂O).",
      ]),
      mc("Atomic Basics", "Choose the best answer.", [
        ["Which particle in an atom has a positive charge?", ["Electron", "Proton", "Neutron", "Photon"], 1],
        ["The number of protons in an atom is its…", ["Mass number", "Atomic number", "Charge", "Valence"], 1],
        ["Which is a compound, not an element?", ["Oxygen (O₂)", "Gold (Au)", "Water (H₂O)", "Helium (He)"], 2],
      ]),
      sortTask(
        "Sort: Element or Compound?",
        "Drag each substance into the right group.",
        ["Element", "Compound"],
        [
          ["Oxygen (O₂)", 0], ["Water (H₂O)", 1], ["Iron (Fe)", 0], ["Salt (NaCl)", 1],
          ["Helium (He)", 0], ["Carbon dioxide (CO₂)", 1],
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if the statement is right.", [
        ["Electrons have a negative charge.", true],
        ["The periodic table is arranged randomly.", false],
        ["A compound is made of two or more elements bonded together.", true],
        ["Neutrons have a positive charge.", false],
      ]),
      sequence(
        "Order by Size",
        "Order these from smallest to largest.",
        ["A proton", "An atom", "A water molecule", "A grain of sand", "A drop of water"]
      ),
      shortAnswer("Chemistry Thinking", "Type your answer.", [
        ["What is the chemical symbol for water?", "H2O", ["h2o", "h₂o", "h2 o"]],
        ["What do we call the centre of an atom?", "Nucleus", ["nucleus", "the nucleus"]],
      ]),
      mc("Reading the Table", "Pick the best answer.", [
        ["Rows on the periodic table are called…", ["Groups", "Periods", "Families", "Columns"], 1],
        ["Elements in the same column often have similar…", ["Colours", "Chemical properties", "Weights only", "Names"], 1],
        ["The symbol 'Na' stands for which element?", ["Nitrogen", "Sodium", "Nickel", "Neon"], 1],
      ]),
      riddle("Chemistry Riddle", "Can you guess it?", [
        ["I'm the positively charged particle in the nucleus. My count sets the atomic number. What am I?", "A proton"],
        ["I'm two hydrogens and one oxygen, and you drink me every day. What am I?", "Water"],
      ]),
    ],
  },

  "g912-social-canadian-government": {
    key: "g912-social-canadian-government",
    title: "Canadian Government",
    subject: "Social Studies",
    gradeBand: "9-12",
    gradeLevel: 10,
    topic: "How Canada's government works",
    summary:
      "Map the three branches, the levels of government, and how a bill becomes law. Eight tasks for civics-ready senior students.",
    estimatedMinutes: 20,
    tasks: [
      moodCheckin("Tap the face that shows how you feel about civics today!"),
      brainSpark("Quick Notes: How Canada Governs", "Read before you play.", [
        "Canada is a constitutional monarchy and a parliamentary democracy.",
        "There are three levels of government: federal, provincial, and municipal.",
        "Parliament has three parts: the Crown, the House of Commons, and the Senate.",
        "The Prime Minister leads the federal government; MPs are elected to the House of Commons.",
      ]),
      mc("Government Basics", "Choose the best answer.", [
        ["Who leads Canada's federal government?", ["The Governor General", "The Prime Minister", "The Chief Justice", "The Mayor"], 1],
        ["Which level of government runs local services like garbage collection?", ["Federal", "Provincial", "Municipal", "International"], 2],
        ["Members elected to the House of Commons are called…", ["Senators", "MPs", "Judges", "Premiers"], 1],
      ]),
      sortTask(
        "Sort by Level of Government",
        "Drag each responsibility to the level that handles it.",
        ["Federal", "Provincial", "Municipal"],
        [
          ["National defence", 0], ["Education", 1], ["Local snow removal", 2],
          ["Immigration", 0], ["Health care delivery", 1], ["City parks", 2],
        ]
      ),
      trueFalse("True or False?", "Tap TRUE if the statement is right.", [
        ["Canada is a parliamentary democracy.", true],
        ["The Senate is elected by voters in a general election.", false],
        ["Provinces are responsible for education.", true],
        ["The Prime Minister is appointed by the Mayor.", false],
      ]),
      sequence(
        "How a Bill Becomes Law",
        "Put these steps in the correct order.",
        [
          "A bill is introduced in the House of Commons",
          "MPs debate and vote on the bill",
          "The bill is reviewed and passed by the Senate",
          "The bill receives Royal Assent and becomes law",
        ]
      ),
      shortAnswer("Civics in Action", "Answer in a sentence.", [
        ["Name one of the three levels of government in Canada.", "Federal", ["federal", "provincial", "municipal", "local"]],
        ["What is the name of Canada's elected lower house?", "House of Commons", ["house of commons", "commons", "the house of commons"]],
      ]),
      mc("Rights & Roles", "Pick the best answer.", [
        ["Which document protects Canadians' fundamental rights and freedoms?", ["The Magna Carta", "The Charter of Rights and Freedoms", "The Bill of Sale", "The Treaty of Ghent"], 1],
        ["The branch of government that interprets laws is the…", ["Legislative", "Executive", "Judicial", "Municipal"], 2],
        ["At what age can most Canadian citizens vote in federal elections?", ["16", "18", "21", "25"], 1],
      ]),
      riddle("Civics Riddle", "Can you guess it?", [
        ["I'm the elected leader of Canada's federal government. What is my title?", "The Prime Minister"],
        ["I'm the document that protects your fundamental freedoms in Canada. What am I?", "The Charter of Rights and Freedoms"],
      ]),
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
