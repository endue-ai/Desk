/** Core shortcut editor shared by the settings window and older saved keyboard panes. Keys are
 * sequences of chords (ADR 0118): recording reads a key as Emacs does (or chords until Enter, with
 * several keys in a row on), a key that would replace or shadow another asks first, and every
 * conflict is listed with its source line. */
import type { Commands } from "../commands";
import { isBinding, PERSONAL_KEYS, SEQUENCE_TIMEOUT } from "../core/defaults";
import { formatCombo, type Platform } from "../input";
import type { KeysPolicy } from "../policies/keys";
import {
  checkRebind,
  continuesKey,
  isDefault,
  type KeyLayers,
  keysOf,
  rebind,
  reset,
  unbind,
} from "../rebind";
import { sequenceText } from "../sequences/copy";
import {
  askBeforeBinding,
  conflictsSection,
  keyNodes,
  timeoutRow,
} from "../sequences/keyboard-parts";
import { formatSequence } from "../sequences/parse";
import { recordKey } from "../sequences/record";
import type { Settings } from "../settings";
import { h, listen, render } from "../shell/dom";
import { type SettingsLanguage, settingsText } from "./copy";

export interface KeyboardOptions {
  settings: Settings;
  commands: Commands;
  contributed: KeysPolicy["contributed"];
  keymap: KeysPolicy["keymap"];
  platform: Platform;
  language: SettingsLanguage;
}

export function mountKeyboard(options: KeyboardOptions): { el: HTMLElement; dispose(): void } {
  const { settings, commands, keymap, platform } = options;
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(options.language, key);
  const sq = (key: Parameters<typeof sequenceText>[1]) => sequenceText(options.language, key);
  const layers = (): KeyLayers => ({
    contributed: options.contributed(),
    personal: settings.get<unknown[]>(PERSONAL_KEYS, []).filter(isBinding),
    platform,
  });
  const titleOf = (id: string) => commands.list().find((c) => c.id === id)?.title ?? id;
  const parts = { platform, language: options.language, name: titleOf };
  const note = h("p", {
    class: "settings-key-note keys-note",
    role: "status",
    "aria-live": "polite",
  });
  const conflict = h("div", { class: "settings-conflict", hidden: true });
  const conflicts = h("div", { class: "keys-conflicts-slot" });
  const list = h("ul", { class: "settings-key-list" });
  let retainedRow: string | null = null;
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

  function draw() {
    const q = query.value.trim().toLowerCase();
    const current = layers();
    render(conflicts, () => [conflictsSection(keymap.conflicts?.() ?? [], parts)]);
    const filtered = commands
      .list()
      .filter(
        (c) =>
          c.id === retainedRow ||
          [
            c.title,
            c.id,
            ...c.keywords,
            ...keysOf(current, c.id).map((k) => formatCombo(k, platform)),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
      );
    render(list, () =>
      filtered.length
        ? filtered.map((c) => {
            const keys = keysOf(current, c.id);
            const active = recording === c.id;
            const button = (
              action: "change" | "reset" | "remove",
              click: () => void,
              disabled = false,
            ) =>
              h(
                "button",
                {
                  class: "settings-button",
                  type: "button",
                  "data-key": `keys-${action}-${c.id}`,
                  "aria-label": `${c.title} · ${tr(action)}`,
                  disabled,
                  ...(action === "change" ? { "aria-pressed": String(active) } : {}),
                  onClick: click,
                },
                active && action === "change" ? tr("record") : tr(action),
              );
            return h(
              "li",
              {
                class: `settings-key-row key-row${active ? " is-recording" : ""}`,
                "data-command": c.id,
              },
              h("span", { class: "settings-key-label" }, c.title, h("small", {}, c.id)),
              h(
                "span",
                { class: "settings-key-combo" },
                keys.length
                  ? keys.map((key) =>
                      h("span", { class: "keys-sequence" }, ...keyNodes(key, platform)),
                    )
                  : tr("none"),
              ),
              h(
                "div",
                { class: "settings-key-actions" },
                button("change", () => (active ? stop() : record(c.id))),
                button(
                  "remove",
                  () => {
                    stop();
                    settings.set(PERSONAL_KEYS, unbind(layers(), c.id));
                    focusChange(c.id);
                  },
                  keys.length === 0,
                ),
                button(
                  "reset",
                  () => {
                    stop();
                    settings.set(PERSONAL_KEYS, reset(layers(), c.id));
                    focusChange(c.id);
                  },
                  isDefault(current, c.id),
                ),
              ),
            );
          })
        : [h("li", { class: "settings-empty" }, tr("noResults"))],
    );
  }
  draw();
  const offKeys = keymap.onChange(draw);
  const offCommands = commands.onChange(draw);
  return {
    el,
    dispose: () => {
      stopRecording?.();
      offKeys();
      offCommands();
    },
  };
}
