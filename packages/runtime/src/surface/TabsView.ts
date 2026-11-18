/**
 * Draw a window's tabs (ADR 0268): what the tab it shows shows, under a strip of its tabs once it
 * has more than one. Each tab's view is mounted once and kept while the tab shows it, so showing
 * another tab, adding one or closing one never mounts a view again: a plugin's frame moved in the
 * page would load again. The window manager says which tabs there are and which is shown
 * (crates/desk-wm `tabs.rs`); a press on a tab asks it to show that one.
 */
import type { SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { icon } from "../shell/icons";
import { closeTab, focusTab } from "../shell/windows";
import { shownTab, tabsOf } from "./tree";
import { resolveView, viewOf } from "./views";

export interface TabsView {
  el: HTMLElement;
  /** Draw the window's tabs as they are now. */
  update(p: SurfacePlacement): void;
  off(): void;
}

interface Drawn {
  view: string;
  /** What the tab shows. */
  pane: HTMLElement;
  /** Its place in the strip. */
  tab: HTMLElement;
  name: HTMLElement;
  close: HTMLElement;
  /** What the strip says of it: its view's icon and title. */
  says: string;
  off: () => void;
}

export function mountTabs(ctx: ShellCtx, surface: string): TabsView {
  const strip = h("div", { class: "tab-strip", role: "tablist" });
  const el = h("div", { class: "tabs" }, strip);
  const drawn = new Map<string, Drawn>();

  const drop = (id: string) => {
    const entry = drawn.get(id);
    if (!entry) return;
    entry.off();
    entry.pane.remove();
    entry.tab.remove();
    drawn.delete(id);
  };

  /** The tab beside `from` in the strip takes the keyboard and is shown. */
  const step = (from: HTMLElement, by: number) => {
    const all = [...strip.querySelectorAll<HTMLElement>("[data-tab]")];
    const next = all[(all.indexOf(from) + by + all.length) % all.length];
    if (!next?.dataset.tab) return;
    next.focus();
    void focusTab(ctx, surface, next.dataset.tab);
  };

  const build = (id: string, shown: string): Drawn => {
    const view = viewOf(ctx, shown);
    const mounted = view.mount({ surface, tab: id });
    const pane = h(
      "div",
      {
        class: `pane${view.byEris ? " is-eris" : ""}`,
        "data-pane": id,
        "data-view": shown,
        role: "group",
      },
      h("div", { class: "pane-body" }, mounted.el),
    );
    const name = h("span", { class: "tab-name" });
    const close = h(
      "button",
      {
        class: "icon-button tool tab-close",
        type: "button",
        tabindex: "-1",
        onClick: (e: Event) => {
          e.stopPropagation();
          void closeTab(ctx, surface, id);
        },
      },
      icon("close", 12),
    );
    const tab = h("div", { class: "tab", role: "tab", "data-tab": id }, name, close);
    const offs = [
      listen(tab, "click", () => void focusTab(ctx, surface, id)),
      listen(tab, "keydown", (e) => {
        const k = e as KeyboardEvent;
        if (k.target !== tab) return;
        if (k.key === "Enter" || k.key === " ") void focusTab(ctx, surface, id);
        else if (k.key === "ArrowRight") step(tab, 1);
        else if (k.key === "ArrowLeft") step(tab, -1);
        else if (k.key === "Delete") void closeTab(ctx, surface, id);
        else return;
        k.preventDefault();
      }),
    ];
    return {
      view: shown,
      pane,
      tab,
      name,
      close,
      says: "",
      off: () => {
        for (const off of offs) off();
        mounted.off?.();
      },
    };
  };

  return {
    el,
    update(p) {
      const s = ctx.store.get();
      const tabs = tabsOf(p).map((t) => ({ id: t.id, view: resolveView(s, p, t.view) }));
      const shown = shownTab(p).id;
      // A tab gone, or one that shows another view now (the launcher's choice), is drawn anew.
      for (const [id, entry] of drawn) {
        if (tabs.find((t) => t.id === id)?.view !== entry.view) drop(id);
      }
      el.classList.toggle("is-many", tabs.length > 1);
      tabs.forEach((t, i) => {
        let entry = drawn.get(t.id);
        if (!entry) {
          entry = build(t.id, t.view);
          drawn.set(t.id, entry);
          el.append(entry.pane);
        }
        // In the strip's order; the panes need none, one alone is shown.
        if (strip.children[i] !== entry.tab)
          strip.insertBefore(entry.tab, strip.children[i] ?? null);
        const view = viewOf(ctx, t.view);
        const says = JSON.stringify([view.icon, view.title, ctx.tr("closeTab")]);
        if (entry.says !== says) {
          entry.says = says;
          entry.name.replaceChildren(icon(view.icon, 14), view.title);
          entry.pane.setAttribute("aria-label", view.title);
          entry.close.setAttribute("aria-label", `${ctx.tr("closeTab")} · ${view.title}`);
          entry.close.title = ctx.tr("closeTab");
        }
        const active = t.id === shown;
        entry.pane.hidden = !active;
        entry.tab.setAttribute("aria-selected", String(active));
        entry.tab.tabIndex = active ? 0 : -1;
        entry.tab.classList.toggle("is-active", active);
      });
    },
    off() {
      for (const id of [...drawn.keys()]) drop(id);
    },
  };
}
