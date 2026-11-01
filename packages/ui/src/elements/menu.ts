import { activeIn, Base, childOf, type DeskSelectDetail, reflect, shadow, step, uid } from "./base";

const css = `
:host {
  position: fixed;
  z-index: 1001;
  display: none;
  box-sizing: border-box;
  min-width: 160px;
  max-width: 320px;
  padding: 4px;
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: var(--desk-text-sm);
  box-shadow: 0 8px 24px var(--desk-background);
}
:host([open]) {
  display: block;
}
:host(:focus) {
  outline: none;
}
::slotted(*) {
  padding: 6px 10px;
  border-radius: var(--desk-radius-md);
  color: var(--desk-text);
  cursor: pointer;
  outline: none;
}
::slotted(:focus) {
  background: var(--desk-border);
  color: var(--desk-text);
}
::slotted(:focus-visible) {
  outline: 2px solid var(--desk-ring);
  outline-offset: -2px;
}
::slotted([role="separator"]) {
  height: 1px;
  margin: 4px 0;
  padding: 0;
  background: var(--desk-border);
  cursor: default;
}
::slotted([aria-disabled="true"]) {
  opacity: 0.5;
  cursor: default;
}
:host([hidden]) {
  display: none;
}
`;

/**
 * `<desk-menu label="File">`: a popup menu. Its children are menu items (give one
 * `role="separator"` to divide them). `show(anchor)` opens it below `anchor` and focuses the first
 * item; arrows (wrapping), Home and End move; Enter, Space and a click activate an item, close the
 * menu and fire `desk-select` ({@link DeskSelectDetail}). Escape and Tab close it and give focus back
 * to the anchor; a press outside closes it and leaves focus alone. Closing fires `close`.
 */
export class DeskMenu extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["open", "label"];
  #anchor: HTMLElement | null = null;
  #returnTo: HTMLElement | null = null;
  #restore = true;

  constructor() {
    super();
    const slot = document.createElement("slot");
    slot.addEventListener("slotchange", () => this.#sync());
    shadow(this, css, [slot]);
    this.addEventListener("keydown", this.#onKeyDown);
    this.addEventListener("click", this.#onClick);
  }

  get open(): boolean {
    return this.hasAttribute("open");
  }

  set open(value: boolean) {
    this.toggleAttribute("open", value);
  }

  /** The items: the children that are neither separators nor hidden. */
  get items(): HTMLElement[] {
    return ([...this.children] as HTMLElement[]).filter(
      (child) => child.getAttribute("role") !== "separator" && !child.hidden,
    );
  }

  /** Open below `anchor`, which gets focus back on close, or where the page's CSS puts the menu. */
  show(anchor?: HTMLElement): void {
    this.#anchor = anchor ?? null;
    if (this.open) this.#place();
    else this.open = true;
  }

  close(): void {
    this.open = false;
  }

  toggle(anchor?: HTMLElement): void {
    if (this.open) this.close();
    else this.show(anchor);
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "menu");
    if (!this.hasAttribute("tabindex")) this.tabIndex = -1;
    if (!this.id) this.id = uid("desk-menu");
    this.#sync();
    if (this.open) this.#opened();
  }

  disconnectedCallback(): void {
    document.removeEventListener("pointerdown", this.#onOutside, true);
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (name === "label") reflect(this, "aria-label", value);
    else if (this.isConnected && (old === null) !== (value === null)) {
      if (value === null) this.#closed();
      else this.#opened();
    }
  }

  #sync(): void {
    for (const child of this.children) {
      if (!child.hasAttribute("role")) child.setAttribute("role", "menuitem");
      const item = child.getAttribute("role") !== "separator";
      if (item && !child.hasAttribute("tabindex")) child.setAttribute("tabindex", "-1");
    }
  }

  #place(): void {
    if (!this.#anchor) return;
    const box = this.#anchor.getBoundingClientRect();
    this.style.top = `${box.bottom + 4}px`;
    this.style.left = `${box.left}px`;
  }

  #opened(): void {
    this.#returnTo = activeIn(this);
    this.#restore = true;
    this.#place();
    const anchor = this.#anchor;
    if (anchor) {
      anchor.setAttribute("aria-haspopup", "menu");
      anchor.setAttribute("aria-expanded", "true");
      anchor.setAttribute("aria-controls", this.id);
    }
    (this.items[0] ?? this).focus();
    document.addEventListener("pointerdown", this.#onOutside, true);
  }

  #closed(): void {
    document.removeEventListener("pointerdown", this.#onOutside, true);
    this.#anchor?.setAttribute("aria-expanded", "false");
    const target = this.#anchor ?? this.#returnTo;
    this.#returnTo = null;
    if (this.#restore && target?.isConnected) target.focus();
    this.dispatchEvent(new Event("close"));
  }

  // Closes first, so a listener that opens a dialog finds focus back on the anchor.
  #activate(item: HTMLElement): void {
    if (item.getAttribute("aria-disabled") === "true") return;
    const detail: DeskSelectDetail = { index: this.items.indexOf(item), item };
    this.close();
    this.dispatchEvent(new CustomEvent("desk-select", { bubbles: true, detail }));
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    const items = this.items;
    const next = step(event.key, items.indexOf(activeIn(this) as HTMLElement), items.length, true);
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === "Tab") {
      // Focus goes back to the anchor; Tab then moves on from there.
      this.close();
    } else if (event.key === "Enter" || event.key === " ") {
      const item = childOf(this, event.target);
      if (!item || !items.includes(item)) return;
      event.preventDefault();
      this.#activate(item);
    }
  };

  #onClick = (event: MouseEvent): void => {
    const item = childOf(this, event.target);
    if (item && this.items.includes(item)) this.#activate(item);
  };

  #onOutside = (event: PointerEvent): void => {
    const path = event.composedPath();
    if (path.includes(this) || (this.#anchor && path.includes(this.#anchor))) return;
    this.#restore = false;
    this.close();
  };
}
