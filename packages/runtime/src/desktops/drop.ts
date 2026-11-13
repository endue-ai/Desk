/**
 * Dropping a window on the switcher (ADR 0117): while a window's title bar is dragged, the desktop
 * under the pointer lights up; let go there and the window moves to it ("+": to a new desktop), at
 * the place it had before the drag. The window's own drag ends first; the move follows it.
 *
 * A window that lies in a page of its own (ADR 0201) is dragged there: its page hears the pointer,
 * whose points are the window's on the desk (`window-docs.ts`), and holds the dragged section.
 */
import type { SurfacePlacement } from "../modes/types";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { listen } from "../shell/dom";
import { moveToNew, moveWindowTo } from "./actions";

const TARGETS = "[data-desktop-id], .desktop-add";

export function windowDrops(ctx: ShellCtx, switcher: HTMLElement): () => void {
  const doc = switcher.ownerDocument;
  const win = doc.defaultView ?? window;
  let dragging: { window: string; before: SurfacePlacement } | undefined;
  let over: HTMLElement | undefined;

  const light = (target: HTMLElement | undefined) => {
    if (target === over) return;
    over?.classList.remove("is-drop-target");
    over = target;
    over?.classList.add("is-drop-target");
  };
  const targetAt = (x: number, y: number) =>
    [...switcher.querySelectorAll<HTMLElement>(TARGETS)].find((b) => {
      const r = b.getBoundingClientRect();
      return !b.matches(":disabled") && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  const reset = () => {
    dragging = undefined;
    light(undefined);
  };
  /** Where `e` is on the desk: in this page as it is, in window `page`'s own page at its place. */
  const deskPoint = (e: Event, page?: string) => {
    const { clientX: x, clientY: y } = e as PointerEvent;
    return page && ctx.pages ? ctx.pages.toDesk(page, { x, y }) : { x, y };
  };

  /** What the pointer does in `from` (this page's window, or window `page`'s own page). */
  const heard = (from: Window, page?: string) =>
    [
      listen(
        from,
        "pointermove",
        (e) => {
          if (!doc.documentElement.classList.contains("is-grabbing")) return;
          if (!dragging) {
            const own = from.document;
            const selector = ".surface.is-dragging[data-surface]";
            const el = own.querySelector<HTMLElement>(selector) ?? doc.querySelector(selector);
            const id = el?.getAttribute("data-surface");
            // Before the window's drag moves it: the store still has where it was.
            const before = id ? windowsOf(ctx.store.get()).find((p) => p.id === id) : undefined;
            if (!id || !before) return;
            dragging = { window: id, before: structuredClone(before) };
          }
          const at = deskPoint(e, page);
          light(targetAt(at.x, at.y));
        },
        { capture: true },
      ),
      listen(
        from,
        "pointerup",
        (e) => {
          const drag = dragging;
          const at = deskPoint(e, page);
          const target = drag && targetAt(at.x, at.y);
          reset();
          if (!drag || !target) return;
          const to = target.getAttribute("data-desktop-id");
          // After the window's own drag has ended and saved its place.
          win.setTimeout(() => {
            if (to) moveWindowTo(ctx, drag.window, to, drag.before);
            else moveToNew(ctx, drag.window, drag.before);
          }, 0);
        },
        { capture: true },
      ),
      listen(from, "pointercancel", reset, { capture: true }),
      listen(from, "keydown", (e) => (e as KeyboardEvent).key === "Escape" && reset(), {
        capture: true,
      }),
    ].reduce(
      (all, off) => () => {
        all();
        off();
      },
      () => {},
    );

  return [
    heard(win),
    ctx.pages?.watch((page, pageWin) => heard(pageWin, page)) ?? (() => {}),
    listen(win, "blur", reset),
  ].reduce(
    (all, off) => () => {
      all();
      off();
    },
    () => light(undefined),
  );
}
