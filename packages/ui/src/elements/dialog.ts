import { activeIn, Base, element, focusables, reflect, shadow } from "./base";

const css = `
:host {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px;
  font: inherit;
  font-size: var(--desk-text-sm);
}
:host([open]) {
  display: flex;
}
:host(:focus) {
  outline: none;
}
.backdrop {
  position: absolute;
  inset: 0;
  background: var(--desk-background);
  opacity: 0.72;
}
.panel {
  position: relative;
  box-sizing: border-box;
  width: min(480px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 20px;
  border: 1px solid var(--desk-border);
  border-radius: 12px;
  background: var(--desk-card);
  color: var(--desk-text);
  box-shadow: 0 16px 48px var(--desk-background);
}
:host(:focus-visible) .panel {
  outline: 2px solid var(--desk-ring);
  outline-offset: 2px;
}
:host([hidden]) {
  display: none;
}
`;

/**
 * `<desk-dialog label="Rename">`: a modal dialog over a dimmed page. `show()` moves focus to the
 * first focusable child (or one marked `autofocus`, or the dialog itself), Tab stays inside, and
 * Escape fires a cancelable `cancel`, then closes. `close()` gives focus back and fires `close`.
 */
export class DeskDialog extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["open", "label"];
  #returnTo: HTMLElement | null = null;

  constructor() {
    super();
    const panel = element("div", { class: "panel", part: "panel" });
    panel.append(document.createElement("slot"));
    shadow(this, css, [element("div", { class: "backdrop", part: "backdrop" }), panel]);
    this.addEventListener("keydown", this.#onKeyDown);
  }

  get open(): boolean {
    return this.hasAttribute("open");
  }

  set open(value: boolean) {
    this.toggleAttribute("open", value);
  }

  show(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "dialog");
    this.setAttribute("aria-modal", "true");
    if (!this.hasAttribute("tabindex")) this.tabIndex = -1;
    if (this.open) this.#opened();
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (name === "label") reflect(this, "aria-label", value);
    else if (this.isConnected && (old === null) !== (value === null)) {
      if (value === null) this.#closed();
      else this.#opened();
    }
  }

  #opened(): void {
    this.#returnTo = activeIn(this);
    const inside = focusables(this);
    (inside.find((child) => child.hasAttribute("autofocus")) ?? inside[0] ?? this).focus();
  }

  #closed(): void {
    const target = this.#returnTo;
    this.#returnTo = null;
    if (target?.isConnected) target.focus();
    this.dispatchEvent(new Event("close"));
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.dispatchEvent(new Event("cancel", { cancelable: true }))) this.close();
    } else if (event.key === "Tab") {
      this.#trap(event);
    }
  };

  // Tab moves on by itself between the first and the last stop; only the ends wrap.
  #trap(event: KeyboardEvent): void {
    const inside = focusables(this);
    const first = inside[0];
    const last = inside.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const index = inside.indexOf(activeIn(this) as HTMLElement);
    const atEnd = event.shiftKey ? index <= 0 : index < 0 || index === inside.length - 1;
    if (!atEnd) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
