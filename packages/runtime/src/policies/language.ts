/**
 * desk.language: the language the desk speaks (ADR 0250). `system` (the default) follows the OS's
 * language, which the page that mounts the desk names; `en` and `ko` are chosen. A change applies
 * at once: the shell's store, the settings window and every plugin frame (`desk:language`) follow.
 */
import { type Language, resolveLanguage } from "@endue-ai/bridge";
import type { Settings } from "../settings";
import { type DeskContext, disposer, type Installed } from "./context";

export const LANGUAGE_SETTING = "desk.language";

/** The OS's language as this page reads it, among the desk's; English when it speaks none of them. */
export function osLanguage(): Language {
  return resolveLanguage("system", globalThis.navigator?.languages ?? []);
}

/** The language in force for these settings, `system` reading as `system`'s language. */
export function deskLanguage(settings: Pick<Settings, "get">, system: Language): Language {
  return resolveLanguage(settings.get<string>(LANGUAGE_SETTING, "system"), [system]);
}

/** Call `apply` with the language in force now and after each change; returns the function that stops. */
export function followLanguage(
  settings: Pick<Settings, "get" | "onChange">,
  system: Language,
  apply: (language: Language) => void,
): () => void {
  let current = deskLanguage(settings, system);
  apply(current);
  return settings.onChange((keys) => {
    if (!keys.includes(LANGUAGE_SETTING)) return;
    const next = deskLanguage(settings, system);
    if (next === current) return;
    current = next;
    apply(next);
  });
}

export interface DeskLanguage extends Installed {
  current(): Language;
  /** Hear each change of the language in force; the returned function stops. */
  onChange(listener: (language: Language) => void): () => void;
}

/**
 * desk.language for the runtime: kept current, shared with every plugin frame, put on the policy
 * context (`ctx.language()`) for modules installed before a change, and each change re-titles the
 * desk's own commands (#359).
 */
export function installLanguage(
  ctx: Pick<DeskContext, "hub" | "share" | "language">,
  system: Language = osLanguage(),
): DeskLanguage {
  const offs = disposer();
  const listeners = new Set<(language: Language) => void>();
  let current: Language = system;
  let started = false;
  offs.add(
    followLanguage(ctx.hub.settings, system, (language) => {
      current = language;
      ctx.share({ type: "desk:language", language });
      if (!started) return;
      ctx.hub.commands.retitle();
      for (const listener of [...listeners]) listener(language);
    }),
  );
  started = true;
  ctx.language = () => current;
  return {
    current: () => current,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      listeners.clear();
      offs.dispose();
    },
  };
}
