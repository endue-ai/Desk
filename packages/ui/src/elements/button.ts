import { Base, shadow } from "./base";

const css = `
:host {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--desk-space-2);
  box-sizing: border-box;
  min-height: var(--desk-button-height);
  padding: 0 var(--desk-button-padding-x);
  border: 1px solid var(--desk-button-border);
  border-radius: var(--desk-button-radius);
  background: var(--desk-button-bg);
  color: var(--desk-button-fg);
  box-shadow: var(--desk-button-shadow);
  font: inherit;
  font-size: var(--desk-text-sm);
  font-weight: var(--desk-button-weight);
  text-transform: var(--desk-button-case);
  letter-spacing: var(--desk-button-tracking);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--desk-motion-fast) ease, border-color var(--desk-motion-fast) ease;
}
:host(:hover) {
  border-color: var(--desk-button-hover-border);
  background: var(--desk-button-hover-bg);
  color: var(--desk-button-hover-fg);
}
:host(:focus-visible) {
  outline: var(--desk-focus-width) solid var(--desk-ring);
  outline-offset: var(--desk-focus-offset);
}
:host([variant="primary"]) {
  border-color: var(--desk-button-primary-border);
  background: var(--desk-button-primary-bg);
  color: var(--desk-button-primary-fg);
}
:host([variant="primary"]:hover:not([disabled])) {
  border-color: var(--desk-button-primary-hover-border);
  background: var(--desk-button-primary-hover-bg);
  color: var(--desk-button-primary-hover-fg);
}
:host([variant="danger"]) {
  border-color: var(--desk-button-danger-border);
  background: var(--desk-button-danger-bg);
  color: var(--desk-button-danger-fg);
}
:host([variant="danger"]:hover:not([disabled])) {
  border-color: var(--desk-button-danger-hover-border);
  background: var(--desk-button-danger-hover-bg);
  color: var(--desk-button-danger-hover-fg);
}
:host([variant="quiet"]) {
  border-color: var(--desk-button-quiet-border);
  background: var(--desk-button-quiet-bg);
  color: var(--desk-button-quiet-fg);
}
:host([variant="quiet"]:hover:not([disabled])) {
  background: var(--desk-button-quiet-hover-bg);
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
 * `<desk-button>`: a push button named by its text, drawn as the design system's button (ADR 0090).
 * `variant="primary"` marks the main action, `danger` a destructive one, `quiet` a toolbar one;
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
