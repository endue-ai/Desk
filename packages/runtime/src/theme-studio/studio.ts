/**
 * The theme studio (ADR 0056, docs/ko/theme-requirements.md TS-01, TS-02): a system window of the main
 * UI, not a plugin. Its gallery shows the endue theme and every installed theme plugin as cards; the
 * focused or hovered card is previewed on the whole desk, Enter or a click applies it, and Escape (or
 * closing) puts back what was in force. Its editor (editor.ts, TS-03 to TS-05) tunes a copy of a theme
 * while the desk previews it; "From an image" (brand.ts, TS-09) starts one from a logo's colours, and
 * Describe (describe.ts, TS-06, TS-07) from a sentence the brain answers. The Market tab (market.ts,
 * TS-08) previews and installs themes from the markets. Its commands (commands.ts) open it.
 */
import type { ThemePackage } from "@endue-ai/bridge";
import type { Commands } from "../commands";
import { SAY_TO_ERIS } from "../eris/look";
import type { RuntimeThemes } from "../policies/theme";
import { h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { containModal } from "../shell/modal";
import { createBrandPanel } from "./brand";
import { tagButtons, themeCardElement } from "./card";
import { defineStudioCommands } from "./commands";
import { type StudioCopy, type StudioLang, studioText } from "./copy";
import { createDescribe } from "./describe";
import { createEditor, type ThemeIo } from "./editor";
import { createMarket } from "./market";
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
  /** Open Describe with `text` in its field and run it; `from: "eris"` offers to send it back. */
  describe(text?: string, from?: "eris"): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

const COLUMNS = 3;

/** What the studio shows: the gallery, or one of the ways to make a theme. */
type View = "gallery" | "edit" | "brand" | "describe" | "market";

export function mountThemeStudio(host: HTMLElement, deps: StudioDeps): ThemeStudio {
  const { themes } = deps;
  const tr = (key: StudioCopy) => studioText(deps.lang(), key);
  let scrim: HTMLElement | undefined;
  let release: (() => void) | undefined;
  let offChange: (() => void) | undefined;
  let query = "";
  let tag: string | undefined;
  let selected = "";
  let view: View = "gallery";
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
  const describe = createDescribe({
    themes,
    lang: deps.lang,
    io: () => deps.io?.(),
    open: () => describing(),
    back: (id) => gallery(id),
    tune: (theme, name) => edit(undefined, theme, name),
    toEris: (text) => {
      close();
      host.dispatchEvent(new CustomEvent(SAY_TO_ERIS, { bubbles: true, detail: { text } }));
    },
  });
  const brand = createBrandPanel({
    tr,
    open: () => fromImage(),
    back: () => gallery(),
    make: (theme, name) => edit(undefined, theme, name),
    describe: (colors) => describing({ colors }),
  });
  const market = createMarket({ themes, tr, open: () => go("market"), back: (id) => gallery(id) });
  const button = (key: string, label: StudioCopy, onClick: () => void) =>
    h("button", { type: "button", class: "btn btn-outline", "data-key": key, onClick }, tr(label));
  const actions = h(
    "div",
    { class: "theme-gallery-actions" },
    button("tune-copy", "tuneCopy", () => edit(selected)),
    button("new-theme", "newTheme", () => edit(undefined)),
    brand.entry,
    describe.entry,
    market.entry,
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
  const views: Record<Exclude<View, "gallery">, () => HTMLElement> = {
    edit: () => editor.element,
    brand: () => brand.element,
    describe: () => describe.element,
    market: () => market.element,
  };
  const layout = () => {
    // The editor, Describe and the Market dock to the right, so the desk shows what they preview.
    const docked = view === "edit" || view === "describe" || view === "market";
    scrim?.classList.toggle("is-editing", docked);
    panel?.classList.toggle("is-editing", docked);
    search.hidden = view !== "gallery";
    if (view !== "edit") drawTransfer();
    render(content, () =>
      view === "gallery"
        ? [
            tagsEl,
            grid,
            h("div", { class: "theme-gallery-bar" }, actions, transferEl),
            transferNote,
          ]
        : [views[view]()],
    );
  };
  /** Leave the view in force: the editor and Describe end what they preview. */
  const leave = () => {
    if (view === "edit") editor.stop();
    if (view === "describe") describe.stop();
    if (view === "market") market.stop();
  };
  const go = (next: View) => {
    leave();
    view = next;
    themes.preview(undefined);
    layout();
  };
  const edit = (from: string | undefined, made?: ThemePackage, name?: string) => {
    go("edit");
    if (made) editor.startDraft(made, themes.state().scheme, name);
    else editor.start(from || undefined, themes.state().scheme);
    content.querySelector<HTMLElement>("input, select, button")?.focus();
  };
  const fromImage = () => {
    go("brand");
    brand.start();
  };
  const describing = (options?: Parameters<typeof describe.start>[0]) => {
    if (view !== "describe") go("describe");
    describe.start(options);
  };
  const gallery = (id?: string) => {
    leave();
    view = "gallery";
    if (id !== undefined) {
      selected = id;
      arriving = id;
    }
    layout();
    draw();
    focusSelected();
  };

  const draw = () => {
    if (!scrim || view === "edit") return;
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
      tagButtons(tagsOf(cards()), tag, tr("all"), (t) => {
        tag = t;
        draw();
      }),
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
    leave();
    view = "gallery";
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
    view = "gallery";
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

  const studio: ThemeStudio = {
    open,
    close,
    isOpen: () => scrim !== undefined,
    edit(from) {
      open();
      edit(from);
    },
    describe(text, from) {
      open();
      describing(text ? { text, run: true, ...(from ? { from } : {}) } : {});
    },
    dispose() {
      close();
      offCommands();
    },
  };
  const offCommands = defineStudioCommands(deps.commands, { ...studio, active: themes.active });
  return studio;
}
