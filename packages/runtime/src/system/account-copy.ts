/**
 * Labels for the person's controls at the bottom left of the desk, and every line of endue ID's
 * sign-in (ADR 0111). The wording follows the endue.ai web where it has a line for the same moment
 * (refs/auth.md §2.2 and §4): its entry buttons, its callback errors and its "sign in again" dialog.
 */
import type { AccountStatus } from "../bridge/types";
import { type KeyOf, moduleText } from "../i18n/messages";
import type { Lang } from "../shell/copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("system", { en, ko });

type Id = KeyOf<keyof typeof en, "system">;
export type AccountKey = Id extends `account.${infer K}` ? K : never;

export const accountText = (lang: Lang, key: AccountKey): string =>
  text(lang, `account.${key}` as Id);

/** A reason the core gives (`slow-down`) as its message's key (`slowDown`). */
const keyOf = (reason: string) => reason.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/**
 * What the person reads about `status`'s problem, in `lang`: the reason's line, a waiting line while
 * the code still holds, or the core's own sentence for a reason this runtime does not know.
 */
export function problemText(lang: Lang, status: AccountStatus): string | undefined {
  const { reason, problem, state } = status;
  if (!reason) return problem;
  if (state === "signing-in") {
    if (reason === "slow-down") return accountText(lang, "slowWaiting");
    if (reason === "offline" || reason === "unavailable") return accountText(lang, "stillWaiting");
  }
  const key = keyOf(reason);
  return `system.account.${key}` in en ? accountText(lang, key as AccountKey) : problem;
}
