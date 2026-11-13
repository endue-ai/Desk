/**
 * Two menus (ADR 0117). A desktop's, from the switcher: rename, move left or right, a new desktop,
 * the overview, remove. A window's, from its title bar: move it to another desktop or a new one.
 * Both open with right-click or the menu key, take arrow keys, and close with Esc or a click outside.
 */
import type { DesktopId } from "../modes/types";
import { desktopsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen, render } from "../shell/dom";
import type { DeskState } from "../shell/state";
import { moveToNew, moveWindowTo, newDesktop, ownWindows, reorder, tx } from "./actions";
import { MAX_DESKTOPS } from "./model";

/** The desktop that shows `window`: the one in front first, then those whose layout places it. */
function holderOf(s: DeskState, window: string): DesktopId | undefined {
  if ((s.wm.windows[s.wm.here] ?? []).some((p) => p.id === window)) return s.wm.here;
  return desktopsOf(s).find((d) => s.wm.layouts[d.id]?.surfaces.some((p) => p.id === window))?.id;
}

import { uiOf } from "./ui";

type Open =
  | { kind: "desktop"; desktop: DesktopId | null; under: HTMLElement }
  | { kind: "window"; window: string; x: number; y: number };

export interface Menus {
  /** A desktop's menu under its button; null: the "+" button's (new desktop, overview). */
  desktop(desktop: DesktopId | null, under: HTMLElement): void;
  dispose(): void;
}

export function mountMenus(root: HTMLElement, ctx: ShellCtx, switcher: HTMLElement): Menus {
  const doc = root.ownerDocument;
  const el = h("div", { class: "popover desktops-menu", role: "menu" });
  let open: Open | undefined;

  const close = (refocus = false) => {
    const was = open;
    open = undefined;
    el.remove();
    if (ctx.store.get().popover === "desktop-menu" || ctx.store.get().popover === "window-menu")
      ctx.store.set({ popover: null });
    if (refocus && was?.kind === "desktop" && was.under.isConnected) was.under.focus();
  };
  const item = (label: string, key: string, run: () => void, enabled = true) =>
    h(
      "button",
      {
        class: "menu-item",
        type: "button",
        role: "menuitem",
        "data-key": key,
        disabled: !enabled,
        onClick: () => {
          close();
          run();
        },
      },
      label,
    );

  const desktopItems = (desktop: DesktopId | null) => {
    const list = desktopsOf(ctx.store.get());
    const at = list.findIndex((d) => d.id === desktop);
    const ui = uiOf(ctx.store);
    const more = list.length < MAX_DESKTOPS;
    const own =
      desktop === null
        ? []
        : [
            item(tx(ctx, "rename"), "menu-rename", () => ui.rename(desktop)),
            item(tx(ctx, "moveLeft"), "menu-left", () => reorder(ctx, desktop, { by: -1 }), at > 0),
            item(
              tx(ctx, "moveRight"),
              "menu-right",
              () => reorder(ctx, desktop, { by: 1 }),
              at < list.length - 1,
            ),
          ];
    return [
      ...own,
      item(tx(ctx, "newDesktop"), "menu-new", () => newDesktop(ctx), more),
      item(tx(ctx, "overview"), "menu-overview", () => ui.overview(true)),
      ...(desktop === null
        ? []
        : [
            h("div", { class: "desktops-menu-rule", role: "separator" }),
            // "…" only when a question follows: what becomes of the desktop's own windows.
            item(
              tx(ctx, ownWindows(ctx.store.get(), desktop) > 0 ? "remove" : "removeNow"),
              "menu-remove",
              () => ui.remove(desktop),
              list.length > 1,
            ),
          ]),
    ];
  };

  const windowItems = (window: string) => {
    const s = ctx.store.get();
    const from = holderOf(s, window);
    const list = desktopsOf(s);
    return [
      h("div", { class: "pop-title" }, tx(ctx, "windowMenu")),
      ...list
        .filter((d) => d.id !== from)
        .map((d) =>
          item(tx(ctx, "moveTo", { name: d.name }), `menu-to-${d.id}`, () =>
            moveWindowTo(ctx, window, d.id),
          ),
        ),
      item(
        tx(ctx, "moveToNew"),
        "menu-to-new",
        () => moveToNew(ctx, window),
        list.length < MAX_DESKTOPS,
      ),
    ];
  };

  const show = (next: Open) => {
    open = next;
    render(el, () =>
      next.kind === "desktop" ? desktopItems(next.desktop) : windowItems(next.window),
    );
    el.setAttribute(
      "aria-label",
      next.kind === "desktop" ? tx(ctx, "desktops") : tx(ctx, "windowMenu"),
    );
    root.append(el);
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    if (next.kind === "desktop") {
      const r = next.under.getBoundingClientRect();
      el.style.top = `${Math.round(r.bottom + 6)}px`;
      el.style.left = `${Math.round(Math.max(8, Math.min(vw - el.offsetWidth - 8, r.right - el.offsetWidth)))}px`;
    } else {
      el.style.top = `${Math.round(Math.min(next.y, vh - el.offsetHeight - 8))}px`;
      el.style.left = `${Math.round(Math.min(next.x, vw - el.offsetWidth - 8))}px`;
    }
    ctx.store.set({ popover: next.kind === "desktop" ? "desktop-menu" : "window-menu" });
    el.querySelector<HTMLElement>(".menu-item:not(:disabled)")?.focus();
  };

  const offs = [
    // Arrow keys walk the items; Esc and Tab close the menu.
    listen(el, "keydown", (e) => {
      const items = [...el.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)")];
      const at = items.indexOf(doc.activeElement as HTMLElement);
      const go = (i: number) => items[(i + items.length) % items.length]?.focus();
      if (e.key === "ArrowDown") go(at + 1);
      else if (e.key === "ArrowUp") go(at - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(items.length - 1);
      else if (e.key === "Escape" || e.key === "Tab") close(true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    }),
    // A click elsewhere, Esc through the desk, another popover: the menu goes.
    ctx.store.watch(
      (s) => s.popover,
      (popover) => {
        if (open && popover !== "desktop-menu" && popover !== "window-menu") close();
      },
    ),
    // A window's menu: right-click its title bar (or the menu key on the window), in this page or
    // in the window's own page (ADR 0201), whose points are the window's on the desk.
    listen(doc, "contextmenu", (e) => windowMenu(e)),
    ctx.pages?.watch((id, win) => listen(win.document, "contextmenu", (e) => windowMenu(e, id))) ??
      (() => {}),
  ];
  function windowMenu(e: Event, page?: string) {
    const target = e.target as Element | null;
    const surface = target?.closest?.("[data-surface]");
    const onBar = target?.closest?.(".surface-title") && !target.closest("button");
    if (!surface || !(onBar || target === surface) || switcher.contains(target)) return;
    const window = surface.getAttribute("data-surface");
    if (!window) return;
    e.preventDefault();
    const r = (target as Element).getBoundingClientRect();
    const { clientX, clientY } = e as MouseEvent;
    const at = { x: clientX || r.left + 16, y: clientY || r.top + 16 };
    show({ kind: "window", window, ...(page ? (ctx.pages?.toDesk(page, at) ?? at) : at) });
  }
  return {
    desktop: (desktop, under) => show({ kind: "desktop", desktop, under }),
    dispose() {
      for (const off of offs) off();
      el.remove();
    },
  };
}
