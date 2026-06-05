// Light client-side profanity guard. Not exhaustive — a gentle nudge to keep
// group content kind, especially with students. Server RLS + reporting handle
// the rest. Matches whole words, case-insensitive, with common leet swaps.
const WORDS = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "asshole",
  "dick",
  "bastard",
  "slut",
  "whore",
  "nigger",
  "faggot",
  "retard",
];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "@": "a",
  $: "s",
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[01345@$]/g, (ch) => LEET[ch] ?? ch);
}

export function hasProfanity(text: string): boolean {
  const t = normalize(text);
  return WORDS.some((w) => new RegExp(`\\b${w}s?\\b`).test(t));
}
