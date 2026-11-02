/**
 * desk.propose's arguments for a sentence said on the talk line, and the kind it asks for. Sentences
 * that start with "make", "build" or "show me", and "bind … to …", go to desk.propose whole; `/make`
 * hands over what follows it. "bind … to …" and a sentence that names shortcuts or key bindings make
 * key bindings, one that names a profile makes a profile (made or built, not shown), and the rest make
 * views. Whether the sentence goes to desk.propose, the theme studio or Eris's conversation is
 * route.ts's to decide.
 */

export type ProposalKindName = "view" | "profile" | "keys";

const MAKE = /^(make|build|show me)\b/i;
const SLASH = /^\/make(\s+|$)/i;
const BIND = /^bind\s+\S.*\s+to\s+\S/i;
const PROFILE = /\bprofiles?\b/i;
const KEYS = /\b(shortcuts?|key ?bindings?|keybindings?)\b/i;
const SHOW = /^show me\b/i;

/** Which kind a sentence asks for: key bindings, a profile, or else a view. */
export function kindOf(text: string): ProposalKindName {
  const said = text.trim();
  if (BIND.test(said)) return "keys";
  if (SHOW.test(said)) return "view";
  if (PROFILE.test(said)) return "profile";
  return KEYS.test(said) ? "keys" : "view";
}

/** desk.propose's arguments for a sentence typed on the talk line, or null when it is not one. */
export function proposalOf(text: string): { kind: ProposalKindName; text: string } | null {
  const said = text.trim();
  const slash = SLASH.exec(said);
  if (slash) {
    const rest = said.slice(slash[0].length).trim();
    return rest ? { kind: kindOf(rest), text: rest } : null;
  }
  return MAKE.test(said) || BIND.test(said) ? { kind: kindOf(said), text: said } : null;
}
