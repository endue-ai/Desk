/**
 * One gallery card: the theme drawn small with its own tokens (a desk, a window, text, a button and
 * the terminal colours), scoped to the card so nothing else changes, then its name, author,
 * description and the colours of both schemes.
 */
import { h } from "../shell/dom";
import { type StudioCopy, type StudioLang, studioText } from "./copy";
import type { ThemeCard } from "./model";

export interface CardState {
  /** The theme's --desk-* variables under the scheme in force. */
  variables: Record<string, string>;
  selected: boolean;
  applied: boolean;
  lang: StudioLang;
}

export function themeCardElement(card: ThemeCard, state: CardState): HTMLElement {
  const tr = (key: StudioCopy) => studioText(state.lang, key);
  const id = `theme-card-${card.id === "" ? "endue" : card.id.replace(/[^a-z0-9-]/g, "-")}`;
  const swatches = (colors: string[], label: StudioCopy) =>
    h(
      "span",
      { class: "theme-swatches", title: tr(label) },
      colors.map((color) => h("span", { class: "theme-swatch", style: { "--swatch": color } })),
    );
  return h(
    "div",
    {
      class: `theme-card${state.selected ? " is-selected" : ""}${state.applied ? " is-applied" : ""}`,
      id,
      role: "option",
      "aria-selected": String(state.selected),
      "data-theme": card.id,
      "data-key": id,
      tabindex: state.selected ? "0" : "-1",
    },
    h(
      "span",
      { class: "theme-mock", style: state.variables, "aria-hidden": "true" },
      h(
        "span",
        { class: "theme-mock-window" },
        h("span", { class: "theme-mock-title" }, card.name),
        h("span", { class: "theme-mock-text" }, "Aa 가나다 123"),
        h("span", { class: "theme-mock-muted" }, card.description || card.name),
        h(
          "span",
          { class: "theme-mock-row" },
          h("span", { class: "theme-mock-button" }, tr("apply")),
          h("span", { class: "theme-mock-input" }),
        ),
      ),
      h(
        "span",
        { class: "theme-mock-ansi" },
        [1, 2, 3, 4, 5, 6].map((n) =>
          h("span", { style: { background: `var(--desk-ansi-${n})` } }),
        ),
      ),
    ),
    h(
      "span",
      { class: "theme-card-text" },
      h(
        "span",
        { class: "theme-card-name" },
        card.name,
        state.applied ? h("span", { class: "theme-card-badge" }, tr("applied")) : null,
      ),
      card.author ? h("span", { class: "theme-card-author" }, `${tr("by")} ${card.author}`) : null,
      h("span", { class: "theme-card-description" }, card.description),
      h(
        "span",
        { class: "theme-card-schemes" },
        swatches(card.light, "light"),
        swatches(card.dark, "dark"),
      ),
    ),
  );
}
