/**
 * The talk line's sentences that ask Eris to make something: ones that start with "make", "build" or
 * "show me" go to desk.propose whole, and `/make` hands over what follows it. The rest stay a
 * conversation (brain.say).
 */

const MAKE = /^(make|build|show me)\b/i;
const SLASH = /^\/make(\s+|$)/i;

/** desk.propose's arguments for a sentence typed on the talk line, or null to talk instead. */
export function proposalOf(text: string): { kind: "view"; text: string } | null {
  const said = text.trim();
  const slash = SLASH.exec(said);
  if (slash) {
    const rest = said.slice(slash[0].length).trim();
    return rest ? { kind: "view", text: rest } : null;
  }
  return MAKE.test(said) ? { kind: "view", text: said } : null;
}
