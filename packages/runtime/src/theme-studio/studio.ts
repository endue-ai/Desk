/**
 * The theme studio (ADR 0056, docs/ko/theme-requirements.md TS-01, TS-02): a system window of the main
 * UI, not a plugin. Its gallery shows the endue theme and every installed theme plugin as cards; the
 * focused or hovered card is previewed on the whole desk, Enter or a click applies it, and Escape (or
 * closing) puts back what was in force. Its editor (editor.ts, TS-03 to TS-05) tunes a copy of a theme
 * while the desk previews it; "From an image" (brand.ts, TS-09) starts one from a logo's colours. The
 * command desk.theme.studio opens it.
 */
import type { ThemePackage } from "@endue-ai/bridge";
import type { Commands } from "../commands";
import type { RuntimeThemes } from "../policies/theme";
import { h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { containModal } from "../shell/modal";
import { createBrandPanel } from "./brand";
import { themeCardElement } from "./card";
import { type StudioCopy, type StudioLang, studioText } from "./copy";
import { createEditor, type ThemeIo } from "./editor";
import { filterCards, moveIn, type ThemeCard, tagsOf, themeCards } from "./model";
import { acceptDrops, transferControls } from "./transfer";

export interface StudioDeps {
  themes: RuntimeThemes;
  commands: Commands;
  lang(): StudioLang;
  /** Where focus goes when the studio closes and nothing else had it. */
  fallback(): HTMLElement;
  /** The core's theme.* (save, export, import, remove), when it has them. */
  io?(): ThemeIo | undefined;
}

export interface ThemeStudio {
  open(): void;
  /** Open the editor on a copy of `from` (an installed theme), or on a new theme. */
  edit(from: string | undefined): void;
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
  let editing = false;
  let branding = false;
  let panel: HTMLElement | undefined;
  let offDrops: (() => void) | undefined;
  let arriving: string | undefined;
  let previewOnArrival = false;
  const content = h("div", { class: "theme-studio-content" });

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

  const editor = createEditor({
    themes,
    lang: deps.lang,
    io: () => deps.io?.(),
    back: (id) => gallery(id),
  });
  const brand = createBrandPanel({
    tr,
    open: () => fromImage(),
    back: () => gallery(),
    make: (theme, name) => edit(undefined, theme, name),
  });
  const actions = h(
    "div",
    { class: "theme-gallery-actions" },
    h(
      "button",
      {
        type: "button",
        class: "btn btn-outline",
        "data-key": "tune-copy",
        onClick: () => edit(selected),
      },
      tr("tuneCopy"),
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-outline",
        "data-key": "new-theme",
        onClick: () => edit(undefined),
      },
      tr("newTheme"),
    ),
    brand.entry,
  );
  const transfer = {
    io: () => deps.io?.(),
    selected: () => selected,
    tr,
    imported: (id: string) => {
      arriving = id;
      previewOnArrival = true;
      select(id);
    },
  };
  const transferEl = h("div", { class: "theme-gallery-actions" });
  const transferNote = h("p", { class: "theme-note theme-transfer-note", "aria-live": "polite" });
  const drawTransfer = () => render(transferEl, () => transferControls(transfer, transferNote));
  const layout = () => {
    scrim?.classList.toggle("is-editing", editing);
    panel?.classList.toggle("is-editing", editing);
    search.hidden = editing || branding;
    if (!editing) drawTransfer();
    if (branding) return render(content, () => [brand.element]);
    render(content, () =>
      editing
        ? [editor.element]
        : [
            tagsEl,
            grid,
            h("div", { class: "theme-gallery-bar" }, actions, transferEl),
            transferNote,
          ],
    );
  };
  const edit = (from: string | undefined, made?: ThemePackage, name?: string) => {
    editing = true;
    branding = false;
    themes.preview(undefined);
    layout();
    if (made) editor.startDraft(made, themes.state().scheme, name);
    else editor.start(from || undefined, themes.state().scheme);
    content.querySelector<HTMLElement>("input, select, button")?.focus();
  };
  const fromImage = () => {
    branding = true;
    themes.preview(undefined);
    layout();
    brand.start();
  };
  const gallery = (id?: string) => {
    editor.stop();
    editing = false;
    branding = false;
    if (id !== undefined) {
      selected = id;
      arriving = id;
    }
    layout();
    draw();
    focusSelected();
  };

  const draw = () => {
    if (!scrim || editing) return;
    const list = shown();
    // A theme just saved or imported is selected before plugin.list lists it: keep it until it comes.
    if (arriving !== undefined && list.some((c) => c.id === arriving)) {
      const came = arriving;
      arriving = undefined;
      // An import is previewed once it is listed (preview ignores a theme the desk does not have).
      if (previewOnArrival && came === selected) {
        previewOnArrival = false;
        themes.preview(came);
        return;
      }
    }
    if (!list.some((c) => c.id === selected) && selected !== arriving)
      selected = list[0]?.id ?? selected;
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
    drawTransfer();
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
    if (editing) editor.stop();
    editing = false;
    branding = false;
    offDrops?.();
    offDrops = undefined;
    themes.preview(undefined);
    offChange?.();
    offChange = undefined;
    const done = release;
    release = undefined;
    scrim.remove();
    scrim = undefined;
    panel = undefined;
    done?.();
  };

  const open = () => {
    if (scrim) return;
    query = "";
    tag = undefined;
    search.value = "";
    selected = themes.active();
    editing = false;
    panel = h(
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
      content,
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
    offDrops = acceptDrops(panel, transfer, transferNote);
    release = containModal(panel, close, deps.fallback());
    offChange = themes.onChange(draw);
    layout();
    draw();
    focusSelected();
  };

  const offCommand = deps.commands.define("desk.theme.studio", {
    title: "Open the theme studio",
    keywords: ["theme", "themes", "appearance", "gallery", "look", "테마"],
    owner: "desk",
    run: () => open(),
  });

  const offEdit = deps.commands.define("desk.theme.edit", {
    title: "Tune a copy of a theme",
    keywords: ["theme", "edit", "tune", "customize", "테마", "편집"],
    owner: "desk",
    run: (args) => {
      const id = (args as { id?: unknown } | undefined)?.id;
      open();
      edit(typeof id === "string" ? id : themes.active());
    },
  });

  return {
    open,
    close,
    isOpen: () => scrim !== undefined,
    edit(from) {
      open();
      edit(from);
    },
    dispose() {
      close();
      offCommand();
      offEdit();
    },
  };
}
