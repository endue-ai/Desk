import { Base, childOf, type DeskSelectDetail, reflect, shadow, step, uid } from "./base";

const css = `
:host {
  display: block;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid var(--desk-border);
  border-radius: 8px;
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: 13px;
  overflow: auto;
}
:host(:focus-visible) {
  outline: 2px solid var(--desk-accent);
  outline-offset: 2px;
}
::slotted(*) {
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--desk-text);
  cursor: pointer;
}
::slotted([data-active]) {
  background: var(--desk-border);
  color: var(--desk-text);
}
::slotted([aria-selected="true"]) {
  background: var(--desk-card);
  color: var(--desk-accent);
  font-weight: 600;
}
::slotted([data-active][aria-selected="true"]) {
  background: var(--desk-border);
  color: var(--desk-accent);
}
:host([hidden]) {
  display: none;
}
`;

/**
 * `<desk-list label="Files">`: a single-select listbox. Its visible children are the options; the
 * list keeps focus and points at the active option with `aria-activedescendant`. Arrows, Home and
 * End move; Enter, Space and a click select and fire `desk-select` ({@link DeskSelectDetail}).
 */
export class DeskList extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["label"];
  #active = -1;

  constructor() {
    super();
    const slot = document.createElement("slot");
    slot.addEventListener("slotchange", () => this.#sync());
    shadow(this, css, [slot]);
    this.addEventListener("keydown", this.#onKeyDown);
    this.addEventListener("click", this.#onClick);
  }

  /** The options: the children that are not hidden. */
  get options(): HTMLElement[] {
    return ([...this.children] as HTMLElement[]).filter((child) => !child.hidden);
  }

  /** The selected option's index among {@link options}, or -1. */
  get selectedIndex(): number {
    return this.options.findIndex((option) => option.getAttribute("aria-selected") === "true");
  }

  set selectedIndex(index: number) {
    this.options.forEach((option, at) => {
      option.setAttribute("aria-selected", String(at === index));
    });
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "listbox");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.#sync();
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    reflect(this, "aria-label", value);
  }

  #sync(): void {
    for (const child of this.children) {
      if (!child.hasAttribute("role")) child.setAttribute("role", "option");
      if (!child.id) child.id = uid("desk-option");
      if (!child.hasAttribute("aria-selected")) child.setAttribute("aria-selected", "false");
    }
    this.#activate(Math.min(this.#active, this.options.length - 1));
  }

  #activate(index: number): void {
    const option = this.options[index];
    this.#active = option ? index : -1;
    for (const child of this.children) child.toggleAttribute("data-active", child === option);
    if (!option) {
      this.removeAttribute("aria-activedescendant");
      return;
    }
    this.setAttribute("aria-activedescendant", option.id);
    option.scrollIntoView({ block: "nearest" });
  }

  #select(index: number): void {
    const item = this.options[index];
    if (!item) return;
    this.selectedIndex = index;
    this.#activate(index);
    const detail: DeskSelectDetail = { index, item };
    this.dispatchEvent(new CustomEvent("desk-select", { bubbles: true, detail }));
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this) return;
    const next = step(event.key, this.#active, this.options.length, false);
    if (next !== null) {
      event.preventDefault();
      this.#activate(next);
    } else if ((event.key === "Enter" || event.key === " ") && this.#active >= 0) {
      event.preventDefault();
      this.#select(this.#active);
    }
  };

  #onClick = (event: MouseEvent): void => {
    const option = childOf(this, event.target);
    const index = option ? this.options.indexOf(option) : -1;
    if (index >= 0) this.#select(index);
  };
}
