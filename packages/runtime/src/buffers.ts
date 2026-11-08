/**
 * The buffer list (like Emacs's buffers): what is open, apart from where it shows. Every plugin
 * surface on the grid is a buffer; a plugin may open more (a file each, say) and shows them in its
 * own surface. The list keeps the order buffers were used in, most recent first.
 */

export interface Buffer {
  id: string;
  name: string;
  /** The plugin that shows it. */
  plugin: string;
  /** The file it holds, as a bridge path, when it holds one. */
  path?: string;
  /** Changed since it was opened or saved. */
  modified: boolean;
  /** The plugin's own surface rather than a buffer the plugin opened. */
  surface: boolean;
}

export type BufferPatch = Partial<Pick<Buffer, "name" | "modified" | "path">>;

export class Buffers {
  readonly #byId = new Map<string, Buffer>();
  /** Ids, most recently used first. */
  #recent: string[] = [];
  readonly #listeners = new Set<() => void>();

  add(buffer: Buffer): Buffer {
    this.#byId.set(buffer.id, { ...buffer });
    this.#recent = [...this.#recent.filter((id) => id !== buffer.id), buffer.id];
    this.#emit();
    return buffer;
  }

  update(id: string, patch: BufferPatch): Buffer | undefined {
    const buffer = this.#byId.get(id);
    if (!buffer) return undefined;
    const next = { ...buffer, ...patch };
    this.#byId.set(id, next);
    this.#emit();
    return next;
  }

  remove(id: string): Buffer | undefined {
    const buffer = this.#byId.get(id);
    if (!buffer) return undefined;
    this.#byId.delete(id);
    this.#recent = this.#recent.filter((other) => other !== id);
    this.#emit();
    return buffer;
  }

  /** Mark a buffer as the one in use now. */
  touch(id: string): void {
    if (!this.#byId.has(id) || this.#recent[0] === id) return;
    this.#recent = [id, ...this.#recent.filter((other) => other !== id)];
    this.#emit();
  }

  get(id: string): Buffer | undefined {
    const buffer = this.#byId.get(id);
    return buffer ? { ...buffer } : undefined;
  }

  /** Most recently used first. */
  list(): Buffer[] {
    return this.#recent.flatMap((id) => {
      const buffer = this.get(id);
      return buffer ? [buffer] : [];
    });
  }

  /** The buffer in use now: the most recently used. */
  current(): Buffer | undefined {
    const id = this.#recent[0];
    return id === undefined ? undefined : this.get(id);
  }

  byPath(path: string): Buffer | undefined {
    return this.list().find((buffer) => buffer.path === path);
  }

  /** A plugin's buffers, most recently used first. */
  ofPlugin(plugin: string): Buffer[] {
    return this.list().filter((buffer) => buffer.plugin === plugin);
  }

  /**
   * The buffer `step` places from `from` in a stable order (by plugin, then name), wrapping around,
   * for next and previous. Undefined when there are none.
   */
  step(from: string | undefined, step: number): Buffer | undefined {
    const order = [...this.#byId.values()].sort(
      (a, b) =>
        a.plugin.localeCompare(b.plugin) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
    if (order.length === 0) return undefined;
    const at = order.findIndex((buffer) => buffer.id === from);
    const index = at === -1 ? (step > 0 ? 0 : order.length - 1) : at + step;
    return order[((index % order.length) + order.length) % order.length];
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** The last part of a bridge path: `~/notes/a.md` → `a.md`. */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}
