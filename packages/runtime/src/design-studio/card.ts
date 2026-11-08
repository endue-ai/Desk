/**
 * The design system studio's gallery as data and cards (DS-02): one card per design system, its
 * specimen drawn with the shell's own kit (buttons, a field, tabs, a badge, rows, a check) under the
 * design system's component tokens, scoped to the card so nothing else changes.
 */
import { cssVariables } from "@endue-ai/ui";
import type { InstalledDesign } from "../design";
import { h } from "../shell/dom";
import type { StudioLang } from "../theme-studio/copy";
import type { ThemeCard } from "../theme-studio/model";
import { type DesignCopy, designText } from "./copy";

/** A gallery card: the theme studio's card shape, so its filter and grid keys apply as they are. */
export type DesignCard = ThemeCard;

export function designCards(
  installed: readonly InstalledDesign[],
  endue: { name: string; description: string },
): DesignCard[] {
  return [
    { id: "", name: endue.name, description: endue.description, tags: [], light: [], dark: [] },
    ...installed.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? "",
      ...(d.designSystem.author ? { author: d.designSystem.author } : {}),
      tags: [...(d.designSystem.tags ?? [])],
      light: [],
      dark: [],
    })),
  ];
}

/** A small set of the desk's components drawn with `tokens` (component tokens, camelCase). */
export function specimen(tokens: Readonly<Record<string, string>>, lang: StudioLang): HTMLElement {
  const tr = (key: DesignCopy) => designText(lang, key);
  const fake = (tag: "span", cls: string, text = "") => h(tag, { class: cls }, text);
  return h(
    "span",
    { class: "design-specimen", style: cssVariables(tokens), "aria-hidden": "true" },
    h(
      "span",
      { class: "design-specimen-line" },
      fake("span", "btn btn-primary", tr("primary")),
      fake("span", "btn btn-outline", tr("secondary")),
      fake("span", "design-specimen-badge", "3"),
    ),
    h(
      "span",
      { class: "design-specimen-line" },
      fake("span", "input design-specimen-field", tr("field")),
    ),
    h(
      "span",
      { class: "segmented design-specimen-tabs" },
      fake("span", "segment is-selected", "A"),
      fake("span", "segment", "B"),
      fake("span", "segment", "C"),
    ),
    h(
      "span",
      { class: "design-specimen-rows" },
      fake("span", "menu-item is-selected", tr("row")),
      h("span", { class: "menu-item" }, h("span", { class: "design-specimen-check" }), tr("row")),
    ),
  );
}

export interface DesignCardState {
  tokens: Readonly<Record<string, string>>;
  selected: boolean;
  applied: boolean;
  lang: StudioLang;
}

export function designCardElement(card: DesignCard, state: DesignCardState): HTMLElement {
  const tr = (key: DesignCopy) => designText(state.lang, key);
  const id = `design-card-${card.id === "" ? "endue" : card.id.replace(/[^a-z0-9-]/g, "-")}`;
  return h(
    "div",
    {
      class: `theme-card design-card${state.selected ? " is-selected" : ""}${state.applied ? " is-applied" : ""}`,
      id,
      role: "option",
      "aria-selected": String(state.selected),
      "data-design": card.id,
      "data-key": id,
      tabindex: state.selected ? "0" : "-1",
    },
    specimen(state.tokens, state.lang),
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
    ),
  );
}
