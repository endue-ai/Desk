/**
 * The desk's policies, collected from every enabled plugin's `contributes` (ADR 0017). Layers go
 * from the built-in desk.* policy plugins to the other plugins in plugin.list order; init.yaml and
 * the active profile layer settings on top (settings.ts). An autoload plugin that is off still
 * contributes its file openers, like Emacs's autoload cookies, so desk.files can turn it on for a
 * file (ADR 0046); the rest of what it contributes counts once it is on.
 */
import type {
  CommandContribution,
  DisplayRule,
  FileOpener,
  KeyBinding,
  PaletteProvider,
  PluginInfo,
  ProfileContribution,
  SettingContribution,
  ThemeContribution,
} from "@endue-ai/bridge";

export interface PolicySet {
  /** Plugins that are on, in layer order. */
  plugins: string[];
  commands: Array<CommandContribution & { owner: string }>;
  /** Every binding in layer order; a later binding of the same key wins. */
  keys: Array<KeyBinding & { owner: string }>;
  /** Asked in this order: later layers first. */
  display: Array<DisplayRule & { owner: string }>;
  /** Asked in this order: later layers first. */
  files: Array<FileOpener & { owner: string }>;
  themes: Array<ThemeContribution & { owner: string }>;
  settings: Record<string, SettingContribution & { owner: string }>;
  /** By id; a later layer's profile of the same id replaces the earlier one. */
  profiles: Array<ProfileContribution & { owner: string }>;
  /** What the palette asks as the person types, in layer order: each one's group follows the last. */
  paletteProviders: Array<PaletteProvider & { owner: string }>;
  /** Contributions dropped because they reach outside their plugin's id, for people. */
  ignored: string[];
}

export function emptyPolicy(): PolicySet {
  return {
    plugins: [],
    commands: [],
    keys: [],
    display: [],
    files: [],
    themes: [],
    settings: {},
    profiles: [],
    paletteProviders: [],
    ignored: [],
  };
}

/** Enabled, ready plugins in layer order: built-in desk.* first (by id), then the rest as listed. */
export function layers(plugins: readonly PluginInfo[]): PluginInfo[] {
  return ordered(plugins, (p) => p.enabled);
}

/** Whether a plugin stays off until the desk needs it (its manifest's `autoload`). */
export function autoloads(plugin: PluginInfo | undefined): boolean {
  return plugin?.manifest?.autoload === true;
}

/** Ready plugins that `keep` keeps, in layer order. */
function ordered(plugins: readonly PluginInfo[], keep: (p: PluginInfo) => boolean): PluginInfo[] {
  const on = plugins.filter((p) => p.status === "ready" && p.manifest && keep(p));
  const base = (p: PluginInfo) => p.builtIn && p.id.startsWith("desk.");
  return [
    ...on.filter(base).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ...on.filter((p) => !base(p)),
  ];
}

const owns = (plugin: string, id: string) => id.startsWith(`${plugin}.`);

export function collect(plugins: readonly PluginInfo[]): PolicySet {
  const set = emptyPolicy();
  const profiles = new Map<string, ProfileContribution & { owner: string }>();
  for (const plugin of ordered(plugins, (p) => p.enabled || autoloads(p))) {
    const owner = plugin.id;
    const c = plugin.manifest?.contributes;
    if (!plugin.enabled) {
      set.files.unshift(...(c?.files ?? []).map((opener) => ({ ...opener, owner })));
      continue;
    }
    set.plugins.push(owner);
    if (!c) continue;
    for (const command of c.commands ?? []) {
      if (owns(owner, command.id)) set.commands.push({ ...command, owner });
      else set.ignored.push(`${owner}: command ${command.id} is outside ${owner}`);
    }
    for (const key of c.keys ?? []) set.keys.push({ ...key, owner });
    set.display.unshift(...(c.display ?? []).map((rule) => ({ ...rule, owner })));
    set.files.unshift(...(c.files ?? []).map((opener) => ({ ...opener, owner })));
    for (const theme of c.themes ?? []) {
      if (owns(owner, theme.id)) set.themes.push({ ...theme, owner });
      else set.ignored.push(`${owner}: theme ${theme.id} is outside ${owner}`);
    }
    for (const [key, setting] of Object.entries(c.settings ?? {})) {
      if (owns(owner, key)) set.settings[key] = { ...setting, owner };
      else set.ignored.push(`${owner}: setting ${key} is outside ${owner}`);
    }
    for (const profile of c.profiles ?? []) profiles.set(profile.id, { ...profile, owner });
    for (const provider of c.paletteProviders ?? []) {
      if (owns(owner, provider.command)) set.paletteProviders.push({ ...provider, owner });
      else set.ignored.push(`${owner}: palette provider ${provider.command} is outside ${owner}`);
    }
  }
  set.profiles = [...profiles.values()];
  return set;
}

/** `*` matches any run of characters; everything else is literal. */
export function globMatch(pattern: string, text: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(text);
}
