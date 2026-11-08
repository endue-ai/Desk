/**
 * Durable personal settings, independent of desk.session and every other plugin: the core's, and the
 * plugins' settings the person sets in the settings window (`set`), under their full names. The
 * person's key bindings are not among them: desk.keys keeps those in ~/.desk/keys.yaml (ADR 0079).
 */
import type { BridgeClient } from "@endue-ai/bridge";
import { fits, type Settings } from "../settings";
import { CORE_SETTINGS, PERSONAL_KEYS } from "./defaults";

export const PREFERENCES_KEY = "preferences";
export type SaveState = "loading" | "saving" | "saved" | "error";
/** A setting's full name, as contributes.settings and init.yaml write it (owner.key). */
const SETTING_NAME = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)+$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validPreferences(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, v]) =>
        key !== PERSONAL_KEYS && Object.hasOwn(CORE_SETTINGS, key) && fits(CORE_SETTINGS[key], v),
    ),
  );
}

/** The plugins' settings in a record: full names the core does not declare, of any value. */
export function pluginPreferences(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key.length <= 128 && SETTING_NAME.test(key) && !Object.hasOwn(CORE_SETTINGS, key),
    ),
  );
}

export class Preferences {
  #state: SaveState = "loading";
  #queue = Promise.resolve();
  #loaded = false;
  #dirty = false;
  #disposed = false;
  #revision = 0;
  /** Plugins' settings kept besides the core's: set in the window, or found in the record. */
  readonly #kept = new Set<string>();
  readonly #listeners = new Set<() => void>();
  readonly #off: () => void;

  constructor(
    readonly settings: Settings,
    readonly bridge: BridgeClient,
  ) {
    this.#off = settings.onEdit(() => {
      if (this.#loaded) this.save();
      else this.#dirty = true;
    });
  }

  state(): SaveState {
    return this.#state;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async load(): Promise<void> {
    try {
      const { value } = await this.bridge.call("store.get", { key: PREFERENCES_KEY });
      const stored = record(value) && value.version === 1 ? value.values : undefined;
      const plugins = pluginPreferences(stored);
      const values = { ...plugins, ...validPreferences(stored) };
      if (this.#disposed) return;
      for (const key of Object.keys(plugins)) this.#kept.add(key);
      // A user edit made while storage was loading always wins over the stored value.
      const edited = this.#dirty;
      this.settings.setLayer("session", { ...values, ...this.settings.layer("session") });
      this.#loaded = true;
      this.#setState("saved");
      if (edited) this.save();
    } catch {
      if (!this.#disposed) {
        this.#loaded = true;
        this.#setState("error");
      }
    }
  }

  /** A setting the person chose in the settings window: in force at once, and kept from now on. */
  set(key: string, value: unknown): void {
    if (Object.keys(pluginPreferences({ [key]: value })).length > 0) this.#kept.add(key);
    this.settings.set(key, value);
  }

  save(): void {
    if (this.#disposed) return;
    const session = this.settings.layer("session");
    const kept = [...this.#kept].filter((key) => Object.hasOwn(session, key));
    const plugins = Object.fromEntries(kept.map((key) => [key, session[key]]));
    const value = { version: 1, values: { ...plugins, ...validPreferences(session) } };
    const revision = ++this.#revision;
    this.#setState("saving");
    // Serialize writes so an older bridge response can never overwrite the latest edit.
    this.#queue = this.#queue.then(async () => {
      try {
        await this.bridge.call("store.set", { key: PREFERENCES_KEY, value });
        if (revision === this.#revision) this.#setState("saved");
      } catch {
        if (revision === this.#revision) this.#setState("error");
      }
    });
  }

  async settled(): Promise<void> {
    await this.#queue;
  }

  dispose(): void {
    this.#disposed = true;
    this.#off();
    this.#listeners.clear();
  }

  #setState(state: SaveState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
