/** Core shortcut editor shared by the settings window and older saved keyboard panes. Keys are
 * sequences of chords (ADR 0118): recording reads a key as Emacs does (or chords until Enter, with
 * several keys in a row on), a key that would replace or shadow another asks first, and every
 * conflict is listed in a person's words. The list shows the commands with a shortcut, or all of
 * them, in groups with an index (#158 findings 16 and 19). */
import type { Commands } from "../commands";
import { isBinding, PERSONAL_KEYS, SEQUENCE_TIMEOUT } from "../core/defaults";
import type { Platform } from "../input";
import type { KeysPolicy } from "../policies/keys";
import {
  checkRebind,
  continuesKey,
  type KeyLayers,
  keysOf,
  rebind,
  reset,
  unbind,
} from "../rebind";
import type { Resolved } from "../sequences/conflicts";
import { sequenceText } from "../sequences/copy";
import { askBeforeBinding, timeoutRow } from "../sequences/keyboard-parts";
import { formatSequence } from "../sequences/parse";
import { recordKey } from "../sequences/record";
import type { Settings } from "../settings";
import { h, listen, render } from "../shell/dom";
import { type SettingsLanguage, settingsText } from "./copy";
import { jumpIndex } from "./jump";
import { type ConflictWords, conflictsPanel, who } from "./key-conflicts";
import {
  type KeyView,
  keyGroup,
  keyGroups,
  keyRow,
  matchesCommand,
  type RowAction,
  viewSwitch,
} from "./key-list";

export interface KeyboardOptions {
  settings: Settings;
  commands: Commands;
  contributed: KeysPolicy["contributed"];
  keymap: KeysPolicy["keymap"];
  platform: Platform;
  language: SettingsLanguage;
  /** A plugin's name, by its id: the list's groups and who set a conflicting key. */
  plugin?: (id: string) => string;
}

export interface KeyboardPane {
  el: HTMLElement;
  /** Put the caret in the shortcuts' own search (⌘/ opens Settings here). */
  focusSearch(): void;
  dispose(): void;
}

export function mountKeyboard(options: KeyboardOptions): KeyboardPane {
  const { settings, commands, keymap, platform } = options;
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(options.language, key);
  const sq = (key: Parameters<typeof sequenceText>[1]) => sequenceText(options.language, key);
  const layers = (): KeyLayers => ({
    contributed: options.contributed(),
    personal: settings.get<unknown[]>(PERSONAL_KEYS, []).filter(isBinding),
    platform,
  });
  const titled = (id: string) => commands.list().find((c) => c.id === id)?.title;
  const plugin = options.plugin ?? ((id: string) => id);
  const words: ConflictWords = { platform, language: options.language, title: titled, plugin };
  const parts = {
    platform,
    language: options.language,
    name: (id: string) => titled(id) ?? id,
    where: (b: Resolved) => who(b, words),
  };
  const note = h("p", {
    class: "settings-key-note keys-note",
    role: "status",
    "aria-live": "polite",
  });
  const conflict = h("div", { class: "settings-conflict", hidden: true });
  const conflicts = h("div", { class: "keys-conflicts-slot" });
  const views = h("div", { class: "keys-views" });
  const index = h("div", { class: "keys-index" });
  const list = h("div", { class: "settings-key-groups" });
  let retainedRow: string | null = null;
  // The commands the shortcuts view has shown since it opened: a key cleared keeps its row.
  let view: KeyView = "shortcuts";
  let kept = new Set<string>();
  const query = h("input", {
    type: "search",
    class: "settings-input",
    placeholder: tr("findCommand"),
    "aria-label": tr("findCommand"),
    onInput: () => {
      retainedRow = null;
      stop();
      draw();
    },
  });
  const restoreAll = h(
    "button",
    { type: "button", class: "settings-button", onClick: confirmRestore },
    tr("resetAll"),
  );
  // Off: a chord ends the key unless keys in force continue it (Emacs). On: chords until Enter.
  const several = h("input", { type: "checkbox", class: "desk-check", "data-key": "keys-several" });
  const el = h(
    "div",
    { class: "settings-keyboard" },
    h("div", { class: "settings-key-tools" }, query, restoreAll),
    h("label", { class: "keys-several" }, several, " ", sq("several")),
    timeoutRow(settings, SEQUENCE_TIMEOUT, options.language),
    note,
    conflict,
    conflicts,
    views,
    index,
    list,
  );
  let recording: string | null = null;
  let stopRecording: (() => void) | undefined;

  function stop() {
    stopRecording?.();
    stopRecording = undefined;
    recording = null;
    conflict.hidden = true;
    note.textContent = "";
    draw();
  }
  const confirm = (children: HTMLElement[]) => {
    conflict.replaceChildren(...children);
    conflict.hidden = false;
    conflict.querySelector("button")?.focus();
  };
  function confirmRestore() {
    stop();
    const button = (label: string, primary: boolean, click: () => void) =>
      h(
        "button",
        { class: `settings-button${primary ? " primary" : ""}`, type: "button", onClick: click },
        label,
      );
    confirm([
      h("p", {}, tr("restoreConfirm")),
      button(tr("cancel"), false, () => {
        stop();
        restoreAll.focus();
      }),
      button(tr("restore"), true, () => {
        stop();
        settings.set(PERSONAL_KEYS, []);
        restoreAll.focus();
      }),
    ]);
  }
  const focusChange = (id: string) => {
    const find = () =>
      list.querySelector<HTMLElement>(`[data-key="keys-change-${CSS.escape(id)}"]`);
    if (!find()) {
      // Keep the edited row visible when its old shortcut was the search match.
      retainedRow = id;
      draw();
    }
    find()?.focus();
  };
  const commit = (id: string, sequence: string) => {
    const result = rebind(layers(), id, sequence);
    stop();
    settings.set(PERSONAL_KEYS, result.personal);
    note.textContent = result.shadowed ? sq("shadowed") : result.displaced ? tr("moved") : "";
    focusChange(id);
  };
  /** Bind `sequence` to `id`, or first ask what it would replace or shadow, or refuse it. */
  const save = (id: string, sequence: string) => {
    stopRecording?.();
    stopRecording = undefined;
    recording = null;
    draw();
    const asked = askBeforeBinding(
      checkRebind(layers(), id, sequence),
      { ...parts, conflict: tr("conflict"), replace: tr("replace"), cancel: tr("cancel") },
      { cancel: () => stop(), bind: () => commit(id, sequence) },
    );
    if (asked) confirm(asked);
    else commit(id, sequence);
  };
  const record = (id: string) => {
    stop();
    recording = id;
    let chords: string[] = [];
    const mode = {
      several: several.checked,
      isPrefix: (next: string[]) => continuesKey(layers(), next),
    };
    note.textContent = mode.several ? sq("recordKeys") : tr("record");
    stopRecording = listen(
      window,
      "keydown",
      (event) => {
        const k = event as KeyboardEvent;
        // Never let the key being recorded reach the shell or the browser.
        k.stopImmediatePropagation();
        if (k.isComposing || k.key === "Process" || k.keyCode === 229) return;
        k.preventDefault();
        const step = recordKey(chords, k, mode);
        if (step.kind === "cancel") stop();
        else if (step.kind === "invalid") note.textContent = tr("invalid");
        else if (step.kind === "save") save(id, step.sequence);
        else if (step.kind === "chords") {
          chords = step.chords;
          const next = mode.several ? sq("enterToSave") : sq("nextKey");
          note.textContent = chords.length
            ? `${formatSequence(chords.join(" "), platform)} — ${next}`
            : mode.several
              ? sq("recordKeys")
              : tr("record");
        }
      },
      { capture: true },
    );
    draw();
  };
  const act = (action: RowAction, id: string) => {
    if (action === "change") return recording === id ? stop() : record(id);
    stop();
    settings.set(PERSONAL_KEYS, action === "remove" ? unbind(layers(), id) : reset(layers(), id));
    focusChange(id);
  };
  const choose = (next: KeyView) => {
    view = next;
    kept = new Set();
    retainedRow = null;
    stop();
  };

  function draw() {
    const q = query.value.trim().toLowerCase();
    const current = layers();
    // A search shows its matches at the top: the conflicts wait until it is cleared.
    render(conflicts, () => [q ? null : conflictsPanel(keymap.conflicts?.() ?? [], words)]);
    const all = commands.list();
    const keyed = all.filter((c) => keysOf(current, c.id).length > 0);
    if (view === "shortcuts") for (const c of keyed) kept.add(c.id);
    const shown = all.filter(
      (c) =>
        c.id === retainedRow ||
        (q
          ? matchesCommand(c, keysOf(current, c.id), platform, q)
          : view === "all" || kept.has(c.id)),
    );
    render(views, () => [
      viewSwitch(view, { shortcuts: keyed.length, all: all.length }, options.language, choose),
    ]);
    const groups = keyGroups(shown, plugin, tr("deskCommands"));
    render(index, () => [jumpIndex(tr("jumpTo"), groups, () => list)]);
    const row = (c: (typeof all)[number]) =>
      keyRow(c, {
        layers: current,
        platform,
        language: options.language,
        recording,
        act: (action) => act(action, c.id),
      });
    render(list, () =>
      shown.length
        ? groups.map((group) => keyGroup(group, row))
        : [h("p", { class: "settings-empty" }, tr("noResults"))],
    );
  }
  draw();
  const offKeys = keymap.onChange(draw);
  const offCommands = commands.onChange(draw);
  return {
    el,
    focusSearch: () => query.focus(),
    dispose: () => {
      stopRecording?.();
      offKeys();
      offCommands();
    },
  };
}
