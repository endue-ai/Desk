/**
 * A frame loading again after an unload (ADR 0070) may focus itself as it mounts: many plugins focus
 * their view when they show it. Unless its surface had the focus, that would take the keyboard from
 * wherever the person is whenever a window comes back into sight. So for a moment after such a frame
 * loads, focus that moves into it goes back where it was.
 */

/** How long after its load a frame may not take the focus. */
export const SETTLE_MS = 1000;
/** The longest it may not, when its load never comes. */
export const SETTLE_MAX_MS = 5000;

export class Settling {
  readonly #held = new Map<string, { before: Element | null; token: object }>();

  /** Keep the focus on `before` while surface `id`'s `frame` loads again. */
  start(id: string, frame: HTMLIFrameElement, before: Element | null): void {
    const token = {};
    this.#held.set(id, { before, token });
    const end = () => {
      if (this.#held.get(id)?.token === token) this.#held.delete(id);
    };
    frame.addEventListener("load", () => setTimeout(end, SETTLE_MS), { once: true });
    setTimeout(end, SETTLE_MAX_MS);
  }

  /** The focus moved into surface `id`: put it back and say so, while its frame settles. */
  refocus(id: string, doc: Document): boolean {
    const held = this.#held.get(id);
    if (!held) return false;
    const before = held.before as HTMLElement | null;
    if (before && before !== doc.body && before.isConnected && typeof before.focus === "function")
      before.focus();
    else (doc.activeElement as HTMLElement | null)?.blur?.();
    return true;
  }

  forget(id: string): void {
    this.#held.delete(id);
  }
}
