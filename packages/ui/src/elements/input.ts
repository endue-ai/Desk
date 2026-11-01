import { Base, element, reflect, shadow } from "./base";

const TYPES = new Set(["text", "search", "email", "password", "tel", "url", "number"]);

const css = `
:host {
  display: inline-block;
  color: var(--desk-text-muted);
  font: inherit;
  font-size: var(--desk-text-sm);
}
label {
  display: flex;
  flex-direction: column;
  gap: var(--desk-space-1);
}
.text:empty {
  display: none;
}
input {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--desk-control-sm);
  padding: 0 var(--desk-space-3);
  border: 1px solid var(--desk-input);
  border-radius: var(--desk-radius-md);
  background: var(--desk-background);
  color: var(--desk-text);
  font: inherit;
}
input::placeholder {
  color: var(--desk-text-muted);
}
input:focus-visible {
  outline: 2px solid var(--desk-ring);
  outline-offset: 1px;
}
:host([disabled]) {
  opacity: 0.5;
}
:host([hidden]) {
  display: none;
}
`;

/**
 * `<desk-input>`: a text field. A native `<input>` sits in the shadow root inside a `<label>` that
 * shows `label`; focus goes straight to it. `value`, `placeholder`, `type` and `disabled` pass
 * through, as does `aria-label` for a field without a visible label. `input` events come through
 * the shadow boundary on their own; `change` is dispatched again from the host.
 */
export class DeskInput extends Base {
  static readonly styles = css;
  static readonly observedAttributes = [
    "label",
    "value",
    "placeholder",
    "type",
    "disabled",
    "aria-label",
  ];
  readonly #text = element("span", { class: "text", part: "label" });
  readonly #input = element("input", { part: "input", type: "text" }) as HTMLInputElement;

  constructor() {
    super();
    const label = document.createElement("label");
    label.append(this.#text, this.#input);
    shadow(this, css, [label], { delegatesFocus: true });
    this.#input.addEventListener("change", () => {
      this.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  get value(): string {
    return this.#input.value;
  }

  set value(value: string) {
    this.#input.value = value;
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    this.toggleAttribute("disabled", value);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    switch (name) {
      case "label":
        this.#text.textContent = value ?? "";
        break;
      case "value":
        this.#input.value = value ?? "";
        break;
      case "type":
        this.#input.type = value !== null && TYPES.has(value) ? value : "text";
        break;
      case "disabled":
        this.#input.disabled = value !== null;
        break;
      default:
        reflect(this.#input, name, value);
    }
  }
}
