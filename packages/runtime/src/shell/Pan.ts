import type { Offset } from "../wm/types";
import { desktopId, edit } from "./actions";
import type { ShellCtx } from "./context";
import { listen } from "./dom";
import { draggable } from "./drag";
import type { DeskState } from "./state";

const ORIGIN: Offset = { x: 0, y: 0 };

/** The canvas offset of the desktop in front (by id, ADR 0117). */
export const panOf = (s: DeskState): Offset => s.pan[desktopId(s)] ?? ORIGIN;

/** The window manager pans the canvas of the desktop in front to `pan` (#83). */
export function setPan(ctx: Pick<ShellCtx, "wm">, pan: Offset): Promise<unknown[]> {
  return edit(ctx, { op: "pan", to: pan });
}

/**
 * The wheel moves the canvas as it would scroll a page `page` pixels high: lines are 16 pixels. It
 * sends its own step, which the window manager adds to the pan it holds. Worked out here from the
 * store's pan, which trails the window manager's by a publish, a wheel that came before the last
 * one's publish overwrote it, and a fast pan fell short. On the compositor the wheels that follow
 * are the shell's own (`compositor_window/pan.rs`): they pan whatever comes under the pointer.
 */
export function wheelPan(
  ctx: Pick<ShellCtx, "wm">,
  e: WheelEvent,
  page: number,
): Promise<unknown[]> {
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1;
  return edit(ctx, { op: "pan-by", by: { x: -e.deltaX * scale, y: -e.deltaY * scale } });
}

/**
 * The canvas under the normal windows: Shift + drag on the empty background or on a window's title
 * bar moves it, and the normal windows with it; floating windows stay where they are. A wheel over
 * the empty background moves it too. Windows' contents, inputs and plugin scroll areas keep their
 * input, and a plain drag never pans. Over the empty canvas the pointer shows how (the root's title,
 * only there). The window manager (crates/desk-wm on the compositor, ADR 0153) pans from the press
 * the page found, and publishes the pan; the wheel's pan is the page's. The way back to the origin
 * is the strip's under the canvas map (`MapStrip.ts`, issue 296).
 */
export function mountPan(root: HTMLElement, ctx: ShellCtx): () => void {
  const background = (target: EventTarget | null) =>
    target === root || (target instanceof Element && target.classList.contains("shell-glow"));
  const titleBar = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest(".surface-title") !== null &&
    target.closest("button") === null;
  /** Holding Shift shows the hand over what a drag would pan. */
  const shift = (e: KeyboardEvent | FocusEvent) =>
    root.classList.toggle("pan-ready", e instanceof KeyboardEvent && e.shiftKey);
  const draw = () => {
    const pan = panOf(ctx.store.get());
    root.classList.add("has-canvas");
    root.style.setProperty("--pan-x", `${pan.x}px`);
    root.style.setProperty("--pan-y", `${pan.y}px`);
  };
  const off = [
    draggable(root, {
      accept: (e) => e.shiftKey && (background(e.target) || titleBar(e.target)),
      press: (e) => ctx.wm.grab({ kind: "pan" }, { x: e.clientX, y: e.clientY }),
      move: () => undefined,
      end: () => undefined,
    }),
    listen(
      root,
      "wheel",
      (e) => {
        if (
          !background(e.target) ||
          e.ctrlKey ||
          root.ownerDocument.documentElement.classList.contains("is-grabbing")
        )
          return;
        e.preventDefault();
        wheelPan(ctx, e, root.clientHeight);
      },
      { passive: false },
    ),
    // The hint is the empty canvas's alone: as the root's title it was every control's tooltip.
    listen(root, "pointerover", (e) => {
      if (background(e.target)) root.title = ctx.tr("panHint");
      else root.removeAttribute("title");
    }),
    ctx.store.watch((s) => [s.pan, s.desktop], draw),
    listen(window, "keydown", shift),
    listen(window, "keyup", shift),
    listen(window, "blur", shift),
  ];
  draw();
  return () => {
    for (const dispose of off) dispose();
    root.classList.remove("has-canvas", "pan-ready");
    root.style.removeProperty("--pan-x");
    root.style.removeProperty("--pan-y");
    root.removeAttribute("title");
  };
}
