/**
 * Quarantine (ADR 0061): a UI plugin whose frame fails to start (mount throws, or the frame throws
 * before its first ready) three starts of the desk in a row is listed in `desk`'s store under
 * `plugins.quarantined` as `{ id, version, at }`. The core holds a listed plugin off at the next
 * starts while the installed version is the one that failed. A ready start sets the count back; a
 * new version and the person turning the plugin on let it go. One instance counts one desk start.
 */

export const QUARANTINED_KEY = "plugins.quarantined";
export const FAILURES_KEY = "plugins.failures";
/** Failed starts in a row that quarantine a plugin. */
export const STARTS_TO_QUARANTINE = 3;

export interface QuarantineEntry {
  id: string;
  version: string;
  /** When it was quarantined (RFC 3339). */
  at: string;
}

type Failures = Record<string, { version: string; starts: number }>;

/** The runtime's records in the core's store. */
export interface QuarantineStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const isEntry = (value: unknown): value is QuarantineEntry => {
  const entry = value as Partial<QuarantineEntry> | null;
  return typeof entry?.id === "string" && typeof entry.version === "string";
};

export class Quarantine {
  readonly #store: QuarantineStore;
  readonly #now: () => string;
  /** Plugins whose start was counted already in this desk start. */
  readonly #counted = new Set<string>();
  /** Each change reads and writes the records whole, one after another. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(store: QuarantineStore, now: () => string) {
    this.#store = store;
    this.#now = now;
  }

  /** The plugins quarantined now. */
  list(): Promise<QuarantineEntry[]> {
    return this.#serial(() => this.#entries());
  }

  /** A frame of `id` failed to start; resolves true when that quarantined it. Once per start. */
  failed(id: string, version: string): Promise<boolean> {
    if (this.#counted.has(id)) return Promise.resolve(false);
    this.#counted.add(id);
    return this.#serial(async () => {
      const failures = await this.#failures();
      const before = failures[id]?.version === version ? failures[id].starts : 0;
      const starts = before + 1;
      if (starts < STARTS_TO_QUARANTINE) {
        failures[id] = { version, starts };
        await this.#store.set(FAILURES_KEY, failures);
        return false;
      }
      delete failures[id];
      const entries = (await this.#entries()).filter((entry) => entry.id !== id);
      entries.push({ id, version, at: this.#now() });
      await this.#store.set(QUARANTINED_KEY, entries);
      await this.#store.set(FAILURES_KEY, failures);
      return true;
    });
  }

  /** A frame of `id` got ready: its failures start over. Once per start. */
  ready(id: string): Promise<void> {
    if (this.#counted.has(id)) return Promise.resolve();
    this.#counted.add(id);
    return this.#serial(async () => {
      const failures = await this.#failures();
      if (!(id in failures)) return;
      delete failures[id];
      await this.#store.set(FAILURES_KEY, failures);
    });
  }

  /** Let go of the plugins whose installed version is not the one that failed. */
  prune(installed: ReadonlyArray<{ id: string; version?: string }>): Promise<void> {
    const versions = new Map(installed.map((plugin) => [plugin.id, plugin.version]));
    const stale = (id: string, version: string) => versions.has(id) && versions.get(id) !== version;
    return this.#serial(async () => {
      const entries = await this.#entries();
      const kept = entries.filter((entry) => !stale(entry.id, entry.version));
      if (kept.length !== entries.length) await this.#store.set(QUARANTINED_KEY, kept);
      const failures = await this.#failures();
      const old = Object.keys(failures).filter((id) => stale(id, failures[id]?.version ?? ""));
      for (const id of old) delete failures[id];
      if (old.length > 0) await this.#store.set(FAILURES_KEY, failures);
    });
  }

  /** The person turned `id` on: it is not quarantined, and its count starts over. */
  release(id: string): Promise<void> {
    return this.#serial(async () => {
      const entries = await this.#entries();
      const kept = entries.filter((entry) => entry.id !== id);
      if (kept.length !== entries.length) await this.#store.set(QUARANTINED_KEY, kept);
      const failures = await this.#failures();
      if (!(id in failures)) return;
      delete failures[id];
      await this.#store.set(FAILURES_KEY, failures);
    });
  }

  async #entries(): Promise<QuarantineEntry[]> {
    const value = await this.#store.get(QUARANTINED_KEY);
    return Array.isArray(value) ? value.filter(isEntry) : [];
  }

  async #failures(): Promise<Failures> {
    const value = await this.#store.get(FAILURES_KEY);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Failures) : {};
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    this.#queue = next.catch(() => {});
    return next;
  }
}
