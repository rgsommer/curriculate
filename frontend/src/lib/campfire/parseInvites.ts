// Pure helpers for turning a pasted invite blob into {name, email} pairs.
// No server imports here so it's safe to use in client components too.

export const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;
const EMAIL_G = /[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g;

export interface ParsedInvite {
  email: string;
  name: string;
}

// Parse "Jonathan Sommer <j@x.com>, Amber <a@x.com>, plain@x.com" into pairs.
// The name for each address is the text immediately before it (after the last
// separator), with brackets/quotes stripped. Bare emails get an empty name.
// Dedupes by email, keeping the first non-empty name seen.
export function parseInviteList(input: string): ParsedInvite[] {
  const s = String(input ?? "");
  const re = new RegExp(EMAIL_G.source, "g");
  const pairs: ParsedInvite[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const email = m[0].trim().toLowerCase();
    const chunk = s.slice(last, m.index);
    // The name belongs to this entry only — text after the last separator.
    const segs = chunk.split(/[,;\n]/);
    let name = segs[segs.length - 1]
      .replace(/["'<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (name.includes("@")) name = ""; // leftover address fragment, not a name
    pairs.push({ email, name });
    last = re.lastIndex;
  }

  const seen = new Map<string, string>();
  for (const { email, name } of pairs) {
    if (!EMAIL_RE.test(email)) continue;
    if (!seen.has(email)) seen.set(email, name);
    else if (!seen.get(email) && name) seen.set(email, name);
  }
  return Array.from(seen, ([email, name]) => ({ email, name }));
}

// First name for a friendly greeting ("Jonathan Sommer" -> "Jonathan").
export function firstName(name?: string | null): string {
  const n = (name ?? "").trim();
  return n ? n.split(/\s+/)[0] : "";
}
