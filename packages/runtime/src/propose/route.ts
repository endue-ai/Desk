/**
 * Where a sentence said on the talk line goes: to a pack when it asks to set a service up (pack.ts),
 * to desk.propose when it asks Eris to make something
 * (talk.ts), to the design system studio's Describe when it asks to change the desk's design system,
 * to the theme studio's Describe when it asks to change the desk's look (eris/look.ts), or to Eris's
 * conversation. `/make` always goes to desk.propose. A sentence both could take ("make it
 * feel like warm paper", "make a board that looks calm") is a look, unless it names something
 * desk.propose makes (a view or one of its kinds of layout, a profile, shortcuts) and not the theme.
 */
import { isDesignRequest, isLookRequest } from "../eris/look";
import { serviceOf } from "./pack";
import { proposalOf } from "./talk";

export type Route =
  | { to: "propose"; args: NonNullable<ReturnType<typeof proposalOf>> }
  | { to: "pack"; service: string }
  | { to: "look" }
  | { to: "design" }
  | { to: "talk" };

const SLASH = /^\s*\/make\b/i;
const THEME = /\bthemes?\b|테마/i;
const MADE =
  /\b(views?|dashboards?|boards?|lists?|tables?|agendas?|kanban|charts?|graphs?|timelines?|calendars?|documents?|chats?|profiles?|shortcuts?)\b/i;

/** The route for `text`; `proposing` says whether desk.propose is there to take it. */
export function routeOf(text: string, proposing = true): Route {
  // "Set up GitHub", "깃허브 연결해줘": a pack for the service (ADR 0108).
  const service = proposing ? serviceOf(text) : null;
  if (service) return { to: "pack", service };
  const args = proposing ? proposalOf(text) : null;
  if (args && SLASH.test(text)) return { to: "propose", args };
  // "디자인 시스템을 각지게 바꿔줘": the components, not the theme's values (ADR 0090).
  if (isDesignRequest(text)) return { to: "design" };
  if (isLookRequest(text) && !(args && MADE.test(text) && !THEME.test(text))) return { to: "look" };
  return args ? { to: "propose", args } : { to: "talk" };
}
