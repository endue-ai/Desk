/**
 * A frame loading again after an unload (ADR 0070) may focus itself as it mounts: many plugins focus
 * their view when they show it. Unless its surface had the focus, that would take the keyboard from
 * wherever the person is whenever a window comes back into sight, and a plugin may do it late (Docker
 * waits for its engine first). So focus that moves into such a frame goes back where it was until the
 * person points at the frame, the desk focuses its surface, Tab moves through the desk, or a minute
 * has passed. Browsers say so with a focusin on the surface, or a blur of the desk's window, or (a
 * window in the background, WKWebView) not at all: the focus is also looked at often.
 */

/** The longest a frame loading again may not take the focus. */
export const SETTLE_MAX_MS = 60_000;
/** How often the focus is looked at while a frame settles. */
export const LOOK_MS = 250;

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
    else {
      // Nothing had the focus: the desk's page takes it back on its body. A frame element's blur
      // leaves its page focused, so the body is made focusable for the moment it takes the focus.
      const { body } = doc;
      const tabbable = body.hasAttribute("tabindex");
      if (!tabbable) body.tabIndex = -1;
      body.focus({ preventScroll: true });
      if (!tabbable) body.removeAttribute("tabindex");
    }
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
    const look = () => {
      for (const [id, held] of this.#held)
        if (doc.activeElement === held.frame) this.refocus(id, doc);
    };
    const onBlur = () => setTimeout(look, 0);
    // Tab through the desk's own page is the person moving, frames included.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") for (const id of [...this.#held.keys()]) this.forget(id);
    };
    doc.addEventListener("focusin", onFocus, true);
    doc.addEventListener("keydown", onKey, true);
    win.addEventListener("blur", onBlur);
    const timer = setInterval(look, LOOK_MS);
    this.#off = () => {
      doc.removeEventListener("focusin", onFocus, true);
      doc.removeEventListener("keydown", onKey, true);
      win.removeEventListener("blur", onBlur);
      clearInterval(timer);
    };
  }
}
