/**
 * The design system studio (ADR 0090, docs/ko/design-system-requirements.md DS): a system window of the
 * main UI beside the theme studio, not a plugin. Its gallery shows the endue design system and every
 * installed one as cards whose specimen is drawn with the card's own component tokens; the focused or
 * hovered card is previewed on the whole desk, Enter or a click applies it, and Escape (or closing) puts
 * back what was in force. The editor (editor.ts) tunes a copy, Describe (describe.ts) makes one from a
 * sentence, the Market (market.ts) previews and installs shared ones, and Import, Export and Remove
 * (transfer.ts) move `.desk-design` files. Its commands (commands.ts) open it.
 */
import type { DesignSystemPackage } from "@endue-ai/bridge";
import type { Commands } from "../commands";
import { SAY_TO_ERIS } from "../eris/look";
import type { RuntimeDesigns } from "../policies/design";
import type { ThemeBrain } from "../policies/theme";
import { h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { containModal } from "../shell/modal";
import { tagButtons } from "../theme-studio/card";
import type { StudioLang } from "../theme-studio/copy";
import { filterCards, moveIn, tagsOf } from "../theme-studio/model";
import { designCardElement, designCards } from "./card";
import { defineDesignStudioCommands } from "./commands";
import { type DesignCopy, designText } from "./copy";
import { createDesignDescribe } from "./describe";
import { createDesignEditor } from "./editor";
import { createDesignMarket } from "./market";
import { acceptDesignDrops, designTransfer } from "./transfer";

export interface DesignStudioDeps {
  designs: RuntimeDesigns;
  commands: Commands;
  lang(): StudioLang;
  /** Where focus goes when the studio closes and nothing else had it. */
  fallback(): HTMLElement;
  /** The brain, for Describe. */
  brain(): ThemeBrain | undefined;
}

export interface DesignStudio {
  open(): void;
  edit(from: string): void;
  describe(text?: string, fromEris?: boolean): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

const COLUMNS = 3;
type View = "gallery" | "edit" | "describe" | "market";

export function mountDesignStudio(host: HTMLElement, deps: DesignStudioDeps): DesignStudio {
  const { designs } = deps;
  const tr = (key: DesignCopy) => designText(deps.lang(), key);
  let scrim: HTMLElement | undefined;
  let panel: HTMLElement | undefined;
  let release: (() => void) | undefined;
  let offChange: (() => void) | undefined;
  let offDrops: (() => void) | undefined;
  let query = "";
  let tag: string | undefined;
  let selected = "";
  let view: View = "gallery";
  const content = h("div", { class: "theme-studio-content" });
  const cards = () =>
    designCards(designs.installed(), {
      name: tr("endueName"),
      description: tr("endueDescription"),
    });
  const shown = () => filterCards(cards(), query, tag);
  const grid = h("div", { class: "theme-grid", role: "listbox", "aria-label": tr("gallery") });
  const tagsEl = h("div", { class: "theme-tags", role: "group" });
  const status = h("p", { class: "theme-studio-status", role: "status" });
  const note = h("p", { class: "theme-note", "aria-live": "polite" });
  const transferEl = h("div", { class: "theme-gallery-actions" });
  const search = h("input", {
    class: "input theme-search",
    type: "search",
    "aria-label": tr("search"),
    placeholder: tr("search"),
    onInput: () => {
      query = search.value;
      draw();
    },
  });
  const back = (id?: string) => gallery(id);
  const editor = createDesignEditor({ designs, lang: deps.lang, back });
  const describe = createDesignDescribe({
    designs,
    brain: deps.brain,
    lang: deps.lang,
    back,
    tune: (made) => edit("", made),
    toEris: (text) => {
      close();
      host.dispatchEvent(new CustomEvent(SAY_TO_ERIS, { bubbles: true, detail: { text } }));
    },
  });
  const market = createDesignMarket({ designs, lang: deps.lang, back });
  const transfer = { designs, selected: () => selected, tr, changed: (id: string) => gallery(id) };
  const button = (key: DesignCopy, onClick: () => void) =>
    h(
      "button",
      { type: "button", class: "btn btn-outline", "data-key": `design-${key}`, onClick },
      tr(key),
    );
  const actions = h(
    "div",
    { class: "theme-gallery-actions" },
    button("tuneCopy", () => edit(selected)),
    button("newDesign", () => edit("")),
    button("describe", () => describing()),
    button("market", () => go("market")),
    button("themes", () => {
      close();
      void deps.commands.run("desk.theme.studio").catch(() => {});
    }),
  );
  const views: Record<Exclude<View, "gallery">, () => HTMLElement> = {
    edit: () => editor.element,
    describe: () => describe.element,
    market: () => market.element,
  };
  const layout = () => {
    // Away from the gallery the studio docks to the right, so the desk shows what it previews.
    const docked = view !== "gallery";
    scrim?.classList.toggle("is-editing", docked);
    panel?.classList.toggle("is-editing", docked);
    search.hidden = docked;
    render(content, () =>
      view === "gallery"
        ? [tagsEl, grid, h("div", { class: "theme-gallery-bar" }, actions, transferEl), note]
        : [views[view]()],
    );
  };
  const leave = () => {
    if (view === "edit") editor.stop();
    if (view === "describe") describe.stop();
    if (view === "market") market.stop();
  };
  const go = (next: View) => {
    leave();
    view = next;
    designs.preview(undefined);
    layout();
    if (next === "market") market.start();
  };
  const edit = (from: string, made?: { name?: string; designSystem: DesignSystemPackage }) => {
    go("edit");
    editor.start(from, made);
    content.querySelector<HTMLElement>("input, select, button")?.focus();
  };
  const describing = (options?: { text?: string; run?: boolean; fromEris?: boolean }) => {
    if (view !== "describe") go("describe");
    describe.start(options);
    content.querySelector<HTMLElement>("textarea")?.focus();
  };
  const gallery = (id?: string) => {
    leave();
    view = "gallery";
    if (id !== undefined) selected = id;
    layout();
    draw();
    focusSelected();
  };
  const draw = () => {
    if (!scrim || view !== "gallery") return;
    const list = shown();
    if (!list.some((c) => c.id === selected) && !/^(local|market)\./.test(selected))
      selected = list[0]?.id ?? "";
    render(tagsEl, () =>
      tagButtons(tagsOf(cards()), tag, tr("all"), (t) => {
        tag = t;
        draw();
      }),
    );
    const active = designs.active();
    render(grid, () =>
      list.length === 0
        ? [h("p", { class: "theme-empty" }, tr("empty"))]
        : list.map((card) =>
            designCardElement(card, {
              tokens: designs.resolve(card.id).tokens,
              selected: card.id === selected,
              applied: card.id === active,
              lang: deps.lang(),
            }),
          ),
    );
    render(transferEl, () => designTransfer(transfer, note));
    const named = (id: string | undefined) => cards().find((c) => c.id === id)?.name;
    const current = named(active) ?? tr("endueName");
    const previewing = designs.previewing();
    status.textContent =
      previewing !== undefined && previewing !== active && named(previewing)
        ? `${tr("current")}: ${current} · ${tr("previewing")}: ${named(previewing)}`
        : `${tr("current")}: ${current}`;
    const option = grid.querySelector<HTMLElement>('[aria-selected="true"]');
    if (option) grid.setAttribute("aria-activedescendant", option.id);
  };
  const focusSelected = () => grid.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  const select = (id: string) => {
    selected = id;
    designs.preview(id);
    draw();
    focusSelected();
  };
  const apply = (id: string) => {
    selected = id;
    designs.apply(id);
    draw();
  };
  const cardAt = (target: EventTarget | null) =>
    (target as Element | null)?.closest<HTMLElement>("[data-design]")?.dataset.design;
  grid.addEventListener("click", (event) => {
    const id = cardAt(event.target);
    if (id !== undefined) apply(id);
  });
  grid.addEventListener("pointerover", (event) => {
    const id = cardAt(event.target);
    if (id !== undefined && id !== designs.previewing()) designs.preview(id);
  });
  grid.addEventListener("pointerleave", () => designs.preview(selected));
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
    offChange?.();
    offDrops = offChange = undefined;
    designs.preview(undefined);
    const done = release;
    release = undefined;
    scrim.remove();
    scrim = panel = undefined;
    done?.();
  };
  const open = () => {
    if (scrim) return;
    query = search.value = "";
    tag = undefined;
    selected = designs.active();
    view = "gallery";
    const close_ = h(
      "button",
      {
        type: "button",
        class: "icon-button theme-studio-close",
        "aria-label": tr("close"),
        title: tr("close"),
        onClick: () => close(),
      },
      icon("close", 18),
    );
    panel = h(
      "section",
      {
        class: "theme-studio design-studio",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "design-studio-title",
      },
      h(
        "header",
        { class: "theme-studio-head" },
        h("h2", { class: "theme-studio-title", id: "design-studio-title" }, tr("title")),
        search,
        close_,
      ),
      content,
      h(
        "footer",
        { class: "theme-studio-foot" },
        status,
        h("p", { class: "theme-studio-hint" }, tr("hint")),
      ),
    );
    scrim = h("div", { class: "scrim theme-studio-scrim design-studio-scrim" }, panel);
    scrim.addEventListener("pointerdown", (event) => {
      if (event.target === scrim) close();
    });
    host.append(scrim);
    offDrops = acceptDesignDrops(panel, transfer, note);
    release = containModal(panel, close, deps.fallback());
    offChange = designs.onChange(draw);
    layout();
    draw();
    focusSelected();
  };

  const studio: DesignStudio = {
    open,
    close,
    isOpen: () => scrim !== undefined,
    edit(from) {
      open();
      edit(from);
    },
    describe(text, fromEris) {
      open();
      describing(text ? { text, run: true, fromEris: fromEris === true } : {});
    },
    dispose() {
      close();
      offCommands();
    },
  };
  const offCommands = defineDesignStudioCommands(deps.commands, {
    ...studio,
    active: designs.active,
  });
  return studio;
}
