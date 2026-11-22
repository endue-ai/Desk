/**
 * Settings › Keyboard's row for the key that opens Search endue from any app (#304, ADR 0238). It is
 * the person's `desk.palette.shortcut`: in the core, the runtime's own setting `palette.shortcut`
 * (as `desk.update.channel` is `update.channel`), which the shell reads and follows without a
 * restart (`apps/desk/shell/src/palette.rs`); `DESK_PALETTE_SHORTCUT` still wins there. It is
 * recorded as any other key, one chord, and kept in the shell's shortcut syntax
 * (`CommandOrControl+Shift+Space`, as `endue.eris.shortcut` is). A key Eris summons with is refused;
 * one the desk binds is kept, saying in words that the desk gives it up. The row shows the key the
 * shell holds, which the shell reports in `palette.shortcut.held`: a key another app holds, or one
 * the shell cannot read, is said in words and the key held before stays. A desk without the shell
 * (the browser) never answers; after a moment the row shows the key saved.
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
/** What the shell holds: `{ shortcut, refused: { shortcut, why } | null, env }`, owner `desk`;
 * `env` when `DESK_PALETTE_SHORTCUT` chose the key, so the setting is not in force. */
export const HELD_KEY = "palette.shortcut.held";
/** How long the row waits for the shell's answer before it shows the key saved. */
export const ANSWER_MS = 3000;
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

interface Held {
  shortcut?: unknown;
  refused?: { shortcut?: unknown; why?: unknown } | null;
  env?: unknown;
}

export interface GlobalKeyOptions {
  bridge: {
    call(method: string, params?: unknown): Promise<unknown>;
    /** The core's events: the shell's answer comes as settings.changed of HELD_KEY. */
    onEvent?(listener: (event: { event: string; data?: unknown }) => void): () => void;
  };
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
  /** The key just saved, waiting for the shell's answer, and what to say once it holds it. */
  let pending: { accelerator: string; said: string; timer: ReturnType<typeof setTimeout> } | null =
    null;
  const keys = h("span", { class: "keys", tabindex: "-1", "data-key": `setting-${PALETTE_KEY}` });
  /** The environment chose the key: a key recorded here is kept, in force once it no longer does. */
  const env = h("p", { class: "settings-key-env", hidden: true }, tr("paletteKeyEnv"));
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
    const said = taken
      ? fill(tr("paletteKeyDesk"), {
          key: formatSequence(chord, platform),
          command: options.title(taken.command) ?? taken.command,
        })
      : "";
    if (pending) clearTimeout(pending.timer);
    note.textContent = fill(tr("paletteKeyTaking"), { key: formatSequence(chord, platform) });
    // No shell answers in the browser: the key saved is the one in force next time the shell runs.
    const timer = setTimeout(() => {
      if (pending?.accelerator !== accelerator) return;
      pending = null;
      held = accelerator;
      show();
      note.textContent = said;
    }, ANSWER_MS);
    pending = { accelerator, said, timer };
  };
  /** The shell's answer: the key it holds, and the one it refused with why. */
  const answered = (value: unknown) => {
    const report = (value ?? {}) as Held;
    if (typeof report.shortcut === "string" && report.shortcut.trim()) held = report.shortcut;
    env.hidden = report.env !== true;
    show();
    const refused = report.refused;
    const was = pending;
    if (was) clearTimeout(was.timer);
    pending = null;
    if (refused && typeof refused.shortcut === "string")
      note.textContent = fill(tr("paletteKeyRefused"), {
        key: read(refused.shortcut),
        why: String(refused.why ?? ""),
      });
    else if (was) note.textContent = was.said;
  };
  const offEvents = bridge.onEvent?.((event) => {
    if (event.event !== "settings.changed") return;
    const data = event.data as { owner?: unknown; key?: unknown; value?: unknown } | undefined;
    if (data?.owner === "desk" && data.key === HELD_KEY) answered(data.value);
  });
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
        env,
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
  const value = (answer: unknown) => (answer as { value?: unknown } | undefined)?.value;
  void Promise.all([
    bridge.call("settings.get", { key: CORE_KEY }).catch(() => undefined),
    bridge.call("settings.get", { key: HELD_KEY }).catch(() => undefined),
  ]).then(([saved, report]) => {
    const text = value(saved);
    if (typeof text === "string" && text.trim()) held = text;
    // What the shell holds wins over what was saved: it may have refused it at start.
    if (value(report) !== undefined) {
      answered(value(report));
      return;
    }
    show();
  });
  return {
    el,
    dispose: () => {
      stop?.();
      stop = undefined;
      offEvents?.();
      if (pending) clearTimeout(pending.timer);
      pending = null;
    },
  };
}
