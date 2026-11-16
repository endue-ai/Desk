/**
 * What arranging windows says (ADR 0116): the rail's Arrange button (`strip`, ADR 0220), its
 * actions, their commands and the spread, whose
 * chrome the compositor draws in the desk's language (`spreadCopy`, sent with the page's report).
 */
import { type KeyOf, moduleText } from "../i18n/messages";
import type { Lang } from "../shell/copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("arrange", { en, ko });

export type ArrangeCopyKey = KeyOf<keyof typeof en, "arrange">;

export function arrangeText(
  lang: Lang,
  key: ArrangeCopyKey,
  vars: Record<string, string | number> = {},
): string {
  return text(lang, key, vars);
}

/** The spread's words for the compositor, `{n}`, `{m}`, `{q}` and `{title}` left to fill in. */
export function spreadCopy(lang: Lang): Record<string, string> {
  const raw = (key: ArrangeCopyKey) => text(lang, key);
  return {
    label: raw("spreadLabel"),
    filter: raw("filter"),
    count: raw("count"),
    countOf: raw("countOf"),
    hint: raw("hint"),
    noMatch: raw("noMatch"),
    option: raw("option"),
    optionAsleep: raw("optionAsleep"),
  };
}
