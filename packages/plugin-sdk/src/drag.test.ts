import { describe, expect, it, vi } from "vitest";
import { DRAG_THRESHOLD, draggable } from "./drag";
import {
  type DeskData,
  type DragResult,
  type Drop,
  defineUiPlugin,
  type PluginContext,
} from "./index";
import { createTestHost } from "./testing/index";

/** A pointer event as the frame's window delivers it. */
const pointer = (type: string, x: number, y = 10) =>
  Object.assign(new Event(type, { cancelable: true }), {
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    isPrimary: true,
  });
const PATHS: DeskData = {
  type: "desk/paths",
  paths: [{ path: "~/Documents/a.md", kind: "file" }],
};

function list() {
  const rows = new EventTarget();
  const startDrag = vi.fn(async (): Promise<DragResult> => ({ effect: "move" }));
  draggable(rows, { item: () => ({ items: [PATHS] }) }, startDrag);
  const click = () => {
    const event = new Event("click", { cancelable: true });
    rows.dispatchEvent(event);
    return event;
  };
  return { rows, startDrag, click };
}

describe("a draggable list's threshold", () => {
  it("keeps a press without movement a click, never a drag", () => {
    const { rows, startDrag, click } = list();
    rows.dispatchEvent(pointer("pointerdown", 10));
    rows.dispatchEvent(pointer("pointerup", 10));
    expect(click().defaultPrevented).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
  });

  it("keeps a press that moves less than the threshold a click", () => {
    const { rows, startDrag, click } = list();
    rows.dispatchEvent(pointer("pointerdown", 10));
    rows.dispatchEvent(pointer("pointermove", 10 + DRAG_THRESHOLD - 1));
    rows.dispatchEvent(pointer("pointerup", 10 + DRAG_THRESHOLD - 1));
    expect(click().defaultPrevented).toBe(false);
    expect(startDrag).not.toHaveBeenCalled();
  });

  it("starts one drag past the threshold, and its release clicks nothing", () => {
    const { rows, startDrag, click } = list();
    rows.dispatchEvent(pointer("pointerdown", 10));
    rows.dispatchEvent(pointer("pointermove", 30));
    rows.dispatchEvent(pointer("pointermove", 40));
    expect(startDrag).toHaveBeenCalledOnce();
    expect(startDrag.mock.calls[0]).toMatchObject([{ items: [PATHS], event: { clientX: 30 } }]);
    rows.dispatchEvent(pointer("pointerup", 40));
    expect(click().defaultPrevented).toBe(true);
  });

  it("keeps the browser's own drag from starting on a row that drags", () => {
    const { rows } = list();
    const native = new Event("dragstart", { cancelable: true });
    rows.dispatchEvent(native);
    expect(native.defaultPrevented).toBe(true);
  });
});

/** A plugin whose `target` takes paths and whose drags start on demand. */
async function mounted(
  answer: (drop: Drop) => "copy" | "move" | "link" | undefined = () => undefined,
) {
  const host = createTestHost({ pluginId: "example.files" });
  const target = {};
  const drops: Drop[] = [];
  let ctx: PluginContext | undefined;
  await defineUiPlugin(
    {
      mount(context) {
        ctx = context;
        context.dnd.onDrop(
          target,
          (drop) => {
            drops.push(drop);
            return answer(drop);
          },
          { accept: ["desk/paths"] },
        );
      },
    },
    host.transport,
  );
  await host.settle();
  if (!ctx) throw new Error("not mounted");
  return { host, ctx, target, drops };
}

describe("startDrag and onDrop on the testing host", () => {
  it("round trip: the drag's items land on the target and its effect ends the drag", async () => {
    const { host, ctx, target, drops } = await mounted(() => "copy");
    expect(host.dnd.accepts).toEqual(["desk/paths"]);
    const dragged = ctx.dnd.startDrag({ items: [PATHS], effectAllowed: ["copy", "move"] });
    expect(ctx.dnd.dragging).toBe(true);
    expect(host.dnd.drags.at(-1)).toMatchObject({
      items: [PATHS],
      effectAllowed: ["copy", "move"],
    });
    host.dnd.move(40, 12, { alt: true });
    expect(host.dnd.drags.at(-1)?.moves).toEqual([
      {
        type: "desk:drag-move",
        drag: 1,
        x: 40,
        y: 12,
        keys: expect.objectContaining({ alt: true }),
      },
    ]);
    const result = await host.dnd.release({ over: target });
    await expect(dragged).resolves.toEqual({ effect: "copy", to: "example.files" });
    expect(result).toEqual({ effect: "copy", to: "example.files" });
    expect(ctx.dnd.dragging).toBe(false);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ from: "example.files", effect: "copy", paths: PATHS.paths });
    expect(drops[0]?.items).toEqual([PATHS]);
  });

  it("agrees the effect from the keys: Alt copies, Mod moves, both link", async () => {
    const { host } = await mounted();
    const items = [PATHS];
    expect(await host.dnd.hover({ items })).toBe("copy");
    expect(await host.dnd.hover({ items, keys: { alt: true } })).toBe("copy");
    expect(await host.dnd.hover({ items, keys: { meta: true } })).toBe("move");
    expect(await host.dnd.hover({ items, keys: { ctrl: true, alt: true } })).toBe("link");
    expect(await host.dnd.hover({ items, keys: { alt: true }, effectAllowed: ["move"] })).toBe(
      "none",
    );
  });

  it("never offers a type the targets do not accept, and the handler never runs", async () => {
    const { host, drops } = await mounted();
    expect(await host.dnd.drop({ items: [{ type: "desk/uri", uri: "https://endue.ai" }] })).toBe(
      "none",
    );
    expect(drops).toEqual([]);
  });

  it("a drag cancelled with Escape ends with no effect", async () => {
    const { host, ctx } = await mounted();
    const dragged = ctx.dnd.startDrag({ items: [PATHS] });
    await host.dnd.cancel();
    await expect(dragged).resolves.toEqual({ effect: "none" });
  });
});
