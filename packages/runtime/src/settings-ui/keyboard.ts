/** Core shortcut editor shared by the settings window and older saved keyboard panes. */
import type { Commands } from "../commands";
import { isBinding, PERSONAL_KEYS } from "../core/defaults";
import { comboOf, formatCombo, type Platform } from "../input";
import type { KeysPolicy } from "../policies/keys";
import { commandAt, isDefault, type KeyLayers, keysOf, rebind, reset, unbind } from "../rebind";
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
  const layers = (): KeyLayers => ({
    contributed: options.contributed(),
    personal: settings.get<unknown[]>(PERSONAL_KEYS, []).filter(isBinding),
    platform,
  });
  const titleOf = (id: string) => commands.list().find((c) => c.id === id)?.title ?? id;
  const note = h("p", {
    class: "settings-key-note keys-note",
    role: "status",
    "aria-live": "polite",
  });
  const conflict = h("div", { class: "settings-conflict", hidden: true });
  const list = h("ul", { class: "settings-key-list" });
  const query = h("input", {
    type: "search",
    class: "settings-input",
    placeholder: tr("findCommand"),
    "aria-label": tr("findCommand"),
    onInput: () => {
      stop();
      draw();
    },
  });
  const el = h(
    "div",
    { class: "settings-keyboard" },
    h(
      "div",
      { class: "settings-key-tools" },
      query,
      h(
        "button",
        {
          type: "button",
          class: "settings-button",
          onClick: () => {
            stop();
            settings.set(PERSONAL_KEYS, []);
          },
        },
        tr("resetAll"),
      ),
    ),
    note,
    conflict,
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
  const commit = (id: string, combo: string) => {
    const result = rebind(layers(), id, combo);
    stop();
    settings.set(PERSONAL_KEYS, result.personal);
    note.textContent = result.displaced ? tr("moved") : "";
    list.querySelector<HTMLElement>(`[data-key="keys-change-${CSS.escape(id)}"]`)?.focus();
  };
  const record = (id: string) => {
    stop();
    recording = id;
    note.textContent = tr("record");
    stopRecording = listen(
      window,
      "keydown",
      (event) => {
        const k = event as KeyboardEvent;
        // Never let the key being recorded reach the shell or the browser.
        k.stopImmediatePropagation();
        if (k.isComposing || k.key === "Process" || k.keyCode === 229) return;
        k.preventDefault();
        if (["Meta", "Control", "Alt", "Shift", "OS"].includes(k.key) || k.repeat) return;
        if (k.key === "Escape") {
          note.textContent = "";
          stop();
          return;
        }
        if (!(k.metaKey || k.ctrlKey || k.altKey || /^F\d{1,2}$/.test(k.key))) {
          note.textContent = tr("invalid");
          return;
        }
        const combo = comboOf(k);
        const had = commandAt(layers(), combo);
        if (had && had !== id) {
          stopRecording?.();
          stopRecording = undefined;
          recording = null;
          draw();
          conflict.replaceChildren(
            h("p", {}, `${formatCombo(combo, platform)} — ${tr("conflict")} ${titleOf(had)}`),
            h(
              "button",
              {
                class: "settings-button",
                type: "button",
                onClick: () => {
                  stop();
                  note.textContent = "";
                },
              },
              tr("cancel"),
            ),
            h(
              "button",
              {
                class: "settings-button primary",
                type: "button",
                onClick: () => commit(id, combo),
              },
              tr("replace"),
            ),
          );
          conflict.hidden = false;
          conflict.querySelector("button")?.focus();
        } else commit(id, combo);
      },
      { capture: true },
    );
    draw();
  };

  function draw() {
    const q = query.value.trim().toLowerCase();
    const current = layers();
    const filtered = commands
      .list()
      .filter((c) =>
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
                  ? keys.map((key) => h("kbd", {}, formatCombo(key, platform)))
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
                  },
                  keys.length === 0,
                ),
                button(
                  "reset",
                  () => {
                    stop();
                    settings.set(PERSONAL_KEYS, reset(layers(), c.id));
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
