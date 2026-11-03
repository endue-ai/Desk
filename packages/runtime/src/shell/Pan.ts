import { isFloating, type Offset, ORIGIN } from "../surface/coordinates";
import { windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { h, listen } from "./dom";
import { draggable } from "./drag";
import { icon } from "./icons";
import type { DeskState } from "./state";

export const panOf = (s: DeskState): Offset => s.pan[s.desktop] ?? ORIGIN;

export function setPan(ctx: ShellCtx, pan: Offset): void {
  ctx.store.set((s) => ({ pan: { ...s.pan, [s.desktop]: pan } }));
}

/**
 * The canvas under the normal windows: Shift + drag on the empty background or on a window's title
 * bar moves it, and the normal windows with it; floating windows stay where they are. A wheel over
 * the empty background moves it too. Windows' contents, inputs and plugin scroll areas keep their
 * input, and a plain drag never pans.
 */
export function mountPan(root: HTMLElement, ctx: ShellCtx): () => void {
  let start = ORIGIN;
  let desktop = ctx.store.get().desktop;
  const hasCanvas = () => windowsOf(ctx.store.get()).some((p) => !isFloating(p));
  const background = (target: EventTarget | null) =>
    target === root || (target instanceof Element && target.classList.contains("shell-glow"));
  const titleBar = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest(".surface-title") !== null &&
    target.closest("button") === null;
  /** Holding Shift shows the hand over what a drag would pan. */
  const shift = (e: KeyboardEvent | FocusEvent) =>
    root.classList.toggle("pan-ready", e instanceof KeyboardEvent && e.shiftKey);
  const reset = h(
    "button",
    {
      class: "canvas-reset icon-button",
      type: "button",
      onClick: () => setPan(ctx, ORIGIN),
    },
    icon("target", 18),
  );
  const draw = () => {
    const pan = panOf(ctx.store.get());
    root.classList.toggle("has-canvas", hasCanvas());
    root.style.setProperty("--pan-x", `${pan.x}px`);
    root.style.setProperty("--pan-y", `${pan.y}px`);
    root.title = hasCanvas() ? ctx.tr("panHint") : "";
    reset.title = ctx.tr("resetPan");
    reset.setAttribute("aria-label", ctx.tr("resetPan"));
    if (pan.x || pan.y) {
      if (reset.parentElement !== root) root.append(reset);
    } else reset.remove();
  };
  const move = (dx: number, dy: number) => {
    if (ctx.store.get().desktop === desktop) setPan(ctx, { x: start.x + dx, y: start.y + dy });
  };
  const off = [
    draggable(root, {
      accept: (e) => e.shiftKey && hasCanvas() && (background(e.target) || titleBar(e.target)),
      start: () => {
        start = panOf(ctx.store.get());
        desktop = ctx.store.get().desktop;
      },
      move,
      end: move,
      cancel: () => {
        if (ctx.store.get().desktop === desktop) setPan(ctx, start);
      },
    }),
    listen(
      root,
      "wheel",
      (e) => {
        if (
          !hasCanvas() ||
          !background(e.target) ||
          e.ctrlKey ||
          root.ownerDocument.documentElement.classList.contains("is-grabbing")
        )
          return;
        e.preventDefault();
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
        const pan = panOf(ctx.store.get());
        setPan(ctx, { x: pan.x - e.deltaX * scale, y: pan.y - e.deltaY * scale });
      },
      { passive: false },
    ),
    ctx.store.watch((s) => [s.pan, s.desktop, s.lang, windowsOf(s)], draw),
    listen(window, "keydown", shift),
    listen(window, "keyup", shift),
    listen(window, "blur", shift),
  ];
  draw();
  return () => {
    for (const dispose of off) dispose();
    reset.remove();
    root.classList.remove("has-canvas", "pan-ready");
    root.style.removeProperty("--pan-x");
    root.style.removeProperty("--pan-y");
    root.removeAttribute("title");
  };
}
