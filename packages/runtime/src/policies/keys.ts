/**
 * Core key bindings and the commands that belong to the keymap itself: quit
 * (C-g: stop what is in progress), the list of bindings and their conflicts. The person's own
 * bindings (`desk.keys.bindings`, set by a rebinding screen or init.yaml) are the last layer. Keys
 * are sequences of chords (ADR 0118): while a prefix is pending the which-key overlay lists what
 * can follow and the status area shows the keys pressed so far.
 */
import type { KeyBinding } from "@endue-ai/bridge";
import { isBinding, PERSONAL_KEYS, SEQUENCE_TIMEOUT } from "../core/defaults";
import { DEFAULT_KEYS } from "../core/keys";
import type { Notify } from "../gesture";
import { formatCombo } from "../input";
import { Keymap } from "../keymap";
import type { PolicySet } from "../policy";
import { sequenceText } from "../sequences/copy";
import { mountIndicator } from "../sequences/indicator";
import { conflictText, lintLines, sourceText } from "../sequences/report";
import { personalSources, withSources } from "../sequences/sources";
import { mountWhichKey } from "../sequences/which-key";
import { type DeskContext, disposer, type Installed } from "./context";

/** The setting that holds the person's layer of the keymap. */
export { PERSONAL_KEYS } from "../core/defaults";

export interface KeysPolicy extends Installed {
  keymap: Keymap;
  /** Core defaults and plugin bindings, in layer order, without the person's. */
  contributed(): PolicySet["keys"];
  /** The person's layer as it is now. */
  personal(): KeyBinding[];
  /** Run when the person quits (Escape by default): hide the palette, dismiss a notice. */
  onQuit(handler: () => void): () => void;
}

/** `notify` is where a bound command's failure is said (desk.notify's notices). */
export function installKeys(
  ctx: DeskContext,
  language: "ko" | "en" = "en",
  notify?: Notify,
): KeysPolicy {
  const { hub, shortcuts } = ctx;
  const { commands, settings } = hub;
  const keymap = new Keymap(shortcuts, commands, notify);
  const quitters = new Set<() => void>();
  const offs = disposer();
  const sources = personalSources(settings);
  const { platform } = shortcuts;

  const personal = (): KeyBinding[] => {
    const value = settings.get<unknown>(PERSONAL_KEYS, []);
    return Array.isArray(value) ? value.filter(isBinding) : [];
  };
  /** The settings layer the person's bindings come from. */
  const layer = () =>
    (["session", "profile", "init"] as const).find((name) => PERSONAL_KEYS in settings.layer(name));
  const apply = () =>
    keymap.apply(
      withSources(DEFAULT_KEYS, hub.policy.keys, personal(), {
        plugins: hub.plugins,
        layer: layer(),
        file: sources.get(),
      }),
    );
  offs.add(hub.onPolicy(apply));
  offs.add(settings.onChange((keys) => keys.includes(PERSONAL_KEYS) && apply()));
  offs.add(sources.onChange(apply));
  offs.add(() => keymap.apply([]));

  // How long a prefix waits: as long as it takes unless the setting says otherwise.
  const timeout = () => {
    const ms = settings.get<unknown>(SEQUENCE_TIMEOUT, 0);
    const value = typeof ms === "number" && Number.isFinite(ms) ? Math.min(ms, 10000) : 0;
    shortcuts.sequences.configure({ timeoutMs: value, ...(ctx.clock ? { clock: ctx.clock } : {}) });
  };
  timeout();
  offs.add(settings.onChange((keys) => keys.includes(SEQUENCE_TIMEOUT) && timeout()));
  offs.add(() => shortcuts.sequences.cancel());

  const titles = () => new Map(commands.list().map((c) => [c.id, c.title]));
  const ownerName = (owner: string) => {
    if (owner === "person") return sequenceText(language, "you");
    if (owner === "desk") return sequenceText(language, "desk");
    return hub.plugins.find((p) => p.id === owner)?.manifest?.name ?? owner;
  };
  if (ctx.root) {
    const overlay = mountWhichKey({
      root: ctx.root,
      sequences: shortcuts.sequences,
      platform,
      language,
      bindings: () => keymap.resolved(),
      facts: {
        title: (id) => titles().get(id),
        available: (id) => commands.has(id),
        owner: ownerName,
      },
    });
    offs.add(overlay.dispose);
    if (ctx.clock) {
      const indicator = mountIndicator({
        root: ctx.root,
        sequences: shortcuts.sequences,
        platform,
        language,
        clock: ctx.clock,
      });
      offs.add(indicator.dispose);
    }
  }

  offs.add(
    commands.define("desk.keys.quit", {
      title: language === "ko" ? "진행 중인 작업 닫기" : "Quit what is in progress",
      keywords: ["cancel", "escape", "keyboard-quit"],
      owner: "desk",
      run: () => {
        for (const quit of quitters) quit();
      },
    }),
  );
  offs.add(
    commands.define("desk.keys.list", {
      title: language === "ko" ? "단축키 목록 보기" : "List key bindings",
      // Emacs's describe-bindings, but "describe" alone finds desk.describe.open (Describe…) first.
      keywords: ["keys", "shortcuts", "bindings", "describe-bindings"],
      owner: "desk",
      // A sequence's key reads chord by chord, one space between: "⌘K ⌘S".
      run: () =>
        keymap.bindings().map((binding) => ({
          key: formatCombo(binding.combo, platform),
          combo: binding.combo,
          command: binding.command,
          owner: binding.owner,
        })),
    }),
  );
  offs.add(
    commands.define("desk.keys.conflicts", {
      title: language === "ko" ? "단축키 충돌 보기" : "List key binding conflicts",
      keywords: ["keys", "shortcuts", "conflicts", "shadowed", "lint"],
      owner: "desk",
      run: () => {
        const words = { platform };
        const conflicts = keymap.conflicts();
        return {
          conflicts: conflicts.map((conflict) => ({
            kind: conflict.kind,
            severity: conflict.severity,
            key: formatCombo(conflict.binding.combo, platform),
            command: conflict.binding.command,
            owner: conflict.binding.owner,
            source: sourceText(conflict.binding),
            bound: conflict.bound,
            ...(conflict.by
              ? {
                  by: {
                    key: formatCombo(conflict.by.combo, platform),
                    command: conflict.by.command,
                    owner: conflict.by.owner,
                    source: sourceText(conflict.by),
                  },
                }
              : {}),
            text: conflictText(conflict, words),
          })),
          lines: lintLines(conflicts, words),
        };
      },
    }),
  );

  return {
    keymap,
    contributed: () => [...DEFAULT_KEYS, ...hub.policy.keys],
    personal,
    onQuit: (handler) => {
      quitters.add(handler);
      return () => quitters.delete(handler);
    },
    dispose: offs.dispose,
  };
}
