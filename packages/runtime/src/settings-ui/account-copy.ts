/**
 * Every line of Settings, endue account (ADR 0130), in Korean and English (messages/, ADR 0250). The wording follows
 * endue.ai's Account and General settings where they have a line for the same setting, so the two
 * read alike; sign-in lines follow the account popover's (system/account-copy.ts).
 */
import type { AccountNotificationKind } from "@endue-ai/bridge";
import { type KeyOf, moduleText } from "../i18n/messages";
import type { SettingsLanguage } from "./copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("settingsUi", { en, ko });

type Id = KeyOf<keyof typeof en, "settingsUi">;
export type AccountCopy = Id extends `account.${infer K}`
  ? K extends `kind.${string}` | `kindHint.${string}`
    ? never
    : K
  : never;

export const accountText = (
  lang: SettingsLanguage,
  key: AccountCopy,
  vars: Record<string, string> = {},
): string => text(lang, `account.${key}` as Id, vars);

const camel = (kind: string) => kind.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** Each kind of notification as endue.ai's settings name it: label and when it comes. */
export function kindText(
  lang: SettingsLanguage,
  kind: AccountNotificationKind,
): { label: string; hint: string } {
  const label = text(lang, `account.kind.${camel(kind)}` as Id);
  const hint = text(lang, `account.kindHint.${camel(kind)}` as Id);
  return { label, hint };
}
