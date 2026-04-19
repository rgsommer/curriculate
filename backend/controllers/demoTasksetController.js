// backend/controllers/demoTasksetController.js
import { TASK_TYPES, TASK_TYPE_META } from "../../shared/taskTypes.js";
import {
  normalizeSelectedType,
  retryMustHave,
  regenerateSingleTask,
} from "./sharedTasksetController.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import * as fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

/**
 * Canonical demo pool key
 */
const DEMO_TASKSET_KEY = "demoTaskset:v1";

/**
 * Bump this when demo generation logic/schema/playability changes
 */
const DEMO_SIGNATURE_VERSION = "demo:v3:attempt-log:strict:no-placeholders:LOGS_ON_2026-01-19a";

/**
 * Attempts
 */
const DEFAULT_MAX_ATTEMPTS = 10;
const MAX_ATTEMPTS_BY_TYPE = {
  [TASK_TYPES.MUSICAL_CHAIRS]: 15,
};

function cloneJson(x) {
  return x ? JSON.parse(JSON.stringify(x)) : x;
}

// Deterministic, schema-correct demo tasks for types that are unnecessarily flaky to
// generate via LLM (or where "correct shape" matters more than "novel content").
// These are NOT placeholders; they are canonical examples designed to exercise the
// frontend with reliable, valid data.
const STATIC_DEMO_TASKS = {
  [TASK_TYPES.SORT]: {
    taskType: TASK_TYPES.SORT,
    title: "Sorting Animals by Habitat",
    prompt:
      "Sort the items into the correct habitat buckets. Drag each item to the right category.",
    // Canonical schema for sort in Curriculate:
    // - config.buckets: string[] (bucket labels)
    // - config.items: {id,text,bucketIndex}[]
    // - config.answerKey: { [id]: bucketIndex }
    // We also include top-level mirrors for convenience/legacy rendering.
    config: {
      buckets: ["Forest", "Ocean", "Desert", "Grassland"],
      items: [
        { id: "item1", text: "Bear", bucketIndex: 0 },
        { id: "item2", text: "Owl", bucketIndex: 0 },
        { id: "item3", text: "Shark", bucketIndex: 1 },
        { id: "item4", text: "Dolphin", bucketIndex: 1 },
        { id: "item5", text: "Camel", bucketIndex: 2 },
        { id: "item6", text: "Cactus", bucketIndex: 2 },
        { id: "item7", text: "Lion", bucketIndex: 3 },
        { id: "item8", text: "Elephant", bucketIndex: 3 },
      ],
      answerKey: {
        item1: 0,
        item2: 0,
        item3: 1,
        item4: 1,
        item5: 2,
        item6: 2,
        item7: 3,
        item8: 3,
      },
    },
    // Optional mirrors
    items: [
      { id: "item1", text: "Bear", bucketIndex: 0 },
      { id: "item2", text: "Owl", bucketIndex: 0 },
      { id: "item3", text: "Shark", bucketIndex: 1 },
      { id: "item4", text: "Dolphin", bucketIndex: 1 },
      { id: "item5", text: "Camel", bucketIndex: 2 },
      { id: "item6", text: "Cactus", bucketIndex: 2 },
      { id: "item7", text: "Lion", bucketIndex: 3 },
      { id: "item8", text: "Elephant", bucketIndex: 3 },
    ],
    answerKey: {
      item1: 0,
      item2: 0,
      item3: 1,
      item4: 1,
      item5: 2,
      item6: 2,
      item7: 3,
      item8: 3,
    },
    categories: ["Forest", "Ocean", "Desert", "Grassland"],
  },

  [TASK_TYPES.MIND_MAPPER]: {
    taskType: TASK_TYPES.MIND_MAPPER,
    title: "Parts of a Plant Cell",
    prompt: "Drag each organelle to its correct position in the mind map.",
    organizerType: "mind-map",
    config: {
      organizerType: "mind-map",
      structure: {
        center: "Plant Cell",
        branches: [
          { label: "Energy", slots: ["_____", "_____"] },
          { label: "Protection", slots: ["_____"] },
          { label: "Storage", slots: ["_____"] },
          { label: "Control", slots: ["_____", "_____"] },
        ],
      },
      items: [
        { text: "Chloroplast", correctIndex: 0 },
        { text: "Mitochondria", correctIndex: 1 },
        { text: "Cell Wall", correctIndex: 2 },
        { text: "Vacuole", correctIndex: 3 },
        { text: "Nucleus", correctIndex: 4 },
        { text: "DNA", correctIndex: 5 },
      ],
    },
    items: [
      { text: "Chloroplast", correctIndex: 0 },
      { text: "Mitochondria", correctIndex: 1 },
      { text: "Cell Wall", correctIndex: 2 },
      { text: "Vacuole", correctIndex: 3 },
      { text: "Nucleus", correctIndex: 4 },
      { text: "DNA", correctIndex: 5 },
    ],
    structure: {
      center: "Plant Cell",
      branches: [
        { label: "Energy", slots: ["_____", "_____"] },
        { label: "Protection", slots: ["_____"] },
        { label: "Storage", slots: ["_____"] },
        { label: "Control", slots: ["_____", "_____"] },
      ],
    },
  },

  [TASK_TYPES.STORYTELLING]: {
    taskType: TASK_TYPES.STORYTELLING,
    title: "A Tale of Ancient Rome",
    prompt: "Build your character and AI will write a story featuring your team in Ancient Rome! Pick your gender, personality, role, and nationality -- then read the adventure together.",
    config: {
      setting: "Ancient Rome during the height of the Empire, where senators debate in marble halls and legions march along cobblestone roads.",
      topicContext: "The rise and fall of the Roman Republic, exploring how power, leadership, and civic duty shaped one of history's greatest civilizations.",
      genre: "adventure",
      showNationality: true,
      vocabWords: ["republic", "senate", "legion", "aqueduct", "gladiator", "consul"],
    },
  },

  [TASK_TYPES.HISTORICAL_DOC]: {
    taskType: TASK_TYPES.HISTORICAL_DOC,
    title: "The Emancipation Proclamation",
    prompt: "Read this historical document carefully. When it disappears, you will answer analysis questions about its significance and impact.",
    config: {
      imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Emancipation_proclamation.jpg/800px-Emancipation_proclamation.jpg",
      imageDescription: "The first page of the Emancipation Proclamation, issued by President Abraham Lincoln on January 1, 1863. The document is handwritten in elegant script on aged paper, beginning with the words 'By the President of the United States of America: A Proclamation.' It declared that all enslaved people in Confederate states 'shall be then, thenceforward, and forever free.' The document fundamentally changed the character of the Civil War from a fight to preserve the Union into a fight for human freedom.",
      docTitle: "The Emancipation Proclamation",
      docAuthor: "Abraham Lincoln",
      docYear: "1863",
      docType: "Presidential Proclamation",
      historicalContext: "By late 1862, the Civil War had raged for over a year. President Lincoln decided to reframe the war's purpose by declaring the freedom of enslaved people in rebel states.",
      viewingSeconds: 90,
      responseSeconds: 150,
      analysisPrompts: [
        "What was the immediate impact of this document when it was issued in 1863?",
        "Who was the intended audience, and how might different groups have reacted?",
        "Why did Lincoln choose to issue this as a military order rather than push for a constitutional amendment at that time?",
      ],
    },
  },

  [TASK_TYPES.ART_VIEW]: {
    taskType: TASK_TYPES.ART_VIEW,
    title: "A Sunday on La Grande Jatte by Georges Seurat",
    prompt: "Study this painting carefully. When it disappears, you will answer questions about what you observed and its artistic significance.",
    config: {
      imageUrl: "https://www.artic.edu/iiif/2/2d484387-2509-5e8e-2c43-22f6571e58cc/full/843,/0/default.jpg",
      imageDescription: "A Sunday on La Grande Jatte by Georges Seurat (1884-1886). A large pointillist painting showing Parisians relaxing in a park on an island in the Seine River. Dozens of figures — men, women, children, and pets — are arranged across a sunlit green lawn leading down to the water. A woman with a parasol and a man in a top hat stand prominently in the foreground. The painting uses thousands of tiny dots of pure color (pointillism) that blend optically when viewed from a distance. The scene has a calm, almost frozen quality despite the many figures. Currently housed at the Art Institute of Chicago.",
      artTitle: "A Sunday on La Grande Jatte",
      artist: "Georges Seurat",
      year: "1884–1886",
      medium: "Oil on canvas",
      viewingSeconds: 60,
      responseSeconds: 120,
      analysisPrompts: [
        "Describe the technique used in this painting. How is it different from traditional brushstrokes?",
        "What do you notice about how the people are positioned? Do they seem relaxed or stiff?",
        "Why do you think the artist chose to paint an everyday scene like people in a park?",
      ],
    },
  },

  [TASK_TYPES.FLASHCARDS]: {
    taskType: TASK_TYPES.FLASHCARDS,
    title: "Vocabulary Review: Human Body Systems",
    prompt: "Flip through the flashcards with your team. One person reads the question aloud — everyone else tries to answer before flipping!",
    cards: [
      { question: "What organ pumps blood throughout the body?", answer: "The heart" },
      { question: "What system breaks down food into nutrients?", answer: "The digestive system" },
      { question: "What are the tiny air sacs in the lungs called?", answer: "Alveoli" },
      { question: "What is the main function of red blood cells?", answer: "Carry oxygen to body tissues" },
      { question: "What organ filters waste from the blood?", answer: "The kidneys" },
      { question: "What is the largest organ in the human body?", answer: "The skin" },
      { question: "What connects muscles to bones?", answer: "Tendons" },
      { question: "What part of the brain controls balance and coordination?", answer: "The cerebellum" },
      { question: "What type of blood vessel carries blood away from the heart?", answer: "Arteries" },
      { question: "What is the role of white blood cells?", answer: "Fight infections and protect against disease" },
    ],
  },

  [TASK_TYPES.BRAIN_SPARK_NOTES]: {
    taskType: TASK_TYPES.BRAIN_SPARK_NOTES,
    title: "Notes: The Solar System",
    prompt: "Copy these notes into your notebook — neat and complete!",
    notes: {
      heading: "The Solar System",
      keyTerms: [
        { term: "Orbit", definition: "The curved path a planet follows as it travels around the Sun due to gravity.", points: ["All 8 planets orbit the Sun", "Orbits are elliptical (oval-shaped)"] },
        { term: "Gravity", definition: "The force of attraction between objects with mass — it keeps planets in orbit.", points: ["The Sun's gravity holds the solar system together", "Larger objects have stronger gravity"] },
        { term: "Terrestrial Planet", definition: "A rocky planet with a solid surface, located in the inner solar system.", points: ["Mercury, Venus, Earth, Mars", "Smaller and denser than gas giants"] },
        { term: "Gas Giant", definition: "A large planet made mostly of hydrogen and helium with no solid surface.", points: ["Jupiter, Saturn, Uranus, Neptune", "Much larger but less dense than terrestrial planets"] },
      ],
      mainPoints: [
        { title: "Structure of the Solar System", content: "The solar system has 8 planets orbiting the Sun. The inner planets are rocky; the outer planets are gas giants.", details: ["The asteroid belt separates inner and outer planets", "Pluto was reclassified as a dwarf planet in 2006"] },
        { title: "The Sun", content: "The Sun is a medium-sized star that provides light and heat to all planets. It contains 99.8% of the solar system's mass.", details: ["Surface temperature: about 5,500 degrees Celsius", "Energy comes from nuclear fusion of hydrogen"] },
        { title: "Earth's Special Position", content: "Earth orbits in the habitable zone where liquid water can exist, making life possible.", details: ["The atmosphere protects us from harmful radiation", "The Moon stabilizes Earth's tilt and creates tides"] },
      ],
      summary: ["The solar system consists of the Sun and 8 planets held together by gravity. The inner rocky planets and outer gas giants each have unique characteristics. Earth's position in the habitable zone makes it uniquely suited for life."],
    },
  },

  [TASK_TYPES.NARRATION_SYNTHESIZE]: {
    taskType: TASK_TYPES.NARRATION_SYNTHESIZE,
    title: "Explain the Water Cycle",
    prompt: "Each team member explains one stage of the water cycle out loud. Speak clearly so your group can rate your explanation.",
    config: {
      playerCount: 4,
      prompts: [
        { id: "p1", concept: "Evaporation", prompt: "Explain how water turns from liquid to gas. What causes it and where does it happen most?" },
        { id: "p2", concept: "Condensation", prompt: "Explain what happens when water vapor rises and cools. How do clouds form?" },
        { id: "p3", concept: "Precipitation", prompt: "Explain how water returns to Earth's surface. What are the different forms it can take?" },
        { id: "p4", concept: "Collection", prompt: "Explain where water goes after it falls. How does it end up back in oceans, lakes, and underground?" },
      ],
      perTurnSeconds: 60,
      ratingScale: { min: 1, max: 5, label: "Clarity" },
    },
  },

  [TASK_TYPES.CASE_STUDY]: {
    taskType: TASK_TYPES.CASE_STUDY,
    title: "The Water Crisis of Milltown",
    prompt: "Read the case below and write a detailed response explaining how you would solve this problem. Use as many key concepts as you can for bonus points.",
    config: {
      scenario: "Milltown, a small city of 40,000 people, has discovered that its main water supply is contaminated with lead from aging pipes installed in the 1950s. The mayor must decide how to respond: replace all pipes at a cost of $50 million over 5 years, switch to bottled water distribution immediately at $2 million per month, or install filtration systems in every home for $8 million total. Meanwhile, residents are angry, local businesses are losing customers, and the state government is threatening to intervene. Three children have already been hospitalized with elevated lead levels.",
      expertRole: "Environmental Scientist",
      expertDescription: "A water quality researcher who has studied lead contamination in urban infrastructure for over 15 years.",
      relevantConcepts: ["contamination", "infrastructure", "public health", "budget", "stakeholder", "intervention"],
    },
  },

  [TASK_TYPES.TRIVIA]: {
    taskType: TASK_TYPES.TRIVIA,
    title: "Fun Facts Trivia Challenge",
    prompt: "Test your general knowledge! Each round has a different twist -- spot the fake, judge true or false, or pick the closest answer.",
    config: {
      rounds: [
        {
          mode: "bluff",
          category: "Animals",
          facts: [
            "A group of flamingos is called a flamboyance.",
            "Octopuses have three hearts.",
            "Elephants are the only animals that can jump.",
          ],
          fakeIndex: 2,
          explanation: "Elephants are actually one of the few mammals that cannot jump at all due to their massive weight and bone structure.",
        },
        {
          mode: "truefalse",
          category: "Space",
          statement: "A day on Venus is longer than a year on Venus.",
          answer: true,
          explanation: "Venus rotates so slowly on its axis that one full rotation (day) takes about 243 Earth days, while it orbits the Sun (year) in about 225 Earth days.",
        },
        {
          mode: "closerto",
          category: "Geography",
          question: "How many countries are there in the world?",
          choices: ["142", "195"],
          correctChoice: 1,
          actualAnswer: "195",
          explanation: "There are 195 recognized countries in the world: 193 member states of the United Nations plus Vatican City and Palestine.",
        },
        {
          mode: "bluff",
          category: "Science",
          facts: [
            "Honey never spoils -- edible honey has been found in ancient Egyptian tombs.",
            "Water can boil and freeze at the same time under the right conditions.",
            "Lightning strikes produce a small amount of gold each time they hit sand.",
          ],
          fakeIndex: 2,
          explanation: "Lightning striking sand creates fulgurites (glass tubes), not gold. However, both honey preservation and the triple point of water (simultaneous boiling and freezing) are real phenomena.",
        },
      ],
    },
  },

  [TASK_TYPES.RIDDLE]: {
    taskType: TASK_TYPES.RIDDLE,
    title: "Mystery Riddle",
    prompt: "Read the riddle carefully and figure out the answer. Think creatively!",
    config: {
      riddle: "I have cities, but no houses live there. I have mountains, but no trees grow on them. I have water, but no fish swim in it. I have roads, but no cars drive on them. What am I?",
      answer: "A map",
    },
  },

  [TASK_TYPES.FLASHCARDS_RACE]: {
    taskType: TASK_TYPES.FLASHCARDS_RACE,
    title: "Geography Speed Round: US States and Capitals",
    prompt: "Race your teammates! Buzz in first and name the correct capital. Speed and accuracy both count!",
    cards: [
      { question: "What is the capital of California?", answer: "Sacramento" },
      { question: "What is the capital of Texas?", answer: "Austin" },
      { question: "What is the capital of New York?", answer: "Albany" },
      { question: "What is the capital of Florida?", answer: "Tallahassee" },
      { question: "What is the capital of Illinois?", answer: "Springfield" },
      { question: "What is the capital of Alaska?", answer: "Juneau" },
      { question: "What is the capital of Montana?", answer: "Helena" },
      { question: "What is the capital of Pennsylvania?", answer: "Harrisburg" },
      { question: "What is the capital of Georgia?", answer: "Atlanta" },
      { question: "What is the capital of Oregon?", answer: "Salem" },
    ],
  },

  [TASK_TYPES.ROLE_PLAY_DECK]: {
    taskType: TASK_TYPES.ROLE_PLAY_DECK,
    title: "The School Lunch Debate",
    prompt: "Draw your role card and argue your position! Each person has a unique perspective on what the school cafeteria should serve.",
    config: {
      scenario: "The school board is holding a public meeting to decide on a completely new lunch menu for next year. Each stakeholder has strong opinions and must convince the board their plan is best.",
      roles: [
        {
          name: "The Health-Conscious Nutritionist",
          goal: "Convince the board to make every meal organic, plant-based, and sugar-free.",
          constraint: "You cannot mention the word 'boring' or admit that any healthy food tastes bad.",
        },
        {
          name: "The Student Body President",
          goal: "Fight for pizza Fridays, a dessert bar, and more choices students actually want.",
          constraint: "You must include at least one healthy option in every proposal you make.",
        },
        {
          name: "The Budget-Minded Principal",
          goal: "Keep lunch costs under $3 per student per day while still meeting nutrition standards.",
          constraint: "You cannot reject any idea without offering a cheaper alternative.",
        },
        {
          name: "The Celebrity Chef Consultant",
          goal: "Propose a gourmet menu that introduces students to world cuisines every week.",
          constraint: "Every dish you suggest must be something a 12-year-old could learn to cook at home.",
        },
      ],
    },
  },

  [TASK_TYPES.ECHO_CHAIN]: {
    taskType: TASK_TYPES.ECHO_CHAIN,
    title: "Echo Chain: Vocabulary Builder",
    prompt: "Say the word aloud, then add a related word. Each person builds the chain longer!",
    config: {
      seedTerm: "metamorphosis",
    },
  },

  [TASK_TYPES.MATCHING]: {
    taskType: TASK_TYPES.MATCHING,
    title: "Match the Vocabulary to Its Definition",
    prompt: "Draw a line between each word on the left and its correct definition on the right.",
    leftItems: [
      "Photosynthesis",
      "Ecosystem",
      "Erosion",
      "Condensation",
      "Habitat",
      "Adaptation",
    ],
    rightItems: [
      "The process by which plants convert sunlight into food",
      "A community of living things and their environment",
      "The wearing away of land by wind or water",
      "Water vapor cooling and turning back into liquid",
      "The natural home of an animal or plant",
      "A trait that helps a living thing survive in its environment",
    ],
    correctMatches: {
      "Photosynthesis": "The process by which plants convert sunlight into food",
      "Ecosystem": "A community of living things and their environment",
      "Erosion": "The wearing away of land by wind or water",
      "Condensation": "Water vapor cooling and turning back into liquid",
      "Habitat": "The natural home of an animal or plant",
      "Adaptation": "A trait that helps a living thing survive in its environment",
    },
  },

  [TASK_TYPES.MAD_DASH_SEQUENCE]: {
    taskType: TASK_TYPES.MAD_DASH_SEQUENCE,
    title: "Order the Steps: How a Bill Becomes a Law",
    prompt: "Put these steps in the correct order from first to last.",
    config: {
      items: [
        "A member of Congress introduces the bill",
        "The bill is debated in committee",
        "The full House or Senate votes on the bill",
        "The other chamber votes on the bill",
        "The President signs or vetoes the bill",
      ],
      correctOrder: [0, 1, 2, 3, 4],
      orderingCriterion: "chronological",
    },
  },

  [TASK_TYPES.VENNSORT]: {
    taskType: TASK_TYPES.VENNSORT,
    title: "Mammals vs. Reptiles",
    prompt: "Sort these animals into the correct category. Some belong in both!",
    config: {
      categories: ["Mammals", "Reptiles"],
      items: [
        { id: "vs-1", text: "Dolphin" },
        { id: "vs-2", text: "Crocodile" },
        { id: "vs-3", text: "Platypus" },
        { id: "vs-4", text: "Komodo Dragon" },
        { id: "vs-5", text: "Bat" },
        { id: "vs-6", text: "Sea Turtle" },
        { id: "vs-7", text: "Whale" },
        { id: "vs-8", text: "Chameleon" },
      ],
    },
    correctAnswer: {
      "vs-1": ["Mammals"],
      "vs-2": ["Reptiles"],
      "vs-3": ["Mammals"],
      "vs-4": ["Reptiles"],
      "vs-5": ["Mammals"],
      "vs-6": ["Reptiles"],
      "vs-7": ["Mammals"],
      "vs-8": ["Reptiles"],
    },
  },

  [TASK_TYPES.PET_FEEDING]: {
    taskType: TASK_TYPES.PET_FEEDING,
    title: "Feed the Pet: Water Cycle Facts",
    prompt: "Feed your pet only the TRUE statements about the water cycle!",
    pack: "classic",
    goodFoods: [
      "Evaporation turns liquid water into water vapor",
      "The sun provides energy that drives the water cycle",
      "Condensation causes clouds to form",
      "Precipitation returns water to Earth's surface",
      "Groundwater feeds into rivers and lakes",
    ],
    badFoods: [
      "Evaporation only happens in the ocean",
      "Clouds are made of cotton",
      "Rain falls upward during storms",
      "Ice is heavier than liquid water",
    ],
    config: {
      goal: 4,
      maxMistakes: 3,
      pack: "classic",
    },
  },

  [TASK_TYPES.PRONUNCIATION]: {
    taskType: TASK_TYPES.PRONUNCIATION,
    title: "Pronunciation Practice: Key Vocabulary",
    prompt: "Read the sentence below clearly and naturally.",
    referenceText: "The mitochondria is the powerhouse of the cell, converting nutrients into energy through cellular respiration.",
    language: "English",
    accentOptions: ["american", "british", "canadian", "australian", "neutral"],
    targetAccent: "american",
  },

  [TASK_TYPES.MULTI_ROOM_SCAVENGER_HUNT]: {
    taskType: TASK_TYPES.MULTI_ROOM_SCAVENGER_HUNT,
    title: "Textbook Treasure Hunt: Find the Key Diagram",
    prompt: "Find the diagram your teacher described and explain what it shows. Use the clues below!",
    config: {
      pageReference: "Page 47, Figure 3.1 — The Rock Cycle Diagram",
      clueSource: "your teacher",
      clues: [
        "Look for a circular diagram with arrows",
        "It shows three types of rocks and how they change",
        "The words igneous, sedimentary, and metamorphic should appear",
      ],
    },
  },

  [TASK_TYPES.BRAINSTORM_BATTLE]: {
    taskType: TASK_TYPES.BRAINSTORM_BATTLE,
    title: "Invention Brainstorm: Solve a School Problem",
    prompt: "Invent something that solves a real problem at school. Think wild — the crazier the better!",
    timeLimitSeconds: 90,
  },

  [TASK_TYPES.MYSTERY_CLUES]: {
    taskType: TASK_TYPES.MYSTERY_CLUES,
    title: "Mystery Clues: Memory Challenge",
    prompt: "Memorize these cards — they'll disappear soon.",
    clues: ["🍎", "🚀", "🧩", "🌙"],
    clueCards: ["🍎", "🚀", "🧩", "🌙"],
    revealMs: 8000,
    bonusPoints: 10,
  },

  [TASK_TYPES.SCRIPT_PLAY]: {
    taskType: TASK_TYPES.SCRIPT_PLAY,
    title: "The Boston Tea Party: Two Perspectives",
    prompt: "Read your lines aloud with expression! Pass the device to the next speaker when it is their turn.",
    config: {
      scenes: [
        {
          title: "Scene 1: The Meeting at Old South Meeting House",
          contextBefore: "December 16, 1773. Thousands of colonists have gathered to decide what to do about three ships loaded with British tea sitting in Boston Harbor. The British governor refuses to let the ships leave without paying the tea tax.",
          speakers: ["Samuel Adams", "A Concerned Merchant"],
          lines: [
            { speakerIndex: 0, text: "Fellow citizens of Boston! For weeks we have petitioned Governor Hutchinson to send these tea ships back to England. And what has been his answer?", tone: "passionate" },
            { speakerIndex: 1, text: "He refuses every time, Mr. Adams. But surely we must be cautious. If we act rashly, the Crown will punish all of us.", tone: "worried" },
            { speakerIndex: 0, text: "Cautious? We have been cautious for years! We asked politely for representation. We wrote letters. We boycotted. And still Parliament taxes us without our consent!", tone: "defiant" },
            { speakerIndex: 1, text: "I agree the tax is unjust. But that tea is worth a fortune. If anything happens to it, King George will make Boston pay dearly.", tone: "nervous" },
            { speakerIndex: 0, text: "Then let him try. This meeting can do nothing more to save this country!", direction: "Raises fist. The crowd erupts in war whoops." },
          ],
        },
        {
          title: "Scene 2: Aboard the Dartmouth",
          contextBefore: "Later that night. A group of colonists disguised as Mohawk Indians boards the tea ship Dartmouth. They work quickly and deliberately.",
          speakers: ["Patriot Leader", "Young Volunteer", "British Sailor"],
          lines: [
            { speakerIndex: 0, text: "Listen carefully -- we are not here to steal or destroy anything besides the tea. No one touches the ship's other cargo. We are making a political statement, not committing robbery.", tone: "firm", direction: "Whispers to the group on deck" },
            { speakerIndex: 1, text: "There must be over three hundred chests down in the hold! This is going to take all night.", tone: "amazed" },
            { speakerIndex: 2, text: "I cannot believe what I am witnessing. Do you people understand that this tea belongs to the East India Company? This is treason!", tone: "shocked" },
            { speakerIndex: 0, text: "No, sir. Taxation without representation is the real crime. We mean you no harm. Stand aside and let us work.", tone: "calm" },
            { speakerIndex: 1, text: "The last chest is overboard! Every single one -- into the harbor!", tone: "triumphant", direction: "Cheers break out across all three ships" },
            { speakerIndex: 0, text: "Now sweep the decks clean and put everything else back in its place. The world must know that the Sons of Liberty are honorable people who fight only for justice.", tone: "proud" },
          ],
        },
      ],
    },
  },
};

function getDemoTasksetModel() {
  if (mongoose.models.DemoTaskset) return mongoose.models.DemoTaskset;

  const DemoTasksetSchema = new mongoose.Schema(
    {
      key: { type: String, unique: true, index: true },
      taskset: { type: mongoose.Schema.Types.Mixed, default: null },
      signature: { type: String, default: "" },
    },
    { timestamps: true }
  );

  return mongoose.model("DemoTaskset", DemoTasksetSchema);
}

// ---------------- SSE helpers ----------------
function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeDemoLog(payload) {
  const dir = path.join(process.cwd(), "sim_out");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `demo-taskset-${isoStamp()}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

// ------------- Placeholder guard -------------
function looksLikePlaceholderTask(task) {
  if (!task || typeof task !== "object") return true;

  const title = String(task.title || "").toLowerCase();
  const prompt = String(task.prompt || "").toLowerCase();

  const poison = [
    "placeholder",
    "please regenerate",
    "demo placeholder",
    "not in the pool yet",
    "regenerate this task",
    "no options provided",
  ];

  return poison.some((p) => title.includes(p) || prompt.includes(p));
}

// ------------- Demo special normalizers -------------
function normalizeFakeOutDemoTask(task) {
  if (!task || typeof task !== "object") return task;

  const cfg = task.config && typeof task.config === "object" ? task.config : {};
  const rawRounds = Array.isArray(cfg.rounds)
    ? cfg.rounds
    : Array.isArray(task.rounds)
    ? task.rounds
    : [];

  const rounds = rawRounds
    .map((r) => {
      const prompt = String(r?.prompt || r?.statement || r?.question || "").trim();

      const optionsRaw = Array.isArray(r?.options)
        ? r.options
        : Array.isArray(r?.choices)
        ? r.choices
        : [];

      const options = optionsRaw.map((x) => String(x || "").trim()).filter(Boolean);

      let correctIndex = Number.isInteger(r?.correctIndex)
        ? r.correctIndex
        : Number.isInteger(r?.correctAnswer)
        ? r.correctAnswer
        : 0;

      if (correctIndex < 0) correctIndex = 0;
      if (correctIndex > 2) correctIndex = 0;

      let jokeOption = String(r?.jokeOption || "").trim();
      let jokeIndex = Number.isInteger(r?.jokeIndex) ? r.jokeIndex : 2;
      // We support 3 base options (0..2) PLUS a separate jokeOption that
      // can be inserted at positions 0..3.
      // If AI tried to provide a 4th option inside options[], treat it as jokeOption.
      if (!jokeOption && options.length >= 4) {
        jokeOption = String(options[3] || "").trim();
      }

      // Clamp jokeIndex to 0..3 (insertion slots among 3 options)
      if (jokeIndex < 0 || jokeIndex > 3) jokeIndex = 3;

      const base3 = options.slice(0, 3).map((s) => String(s || "").trim()).filter(Boolean);
      while (base3.length < 3) base3.push("—");

      if (!jokeOption) jokeOption = "A flying spaghetti monster";
      if (jokeIndex < 0 || jokeIndex > 3) jokeIndex = 3;

      return { prompt, options: base3, correctIndex, jokeOption, jokeIndex };
    })
    .filter(
      (r) =>
        r.prompt &&
        Array.isArray(r.options) &&
        r.options.length === 3 &&
        String(r.jokeOption || "").trim() &&
        Number.isInteger(r.jokeIndex) &&
        r.jokeIndex >= 0 &&
        r.jokeIndex <= 3
    );

  const playerCountRaw = cfg.playerCount ?? cfg.players ?? cfg.numPlayers ?? task.playerCount;
  const playerCount = Math.max(2, Math.min(8, Number(playerCountRaw) || 4));

  return {
    ...task,
    taskType: TASK_TYPES.FAKE_OUT,
    config: {
      ...cfg,
      playerCount,
      rounds,
      pointsPerCorrect: Number(cfg.pointsPerCorrect ?? 10) || 10,
      readerBonusPoints: Number(cfg.readerBonusPoints ?? cfg.foolBonusPoints ?? 5) || 0,
      interTeamEnabled: false,
      intraTeamEnabled: true,
    },
  };
}

function normalizeGuessWhoDemoTask(task) {
  if (!task || typeof task !== "object") return task;
  const cfg = task.config && typeof task.config === "object" ? task.config : {};

  const playerCountRaw = cfg.playerCount ?? cfg.players ?? cfg.numPlayers ?? task.playerCount;
  const playerCount = Math.max(2, Math.min(6, Number(playerCountRaw) || 4));

  const secretAnswers = Array.isArray(cfg.secretAnswers) ? cfg.secretAnswers : [];
  const safeSecrets = secretAnswers
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, playerCount);

  while (safeSecrets.length < playerCount) safeSecrets.push("UNKNOWN");

  return {
    ...task,
    taskType: TASK_TYPES.GUESS_WHO,
    config: {
      ...cfg,
      playerCount,
      secretAnswers: safeSecrets,
      maxGuesses: Math.max(5, Math.min(15, Number(cfg.maxGuesses ?? 12) || 12)),
      timerSeconds: Math.max(30, Math.min(180, Number(cfg.timerSeconds ?? 120) || 120)),
      interTeamEnabled: false,
      intraTeamEnabled: true,
    },
  };
}

// ----------------- Status endpoint -----------------
export async function getDemoTaskset(req, res) {
  const key =
    String(req.query.key || req.body?.key || DEMO_TASKSET_KEY).trim() || DEMO_TASKSET_KEY;

  try {
    const DemoTasksetModel = getDemoTasksetModel();
    const doc = await DemoTasksetModel.findOne({ key }).lean();

    res.setHeader("Cache-Control", "no-store");

    if (!doc || !doc.taskset) {
      return res.status(404).json({
        ok: false,
        key,
        error: "Demo taskset not found. Generate it first.",
      });
    }

    return res.json({
      ok: true,
      key,
      taskset: doc.taskset,
      updatedAt: doc.updatedAt || doc.createdAt || null,
      signature: doc.signature || "",
    });
  } catch (e) {
    console.error("[DEMO] GET /api/demo/taskset failed:", e);
    return res.status(500).json({
      ok: false,
      error: "Failed to load demo taskset",
      message: e?.message || String(e),
    });
  }
}

export async function getDemoTasksetStatus(req, res) {
  const key =
    String(req.query.key || req.body?.key || DEMO_TASKSET_KEY).trim() || DEMO_TASKSET_KEY;

  try {
    const DemoTasksetModel = getDemoTasksetModel();
    const doc = await DemoTasksetModel.findOne({ key }).lean();

    res.setHeader("Cache-Control", "no-store");

    if (!doc) {
      return res.json({ ok: true, key, exists: false, taskCount: 0, updatedAt: null, signature: "" });
    }

    const taskCount = Array.isArray(doc.taskset?.tasks) ? doc.taskset.tasks.length : 0;

    return res.json({
      ok: true,
      key,
      exists: true,
      taskCount,
      updatedAt: doc.updatedAt || doc.createdAt || null,
      signature: doc.signature || "",
    });
  } catch (e) {
    console.error("[DEMO] GET /api/demo/taskset/status failed:", e);
    return res.status(500).json({ ok: false, error: e?.message || "status failed" });
  }
}

/**
 * GET /api/demo/taskset/stream
 *
 * SSE events:
 *  - init      { types, total, signature }
 *  - progress  { index, total, taskType, status }
 *  - attempt   { taskType, attempt, maxAttempts, phase, ok?, error? }  <-- NEW
 *  - task      { index, total, taskType, task }
 *  - fail      { index, total, taskType, attempts, error }            <-- NEW (per type)
 *  - done      { ok, key, taskCount, totalEligible, failedTypes, logFile, signature }
 *  - fatal     { ok:false, error, logFile, signature }
 *
 * STRICT COMPLETENESS:
 * - if ANY task type fails => NOT SAVED
 */
export async function streamDemoTaskset(req, res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const requestedKey = String(req.query.key || "").trim() || DEMO_TASKSET_KEY;

  // heartbeat to keep proxies alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {}
  }, 15000);

  req.on("close", () => clearInterval(heartbeat));
  res.flushHeaders?.();

  // Eligible = implemented + generatorEligible
  const eligibleTypes = Object.values(TASK_TYPES)
    .map((t) => normalizeSelectedType(t))
    .filter(Boolean)
    .filter((t) => {
      const meta = TASK_TYPE_META?.[t];
      return meta && meta.implemented !== false && meta.generatorEligible !== false;
    });

  const signaturePayload = { v: DEMO_SIGNATURE_VERSION, totalEligible: eligibleTypes.length, types: eligibleTypes };
  const signature = JSON.stringify(signaturePayload);

  sseWrite(res, "init", { types: eligibleTypes, total: eligibleTypes.length, signature });

  const DemoModel = getDemoTasksetModel();

  const tasksByType = {};
  const failuresByType = {};
  const debugLog = {
    signaturePayload,
    startedAt: new Date().toISOString(),
    types: eligibleTypes,
    attempts: [], // one entry per attempt with prompt + result + ok/error
    failuresByType: {},
  };

  let logFile = null;

  try {
    for (let i = 0; i < eligibleTypes.length; i++) {
      const taskType = eligibleTypes[i];

      sseWrite(res, "progress", { index: i, total: eligibleTypes.length, taskType, status: "generating" });

      const mustHave = retryMustHave[taskType] || "";
      const maxAttempts = MAX_ATTEMPTS_BY_TYPE[taskType] || DEFAULT_MAX_ATTEMPTS;

      // If a deterministic canonical task is provided for this type, emit it
      // immediately (no LLM calls, no retries) and move on.
      const staticTask = STATIC_DEMO_TASKS[taskType];
      if (staticTask) {
        try {
          const task = cloneJson(staticTask);
          let validatedTask = normalizeTaskByType(taskType, { ...(task || {}), taskType });

          const v = validateTaskByType(taskType, validatedTask);
          if (!v.ok) throw new Error(v.errors.join("; "));

          const play = assessTaskPlayability(validatedTask);
          if (!play.playable) throw new Error(play.issues.join("; "));

          // ✅ store by type (tasks[] is built later)
          tasksByType[taskType] = validatedTask;

          sseWrite(res, "task", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            task: validatedTask,
          });

          sseWrite(res, "progress", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            status: "done",
          });
        } catch (err) {
          const msg = err?.message || String(err);

          failuresByType[taskType] = { error: `Static demo task invalid: ${msg}`, attempts: 0 };
          debugLog.failuresByType[taskType] = failuresByType[taskType];

          sseWrite(res, "fail", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            attempts: 0,
            error: failuresByType[taskType].error,
          });

          sseWrite(res, "progress", {
            index: i,
            total: eligibleTypes.length,
            taskType,
            status: "failed",
          });
        }

        continue; // ⛔ skip LLM generation entirely for this type
      }

      let attemptTask = null;
      let lastErr = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let promptCapture = null;

        try {
          sseWrite(res, "attempt", { taskType, attempt, maxAttempts, phase: "prompting" });

          attemptTask = await regenerateSingleTask({
            allowedType: taskType,
            mustHave,
            subject: "General",
            gradeLevel: 7,
            difficulty: "MEDIUM",
            learningGoal: "Demonstrate the task type clearly and correctly.",
            topicLabel: "Demo",
            vocabularyLines: "",
            specialConsiderations:
              "This is a demo task. Keep content universally appropriate and school-safe.",
            previousTask: attemptTask,
            onPrompt: (p) => {
              promptCapture = p; // includes system + user
            },
          });

          // Normalize demo quirks
          if (taskType === TASK_TYPES.FAKE_OUT) attemptTask = normalizeFakeOutDemoTask(attemptTask);
          if (taskType === TASK_TYPES.GUESS_WHO) attemptTask = normalizeGuessWhoDemoTask(attemptTask);

          // Normalize canonical schema
          attemptTask = normalizeTaskByType(taskType, { ...(attemptTask || {}), taskType });

          // Hard-block placeholders
          if (looksLikePlaceholderTask(attemptTask)) {
            throw new Error("Generated task looks like a placeholder (blocked).");
          }

          sseWrite(res, "attempt", { taskType, attempt, maxAttempts, phase: "validating" });

          // Strict schema validation
          const v = validateTaskByType(taskType, attemptTask);
          if (!v.ok) throw new Error(v.errors.join("; "));

          // Playability
          const play = assessTaskPlayability(attemptTask);
          if (!play.playable) throw new Error(play.issues.join("; "));

          // Log success (prompt + output)
          debugLog.attempts.push({
            taskType,
            attempt,
            ok: true,
            prompt: promptCapture || null,
            task: attemptTask,
          });

          sseWrite(res, "attempt", { taskType, attempt, maxAttempts, phase: "success", ok: true });

          tasksByType[taskType] = attemptTask;
          break;
        } catch (e) {
          lastErr = e;

          console.error("[DEMO][ATTEMPT FAIL]", {
            taskType,
            attempt,
            maxAttempts,
            error: String(e?.message || e),
          });

          debugLog.attempts.push({
            taskType,
            attempt,
            ok: false,
            error: String(e?.message || e),
            prompt: promptCapture || null,
            // include the best candidate we had (if any)
            task: attemptTask || null,
          });

          sseWrite(res, "attempt", {
            taskType,
            attempt,
            maxAttempts,
            phase: "fail",
            ok: false,
            error: String(e?.message || e),
          });
        }
      }

      if (!tasksByType[taskType]) {
        const msg = String(lastErr?.message || lastErr || `Failed to generate task for ${taskType}`);
        console.error("[DEMO][TYPE FAILED]", {
          taskType,
          attempts: maxAttempts,
          error: msg,
        });

        failuresByType[taskType] = { error: msg, attempts: maxAttempts };
        debugLog.failuresByType[taskType] = failuresByType[taskType];

        sseWrite(res, "fail", {
          index: i,
          total: eligibleTypes.length,
          taskType,
          attempts: maxAttempts,
          error: msg,
        });

        sseWrite(res, "progress", { index: i, total: eligibleTypes.length, taskType, status: "failed" });
        continue;
      }

      sseWrite(res, "task", { index: i, total: eligibleTypes.length, taskType, task: tasksByType[taskType] });
      sseWrite(res, "progress", { index: i, total: eligibleTypes.length, taskType, status: "done" });
    }

    // Write log BEFORE deciding to save, so you always get a logFile even on failure
    debugLog.doneAt = new Date().toISOString();
    debugLog.taskCount = Object.keys(tasksByType).length;
    debugLog.failedTypes = Object.keys(failuresByType);

    logFile = await writeDemoLog(debugLog);
    console.log("[DEMO] debug log written:", logFile);

    const failedTypes = Object.keys(failuresByType);
    const complete = failedTypes.length === 0 && Object.keys(tasksByType).length === eligibleTypes.length;

    if (!complete) {
      // STRICT COMPLETENESS: do NOT save partial demo pools
      sseWrite(res, "done", {
        ok: false,
        key: requestedKey,
        taskCount: Object.keys(tasksByType).length,
        totalEligible: eligibleTypes.length,
        failedTypes,
        failuresByType,
        signature,
        logFile,
        error:
          "Demo generation stopped short: one or more task types failed after retries. Nothing was saved. See logFile for prompts, outputs, and validation errors.",
      });
      clearInterval(heartbeat);
      return res.end();
    }

    // Build ordered tasks (exactly one per eligible type)
    const tasks = eligibleTypes.map((t) => tasksByType[t]);

    // Final safety net: block placeholders
    const poisonTypes = tasks
      .filter((t) => looksLikePlaceholderTask(t))
      .map((t) => t?.taskType || "(unknown)");
    if (poisonTypes.length) {
      throw new Error(`Refusing to save: placeholder-like tasks detected for: ${Array.from(new Set(poisonTypes)).join(", ")}`);
    }

    const displayName = `Demo Taskset (${tasks.length} types)`;
    const taskset = {
      key: requestedKey,
      name: displayName,
      subject: "General",
      gradeLevel: 7,
      createdAt: new Date().toISOString(),
      tasks,
    };

    await DemoModel.updateOne(
      { key: requestedKey },
      { $set: { key: requestedKey, taskset, signature } },
      { upsert: true }
    );

    sseWrite(res, "done", {
      ok: true,
      key: requestedKey,
      taskCount: tasks.length,
      totalEligible: eligibleTypes.length,
      failedTypes: [],
      signature,
      logFile,
    });

    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    debugLog.error = String(err?.message || err);
    console.error("[DEMO][FATAL]", String(err?.message || err));

    try {
      logFile = logFile || (await writeDemoLog(debugLog));
    } catch {}

    sseWrite(res, "fatal", {
      ok: false,
      error: String(err?.message || err),
      signature,
      logFile,
    });

    clearInterval(heartbeat);
    res.end();
  }
}