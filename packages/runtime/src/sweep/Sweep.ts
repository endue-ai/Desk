/**
 * Sweep on the desk (ADR 0296): Cmd+drag (Ctrl+drag off the Mac) on the empty canvas draws an area
 * and the mode in force acts on it (`model.ts`). While sweeping, the bar shows the four modes and 1–4
 * pick one; afterwards it shows what Select picked, with its commands and Ask Eris, and the chip of
 * what the next line to Eris carries. The area and the picked windows' rings are drawn above the
 * windows and hear nothing (the compositor's part `desk.sweep-marks`); the bar hears its own
 * presses (`desk.sweep`).
 */
import { MOVE, RESIZE } from "../arrange/frame";
import type { ShellCtx } from "../shell/context";
import { type Child, h, listen, render } from "../shell/dom";
import { draggable } from "../shell/drag";
import { panOf } from "../shell/Pan";
import {
  around,
  type Box,
  boxBetween,
  gridIn,
  SWEEP_LABELS,
  SWEEP_MODES,
  type SweepContext,
  type SweepMode,
  type SweepState,
  tooSmall,
  touched,
  windowLines,
} from "./model";
import { type Seen, takeSnapshot } from "./snapshot";

const TALK = "desk.shell.talk";

/** Sweep's part of the store, changed. */
export function setSweep(ctx: Pick<ShellCtx, "store">, patch: Partial<SweepState>): void {
  ctx.store.set((s) => ({ sweep: { ...s.sweep, ...patch } }));
}

/** The windows on screen, in CSS pixels from the desk's top left, as the page lays them out. */
export function windowsSeen(root: HTMLElement, ctx: Pick<ShellCtx, "store">): Seen[] {
  const origin = root.getBoundingClientRect();
  const plugins = new Map(
    Object.values(ctx.store.get().wm.windows)
      .flat()
      .map((w) => [w.id, w.plugin]),
  );
  return [...root.querySelectorAll<HTMLElement>(".surface[data-surface]")].flatMap((el) => {
    const id = el.dataset.surface ?? "";
    const r = el.getBoundingClientRect();
    if (!id || r.width <= 0 || r.height <= 0) return [];
    const plugin = plugins.get(id) ?? id.split("#")[0] ?? id;
    const title = el.querySelector(".surface-title")?.textContent?.trim() || plugin;
    const box = { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
    return [{ id, title, plugin, box }];
  });
}

/** What Eris reads of the windows Select picked. */
export function selectionText(windows: readonly Seen[]): string {
  return `[The person selected these windows and speaks about them; window commands such as desk.windows.close take their ids.]\n${windowLines(windows)}`;
}

/** Arrange `windows` in `area` (CSS pixels from the desk's top left): a grid, through the window commands. */
export async function arrangeIn(ctx: Pick<ShellCtx, "runtime">, area: Box, ids: readonly string[]) {
  const cells = gridIn(area, ids.length);
  for (const [i, window] of ids.entries()) {
    const cell = cells[i];
    if (!cell) continue;
    await ctx.runtime.commands.run(MOVE, { window, x: cell.x, y: cell.y });
    await ctx.runtime.commands.run(RESIZE, { window, w: cell.w, h: cell.h });
  }
}

/** Hand `context` to Eris with the next line, and open the talk line for it. */
export async function askWith(ctx: Pick<ShellCtx, "store" | "runtime">, context: SweepContext) {
  setSweep(ctx, { context });
  await ctx.runtime.commands.run(TALK).catch(() => undefined);
}

const backgroundOf = (root: HTMLElement) =>
  getComputedStyle(root).backgroundColor || getComputedStyle(document.body).backgroundColor;

export function mountSweep(root: HTMLElement, ctx: ShellCtx): () => void {
  // In the page only while it shows something: a desk at rest has none of it.
  const layer = h("div", { class: "sweep-layer" });
  const area = h("div", { class: "sweep-mark sweep-area", hidden: true, "aria-hidden": "true" });
  const rings = h("div", { class: "sweep-rings", "aria-hidden": "true" });
  const bar = h("div", { class: "sweep-bar", role: "toolbar", "aria-label": "Sweep" });
  layer.append(area, rings, bar);

  let sweeping = false;
  let from = { x: 0, y: 0 };
  const isMod = (e: PointerEvent | KeyboardEvent) =>
    ctx.platform === "mac" ? e.metaKey : e.ctrlKey;
  const background = (target: EventTarget | null) =>
    target === root || (target instanceof Element && target.classList.contains("shell-glow"));
  const at = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const place = (el: HTMLElement, box: Box) => {
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
  };
  const mode = () => ctx.store.get().sweep.mode;
  const picked = () => {
    const ids = new Set(ctx.store.get().sweep.selected);
    return windowsSeen(root, ctx).filter((w) => ids.has(w.id));
  };
  const say = (text: string) => ctx.runtime.notify({ caller: "desk", title: text, level: "info" });

  const act = async (box: Box, add: boolean) => {
    const seen = touched(box, windowsSeen(root, ctx));
    switch (mode()) {
      case "pan":
        return;
      case "select": {
        if (tooSmall(box))
          return setSweep(ctx, { selected: add ? ctx.store.get().sweep.selected : [] });
        const before = add ? ctx.store.get().sweep.selected : [];
        return setSweep(ctx, { selected: [...new Set([...before, ...seen.map((w) => w.id)])] });
      }
      case "arrange":
        if (tooSmall(box)) return;
        if (seen.length === 0) return say("No window is in that area to arrange.");
        return arrangeIn(
          ctx,
          box,
          seen.map((w) => w.id),
        );
      case "ask":
        if (tooSmall(box)) return;
        return askWith(ctx, await takeSnapshot(ctx.bridge, box, seen, backgroundOf(root)));
    }
  };

  const draw = () => {
    const s = ctx.store.get().sweep;
    // The picked windows' rings, where the page lays them out now.
    render(rings, () =>
      picked().map((w) => {
        const ring = h("div", { class: "sweep-mark sweep-ring" });
        place(ring, w.box);
        return ring;
      }),
    );
    const parts: Child[] = [];
    if (sweeping || s.selected.length > 0) {
      parts.push(
        h(
          "div",
          { class: "segmented", role: "radiogroup", "aria-label": "Sweep mode" },
          SWEEP_MODES.map((m, i) =>
            h(
              "button",
              {
                class: `segment${m === s.mode ? " is-selected" : ""}`,
                type: "button",
                role: "radio",
                "aria-checked": String(m === s.mode),
                title: `${SWEEP_LABELS[m]} (${i + 1})`,
                onClick: () => setSweep(ctx, { mode: m }),
              },
              SWEEP_LABELS[m],
            ),
          ),
        ),
      );
    }
    if (!sweeping && s.selected.length > 0) parts.push(...selectionTools(s.selected.length));
    if (s.context) parts.push(chip(s.context));
    bar.hidden = parts.length === 0;
    render(bar, () => parts);
    const showing = sweeping || s.selected.length > 0 || s.context !== null;
    if (showing && !layer.isConnected) root.append(layer);
    else if (!showing && layer.isConnected) layer.remove();
  };

  const each = (command: string) => async () => {
    for (const window of ctx.store.get().sweep.selected)
      await ctx.runtime.commands.run(command, { window }).catch(() => undefined);
    setSweep(ctx, { selected: [] });
  };
  const tool = (label: string, run: () => unknown, danger = false) =>
    h(
      "button",
      { class: `btn${danger ? " btn-danger" : ""}`, type: "button", onClick: run },
      label,
    );
  const selectionTools = (count: number): Child[] => [
    h("span", { class: "sweep-count" }, `${count} selected`),
    tool("Arrange", () => {
      const seen = picked();
      const box = seen.length ? aroundSeen(seen) : undefined;
      if (box)
        void arrangeIn(
          ctx,
          box,
          seen.map((w) => w.id),
        );
    }),
    tool("Snapshot", async () => {
      const seen = picked();
      const box = aroundSeen(seen);
      if (box) await askWith(ctx, await takeSnapshot(ctx.bridge, box, seen, backgroundOf(root)));
    }),
    tool("Ask Eris", () => {
      const seen = picked();
      const label = `${seen.length} window${seen.length === 1 ? "" : "s"}`;
      void askWith(ctx, { label, text: selectionText(seen) });
    }),
    tool("Put away", each("desk.windows.put-away")),
    tool("Close", each("desk.windows.close"), true),
    h(
      "button",
      {
        class: "icon-button",
        type: "button",
        "aria-label": "Clear the selection",
        onClick: () => setSweep(ctx, { selected: [] }),
      },
      "×",
    ),
  ];
  const chip = (context: SweepContext) =>
    h(
      "div",
      { class: "sweep-context" },
      context.image ? h("img", { class: "sweep-thumb", src: context.image, alt: "" }) : null,
      h("span", {}, `For Eris: ${context.label}`),
      h(
        "button",
        {
          class: "icon-button",
          type: "button",
          "aria-label": "Leave it out",
          onClick: () => setSweep(ctx, { context: null }),
        },
        "×",
      ),
    );

  const offs = [
    draggable(root, {
      accept: (e) => isMod(e) && background(e.target),
      press: (e) => {
        if (mode() === "pan") void ctx.wm.grab({ kind: "pan" }, { x: e.clientX, y: e.clientY });
      },
      start: (down) => {
        if (mode() === "pan") return;
        sweeping = true;
        from = at(down);
        area.hidden = false;
        place(area, { ...from, w: 0, h: 0 });
        draw();
      },
      move: (_dx, _dy, e) => {
        if (!sweeping) return;
        const to = at(e);
        place(area, boxBetween(from.x, from.y, to.x, to.y));
      },
      end: (_dx, _dy, e) => {
        if (!sweeping) return;
        const to = at(e);
        sweeping = false;
        area.hidden = true;
        void act(boxBetween(from.x, from.y, to.x, to.y), e.shiftKey).finally(draw);
      },
      cancel: () => {
        sweeping = false;
        area.hidden = true;
        draw();
      },
    }),
    // 1–4 pick the mode while sweeping; Escape lets the selection go.
    listen(window, "keydown", (e) => {
      const n = Number(e.key);
      if (sweeping && n >= 1 && n <= SWEEP_MODES.length) {
        e.preventDefault();
        setSweep(ctx, { mode: SWEEP_MODES[n - 1] as SweepMode });
      } else if (e.key === "Escape" && !sweeping && ctx.store.get().sweep.selected.length > 0) {
        setSweep(ctx, { selected: [] });
      }
    }),
    ctx.store.watch((s) => [s.sweep, s.wm.windows, panOf(s)], draw),
  ];
  draw();
  return () => {
    for (const off of offs) off();
    layer.remove();
  };
}

/** The box around windows seen. */
const aroundSeen = (seen: readonly Seen[]) => around(seen.map((w) => w.box));
