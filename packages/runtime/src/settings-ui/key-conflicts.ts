/**
 * Settings › Keyboard's conflicts in a person's words (#158 finding 16): which shortcut does not run
 * as it is set, why, and who set it (you, the desk, or a plugin by its name), never a file path or a
 * command's id. `desk.keys.conflicts` and `desk settings lint` keep the developer's lines with their
 * sources (`sequences/report.ts`).
 */
import { type KeyOf, moduleText } from "../i18n/messages";
import type { Platform } from "../sequences/chord";
import type { Conflict, Resolved } from "../sequences/conflicts";
import { keyNodes } from "../sequences/keyboard-parts";
import { formatSequence } from "../sequences/parse";
import { h } from "../shell/dom";
import type { SettingsLanguage } from "./copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

export interface ConflictWords {
  platform: Platform;
  language: SettingsLanguage;
  /** A command's title; undefined when no such command is there now. */
  title(command: string): string | undefined;
  /** A plugin's name, by its id. */
  plugin(id: string): string;
}

const text = moduleText("settingsUi", { en, ko });
type Id = KeyOf<keyof typeof en, "settingsUi">;
type Copy = KeyOf<Id, "conflicts">;
const say = (words: ConflictWords, key: Copy, vars?: Record<string, string>) =>
  text(words.language, `conflicts.${key}` as Id, vars);

/** A phrase as a message key's last part: "the app's windows" reads theAppsWindows. */
const keyOf = (phrase: string) =>
  phrase
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .map((w, i) => (i ? w.charAt(0).toUpperCase() : w.charAt(0).toLowerCase()) + w.slice(1))
    .join("");

/** What the system does with a reserved chord: from the catalog, else `Reserved.does` as is. */
function doesText(words: ConflictWords, does: string): string {
  const key = `does.${keyOf(does)}` as Copy;
  const said = say(words, key);
  return said === `settingsUi.conflicts.${key}` ? does : said;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The conflicts a person is shown: a key that two layers give the same command loses nothing. */
export function shownConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.filter(
    ({ kind, binding, by }) =>
      !(kind === "duplicate" && by?.command === binding.command && same(by.args, binding.args)),
  );
}

/** Why `conflict` keeps its key from running, as one or two sentences. */
export function conflictReason(conflict: Conflict, words: ConflictWords): string {
  const keys = (b: Resolved) => formatSequence(b.combo, words.platform);
  const { binding, by, reserved } = conflict;
  if (conflict.kind === "reserved" && reserved) {
    const chord = formatSequence(reserved.chord, words.platform);
    const does = doesText(words, reserved.does);
    if (reserved.never) return say(words, "never", { chord, does, fix: say(words, "another") });
    const holder = say(words, `holder.${keyOf(reserved.by)}` as Copy);
    const fix = reserved.by === "the desk" ? say(words, "another") : say(words, "offThere");
    return say(words, "reserved", { holder, does, fix });
  }
  if (!by) return "";
  const other = `“${name(by.command, words)}”`;
  if (conflict.kind === "duplicate")
    return say(words, "duplicate", { other, who: lower(who(by, words)) });
  if (binding.chords.length > by.chords.length)
    return say(words, "prefixFirst", { keys: keys(by), other });
  return say(words, "startsWith", { keys: keys(by) });
}

/** A command's title, or what it is when it is not there now. */
function name(command: string, words: ConflictWords): string {
  return words.title(command) ?? say(words, "absent");
}

/** Who set a binding: you, the desk itself, or a plugin by its name. */
export function who(binding: Resolved, words: ConflictWords): string {
  if (binding.layer === "personal") return say(words, "you");
  if (binding.layer === "default") return say(words, "desk");
  return say(words, "plugin", { plugin: words.plugin(binding.owner) });
}

/** Every conflict a person should know of; the keys a later layer took over under a disclosure. */
export function conflictsPanel(conflicts: Conflict[], words: ConflictWords): HTMLElement | null {
  const shown = shownConflicts(conflicts);
  if (!shown.length) return null;
  const tr = (key: Copy) => say(words, key);
  const item = (conflict: Conflict) =>
    h(
      "li",
      {
        class: `settings-key-row keys-conflict is-${conflict.severity}`,
        "data-conflict": conflict.kind,
        "data-combo": conflict.binding.combo,
      },
      h(
        "span",
        { class: "settings-key-label" },
        h("strong", {}, name(conflict.binding.command, words)),
        h("span", { class: "keys-conflict-why" }, conflictReason(conflict, words)),
        h("small", {}, who(conflict.binding, words)),
      ),
      h(
        "span",
        { class: "settings-key-combo" },
        ...keyNodes(conflict.binding.combo, words.platform),
      ),
    );
  const serious = shown.filter((c) => c.severity !== "info");
  const settled = shown.filter((c) => c.severity === "info");
  return h(
    "section",
    { class: "keys-conflicts", "aria-label": tr("heading") },
    serious.length
      ? [
          h("h2", { class: "settings-key-note" }, `${tr("heading")} (${serious.length})`),
          h("p", { class: "settings-key-note" }, tr("intro")),
          h("ul", { class: "settings-key-list" }, serious.map(item)),
        ]
      : null,
    settled.length
      ? h(
          "details",
          { class: "keys-conflicts-settled" },
          h("summary", {}, `${tr("taken")} (${settled.length})`),
          h("ul", { class: "settings-key-list" }, settled.map(item)),
        )
      : null,
  );
}
