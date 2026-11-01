import { Base, shadow } from "./base";

const css = `
:host {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--desk-space-2);
  box-sizing: border-box;
  min-height: var(--desk-control-sm);
  padding: 0 var(--desk-space-3);
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: var(--desk-text-sm);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
:host(:hover) {
  background: var(--desk-hover);
  color: var(--desk-text);
}
:host(:focus-visible) {
  outline: 2px solid var(--desk-ring);
  outline-offset: 2px;
}
:host([variant="primary"]) {
  border-color: var(--desk-primary);
  background: var(--desk-primary);
  color: var(--desk-primary-foreground);
}
:host([variant="primary"]:hover:not([disabled])) {
  border-color: var(--desk-primary-hover);
  background: var(--desk-primary-hover);
  color: var(--desk-primary-foreground);
}
:host([disabled]) {
  opacity: 0.5;
  cursor: default;
  pointer-events: none;
}
:host([hidden]) {
  display: none;
}
`;

/**
 * `<desk-button>`: a push button named by its text. `variant="primary"` marks the main action;
 * `disabled` takes it out of the tab order and swallows its clicks.
 */
export class DeskButton extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["disabled"];

  constructor() {
    super();
    shadow(this, css, [document.createElement("slot")]);
    // Registered first, so a disabled button's click reaches no other listener.
    this.addEventListener("click", this.#onClick);
    this.addEventListener("keydown", this.#onKeyDown);
    this.addEventListener("keyup", this.#onKeyUp);
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    this.toggleAttribute("disabled", value);
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
    this.#sync();
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  #sync(): void {
    this.tabIndex = this.disabled ? -1 : 0;
    if (this.disabled) this.setAttribute("aria-disabled", "true");
    else this.removeAttribute("aria-disabled");
  }

  #onClick = (event: MouseEvent): void => {
    if (!this.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // Enter clicks on keydown and Space on keyup, as a native button does.
  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this || this.disabled) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.click();
    } else if (event.key === " ") {
      event.preventDefault();
    }
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    if (event.target !== this || this.disabled || event.key !== " ") return;
    event.preventDefault();
    this.click();
  };
}
