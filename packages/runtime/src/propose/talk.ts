/**
 * The talk line's sentences that ask Eris to make something: ones that start with "make", "build" or
 * "show me" go to desk.propose whole, and `/make` hands over what follows it. A sentence that names a
 * profile (made or built, not shown) makes a profile, and "bind … to …" makes key bindings; the rest
 * make views. Everything else stays a conversation (brain.say).
 */

export type ProposalKindName = "view" | "profile" | "keys";

const MAKE = /^(make|build|show me)\b/i;
const SLASH = /^\/make(\s+|$)/i;
const BIND = /^bind\s+\S.*\s+to\s+\S/i;
const PROFILE = /\bprofile\b/i;
const SHOW = /^show me\b/i;

/** Which kind a sentence asks for: key bindings, a profile, or else a view. */
export function kindOf(text: string): ProposalKindName {
  const said = text.trim();
  if (BIND.test(said)) return "keys";
  if (PROFILE.test(said) && !SHOW.test(said)) return "profile";
  return "view";
}

/** desk.propose's arguments for a sentence typed on the talk line, or null to talk instead. */
export function proposalOf(text: string): { kind: ProposalKindName; text: string } | null {
  const said = text.trim();
  const slash = SLASH.exec(said);
  if (slash) {
    const rest = said.slice(slash[0].length).trim();
    return rest ? { kind: kindOf(rest), text: rest } : null;
  }
  return MAKE.test(said) || BIND.test(said) ? { kind: kindOf(said), text: said } : null;
}
