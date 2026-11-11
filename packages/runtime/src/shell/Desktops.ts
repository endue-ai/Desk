/**
 * Top right: the current profile's desktops (ADR 0117), each with its name and a 2×2 map of where its
 * windows sit, scrolling when there are many. Hover shows a desktop's windows to scale; right-click
 * (or the menu key) opens its menu; dragging one reorders it, and dropping a window on one moves the
 * window there. "+" goes to an empty desktop, a new one when none is free.
 */
import "../desktops/desktops.css";
import { emptyDesktop, newDesktop, reorder, switchTo, tx } from "../desktops/actions";
import { mountDialogs } from "../desktops/dialogs";
import { windowDrops } from "../desktops/drop";
import { mountMenus } from "../desktops/menu";
import { MAX_DESKTOPS } from "../desktops/model";
import { mountOverview } from "../desktops/overview";
import { mountPeek } from "../desktops/peek";
import { provideUi } from "../desktops/ui";
import type { Desktop } from "../modes/types";
import { desktopId, desktopIsEmpty, desktopsOf, windowsOf } from "./actions";
import { REFERENCE, type ShellCtx } from "./context";
import { h, listen, render } from "./dom";
import { draggable } from "./drag";
import { icon } from "./icons";
import type { DeskState } from "./state";

/** Where a desktop's windows sit, its plugin windows in their slots included: what it shows. */
function quadrants(s: DeskState, d: string): boolean[] {
  const filled = [false, false, false, false];
  for (const p of windowsOf(s, d)) {
    const col = p.x + p.w / 2 > REFERENCE.width / 2 ? 1 : 0;
    const row = p.y + p.h / 2 > REFERENCE.height / 2 ? 1 : 0;
    filled[row * 2 + col] = true;
  }
  return filled;
}

/** How a desktop reads: "Desktop 2", or "Desktop 2 · Mail" once it has a name of its own. */
export function desktopLabel(ctx: ShellCtx, d: Desktop, n: number, empty: boolean): string {
  const named = d.name === String(n) ? n : `${n} · ${d.name}`;
  const key = n <= 9 ? ctx.keyOf(`desk.shell.desktop-${n}`) : undefined;
  return `${ctx.tr(empty ? "desktopEmpty" : "desktop", { n: named })}${key ? ` (${key})` : ""}`;
}

/**
 * Scroll a long list so the desktop in front is whole in sight: inside the ring's padding and clear of
 * the "+" that sticks to the right end. The boxes are measured as drawn, since the list's width is a
 * fraction of the window's and `clientWidth` rounds it; the scroll moves by whole pixels, rounded up.
 */
function keepInSight(el: HTMLElement, front: HTMLElement): void {
  if (el.scrollWidth <= el.clientWidth) return;
  const style = getComputedStyle(el);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const view = el.getBoundingClientRect();
  const add = el.querySelector<HTMLElement>(".desktop-add");
  const start = view.left + px(style.borderLeftWidth) + px(style.paddingLeft);
  const end =
    view.right -
    px(style.borderRightWidth) -
    px(style.paddingRight) -
    (add ? add.getBoundingClientRect().width + px(style.columnGap) : 0);
  const chip = front.getBoundingClientRect();
  if (chip.left < start) el.scrollLeft -= Math.ceil(start - chip.left);
  else if (chip.right > end) el.scrollLeft += Math.ceil(chip.right - end);
}

export function mountDesktops(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("nav", { class: "desktops", "aria-label": ctx.tr("desktop", { n: "" }).trim() });
  root.append(el);
  const peek = mountPeek(root, ctx);
  const menus = mountMenus(root, ctx, el);
  const dialogs = mountDialogs(root, ctx);
  const overview = mountOverview(root, ctx, dialogs);
  let reorders: Array<() => void> = [];

  /** Drag a desktop sideways to put it elsewhere in the list; Esc puts it back. */
  const reorderable = (button: HTMLElement, id: string) =>
    draggable(button, {
      accept: () => desktopsOf(ctx.store.get()).length > 1,
      start: () => {
        peek.hide();
        button.classList.add("is-moving");
      },
      move: (dx) => {
        button.style.transform = `translateX(${dx}px)`;
      },
      end: (_dx, _dy, e) => {
        const others = [...el.querySelectorAll<HTMLElement>("[data-desktop-id]")].filter(
          (b) => b !== button,
        );
        const at = others.filter((b) => {
          const r = b.getBoundingClientRect();
          return e.clientX > r.left + r.width / 2;
        }).length;
        button.style.removeProperty("transform");
        button.classList.remove("is-moving");
        reorder(ctx, id, { at: at + 1 });
      },
      cancel: () => {
        button.style.removeProperty("transform");
        button.classList.remove("is-moving");
      },
    });

  const draw = () => {
    for (const off of reorders.splice(0)) off();
    const s = ctx.store.get();
    const list = desktopsOf(s);
    const here = desktopId(s);
    const empty = emptyDesktop(s);
    const addLabel = empty ? ctx.tr("addDesktop") : tx(ctx, "newDesktop");
    const buttons = list.map((d, i) => {
      const n = i + 1;
      const label = desktopLabel(ctx, d, n, desktopIsEmpty(s, d.id));
      const active = d.id === here ? " is-active" : "";
      const named = [...d.name].length > 2 ? " is-named" : "";
      return h(
        "button",
        {
          class: `desktop-button${active}${named}`,
          type: "button",
          "data-key": `desktop-${d.id}`,
          "data-desktop": n,
          "data-desktop-id": d.id,
          "aria-pressed": String(d.id === here),
          "aria-label": label,
          title: label,
          onClick: () => switchTo(ctx, d.id),
          onContextmenu: (e: MouseEvent) => {
            e.preventDefault();
            peek.hide();
            menus.desktop(d.id, e.currentTarget as HTMLElement);
          },
          onPointerenter: (e: PointerEvent) => peek.show(d.id, e.currentTarget as HTMLElement),
          onPointerleave: () => peek.hide(),
        },
        h("span", { class: "desktop-number" }, d.name),
        h(
          "span",
          { class: "mini-grid", "aria-hidden": "true" },
          quadrants(s, d.id).map((on) => h("span", { class: `mini-dot${on ? " is-on" : ""}` })),
        ),
      );
    });
    render(el, () => [
      ...buttons,
      h(
        "button",
        {
          class: "add-button desktop-add",
          type: "button",
          "data-key": "desktop-add",
          "aria-label": addLabel,
          title: addLabel,
          disabled: !empty && list.length >= MAX_DESKTOPS,
          onClick: () => (empty ? switchTo(ctx, empty) : newDesktop(ctx)),
          onContextmenu: (e: MouseEvent) => {
            e.preventDefault();
            menus.desktop(null, e.currentTarget as HTMLElement);
          },
        },
        icon("plus", 16),
      ),
    ]);
    reorders = buttons.map((b, i) => reorderable(b, list[i]?.id ?? ""));
    const front = buttons[list.findIndex((d) => d.id === here)];
    if (front) keepInSight(el, front);
  };
  draw();
  const offs = [
    ctx.store.watch(
      // What the buttons show: the plugin windows in their slots come and go with no layout's change.
      (s) => [
        s.desktop,
        s.wm.desktops,
        s.wm.layouts,
        desktopsOf(s).map((d) => quadrants(s, d.id)),
        s.modeId,
        s.modes,
        s.lang,
      ],
      draw,
    ),
    ctx.runtime.keymap.onChange(draw),
    // A wheel scrolls a long list sideways.
    listen(
      el,
      "wheel",
      (e) => {
        if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      },
      { passive: false },
    ),
    windowDrops(ctx, el),
    provideUi(ctx.store, {
      rename: dialogs.rename,
      remove: dialogs.remove,
      overview: overview.toggle,
    }),
  ];
  return () => {
    for (const off of [...offs, ...reorders]) off();
    overview.dispose();
    dialogs.dispose();
    menus.dispose();
    peek.dispose();
    el.remove();
  };
}
