/** Durable personal settings, independent of desk.session and every other plugin. */
import type { BridgeClient } from "@endue-ai/bridge";
import { fits, type Settings } from "../settings";
import { CORE_SETTINGS, isBinding, PERSONAL_KEYS } from "./defaults";

export const PREFERENCES_KEY = "preferences";
export type SaveState = "loading" | "saving" | "saved" | "error";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validPreferences(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, v]) =>
        Object.hasOwn(CORE_SETTINGS, key) &&
        fits(CORE_SETTINGS[key], v) &&
        (key !== PERSONAL_KEYS || (Array.isArray(v) && v.every(isBinding))),
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
      let values: Record<string, unknown> = {};
      let migrated = false;
      if (value === undefined) {
        const old = await this.bridge.call("store.get", { key: "session" });
        if (record(old.value) && record(old.value.parts) && Array.isArray(old.value.parts.keys)) {
          values = validPreferences({ [PERSONAL_KEYS]: old.value.parts.keys });
          migrated = Object.keys(values).length > 0;
        }
      } else if (record(value) && value.version === 1) {
        values = validPreferences(value.values);
      }
      if (this.#disposed) return;
      // A user edit made while storage was loading always wins over the stored value.
      const edited = this.#dirty;
      this.settings.setLayer("session", { ...values, ...this.settings.layer("session") });
      this.#loaded = true;
      this.#setState("saved");
      if (migrated || edited) this.save();
    } catch {
      if (!this.#disposed) {
        this.#loaded = true;
        this.#setState("error");
      }
    }
  }

  save(): void {
    if (this.#disposed) return;
    const value = { version: 1, values: validPreferences(this.settings.layer("session")) };
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
