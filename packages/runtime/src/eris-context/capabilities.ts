/**
 * What the person can do on the desk (ADR 0124): every command the desk knows, its own and the
 * plugins', with its title, owner, keys and whether it can run now, and the plugins that are on
 * with their commands, their window and the views they open. A command is known when the core's
 * registry has it (it can run now), when a plugin that is on contributes it (it runs once that
 * plugin's window is up), or when a key is bound to it. desk.capabilities answers the catalogue;
 * Eris's words carry its summary every turn.
 */
import type { BrainDeskCapabilities, BrainDeskPlugin } from "@endue-ai/bridge";
import type { CommandInfo } from "../commands";
import type { ShellCtx } from "../shell/context";
import { LIMITS, PLUGIN_ID } from "./brain";

export interface CapabilitySource {
  /** The registry as the core listed it last: these can run now. */
  commands(): CommandInfo[];
  /** What the plugins that are on contribute, by owner. */
  contributed(): Array<{ id: string; title: string; owner: string }>;
  bindings(): Array<{ command: string; owner: string }>;
  /** The keys that run a command, as people read them on this platform. */
  keysOf(command: string): string[];
  /** The plugins that are on, in layer order. */
  plugins(): string[];
  /** The plugin surfaces on the desk now, with their titles. */
  windows(): Array<{ id: string; title: string }>;
}

export interface Capability {
  id: string;
  title: string;
  /** `desk` for the runtime's own commands, else the plugin that provides it. */
  owner: string;
  keys: string[];
  available: boolean;
}

export interface PluginCapability {
  id: string;
  title: string;
  commands: number;
  available: number;
  /** Its window is on the desk. */
  open: boolean;
  views: string[];
}

export interface Catalogue {
  commands: Capability[];
  plugins: PluginCapability[];
}

export function sourceOf(ctx: ShellCtx): CapabilitySource {
  const { runtime } = ctx;
  return {
    commands: () => runtime.commands.list(),
    contributed: () => runtime.policy().commands,
    bindings: () => runtime.keymap.bindings(),
    keysOf: (command) => runtime.keymap.keysFor(command),
    plugins: () => runtime.policy().plugins,
    windows: () => ctx.store.get().adopted,
  };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function catalogue(source: CapabilitySource): Catalogue {
  const known = new Map<string, Capability>();
  const add = (id: string, title: string, owner: string, available: boolean) => {
    if (!known.has(id)) known.set(id, { id, title, owner, keys: source.keysOf(id), available });
  };
  for (const c of source.commands()) add(c.id, c.title, c.provider, true);
  for (const c of source.contributed()) add(c.id, c.title, c.owner, false);
  for (const b of source.bindings()) add(b.command, b.command, b.owner, false);
  const commands = [...known.values()].sort(byId);
  const windows = source.windows();
  const plugins = source.plugins().map((id): PluginCapability => {
    const theirs = commands.filter((c) => c.owner === id);
    const window = windows.find((w) => w.id === id);
    return {
      id,
      title: window?.title || id,
      commands: theirs.length,
      available: theirs.filter((c) => c.available).length,
      open: window !== undefined,
      views: window ? [`plugin:${id}`] : [],
    };
  });
  return { commands, plugins };
}

/** The catalogue in short, for Eris's words: the counts, then the plugins with something to offer. */
export function summarise(c: Catalogue): BrainDeskCapabilities {
  const offer = c.plugins.filter((p) => PLUGIN_ID.test(p.id) && (p.commands > 0 || p.views.length));
  const ordered = [...offer.filter((p) => p.open), ...offer.filter((p) => !p.open)];
  return {
    commands: c.commands.length,
    available: c.commands.filter((x) => x.available).length,
    keyed: c.commands.filter((x) => x.keys.length > 0).length,
    plugins: ordered.slice(0, 128).map(
      (p): BrainDeskPlugin => ({
        id: p.id,
        title: p.title.slice(0, LIMITS.title),
        commands: p.commands,
        available: p.available,
        ...(p.open ? { open: true } : {}),
        ...(p.views.length ? { views: p.views.slice(0, 16).map((v) => v.slice(0, 256)) } : {}),
      }),
    ),
  };
}

export interface CatalogueQuery {
  owner?: string;
  query?: string;
  available?: boolean;
  limit?: number;
}

export const LIMIT = { default: 200, most: 500 };

/** desk.capabilities' answer: the commands that match, as many as `limit`, and every plugin. */
export function query(c: Catalogue, q: CatalogueQuery) {
  const word = q.query?.trim().toLowerCase();
  const matching = c.commands.filter(
    (x) =>
      (q.owner === undefined || x.owner === q.owner) &&
      (q.available === undefined || x.available === q.available) &&
      (!word || x.id.toLowerCase().includes(word) || x.title.toLowerCase().includes(word)),
  );
  const limit = Math.max(1, Math.min(LIMIT.most, Math.round(q.limit ?? LIMIT.default)));
  const commands = matching.slice(0, limit);
  return {
    total: c.commands.length,
    available: c.commands.filter((x) => x.available).length,
    commands,
    ...(matching.length > commands.length ? { more: matching.length - commands.length } : {}),
    plugins: c.plugins,
  };
}
