// shared/excludedTeamNames.js
// Words that should be silently REMOVED from team names if present.
// Matching is case-insensitive and whole-word only.

const EXCLUDED_TEAM_WORDS = [
  // Profanity / crude
  "damn", "hell", "crap", "ass", "fuck", "asshole", "shit", "piss", "bastard",

  // Violence / harm
  "kill", "killer", "murder", "dead", "death", "die",
  "blood", "stab", "shoot", "gun", "bomb", "terror", "terrorist",

  // Drugs / alcohol
  "drug", "drugs", "weed", "pot", "coke", "crack", "meth", "heroin",
  "alcohol", "beer", "vodka", "whiskey", "wine",

  // Hate / extremism
  "hate", "nazi", "racist",

  // Sexual / inappropriate
  "sex", "sexy", "porn", "nude", "naked",

  // Self-harm related
  "suicide", "suicidal",

  // Bullying / insults
  "loser", "idiot", "stupid", "moron",

  // School-unsafe slang
  "freak", "creep",
];

export default EXCLUDED_TEAM_WORDS;
