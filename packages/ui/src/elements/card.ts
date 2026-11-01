import { Base, element, shadow, uid } from "./base";

const css = `
:host {
  display: block;
  box-sizing: border-box;
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: var(--desk-text-sm);
}
:host([hidden]) {
  display: none;
}
section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
}
h2 {
  margin: 0;
  color: var(--desk-text);
  font-size: var(--desk-text-sm);
  font-weight: 600;
}
h2[hidden] {
  display: none;
}
:host([density="compact"]) section {
  gap: 4px;
  padding: 8px 10px;
}
`;

/**
 * `<desk-card heading="New">`: a card holding its children under a heading. With a heading it is a
 * region named by it; without one it is a plain group of what it holds.
 */
export class DeskCard extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["heading"];
  readonly #section = element("section", { part: "card" });
  readonly #heading = element("h2", { id: uid("desk-card-heading"), part: "heading" });

  constructor() {
    super();
    this.#section.append(this.#heading, document.createElement("slot"));
    shadow(this, css, [this.#section]);
    this.#sync();
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  #sync(): void {
    const heading = this.getAttribute("heading");
    this.#heading.textContent = heading ?? "";
    this.#heading.hidden = !heading;
    if (heading) {
      this.#section.setAttribute("role", "region");
      this.#section.setAttribute("aria-labelledby", this.#heading.id);
    } else {
      this.#section.removeAttribute("role");
      this.#section.removeAttribute("aria-labelledby");
    }
  }
}
