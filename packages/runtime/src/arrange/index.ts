/**
 * Arranging windows (ADR 0116), mounted by the shell's windows (`surface/Surface.ts`): the
 * desk.windows.* commands, the right-edge strip that runs them, and the spread overlay.
 */
import { CommandError } from "../commands";
import { PLACEHOLDER } from "../frames/placeholder";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { panOf, setPan } from "../shell/Pan";
import { focusPane } from "../shell/windows";
import { isFloating, screenRect } from "../surface/coordinates";
import { leaves, panesOf } from "../surface/tree";
import { resolveView, viewOf } from "../surface/views";
import { Arranger } from "./arranger";
import { defineArrangeCommands } from "./commands";
import { Spread, spreadWindows } from "./spread";
import { spreadView } from "./spread-view";
import { mountStrip } from "./strip";

export interface ArrangeWindows {
  /** The layer the windows are drawn in. */
  layer: HTMLElement;
  /** A window's element, by surface id. */
  element(id: string): HTMLElement | undefined;
  size(): { vw: number; vh: number };
}

/** A duration token in milliseconds (`240ms`, `0.4s`); the runtime zeroes them for reduced motion. */
function motion(el: Element, name: string, fallback: number): number {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.endsWith("ms") ? n : value.endsWith("s") ? n * 1000 : n;
}

export function mountArrange(
  root: HTMLElement,
  ctx: ShellCtx,
  windows: ArrangeWindows,
): () => void {
  const shell = root.closest<HTMLElement>(".shell") ?? root;
  const arranger = new Arranger(ctx, { size: windows.size });
  const title = (id: string) => {
    const s = ctx.store.get();
    const p = windowsOf(s).find((w) => w.id === id);
    const label = windows.element(id)?.getAttribute("aria-label");
    if (label) return label;
    const first = p ? leaves(panesOf(p))[0]?.view : undefined;
    return p ? viewOf(ctx, resolveView(s, p, first ?? p.id)).title : id;
  };
  let spread: Spread | undefined;
  const view = spreadView({
    root,
    shell,
    layer: windows.layer,
    element: windows.element,
    lang: () => ctx.store.get().lang,
    spread: () => spread,
  });
  spread = new Spread(
    {
      store: ctx.store,
      ticker: ctx.ticker,
      reduced: () => ctx.reduced(),
      size: windows.size,
      windows: () =>
        spreadWindows(ctx.store.get(), {
          size: windows.size(),
          covered: (plugin) => ctx.windows.covered?.(plugin) ?? false,
          unloaded: (id) => windows.element(id)?.querySelector(`.${PLACEHOLDER}`) != null,
          title,
        }),
      reveal: (id) => reveal(ctx, id, windows.size()),
      focus: (id) => {
        focusPane(ctx, id);
        // A window of the shell's own views holds the keyboard itself; a plugin's frame took it.
        if (!ctx.runtime.shortcuts.focused) windows.element(id)?.focus({ preventScroll: true });
      },
      durations: () => ({
        open: motion(shell, "--desk-motion-slow", 400),
        move: motion(shell, "--desk-motion-fast", 150),
        close: motion(shell, "--desk-motion-base", 220),
      }),
    },
    view,
  );
  const run = (command: string) => {
    void ctx.runtime.commands.run(command).catch((error: unknown) => {
      // A core without the registry (a bare stub) still arranges, without the undo stack.
      if (!(error instanceof CommandError) || error.code !== "unknown_command") return;
      if (command.endsWith(".spread")) spread?.toggle();
      else if (command.endsWith(".restore-arrangement")) arranger.restore();
      else arranger.arrange(command.endsWith(".tile") ? "tile" : "cascade");
    });
  };
  const offs = [
    defineArrangeCommands(ctx, arranger, spread),
    mountStrip(root, ctx, arranger, run),
    // The desk under the spread changed: windows came, went or moved, or the desktop changed.
    ctx.store.watch(
      (s) => [s.desktop, s.pan, windowsOf(s).map((p) => [p.id, p.x, p.y, p.w, p.h, p.fill])],
      () => spread?.sync(),
    ),
    ctx.runtime.onQuit(() => void spread?.cancel()),
  ];
  return () => {
    for (const off of offs) off();
    spread?.dispose();
    view.dispose();
  };
}

/** Pan the canvas just enough to bring a normal window wholly into sight; floating ones are. */
function reveal(ctx: ShellCtx, id: string, size: { vw: number; vh: number }): void {
  const s = ctx.store.get();
  const p = windowsOf(s).find((w) => w.id === id);
  if (!p || isFloating(p)) return;
  const pan = panOf(s);
  const r = screenRect(p, pan, size.vw, size.vh);
  const fit = (at: number, length: number, room: number) =>
    length >= room || at < 0 ? -at : at + length > room ? room - at - length : 0;
  const dx = fit(r.x, r.w, size.vw);
  const dy = fit(r.y, r.h, size.vh);
  if (dx || dy) setPan(ctx, { x: pan.x + dx, y: pan.y + dy });
}
