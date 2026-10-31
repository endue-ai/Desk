import { Base, element, shadow } from "./base";

const css = `
:host {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  padding: 10px 14px;
  border: 1px solid var(--desk-border);
  border-radius: 8px;
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
}
:host([hidden]) {
  display: none;
}
.figure {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.value {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.unit,
.label {
  color: var(--desk-text-muted);
  font-size: 12px;
}
:host([density="compact"]) {
  padding: 6px 10px;
}
:host([density="compact"]) .value {
  font-size: 20px;
}
`;

/**
 * `<desk-stat label="Open tasks" value="7" unit="min">`: one number with its label. Screen readers
 * read it once, as its name ("Open tasks: 7 min"): the host is a named group and its parts are
 * hidden from them.
 */
export class DeskStat extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["label", "value", "unit"];
  readonly #value = element("span", { class: "value", "aria-hidden": "true", part: "value" });
  readonly #unit = element("span", { class: "unit", "aria-hidden": "true", part: "unit" });
  readonly #label = element("span", { class: "label", "aria-hidden": "true", part: "label" });

  constructor() {
    super();
    const figure = element("span", { class: "figure" });
    figure.append(this.#value, this.#unit);
    shadow(this, css, [figure, this.#label]);
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "group");
    this.#sync();
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  #sync(): void {
    const [label, value, unit] = ["label", "value", "unit"].map((n) => this.getAttribute(n) ?? "");
    this.#value.textContent = value ?? "";
    this.#unit.textContent = unit ?? "";
    this.#unit.hidden = !unit;
    this.#label.textContent = label ?? "";
    const figure = unit ? `${value} ${unit}` : (value ?? "");
    this.setAttribute("aria-label", label ? `${label}: ${figure}` : figure);
  }
}
