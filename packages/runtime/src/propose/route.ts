/**
 * Where a sentence said on the talk line goes: to desk.propose when it asks Eris to make something
 * (talk.ts), to the theme studio's Describe when it asks to change the desk's look (eris/look.ts), or
 * to Eris's conversation. `/make` always goes to desk.propose. A sentence both could take ("make it
 * feel like warm paper", "make a board that looks calm") is a look, unless it names something
 * desk.propose makes (a view or one of its kinds of layout, a profile, shortcuts) and not the theme.
 */
import { isLookRequest } from "../eris/look";
import { proposalOf } from "./talk";

export type Route =
  | { to: "propose"; args: NonNullable<ReturnType<typeof proposalOf>> }
  | { to: "look" }
  | { to: "talk" };

const SLASH = /^\s*\/make\b/i;
const THEME = /\bthemes?\b|테마/i;
const MADE =
  /\b(views?|dashboards?|boards?|lists?|tables?|agendas?|kanban|charts?|graphs?|timelines?|profiles?|shortcuts?)\b/i;

/** The route for `text`; `proposing` says whether desk.propose is there to take it. */
export function routeOf(text: string, proposing = true): Route {
  const args = proposing ? proposalOf(text) : null;
  if (args && SLASH.test(text)) return { to: "propose", args };
  if (isLookRequest(text) && !(args && MADE.test(text) && !THEME.test(text))) return { to: "look" };
  return args ? { to: "propose", args } : { to: "talk" };
}
