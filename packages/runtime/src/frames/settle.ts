/**
 * A frame loading again after an unload (ADR 0070) may focus itself as it mounts: many plugins focus
 * their view when they show it. Unless its surface had the focus, that would take the keyboard from
 * wherever the person is whenever a window comes back into sight. So focus that moves into such a
 * frame goes back where it was, until the person points at the frame, the desk focuses its surface,
 * or ten seconds have passed. Browsers say so with a focusin on the surface, or only with a blur of
 * the desk's window; both are heard.
 */

/** The longest a frame loading again may not take the focus. */
export const SETTLE_MAX_MS = 10_000;

interface Held {
  frame: HTMLIFrameElement;
  end(): void;
}

export class Settling {
  readonly #held = new Map<string, Held>();
  /** Where the focus last was outside the settling frames: where it goes back to. */
  #before: Element | null = null;
  #off: (() => void) | undefined;

  /** Keep the focus out of surface `id`'s `frame` while it loads again. */
  start(id: string, frame: HTMLIFrameElement): void {
    this.forget(id);
    const timer = setTimeout(() => this.forget(id), SETTLE_MAX_MS);
    const pointed = () => this.forget(id);
    // The person's pointer on the frame: what focuses it next is them.
    frame.addEventListener("pointerover", pointed, { once: true });
    const end = () => {
      clearTimeout(timer);
      frame.removeEventListener("pointerover", pointed);
    };
    this.#held.set(id, { frame, end });
    this.#listen(frame.ownerDocument);
  }

  /** The focus moved into surface `id`: put it back and say so, while its frame settles. */
  refocus(id: string, doc: Document): boolean {
    const held = this.#held.get(id);
    if (!held) return false;
    const before = this.#before as HTMLElement | null;
    if (before && before !== doc.body && before.isConnected && typeof before.focus === "function")
      before.focus();
    else (doc.activeElement as HTMLElement | null)?.blur?.();
    return true;
  }

  forget(id: string): void {
    this.#held.get(id)?.end();
    this.#held.delete(id);
    if (this.#held.size === 0) {
      this.#off?.();
      this.#off = undefined;
    }
  }

  #settling(el: EventTarget | null): boolean {
    return [...this.#held.values()].some((held) => held.frame === el);
  }

  /** Follow where the focus is, and hear the desk's window lose it: to a settling frame, perhaps. */
  #listen(doc: Document): void {
    const win = doc.defaultView;
    if (this.#off || !win) return;
    if (!this.#settling(doc.activeElement)) this.#before = doc.activeElement;
    const onFocus = (event: FocusEvent) => {
      if (!this.#settling(event.target)) this.#before = event.target as Element;
    };
    const onBlur = () =>
      setTimeout(() => {
        for (const [id, held] of this.#held)
          if (doc.activeElement === held.frame) this.refocus(id, doc);
      }, 0);
    doc.addEventListener("focusin", onFocus, true);
    win.addEventListener("blur", onBlur);
    this.#off = () => {
      doc.removeEventListener("focusin", onFocus, true);
      win.removeEventListener("blur", onBlur);
    };
  }
}
