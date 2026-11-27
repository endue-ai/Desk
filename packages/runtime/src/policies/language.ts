/**
 * desk.language: the language the desk speaks (ADR 0250). `system` (the default) follows the OS's
 * language, which the page that mounts the desk names; `en` and `ko` are chosen. A change applies
 * at once: the shell's store, the settings window and every plugin frame (`desk:language`) follow,
 * and the app's menu bar and tray, which read the choice in the core (ADR 0276).
 */
import { type BridgeClient, type Language, resolveLanguage } from "@endue-ai/bridge";
import type { Settings } from "../settings";
import { type DeskContext, disposer, type Installed } from "./context";

export const LANGUAGE_SETTING = "desk.language";
/**
 * desk.language in the core: the runtime's own setting `language`, as `desk.palette.shortcut` is
 * `palette.shortcut`. init.yaml's desk.language reads there too; the shell reads it at start and
 * follows its settings.changed (`apps/desk/shell/src/language.rs`).
 */
export const CORE_LANGUAGE = "language";

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

/**
 * Write the choice in force (`system`, `en`, `ko`) to the core as CORE_LANGUAGE when the core holds
 * another, and again after each change, the latest choice once the write before it is done. `synced`
 * resolves once the first is; nothing rejects, so a core that refuses leaves the desk as it is.
 */
export function mirrorLanguage(
  settings: Pick<Settings, "get" | "onChange">,
  bridge: Pick<BridgeClient, "call">,
): { synced: Promise<void>; stop(): void } {
  let held: unknown;
  let queue: Promise<void> = bridge.call("settings.get", { key: CORE_LANGUAGE }).then(
    (answer) => {
      held = (answer as { value?: unknown }).value ?? "system";
    },
    () => undefined,
  );
  const write = () => {
    queue = queue
      .then(async () => {
        const value = settings.get<string>(LANGUAGE_SETTING, "system");
        if (value === held) return;
        await bridge.call("settings.set", { key: CORE_LANGUAGE, value });
        held = value;
      })
      .catch(() => undefined);
    return queue;
  };
  const synced = write();
  const stop = settings.onChange((keys) => {
    if (keys.includes(LANGUAGE_SETTING)) void write();
  });
  return { synced, stop };
}

export interface DeskLanguage extends Installed {
  current(): Language;
  /** Hear each change of the language in force; the returned function stops. */
  onChange(listener: (language: Language) => void): () => void;
  /**
   * Call once the settings are in (init.yaml, the profile, the saved preferences): the core learns
   * the choice, so the shell's menus follow it, and each change after. Before, a choice is not
   * written, so the shell keeps the one it started with while they load.
   */
  loaded(): Promise<void>;
}

/**
 * desk.language for the runtime: kept current, shared with every plugin frame, put on the policy
 * context (`ctx.language()`) for modules installed before a change, and each change re-titles the
 * desk's own commands (#359).
 */
export function installLanguage(
  ctx: Pick<DeskContext, "hub" | "share" | "language" | "bridge">,
  system: Language = osLanguage(),
): DeskLanguage {
  const offs = disposer();
  const listeners = new Set<(language: Language) => void>();
  let current: Language = system;
  let started = false;
  let mirrored: Promise<void> | undefined;
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
    loaded: () => {
      if (!mirrored) {
        const mirror = mirrorLanguage(ctx.hub.settings, ctx.bridge);
        offs.add(mirror.stop);
        mirrored = mirror.synced;
      }
      return mirrored;
    },
    dispose: () => {
      listeners.clear();
      offs.dispose();
    },
  };
}
