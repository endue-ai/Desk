/**
 * Settings › Keyboard's row for the key that opens Search Desk from any app (#304, ADR 0238). It is
 * the person's `desk.palette.shortcut`: in the core, the runtime's own setting `palette.shortcut`
 * (as `desk.update.channel` is `update.channel`), which the shell reads and follows without a
 * restart (`apps/desk/shell/src/palette.rs`); `DESK_PALETTE_SHORTCUT` still wins there. It is
 * recorded as any other key, one chord, and kept in the shell's shortcut syntax
 * (`CommandOrControl+Shift+Space`, as `endue.eris.shortcut` is). A key Eris summons with is refused;
 * one the desk binds is kept, saying in words that the desk gives it up.
 */
import type { Platform } from "../input";
import { splitChord } from "../sequences/chord";
import type { Resolved } from "../sequences/conflicts";
import { formatSequence } from "../sequences/parse";
import { recordKey } from "../sequences/record";
import type { Settings } from "../settings";
import { h, listen } from "../shell/dom";
import { type SettingsLanguage, settingsText } from "./copy";

/** The person's name for the setting, and the runtime's own key in the core. */
export const PALETTE_KEY = "desk.palette.shortcut";
export const CORE_KEY = "palette.shortcut";
/** The shell's default (`hotkeys.rs`, PALETTE_DEFAULT). */
export const DEFAULT = "CommandOrControl+Shift+Space";
const ERIS = "endue.eris.shortcut";
const ERIS_DEFAULT = "Alt+Enter";

const ORDER = ["Meta", "Control", "Alt", "Shift"] as const;
/** Keys whose names differ: the chord's (as a key press names it) and the shell's (a key code). */
const CODES: Record<string, string> = {
  "/": "Slash",
  ".": "Period",
  ",": "Comma",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",
};
const KEYS = Object.fromEntries(Object.entries(CODES).map(([key, code]) => [code, key]));
const ALIASES: Record<string, string> = { Return: "Enter", Esc: "Escape", Del: "Delete" };

/** A chord ("Meta+Shift+Space") in the shell's shortcut syntax ("CommandOrControl+Shift+Space"). */
export function toAccelerator(chord: string, platform: Platform): string {
  const { mods, key } = splitChord(chord);
  const held = new Set(
    mods.map((m) => (m === "Mod" ? (platform === "mac" ? "Meta" : "Control") : m)),
  );
  const primary = platform === "mac" ? "Meta" : "Control";
  const names = ORDER.filter((m) => held.has(m)).map((m) =>
    m === primary ? "CommandOrControl" : m === "Meta" ? "Super" : m,
  );
  const code = /^[A-Z]$/.test(key)
    ? `Key${key}`
    : /^[0-9]$/.test(key)
      ? `Digit${key}`
      : (CODES[key] ?? key);
  return [...names, code].join("+");
}

/** A shortcut as the shell writes it, as the chord a key press makes on `platform`. */
export function toChord(accelerator: string, platform: Platform): string {
  const parts = accelerator
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const key = parts.pop() ?? "";
  const held = new Set<string>();
  for (const part of parts) {
    const p = part.toLowerCase();
    if (["commandorcontrol", "cmdorctrl", "commandorctrl", "cmdorcontrol"].includes(p))
      held.add(platform === "mac" ? "Meta" : "Control");
    else if (["super", "meta", "command", "cmd"].includes(p)) held.add("Meta");
    else if (["control", "ctrl"].includes(p)) held.add("Control");
    else if (["alt", "option"].includes(p)) held.add("Alt");
    else if (p === "shift") held.add("Shift");
  }
  const letter = /^Key([A-Z])$/i.exec(key) ?? /^Digit([0-9])$/i.exec(key);
  const name = letter?.[1]
    ? letter[1].toUpperCase()
    : (KEYS[key] ?? ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return [...ORDER.filter((m) => held.has(m)), name].join("+");
}

export interface GlobalKeyOptions {
  bridge: { call(method: string, params?: unknown): Promise<unknown> };
  /** The runtime's settings, where Eris's key is read. */
  settings: Pick<Settings, "get">;
  platform: Platform;
  language: SettingsLanguage;
  /** The desk's keys in force. */
  bindings: () => Resolved[];
  /** A command's title, by its id. */
  title: (id: string) => string | undefined;
}

export interface GlobalKeyRow {
  el: HTMLElement;
  dispose(): void;
}

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");

export function globalKeyRow(options: GlobalKeyOptions): GlobalKeyRow {
  const { bridge, platform, language } = options;
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(language, key);
  let held = DEFAULT;
  let stop: (() => void) | undefined;
  const keys = h("span", { class: "keys", tabindex: "-1", "data-key": `setting-${PALETTE_KEY}` });
  const note = h("p", { class: "settings-key-note", role: "status", "aria-live": "polite" });
  const read = (text: string) => formatSequence(toChord(text, platform), platform);
  const show = () => {
    keys.textContent = read(held);
  };
  const save = async (chord: string) => {
    const accelerator = toAccelerator(chord, platform);
    const eris = options.settings.get<string>(ERIS, ERIS_DEFAULT) || ERIS_DEFAULT;
    if (toChord(eris, platform) === chord) {
      note.textContent = fill(tr("paletteKeyEris"), { key: formatSequence(chord, platform) });
      return;
    }
    const taken = options
      .bindings()
      .find((b) => b.chords.length === 1 && b.combo === chord && b.command !== "desk.palette.open");
    try {
      await bridge.call("settings.set", { key: CORE_KEY, value: accelerator });
    } catch (error) {
      note.textContent = fill(tr("paletteKeyFailed"), {
        why: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    held = accelerator;
    show();
    note.textContent = taken
      ? fill(tr("paletteKeyDesk"), {
          key: formatSequence(chord, platform),
          command: options.title(taken.command) ?? taken.command,
        })
      : "";
  };
  const record = () => {
    stop?.();
    note.textContent = tr("record");
    stop = listen(
      window,
      "keydown",
      (event) => {
        const k = event as KeyboardEvent;
        // Never let the key being recorded reach the shell or the browser.
        k.stopImmediatePropagation();
        if (k.isComposing || k.key === "Process" || k.keyCode === 229) return;
        k.preventDefault();
        const step = recordKey([], k, { several: false, isPrefix: () => false });
        if (step.kind === "cancel") {
          note.textContent = "";
          stop?.();
        } else if (step.kind === "invalid") note.textContent = tr("invalid");
        else if (step.kind === "save") {
          stop?.();
          note.textContent = "";
          void save(step.sequence);
        }
      },
      { capture: true },
    );
  };
  const reset = async () => {
    await save(toChord(DEFAULT, platform));
  };
  const el = h(
    "div",
    { class: "settings-group-rows settings-global-key" },
    h(
      "div",
      { class: "settings-row", "data-setting": PALETTE_KEY },
      h(
        "div",
        { class: "settings-row-label" },
        h("span", {}, tr("paletteKey")),
        h("p", {}, tr("paletteKeyHint")),
        note,
      ),
      keys,
      h(
        "button",
        {
          type: "button",
          class: "btn btn-xs btn-outline",
          "data-key": "record-palette-shortcut",
          onClick: record,
        },
        tr("change"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-xs btn-outline",
          "data-key": "reset-palette-shortcut",
          onClick: () => void reset(),
        },
        tr("reset"),
      ),
    ),
  );
  show();
  void bridge
    .call("settings.get", { key: CORE_KEY })
    .then((answer) => {
      const value = (answer as { value?: unknown } | undefined)?.value;
      if (typeof value === "string" && value.trim()) held = value;
      show();
    })
    .catch(() => {});
  return {
    el,
    dispose: () => {
      stop?.();
      stop = undefined;
    },
  };
}
