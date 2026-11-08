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
import { desktopId, desktopIsEmpty, desktopsOf, layoutOf } from "./actions";
import { REFERENCE, type ShellCtx } from "./context";
import { h, listen, render } from "./dom";
import { draggable } from "./drag";
import { icon } from "./icons";

function quadrants(ctx: ShellCtx, d: string): boolean[] {
  const filled = [false, false, false, false];
  for (const p of layoutOf(ctx.store.get(), d).surfaces) {
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
          quadrants(ctx, d.id).map((on) => h("span", { class: `mini-dot${on ? " is-on" : ""}` })),
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
    // The desktop in front stays in sight when the list scrolls.
    const front = buttons[list.findIndex((d) => d.id === here)];
    if (front && el.scrollWidth > el.clientWidth) {
      const left = front.offsetLeft;
      if (left < el.scrollLeft) el.scrollLeft = left;
      else if (left + front.offsetWidth > el.scrollLeft + el.clientWidth)
        el.scrollLeft = left + front.offsetWidth - el.clientWidth;
    }
  };
  draw();
  const offs = [
    ctx.store.watch((s) => [s.desktop, s.desktops, s.modeId, s.session, s.modes, s.lang], draw),
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
