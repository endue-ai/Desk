/**
 * Several windows of one plugin (ADR 0212). A file opener whose first surface says `instances:
 * "per-file"` opens a window of its own for each file: each window is an instance of the plugin,
 * and its key is what the runtime keys the window's frame, surface, buffers and sleep by, and what
 * the window manager and the compositor seat it by. The first window's key is the plugin id itself,
 * so a plugin with one window is keyed as it always was; the n-th is `<plugin id>@<n>`, whose page
 * loads on a host of its own, `<surface>--<n>.<plugin label>`, and calls as the plugin: grants,
 * commands and settings stay per plugin. A plugin id never holds an `@`.
 */
import type { PluginManifest } from "@endue-ai/bridge";

const MARK = "@";
/** A window's key after the first: a plugin id (as the manifest has it), `@`, its number. */
const KEY = /^([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)@([1-9][0-9]*)$/;
/** How many command runs each remember the window that started them. */
const RUNS_KEPT = 64;

/** The key of a plugin's `n`-th window: the plugin id for its first. */
export function instanceKey(plugin: string, n: number): string {
  return n <= 1 ? plugin : `${plugin}${MARK}${n}`;
}

/** The plugin a window's key belongs to; a plugin id (or any other surface's id) is its own. */
export function pluginOf(key: string): string {
  return KEY.exec(key)?.[1] ?? key;
}

/** Which window of its plugin a key names: 1 for the plugin id. */
export function instanceNumber(key: string): number {
  return Math.max(1, Number(KEY.exec(key)?.[2] ?? 1));
}

/** The surface label a plugin's `n`-th window loads on: `main`, then `main--2` (its host's first label). */
export function instanceSurface(surface: string, n: number): string {
  return n <= 1 ? surface : `${surface}--${n}`;
}

/** Whether a plugin's first surface opens a window of its own for each file. */
export function perFile(manifest: PluginManifest | undefined): boolean {
  return manifest?.surfaces?.[0]?.instances === "per-file";
}

/**
 * The windows each mounted plugin has open, by key, in the order they opened. A window opened
 * after the first takes the next number its plugin has not used this session, so no host is used
 * twice: a host's page is the window's own. Which window of a plugin is in use is the one that last
 * had the focus or called the desk.
 */
export class PluginInstances {
  readonly #open = new Set<string>();
  readonly #used = new Map<string, number>();
  readonly #recent = new Map<string, string>();
  /** Command runs (cmd.invoke) by invocation id: the window whose run it is hears its answer. */
  readonly #runs = new Map<string, string>();

  add(key: string): void {
    this.#open.add(key);
    const plugin = pluginOf(key);
    this.#used.set(plugin, Math.max(this.#used.get(plugin) ?? 1, instanceNumber(key)));
  }

  delete(key: string): boolean {
    if (this.#recent.get(pluginOf(key)) === key) this.#recent.delete(pluginOf(key));
    return this.#open.delete(key);
  }

  has(key: string): boolean {
    return this.#open.has(key);
  }

  keys(): string[] {
    return [...this.#open];
  }

  /** A plugin's open windows, the first it opened first. */
  of(plugin: string): string[] {
    return this.keys().filter((key) => pluginOf(key) === plugin);
  }

  /** The key a plugin's next window takes: its first window's when that is closed, else a new one. */
  mint(plugin: string): string {
    if (!this.#open.has(plugin)) return plugin;
    return instanceKey(plugin, (this.#used.get(plugin) ?? 1) + 1);
  }

  /** Window `key` had the focus or called the desk: it is its plugin's window in use. */
  touch(key: string): void {
    if (this.#open.has(key)) this.#recent.set(pluginOf(key), key);
  }

  /** A plugin's window in use: the one touched last, else the last it opened. */
  inUse(plugin: string): string | undefined {
    const recent = this.#recent.get(plugin);
    return recent !== undefined && this.#open.has(recent) ? recent : this.of(plugin).at(-1);
  }

  /** `key` is an open window, or a plugin's window in use; undefined when it has none. */
  resolve(key: string): string | undefined {
    return this.#open.has(key) ? key : this.inUse(key);
  }

  /** Window `key` started the command run `invocationId`: its answer goes there. */
  ran(invocationId: string, key: string): void {
    this.#runs.set(invocationId, key);
    const oldest = this.#runs.keys().next().value;
    if (this.#runs.size > RUNS_KEPT && oldest !== undefined) this.#runs.delete(oldest);
  }

  /** The window whose run `invocationId` is, once its answer comes; else the plugin's in use. */
  answered(invocationId: string, plugin: string): string | undefined {
    const key = this.#runs.get(invocationId);
    this.#runs.delete(invocationId);
    return key !== undefined && this.#open.has(key) ? key : this.inUse(plugin);
  }
}
