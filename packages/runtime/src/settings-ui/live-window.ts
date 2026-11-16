/**
 * The settings window in the desk's language (desk.language, ADR 0250): its words are fixed when it
 * is built, so each language chosen builds it again, open at the section it showed if it was open.
 */
import type { Preferences } from "../core/preferences";
import type { DeskContext } from "../policies/context";
import type { KeysPolicy } from "../policies/keys";
import type { DeskLanguage } from "../policies/language";
import { installSettingsWindow, type SettingsWindow } from "./window";

export function installLiveSettingsWindow(
  ctx: DeskContext,
  keys: KeysPolicy,
  preferences: Preferences,
  language: Pick<DeskLanguage, "current" | "onChange">,
): SettingsWindow {
  let built = installSettingsWindow(ctx, keys, preferences, language.current());
  const off = language.onChange((next) => {
    const where = built.showing();
    built.dispose();
    built = installSettingsWindow(ctx, keys, preferences, next);
    if (where) built.open(where);
  });
  return {
    open: (section) => built.open(section),
    close: () => built.close(),
    showing: () => built.showing(),
    dispose: () => {
      off();
      built.dispose();
    },
  };
}
