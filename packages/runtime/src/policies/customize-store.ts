/**
 * The person's changes to plugin pages (desk.customize, ADR 0398), kept in the core's store under
 * `customize`: one set per endue account signed in on this desk, and one for this computer while
 * nobody is. An account is named by a hash of its email, never the email. The first time an
 * account signs in with no set of its own, it takes this computer's, so nothing made before
 * signing in is lost.
 */
import type { BridgeClient } from "@endue-ai/bridge";

export const CUSTOMIZE_KEY = "customize";
/** The set kept while no endue account is signed in. */
export const LOCAL = "local";
/** The most a style or a script may weigh, in UTF-8 bytes. */
export const MAX_BYTES = 64 * 1024;
const ACCOUNT = { permission: "account:manage" } as const;
const PLUGIN_ID = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)+$/;

/** One plugin's changes: a style, a script, the person's words for them, and when they last changed. */
export interface Custom {
  css?: string;
  js?: string;
  note?: string;
  updated: string;
}

export type CustomChange = { css?: string | null; js?: string | null; note?: string | null };
type Sets = Record<string, Record<string, Custom>>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
  typeof value === "string" && value !== "" && bytes(value) <= MAX_BYTES ? value : undefined;

export const bytes = (value: string): number => new TextEncoder().encode(value).length;

/** One plugin's entry as stored, or undefined when it holds nothing worth keeping. */
function readCustom(value: unknown): Custom | undefined {
  if (!record(value)) return undefined;
  const css = text(value.css);
  const js = text(value.js);
  if (css === undefined && js === undefined) return undefined;
  const note = typeof value.note === "string" ? value.note.slice(0, 500) : undefined;
  const updated = typeof value.updated === "string" ? value.updated : new Date(0).toISOString();
  return { ...(css ? { css } : {}), ...(js ? { js } : {}), ...(note ? { note } : {}), updated };
}

/** The record's sets, with whatever does not check left out. */
export function readSets(value: unknown): Sets {
  if (!record(value) || value.version !== 1 || !record(value.sets)) return {};
  const sets: Sets = {};
  for (const [owner, plugins] of Object.entries(value.sets)) {
    if (!record(plugins)) continue;
    const kept: Record<string, Custom> = {};
    for (const [plugin, entry] of Object.entries(plugins)) {
      const custom = PLUGIN_ID.test(plugin) ? readCustom(entry) : undefined;
      if (custom) kept[plugin] = custom;
    }
    sets[owner] = kept;
  }
  return sets;
}

/** Whose set is in force: the endue account signed in (a hash of its email), else this computer. */
export async function ownerNow(bridge: BridgeClient): Promise<string> {
  try {
    const status = await bridge.call("account.status", { scope: ACCOUNT });
    const email = status.state === "signed-in" ? status.profile?.email : undefined;
    if (!email) return LOCAL;
    const data = new TextEncoder().encode(email.trim().toLowerCase());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return `endue:${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    // A desk without endue ID (or a stub bridge) keeps one set for this computer.
    return LOCAL;
  }
}

export class CustomStore {
  #sets: Sets = {};
  #owner = LOCAL;
  #queue: Promise<boolean> = Promise.resolve(true);
  readonly #bridge: BridgeClient;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
  }

  async load(): Promise<void> {
    const { value } = await this.#bridge.call("store.get", { key: CUSTOMIZE_KEY });
    this.#sets = readSets(value);
  }

  owner(): string {
    return this.#owner;
  }

  /** Put `owner`'s set in force; an account with none takes this computer's (kept on disk). */
  use(owner: string): void {
    this.#owner = owner;
    const local = this.#sets[LOCAL];
    if (owner !== LOCAL && this.#sets[owner] === undefined && local && Object.keys(local).length) {
      this.#sets[owner] = structuredClone(local);
      this.#save();
    }
  }

  entries(): Map<string, Custom> {
    return new Map(Object.entries(this.#sets[this.#owner] ?? {}));
  }

  get(plugin: string): Custom | undefined {
    return this.#sets[this.#owner]?.[plugin];
  }

  /** Change one plugin's entry (null removes a field) and keep it: the entry as it is now. */
  put(plugin: string, change: CustomChange, now: Date = new Date()): Custom | undefined {
    const before = this.get(plugin);
    const merged: Record<string, unknown> = { ...before };
    for (const [field, value] of Object.entries(change)) {
      if (value === null || value === "") delete merged[field];
      else if (value !== undefined) merged[field] = value;
    }
    const entry = readCustom({ ...merged, updated: now.toISOString() });
    const set = { ...this.#sets[this.#owner] };
    if (entry) set[plugin] = entry;
    else delete set[plugin];
    this.#sets[this.#owner] = set;
    this.#save();
    return entry;
  }

  /** Resolves once every write so far is done: whether the last one reached the store. */
  settled(): Promise<boolean> {
    return this.#queue;
  }

  #save(): void {
    const value = { version: 1, sets: structuredClone(this.#sets) };
    // In order, so an older write never lands over a newer one.
    this.#queue = this.#queue
      .then(() => this.#bridge.call("store.set", { key: CUSTOMIZE_KEY, value }))
      .then(
        () => true,
        () => false,
      );
  }
}

export const isPluginId = (id: unknown): id is string =>
  typeof id === "string" && id.length <= 128 && PLUGIN_ID.test(id);
