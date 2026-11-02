import { Base, element, shadow } from "./base";

/** What a file plugin promises when it saves a format (ADR 0071), most to least. */
export const EDIT_TIERS = ["lossless", "text", "read-only"] as const;
export type EditTier = (typeof EDIT_TIERS)[number];

const WORDS: Record<EditTier, { label: string; detail: string }> = {
  lossless: {
    label: "Lossless editing",
    detail: "Saving changes only the bytes you edit; the rest of the file stays as it was.",
  },
  text: {
    label: "Text editing",
    detail:
      "Saving keeps the content, not always the formatting. The first save makes a copy unless you choose to overwrite.",
  },
  "read-only": {
    label: "Read-only",
    detail: "This format opens for reading; it is not edited here.",
  },
};

const css = `
:host {
  display: inline-flex;
  align-items: center;
  gap: var(--desk-space-2);
  box-sizing: border-box;
  max-width: 100%;
  padding: 1px var(--desk-space-2);
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-full);
  color: var(--desk-text-muted);
  font: inherit;
  font-size: var(--desk-text-xs);
  line-height: 1.5;
  white-space: nowrap;
}
:host([hidden]) {
  display: none;
}
.mark {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--desk-radius-full);
  background: currentcolor;
}
:host([tier="lossless"]) .mark {
  color: var(--desk-success-text);
}
:host([tier="text"]) .mark {
  color: var(--desk-warning-text);
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
}
`;

/**
 * `<desk-edit-tier tier="lossless" format="CSV">`: what saving does to this file, shown before the
 * first edit. `tier` is `lossless`, `text` or `read-only` (missing or unknown reads as read-only);
 * `format` prefixes the label ("CSV · Lossless editing"). `label` and `detail` replace the words, for
 * translations. The detail is the label's tooltip; screen readers read the host once, as a note named
 * "CSV: Lossless editing. Saving changes only …".
 */
export class DeskEditTier extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["tier", "format", "label", "detail"];
  readonly #label = element("span", { class: "label", part: "label", "aria-hidden": "true" });

  constructor() {
    super();
    const mark = element("span", { class: "mark", part: "mark", "aria-hidden": "true" });
    shadow(this, css, [mark, this.#label]);
  }

  /** The tier stated: `read-only` unless the attribute names another. */
  get tier(): EditTier {
    const tier = this.getAttribute("tier");
    return EDIT_TIERS.find((known) => known === tier) ?? "read-only";
  }

  set tier(value: EditTier) {
    this.setAttribute("tier", value);
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "note");
    this.#sync();
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  #sync(): void {
    const words = WORDS[this.tier];
    const label = this.getAttribute("label") || words.label;
    const detail = this.getAttribute("detail") || words.detail;
    const format = this.getAttribute("format") ?? "";
    this.#label.textContent = format ? `${format} · ${label}` : label;
    this.#label.setAttribute("title", detail);
    this.setAttribute("aria-label", `${format ? `${format}: ` : ""}${label}. ${detail}`);
  }
}
