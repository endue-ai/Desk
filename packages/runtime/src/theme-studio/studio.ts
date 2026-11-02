/**
 * The theme studio (ADR 0056, docs/ko/theme-requirements.md TS-01, TS-02): a system window of the main
 * UI, not a plugin. Its gallery shows the endue theme and every installed theme plugin as cards; the
 * focused or hovered card is previewed on the whole desk, Enter or a click applies it, and Escape (or
 * closing) puts back what was in force. The command desk.theme.studio opens it.
 */
import type { Commands } from "../commands";
import type { RuntimeThemes } from "../policies/theme";
import { h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { containModal } from "../shell/modal";
import { themeCardElement } from "./card";
import { type StudioCopy, type StudioLang, studioText } from "./copy";
import { filterCards, moveIn, type ThemeCard, tagsOf, themeCards } from "./model";

export interface StudioDeps {
  themes: RuntimeThemes;
  commands: Commands;
  lang(): StudioLang;
  /** Where focus goes when the studio closes and nothing else had it. */
  fallback(): HTMLElement;
}

export interface ThemeStudio {
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

const COLUMNS = 3;

export function mountThemeStudio(host: HTMLElement, deps: StudioDeps): ThemeStudio {
  const { themes } = deps;
  const tr = (key: StudioCopy) => studioText(deps.lang(), key);
  let scrim: HTMLElement | undefined;
  let release: (() => void) | undefined;
  let offChange: (() => void) | undefined;
  let query = "";
  let tag: string | undefined;
  let selected = "";

  const previewOf = (id: string, scheme: "light" | "dark") => {
    const t = themes.resolve(id, scheme).tokens;
    return [t.background, t.card, t.primary, t.text].filter((c): c is string => Boolean(c));
  };
  const cards = (): ThemeCard[] =>
    themeCards(
      themes.installed(),
      { name: tr("endueName"), description: tr("endueDescription") },
      previewOf,
    );
  const shown = () => filterCards(cards(), query, tag);

  const grid = h("div", { class: "theme-grid", role: "listbox", "aria-label": tr("gallery") });
  const tagsEl = h("div", { class: "theme-tags", role: "group" });
  const status = h("p", { class: "theme-studio-status", role: "status" });
  const search = h("input", {
    class: "theme-search",
    type: "search",
    "aria-label": tr("search"),
    placeholder: tr("search"),
    onInput: () => {
      query = search.value;
      draw();
    },
  });

  const draw = () => {
    if (!scrim) return;
    const list = shown();
    if (!list.some((c) => c.id === selected)) selected = list[0]?.id ?? selected;
    render(tagsEl, () =>
      [undefined, ...tagsOf(cards())].map((t) =>
        h(
          "button",
          {
            type: "button",
            class: `theme-tag${t === tag ? " is-on" : ""}`,
            "aria-pressed": String(t === tag),
            "data-key": `tag-${t ?? "all"}`,
            onClick: () => {
              tag = t;
              draw();
            },
          },
          t ?? tr("all"),
        ),
      ),
    );
    const active = themes.active();
    render(grid, () =>
      list.length === 0
        ? [h("p", { class: "theme-empty" }, tr("empty"))]
        : list.map((card) =>
            themeCardElement(card, {
              variables: themes.resolve(card.id).variables,
              selected: card.id === selected,
              applied: card.id === active,
              lang: deps.lang(),
            }),
          ),
    );
    const current = cards().find((c) => c.id === active)?.name ?? tr("endueName");
    const previewing = themes.previewing();
    const previewName = cards().find((c) => c.id === previewing)?.name;
    status.textContent =
      previewing !== undefined && previewing !== active && previewName
        ? `${tr("current")}: ${current} · ${tr("previewing")}: ${previewName}`
        : `${tr("current")}: ${current}`;
    const option = grid.querySelector<HTMLElement>('[aria-selected="true"]');
    if (option) grid.setAttribute("aria-activedescendant", option.id);
  };

  const focusSelected = () => grid.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  const select = (id: string, focus = true) => {
    selected = id;
    themes.preview(id);
    draw();
    if (focus) focusSelected();
  };
  const apply = (id: string) => {
    selected = id;
    themes.apply(id);
    draw();
  };
  const cardAt = (target: EventTarget | null) =>
    (target as Element | null)?.closest<HTMLElement>("[data-theme]")?.dataset.theme;

  grid.addEventListener("click", (event) => {
    const id = cardAt(event.target);
    if (id !== undefined) apply(id);
  });
  grid.addEventListener("pointerover", (event) => {
    const id = cardAt(event.target);
    if (id !== undefined && id !== themes.previewing()) themes.preview(id);
  });
  grid.addEventListener("pointerleave", () => themes.preview(selected));
  grid.addEventListener("keydown", (event) => {
    const list = shown();
    const at = list.findIndex((c) => c.id === selected);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      apply(selected);
      if (event.key === "Enter") close();
      return;
    }
    const next = moveIn(at, event.key, list.length, COLUMNS);
    if (next !== at && list[next]) {
      event.preventDefault();
      select(list[next].id);
    }
  });

  const close = () => {
    if (!scrim) return;
    themes.preview(undefined);
    offChange?.();
    offChange = undefined;
    const done = release;
    release = undefined;
    scrim.remove();
    scrim = undefined;
    done?.();
  };

  const open = () => {
    if (scrim) return;
    query = "";
    tag = undefined;
    search.value = "";
    selected = themes.active();
    const panel = h(
      "section",
      {
        class: "theme-studio",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "theme-studio-title",
      },
      h(
        "header",
        { class: "theme-studio-head" },
        h("h2", { class: "theme-studio-title", id: "theme-studio-title" }, tr("title")),
        search,
        h(
          "button",
          {
            type: "button",
            class: "icon-button theme-studio-close",
            "aria-label": tr("close"),
            title: tr("close"),
            onClick: () => close(),
          },
          icon("close", 18),
        ),
      ),
      tagsEl,
      grid,
      h(
        "footer",
        { class: "theme-studio-foot" },
        status,
        h("p", { class: "theme-studio-hint" }, tr("hint")),
      ),
    );
    scrim = h("div", { class: "scrim theme-studio-scrim" }, panel);
    scrim.addEventListener("pointerdown", (event) => {
      if (event.target === scrim) close();
    });
    host.append(scrim);
    release = containModal(panel, close, deps.fallback());
    offChange = themes.onChange(draw);
    draw();
    focusSelected();
  };

  const offCommand = deps.commands.define("desk.theme.studio", {
    title: "Open the theme studio",
    keywords: ["theme", "themes", "appearance", "gallery", "look", "테마"],
    owner: "desk",
    run: () => open(),
  });

  return {
    open,
    close,
    isOpen: () => scrim !== undefined,
    dispose() {
      close();
      offCommand();
    },
  };
}
