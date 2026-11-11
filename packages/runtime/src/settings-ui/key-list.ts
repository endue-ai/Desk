/**
 * Settings › Keyboard's list (#158 finding 19): which commands it shows (the ones with a shortcut, or
 * all of them; a search looks in all), in groups by who provides them (the desk first, then each
 * plugin by name), each row with its keys and its Change, Clear and Reset buttons.
 */
import type { CommandInfo } from "../commands";
import { formatCombo, type Platform } from "../input";
import { isDefault, type KeyLayers, keysOf } from "../rebind";
import { keyNodes } from "../sequences/keyboard-parts";
import { h } from "../shell/dom";
import { type SettingsLanguage, settingsText } from "./copy";
import { type JumpTarget, jumpHeading } from "./jump";

/** The list's two views: the commands that have a shortcut, or every command. */
export type KeyView = "shortcuts" | "all";

export interface KeyGroup extends JumpTarget {
  commands: CommandInfo[];
}

/** Whether `command` holds every word of `query`, in its title, id, keywords or keys. */
export function matchesCommand(
  command: CommandInfo,
  keys: string[],
  platform: Platform,
  query: string,
): boolean {
  const text = [
    command.title,
    command.id,
    ...command.keywords,
    ...keys.map((k) => formatCombo(k, platform)),
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(query);
}

/** The commands by who provides them: the desk's own first, then each plugin by its name. */
export function keyGroups(
  commands: CommandInfo[],
  name: (provider: string) => string,
  desk: string,
): KeyGroup[] {
  const groups = new Map<string, KeyGroup>();
  for (const command of commands) {
    const id = command.provider || "desk";
    let group = groups.get(id);
    if (!group) {
      group = { id, name: id === "desk" ? desk : name(id), commands: [] };
      groups.set(id, group);
    }
    group.commands.push(command);
  }
  return [...groups.values()].sort((a, b) =>
    a.id === "desk" ? -1 : b.id === "desk" ? 1 : a.name.localeCompare(b.name),
  );
}

export type RowAction = "change" | "reset" | "remove";

export interface RowOptions {
  layers: KeyLayers;
  platform: Platform;
  language: SettingsLanguage;
  recording: string | null;
  act(action: RowAction, command: CommandInfo): void;
}

/** One command's row: its title and id, its keys, and what can be done with them. */
export function keyRow(c: CommandInfo, options: RowOptions): HTMLElement {
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(options.language, key);
  const keys = keysOf(options.layers, c.id);
  const active = options.recording === c.id;
  const button = (action: RowAction, disabled = false) =>
    h(
      "button",
      {
        class: "settings-button",
        type: "button",
        "data-key": `keys-${action}-${c.id}`,
        "aria-label": `${c.title} · ${tr(action)}`,
        disabled,
        ...(action === "change" ? { "aria-pressed": String(active) } : {}),
        onClick: () => options.act(action, c),
      },
      active && action === "change" ? tr("record") : tr(action),
    );
  return h(
    "li",
    { class: `settings-key-row key-row${active ? " is-recording" : ""}`, "data-command": c.id },
    h("span", { class: "settings-key-label" }, c.title, h("small", {}, c.id)),
    h(
      "span",
      { class: "settings-key-combo" },
      keys.length
        ? keys.map((key) =>
            h("span", { class: "keys-sequence" }, ...keyNodes(key, options.platform)),
          )
        : tr("none"),
    ),
    h(
      "div",
      { class: "settings-key-actions" },
      button("change"),
      button("remove", keys.length === 0),
      button("reset", isDefault(options.layers, c.id)),
    ),
  );
}

/** One group: its heading, which the index jumps to, and its rows. */
export function keyGroup(group: KeyGroup, row: (c: CommandInfo) => HTMLElement): HTMLElement {
  return h(
    "section",
    { class: "settings-key-group", "data-group": group.id },
    jumpHeading("h3", group.id, group.name),
    h("ul", { class: "settings-key-list" }, group.commands.map(row)),
  );
}

/** The switch between the two views, with how many commands each shows. */
export function viewSwitch(
  view: KeyView,
  counts: Record<KeyView, number>,
  language: SettingsLanguage,
  choose: (view: KeyView) => void,
): HTMLElement {
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(language, key);
  const label: Record<KeyView, string> = { shortcuts: tr("withShortcut"), all: tr("allCommands") };
  return h(
    "div",
    { class: "segmented keys-views-switch", role: "group", "aria-label": tr("showCommands") },
    (["shortcuts", "all"] as const).map((v) =>
      h(
        "button",
        {
          type: "button",
          class: `segment${view === v ? " is-selected" : ""}`,
          "data-key": `keys-view-${v}`,
          "aria-pressed": String(view === v),
          onClick: () => choose(v),
        },
        `${label[v]} (${counts[v]})`,
      ),
    ),
  );
}
