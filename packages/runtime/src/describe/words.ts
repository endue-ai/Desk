/**
 * The words desk.describe answers in: the facts it reads (`Facts`), the answer (`Description`) and
 * the names it gives plugins, callers, layers and permissions. Plain data, no DOM.
 */
import type {
  CallerGrant,
  CommandInfo,
  KeyBinding,
  Permission,
  PluginInfo,
  SettingContribution,
} from "@endue-ai/bridge";
import type { Platform } from "../input";
import type { Layer } from "../settings";

export type DescribeKind = "key" | "command" | "setting" | "plugin" | "grant";
export const KINDS: readonly DescribeKind[] = ["key", "command", "setting", "plugin", "grant"];

/** One labelled line of an answer: "Plugin: desk.files (Files), /…/plugins/files". */
export interface Fact {
  label: string;
  value: string;
}

/** The answer: one sentence, the facts under it, the file "Open file" shows, and all of it as text. */
export interface Description {
  kind: DescribeKind;
  /** What was asked, as found: the canonical combo of a key, else the id. */
  name: string;
  summary: string;
  lines: Fact[];
  /** A bridge path: the plugin.json or init.yaml behind the answer. */
  file?: string;
  /** The summary and one `Label: value` line per fact: what Copy copies and the CLI prints. */
  text: string;
}

/** A cmd.list entry; `undo` names the inverse command once the registry has one (#276). */
export type DescribedCommand = CommandInfo & { undo?: string };

/** What the desk knows now, as desk.describe reads it. */
export interface Facts {
  platform: Platform;
  /** The registry as cmd.list answers it: the commands that can run now. */
  commands: DescribedCommand[];
  /** Every binding in layer order, the person's (`owner: "person"`) last; a later one of a key wins. */
  keys: Array<KeyBinding & { owner: string }>;
  plugins: PluginInfo[];
  /** The settings the enabled plugins declare, with the plugin that declares each. */
  declared: Record<string, SettingContribution & { owner: string }>;
  /** The values each layer above the manifest defaults holds. */
  layers: Record<Layer, Record<string, unknown>>;
  /** The profile in force. */
  profile?: string;
  /** Where init.yaml is (init.get's `file`). */
  initFile?: string;
  /** Every grant, when the asker may list them (it holds perm:manage, or it is the person). */
  grants?: CallerGrant[];
  /** Who asked, when the grants are not shown to it. */
  asker?: string;
}

/** The answer from its summary and facts, with its text. */
export function described(
  kind: DescribeKind,
  name: string,
  summary: string,
  lines: Fact[],
  file?: string,
): Description {
  const text = [summary, ...lines.map((fact) => `${fact.label}: ${fact.value}`)].join("\n");
  return { kind, name, summary, lines, ...(file ? { file } : {}), text };
}

export const plugin = (id: string, f: Facts) => f.plugins.find((p) => p.id === id);

/** The plugin a command belongs to: its provider, or for the desk's own the plugin its id names. */
export function commandPlugin(id: string, provider: string | undefined, f: Facts) {
  if (provider && provider !== "desk") return provider;
  const owners = f.plugins.filter((p) => id.startsWith(`${p.id}.`)).map((p) => p.id);
  return owners.sort((a, b) => b.length - a.length)[0];
}

/** "desk.files (Files)", or the id alone when the manifest has no name. */
export function pluginLabel(id: string, f: Facts): string {
  const name = plugin(id, f)?.manifest?.name;
  return name ? `${id} (${name})` : id;
}

/** "desk.files (Files), /…/plugins/files". */
export function pluginWithFolder(id: string, f: Facts): string {
  const folder = plugin(id, f)?.folder;
  return folder ? `${pluginLabel(id, f)}, ${folder}` : pluginLabel(id, f);
}

/** The plugin.json of an installed plugin, when the core named its folder. */
export function manifestFile(id: string | undefined, f: Facts): string | undefined {
  const folder = id ? plugin(id, f)?.folder : undefined;
  return folder ? `${folder}/plugin.json` : undefined;
}

const CALLERS: Record<string, string> = {
  desk: "the desk itself",
  cli: "the desk CLI",
  palette: "the system palette",
};

/** Who a caller is: an installed plugin by its name, the desk's own callers by what they are. */
export function callerLabel(id: string, f: Facts): string {
  if (plugin(id, f)) return pluginLabel(id, f);
  const own = CALLERS[id];
  return own ? `${id} (${own})` : id;
}

/** "init.yaml", "profile focus", "this session" or "manifest default". */
export function layerName(layer: Layer | "default", f: Facts): string {
  if (layer === "init") return "init.yaml";
  if (layer === "profile") return f.profile ? `profile ${f.profile}` : "the profile";
  if (layer === "session") return "this session";
  return "manifest default";
}

/** "a, b or c". */
export function orList(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

const WORDS: Record<Permission["permission"], string> = {
  "search:read": "search published documents and plugins",
  "search:system": "search this computer's files and applications",
  "fs:read": "read files",
  "fs:write": "write files",
  "proc:spawn": "run programs",
  "net:fetch": "use the network",
  "audio:capture": "use the microphone",
  "ui:surface": "open its surfaces",
  "ui:notify": "show notifications",
  "plugin:manage": "manage plugins",
  "brain:converse": "talk to the brain",
  "brain:ask": "ask the brain for structured answers",
  "cmd:invoke": "run commands",
  "cmd:advise": "hook into commands",
  "settings:read": "read settings",
  "log:read": "read the logs",
  "events:subscribe": "watch desk events",
  "perm:manage": "manage permissions",
  "data:read": "read items",
  "connector:manage": "manage connectors",
  "view:manage": "manage views",
  "shell:open": "open links and show files",
  "update:manage": "manage the desk's updates",
  "theme:manage": "manage the person's themes",
  "account:manage": "sign the desk in to endue ID",
  "memory:read": "read Eris's memory",
  "memory:write": "keep and forget what Eris remembers",
};

/** A permission's scope: "paths: ~/Notes/**", or "" when it has none. */
export function scopeText(permission: Permission): string {
  return Object.entries(permission)
    .filter(([field]) => field !== "permission")
    .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join("; ");
}

/** What a permission lets its holder do: "write files (paths: ~/Notes/**)". */
export function permissionWords(permission: Permission): string {
  const scope = scopeText(permission);
  const words = WORDS[permission.permission] ?? permission.permission;
  return scope ? `${words} (${scope})` : words;
}

/** "once", "for this session" or "always". */
export function durationWords(grant: CallerGrant["grant"]): string {
  if (grant.duration === "always") return "always";
  return grant.duration === "once" ? "once" : "for this session";
}
