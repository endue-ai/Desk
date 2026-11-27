/**
 * The shortcut bar's list (ADR 0274): what the person put on the bar above the agent bar, as the core
 * setting `desk.shell.shortcuts` keeps it, and what the bar's "+" offers to put there. A shortcut
 * opens a plugin (`desk.plugins.open`) or runs a command (Search is `desk.palette.open`). Plain data
 * in, plain data out, so it is tested without a DOM; the bar's words are the bar's (ShortcutBar.ts).
 */
import type { PluginInfo } from "@endue-ai/bridge";
import type { CommandInfo } from "../commands";
import { pluginIcon } from "../shell/plugin-icons";

/** The core setting that keeps the list (core/defaults.ts): a person's, kept in their preferences. */
export const SHORTCUTS = "desk.shell.shortcuts";
/** How many shortcuts the bar holds. */
export const MAX = 12;

export type Shortcut = { plugin: string } | { command: string };

/** What a desk shows before the person changes it: Search. */
export const DEFAULT_SHORTCUTS: readonly Shortcut[] = [{ command: "desk.palette.open" }];

/**
 * The desk's own actions worth a button, in the order the "+" offers them, each with its icon
 * (shell/icons.ts). One the registry does not hold (its plugin is off) is not offered.
 */
export const SUGGESTED: ReadonlyArray<readonly [command: string, icon: string]> = [
  ["desk.palette.open", "search"],
  ["endue.launcher.open", "grid"],
  ["desk.settings.open", "settings"],
  ["desk.inbox.open", "inbox"],
  ["desk.theme.studio", "palette"],
];
const ICONS = new Map(SUGGESTED);

/** The bar's own commands: no shortcut runs them. */
const OWN = /^desk\.shortcuts\./;
/** Placements that open on the desk itself; edges and overlays are the desk's own chrome. */
const ON_DESK = new Set(["center", "floating"]);

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && !/\s/.test(value);

/** One shortcut's key, the same for the same target: `plugin:<id>` or `command:<id>`. */
export const keyOf = (shortcut: Shortcut): string =>
  "plugin" in shortcut ? `plugin:${shortcut.plugin}` : `command:${shortcut.command}`;

/**
 * The icon a shortcut shows, if it has one: a desk action's, or a built-in plugin's own (the one
 * its windows show, ADR 0273). Others show their name's first letter: a plugin the desk does not
 * know would get the box, the same for each one, which tells them apart from nothing.
 */
export function iconOf(shortcut: Shortcut): string | undefined {
  if ("command" in shortcut) return ICONS.get(shortcut.command);
  const own = pluginIcon(shortcut.plugin);
  return own === "box" ? undefined : own;
}

/** A shortcut as written (`{ plugin }` or `{ command }`), or undefined when it is neither. */
export function shortcutOf(value: unknown): Shortcut | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if ("plugin" in v === "command" in v) return undefined;
  if (isId(v.plugin)) return { plugin: v.plugin };
  if (isId(v.command) && !OWN.test(v.command)) return { command: v.command };
  return undefined;
}

/** The list a setting's value holds: each shortcut once, in its order, at most MAX, the rest dropped. */
export function shortcutsOf(value: unknown): Shortcut[] {
  if (!Array.isArray(value)) return [...DEFAULT_SHORTCUTS];
  const seen = new Set<string>();
  const out: Shortcut[] = [];
  for (const item of value) {
    const shortcut = shortcutOf(item);
    if (!shortcut || seen.has(keyOf(shortcut)) || out.length >= MAX) continue;
    seen.add(keyOf(shortcut));
    out.push(shortcut);
  }
  return out;
}

export const holds = (list: readonly Shortcut[], shortcut: Shortcut): boolean =>
  list.some((s) => keyOf(s) === keyOf(shortcut));

/** The list with `shortcut` at its end; the same list when it holds it already or is full. */
export function added(list: readonly Shortcut[], shortcut: Shortcut): Shortcut[] {
  return holds(list, shortcut) || list.length >= MAX ? [...list] : [...list, shortcut];
}

export function removed(list: readonly Shortcut[], shortcut: Shortcut): Shortcut[] {
  return list.filter((s) => keyOf(s) !== keyOf(shortcut));
}

/** The list with `shortcut` moved `by` places (up is -1), kept inside the list. */
export function moved(list: readonly Shortcut[], shortcut: Shortcut, by: number): Shortcut[] {
  const from = list.findIndex((s) => keyOf(s) === keyOf(shortcut));
  const to = Math.min(Math.max(from + by, 0), list.length - 1);
  if (from < 0 || to === from) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  if (item) out.splice(to, 0, item);
  return out;
}

/** Whether a plugin opens on the desk as a window: a UI plugin not at an edge or over the app. */
export function opensOnDesk(plugin: PluginInfo): boolean {
  const manifest = plugin.manifest;
  if (manifest?.kind !== "ui") return false;
  const placement = manifest.surfaces?.[0]?.placement;
  return placement === undefined || ON_DESK.has(placement);
}

export type Group = "desk" | "plugins" | "commands";

/** One thing the "+" offers. */
export interface Choice {
  shortcut: Shortcut;
  key: string;
  name: string;
  group: Group;
  /** What it is found by besides its name: its id, a command's keywords. */
  words: string[];
}

export interface Known {
  /** The installed plugins, as plugin.list said last. */
  plugins: readonly PluginInfo[];
  /** The registered commands, as the registry said last. */
  commands: readonly CommandInfo[];
  /** The bar's own name for one of the desk's actions (SUGGESTED), in the desk's language. */
  named(command: string): string | undefined;
}

/**
 * Everything the "+" may offer: the desk's actions, then every plugin that opens on the desk by
 * name (one that failed cannot open, so it is not offered), then every other command by title.
 */
export function choices(known: Known): Choice[] {
  const titles = new Map(known.commands.map((c) => [c.id, c]));
  const desk: Choice[] = SUGGESTED.flatMap(([id]) => {
    const command = titles.get(id);
    if (!command) return [];
    const name = known.named(id) ?? command.title;
    return [
      {
        shortcut: { command: id },
        key: `command:${id}`,
        name,
        group: "desk" as const,
        words: [id, command.title, ...command.keywords],
      },
    ];
  });
  const byName = (a: Choice, b: Choice) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const plugins: Choice[] = known.plugins
    .filter((p) => p.status === "ready" && opensOnDesk(p))
    .map((p) => ({
      shortcut: { plugin: p.id },
      key: `plugin:${p.id}`,
      name: p.manifest?.name || p.id,
      group: "plugins" as const,
      words: [p.id],
    }))
    .sort(byName);
  const commands: Choice[] = known.commands
    .filter((c) => !ICONS.has(c.id) && !OWN.test(c.id) && c.title.trim() !== "")
    .map((c) => ({
      shortcut: { command: c.id },
      key: `command:${c.id}`,
      name: c.title,
      group: "commands" as const,
      words: [c.id, ...c.keywords],
    }))
    .sort(byName);
  return [...desk, ...plugins, ...commands];
}

/** The words of a name, an id or a keyword: what lies between spaces, dots and other marks. */
const partsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const ID = /^[\w-]+(\.[\w-]+)+$/;
/** An id's words after its owner's (`desk.palette.open`: palette, open): every desk command's
 *  "desk" would find them all. The whole id, typed with its dots, still finds it. */
const wordsOf = (word: string) => (ID.test(word) ? partsOf(word).slice(1) : partsOf(word));
/** From how many letters a name is found by what it holds anywhere, not only at a word's start:
 *  fewer find every command with "te" in "palette". */
const INSIDE = 3;

/**
 * What the "+" lists for what was typed. Nothing typed: the desk's actions, the plugins, and the
 * commands already on the bar (so they can be taken off). Typed: those whose name starts with it,
 * then a word of whose name does, then a word of whose id or keywords does (or the id itself),
 * then, from three letters, whose name holds it; each group in its order.
 */
export function matching(all: readonly Choice[], typed: string, on: readonly Shortcut[]): Choice[] {
  const q = typed.trim().toLowerCase();
  if (q === "") return all.filter((c) => c.group !== "commands" || holds(on, c.shortcut));
  const rank = (c: Choice) => {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (partsOf(name).some((part) => part.startsWith(q))) return 1;
    const words = c.words.map((w) => w.toLowerCase());
    const id = q.includes(".");
    if (words.some((w) => (id && w.startsWith(q)) || wordsOf(w).some((p) => p.startsWith(q))))
      return 2;
    return q.length >= INSIDE && name.includes(q) ? 3 : 4;
  };
  const order: Record<Group, number> = { desk: 0, plugins: 1, commands: 2 };
  return all
    .map((c) => ({ c, r: rank(c) }))
    .filter(({ r }) => r < 4)
    .sort((a, b) => a.r - b.r || order[a.c.group] - order[b.c.group])
    .map(({ c }) => c);
}

/**
 * A shortcut's name and whether its target is missing: a plugin not installed or failed, a command
 * the registry does not hold. Until the plugins or the commands are first listed nothing is missing.
 */
export function labelOf(shortcut: Shortcut, known: Known): { name: string; missing: boolean } {
  if ("plugin" in shortcut) {
    const plugin = known.plugins.find((p) => p.id === shortcut.plugin);
    const missing = known.plugins.length > 0 && plugin?.status !== "ready";
    return { name: plugin?.manifest?.name || shortcut.plugin, missing };
  }
  const command = known.commands.find((c) => c.id === shortcut.command);
  const name = known.named(shortcut.command) ?? command?.title ?? shortcut.command;
  return { name, missing: known.commands.length > 0 && !command };
}

/** A name's first letter, for a shortcut with no icon. */
export const initialOf = (name: string): string => ([...name.trim()][0] ?? "?").toUpperCase();
