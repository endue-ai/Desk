/**
 * The switcher's preview (ADR 0117): resting the pointer on a desktop shows its name and its windows
 * to scale under it, live while it stays there. Nothing is in the page until the pointer rests.
 */
import { desktopsOf, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, render } from "../shell/dom";
import { tx } from "./actions";
import { deskMap } from "./map";

const REST_MS = 400;

export interface Peek {
  show(desktop: string, under: HTMLElement): void;
  hide(): void;
  dispose(): void;
}

export function mountPeek(root: HTMLElement, ctx: ShellCtx): Peek {
  const win = root.ownerDocument.defaultView ?? window;
  const el = h("div", { class: "popover desktop-peek", "aria-hidden": "true" });
  let timer: number | undefined;
  let shown: { desktop: string; under: HTMLElement } | undefined;

  const draw = () => {
    if (!shown) return;
    const s = ctx.store.get();
    const d = desktopsOf(s).find((x) => x.id === shown?.desktop);
    if (!d || !shown.under.isConnected) return hide();
    const count = windowsOf(s, d.id).length;
    render(el, () => [
      h("span", { class: "desktop-peek-name" }, d.name),
      deskMap(ctx, s, d.id),
      h(
        "span",
        { class: "desktop-peek-meta" },
        count ? tx(ctx, "windows", { n: count }) : tx(ctx, "empty"),
      ),
    ]);
    const r = shown.under.getBoundingClientRect();
    const width = 220;
    el.style.top = `${Math.round(r.bottom + 8)}px`;
    el.style.left = `${Math.round(Math.max(8, Math.min(win.innerWidth - width - 8, r.right - width)))}px`;
    if (!el.isConnected) root.append(el);
  };
  const hide = () => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    shown = undefined;
    el.remove();
  };
  const off = ctx.store.watch(
    (s) => (shown ? [windowsOf(s, shown.desktop), desktopsOf(s), s.lang] : null),
    draw,
  );
  return {
    show(desktop, under) {
      if (root.ownerDocument.documentElement.classList.contains("is-grabbing")) return;
      hide();
      timer = win.setTimeout(() => {
        timer = undefined;
        shown = { desktop, under };
        draw();
      }, REST_MS);
    },
    hide,
    dispose() {
      off();
      hide();
    },
  };
}
