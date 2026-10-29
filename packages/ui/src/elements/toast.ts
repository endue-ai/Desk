import { Base, element, shadow } from "./base";

const DURATION = 5000;

const css = `
:host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1002;
  display: none;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 10px 10px 16px;
  border: 1px solid var(--desk-border);
  border-radius: 10px;
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: 13px;
  box-shadow: 0 8px 24px var(--desk-background);
}
:host([open]) {
  display: flex;
}
:host([tone="error"]) {
  border-color: var(--desk-accent);
}
.message {
  flex: 1;
}
button {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: var(--desk-card);
  color: var(--desk-text-muted);
  font: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
button:hover {
  background: var(--desk-border);
  color: var(--desk-text);
}
button:focus-visible {
  outline: 2px solid var(--desk-accent);
  outline-offset: 1px;
}
:host([hidden]) {
  display: none;
}
`;

/**
 * `<desk-toast>`: a short message in the corner, announced politely (`role="status"`), or at once
 * for `tone="error"` (`role="alert"`). It never takes focus. `show(message, { duration })` opens it
 * and closes it after `duration` ms (5000; 0 keeps it), waiting while the pointer or focus is
 * inside. Its dismiss button (`dismiss-label`, default "Dismiss") and Escape inside close it; closing
 * fires `close`.
 */
export class DeskToast extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["open", "tone", "dismiss-label"];
  readonly #dismiss = element("button", {
    type: "button",
    part: "dismiss",
    "aria-label": "Dismiss",
  });
  #duration = DURATION;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #hovered = false;
  #focused = false;

  constructor() {
    super();
    const message = element("span", { class: "message", part: "message" });
    message.append(document.createElement("slot"));
    this.#dismiss.textContent = "×";
    this.#dismiss.addEventListener("click", () => this.close());
    shadow(this, css, [message, this.#dismiss]);
    this.addEventListener("keydown", this.#onKeyDown);
    this.addEventListener("pointerenter", () => this.#hold("pointer", true));
    this.addEventListener("pointerleave", () => this.#hold("pointer", false));
    this.addEventListener("focusin", () => this.#hold("focus", true));
    this.addEventListener("focusout", this.#onFocusOut);
  }

  get open(): boolean {
    return this.hasAttribute("open");
  }

  set open(value: boolean) {
    this.toggleAttribute("open", value);
  }

  /** Open with `message` (or the current content) for `duration` ms. */
  show(message?: string, options: { duration?: number } = {}): void {
    if (message !== undefined) this.textContent = message;
    this.#duration = options.duration ?? DURATION;
    if (this.open) this.#arm();
    else this.open = true;
  }

  close(): void {
    this.open = false;
  }

  connectedCallback(): void {
    this.#role();
    if (this.open) this.#arm();
  }

  disconnectedCallback(): void {
    clearTimeout(this.#timer);
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (name === "tone") this.#role();
    else if (name === "dismiss-label") this.#dismiss.setAttribute("aria-label", value ?? "Dismiss");
    else if ((old === null) !== (value === null)) {
      if (value !== null) {
        this.#arm();
        return;
      }
      clearTimeout(this.#timer);
      this.dispatchEvent(new Event("close"));
    }
  }

  #role(): void {
    this.setAttribute("role", this.getAttribute("tone") === "error" ? "alert" : "status");
  }

  #arm(): void {
    clearTimeout(this.#timer);
    if (!this.open || this.#duration <= 0 || this.#hovered || this.#focused) return;
    this.#timer = setTimeout(() => this.close(), this.#duration);
  }

  #hold(by: "pointer" | "focus", on: boolean): void {
    if (by === "pointer") this.#hovered = on;
    else this.#focused = on;
    this.#arm();
  }

  #onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next && (next === this || this.contains(next))) return;
    this.#hold("focus", false);
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.open) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };
}
