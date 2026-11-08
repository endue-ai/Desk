import { describe, expect, it } from "vitest";
import { DragBroker } from "./broker";
import type { DndHostMessage, DropAnswer, Point } from "./types";

// Three frames side by side, 400 px wide each: a.one at 0, b.two at 400, c.three at 800.
const FRAMES = ["a.one", "b.two", "c.three"];
const left = (id: string) => FRAMES.indexOf(id) * 400;
const PATHS = { type: "desk/paths", paths: [{ path: "~/Documents/a.md", kind: "file" }] };
const KEYS = { alt: false, shift: false, ctrl: false, meta: false };

function desk(options: { patient?: boolean; pressed?: boolean } = {}) {
  const posted = new Map<string, DndHostMessage[]>(FRAMES.map((id) => [id, []]));
  const drawn: Array<{ at?: Point; effect?: DropAnswer; shown?: boolean; hidden?: boolean }> = [];
  const broker = new DragBroker({
    pluginAt: (x) => FRAMES[Math.floor(x / 400)],
    toFrame: (id, at) => ({ x: at.x - left(id), y: at.y }),
    toPage: (id, at) => ({ x: at.x + left(id), y: at.y }),
    post: (id, message) => posted.get(id)?.push(message),
    layer: {
      show: (_image, at) => drawn.push({ at, shown: true }),
      move: (at, effect) => drawn.push({ at, effect }),
      hide: () => drawn.push({ hidden: true }),
    },
    // An impatient desk does not wait for a target's late answer.
    wait: () => (options.patient ? new Promise<void>(() => {}) : Promise.resolve()),
    gesture: () => options.pressed ?? true,
  });
  const send = (id: string, message: Record<string, unknown>) => broker.message(id, message);
  const of = (id: string) => posted.get(id) ?? [];
  const types = (id: string) => of(id).map((m) => m.type);
  return { broker, send, of, types, drawn };
}

/** a.one starts dragging a path at (10, 10); b.two takes paths and text. */
function dragging(options?: { patient?: boolean }) {
  const d = desk(options);
  d.send("b.two", { type: "desk:drop-types", types: ["desk/paths", "text/plain"] });
  d.send("c.three", { type: "desk:drop-types", types: ["desk/text"] });
  d.send("a.one", { type: "desk:drag-start", drag: 7, items: [PATHS], x: 10, y: 10 });
  return d;
}

describe("the drag broker", () => {
  it("offers a drag that starts in frame A to frame B with its types, in B's coordinates", () => {
    const { send, of } = dragging();
    send("a.one", { type: "desk:drag-move", drag: 7, x: 450, y: 20, keys: KEYS });
    expect(of("b.two")).toEqual([
      {
        type: "desk:dragenter",
        drag: 1,
        seq: 1,
        types: ["desk/paths", "text/plain"],
        effectAllowed: ["copy", "move", "link"],
        from: "a.one",
        x: 50,
        y: 20,
        keys: KEYS,
      },
    ]);
    send("a.one", { type: "desk:drag-move", drag: 7, x: 460, y: 20, keys: { ...KEYS, alt: true } });
    expect(of("b.two")[1]).toMatchObject({
      type: "desk:dragover",
      seq: 2,
      x: 60,
      keys: { alt: true },
    });
  });

  it("lets B accept or refuse an effect, and shows the source and the image what B answered", () => {
    const { send, of, drawn } = dragging();
    send("a.one", { type: "desk:drag-start", drag: 9, items: [PATHS], x: 0, y: 0 });
    send("a.one", { type: "desk:drag-move", drag: 7, x: 450, y: 20, keys: KEYS });
    send("b.two", { type: "desk:drag-status", drag: 1, seq: 1, effect: "copy" });
    expect(of("a.one").at(-1)).toEqual({ type: "desk:drag-feedback", drag: 7, effect: "copy" });
    expect(drawn.at(-1)).toEqual({ at: { x: 450, y: 20 }, effect: "copy" });
    send("a.one", { type: "desk:drag-move", drag: 7, x: 470, y: 20, keys: KEYS });
    send("b.two", { type: "desk:drag-status", drag: 1, seq: 2, effect: "none" });
    expect(of("a.one").at(-1)).toEqual({ type: "desk:drag-feedback", drag: 7, effect: "none" });
    // An effect the source does not allow is a refusal; a second drag waits for the first.
    expect(of("a.one")).toContainEqual({ type: "desk:drag-ended", drag: 9, effect: "none" });
  });

  it("delivers the items to B only, once B answered, and tells A how it ended", async () => {
    const { send, of, types } = dragging();
    send("a.one", { type: "desk:drag-move", drag: 7, x: 850, y: 20, keys: KEYS });
    send("a.one", { type: "desk:drag-move", drag: 7, x: 450, y: 20, keys: KEYS });
    send("b.two", { type: "desk:drag-status", drag: 1, seq: 1, effect: "move" });
    send("a.one", { type: "desk:drag-end", drag: 7, x: 450, y: 20, keys: KEYS });
    await Promise.resolve();
    const drop = of("b.two").at(-1);
    expect(drop).toEqual({
      type: "desk:drop",
      drag: 1,
      x: 50,
      y: 20,
      keys: KEYS,
      effect: "move",
      items: [PATHS, { type: "text/plain", text: "~/Documents/a.md" }],
    });
    send("b.two", { type: "desk:drop-done", drag: 1, effect: "move" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(of("a.one").at(-1)).toEqual({
      type: "desk:drag-ended",
      drag: 7,
      effect: "move",
      to: "b.two",
    });
    expect(types("a.one")).not.toContain("desk:drop");
    expect(types("c.three")).toEqual([]);
  });

  it("waits for B's answer to the last hover before it drops, and drops nothing when B refuses", async () => {
    const { broker, send, of, types } = dragging({ patient: true });
    send("a.one", { type: "desk:drag-move", drag: 7, x: 450, y: 20, keys: KEYS });
    const released = broker.release({ x: 460, y: 20 });
    expect(types("b.two")).toEqual(["desk:dragenter", "desk:dragover"]);
    send("b.two", { type: "desk:drag-status", drag: 1, seq: 2, effect: "none" });
    await expect(released).resolves.toEqual({ effect: "none" });
    expect(types("b.two")).toEqual(["desk:dragenter", "desk:dragover", "desk:dragleave"]);
    expect(of("a.one").at(-1)).toEqual({ type: "desk:drag-ended", drag: 7, effect: "none" });
  });

  it("cancels on Escape: B hears it leave, nobody gets the items", async () => {
    const { broker, send, of, types, drawn } = dragging();
    send("a.one", { type: "desk:drag-move", drag: 7, x: 450, y: 20, keys: KEYS });
    send("b.two", { type: "desk:drag-status", drag: 1, seq: 1, effect: "copy" });
    send("a.one", { type: "desk:drag-cancel", drag: 7 });
    expect(types("b.two")).toEqual(["desk:dragenter", "desk:dragleave"]);
    expect(of("a.one").at(-1)).toEqual({ type: "desk:drag-ended", drag: 7, effect: "none" });
    expect(drawn.at(-1)).toEqual({ hidden: true });
    expect(broker.active).toBe(false);
    // Escape on the desk itself ends a drag the same way.
    send("a.one", { type: "desk:drag-start", drag: 8, items: [PATHS], x: 10, y: 10 });
    broker.pointer({ x: 450, y: 20 });
    broker.cancel();
    expect(of("a.one").at(-1)).toEqual({ type: "desk:drag-ended", drag: 8, effect: "none" });
    await expect(broker.release({ x: 450, y: 20 })).resolves.toEqual({ effect: "none" });
    expect(types("b.two").filter((t) => t === "desk:drop")).toEqual([]);
  });

  it("never lets a drag reach a frame that does not accept its types", async () => {
    const { send, of, types } = dragging();
    send("a.one", { type: "desk:drag-move", drag: 7, x: 850, y: 20, keys: KEYS });
    send("a.one", { type: "desk:drag-end", drag: 7, x: 850, y: 20, keys: KEYS });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(types("c.three")).toEqual([]);
    expect(of("a.one").at(-1)).toEqual({ type: "desk:drag-ended", drag: 7, effect: "none" });
  });

  it("refuses a drag whose items do not hold, and forgets a frame's types when it reloads", () => {
    const { send, of, types, broker } = desk();
    send("a.one", {
      type: "desk:drag-start",
      drag: 3,
      items: [{ type: "desk/paths", paths: [{ path: "../etc/passwd" }] }],
      x: 0,
      y: 0,
    });
    expect(of("a.one")).toEqual([{ type: "desk:drag-ended", drag: 3, effect: "none" }]);
    expect(broker.active).toBe(false);
    send("b.two", { type: "desk:drop-types", types: ["desk/paths"] });
    expect(send("b.two", { type: "desk:hello" })).toBe(false);
    send("a.one", { type: "desk:drag-start", drag: 4, items: [PATHS], x: 450, y: 0 });
    expect(types("b.two")).toEqual([]);
  });

  it("refuses a drag no press started: a frame cannot drop paths on another by itself", async () => {
    const { send, of, types, broker } = desk({ pressed: false });
    send("b.two", { type: "desk:drop-types", types: ["desk/paths"] });
    send("a.one", { type: "desk:drag-start", drag: 5, items: [PATHS], x: 450, y: 20 });
    send("a.one", { type: "desk:drag-end", drag: 5, x: 450, y: 20, keys: KEYS });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(of("a.one")).toEqual([{ type: "desk:drag-ended", drag: 5, effect: "none" }]);
    expect(types("b.two")).toEqual([]);
    expect(broker.active).toBe(false);
  });
});
