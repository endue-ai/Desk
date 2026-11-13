// The surface shim (shim.js) follows files dragged in from the OS over a window out of the canvas
// (#235): run in a page of its own with its events played by the test. It tells the shell where a
// drag of files is, once a place, that it left (past nested elements) and where it dropped; it
// keeps the page's own handlers from it; a drag with no files is left to the page; and the page
// cannot say what the shim says.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./shim.js", import.meta.url), "utf8");

type Listener = (event: FakeDrag) => void;

interface FakeDrag {
  type: string;
  clientX: number;
  clientY: number;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  dataTransfer: { types: string[]; dropEffect: string };
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

function page() {
  const posts: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, Listener[]>();
  const scope: Record<string, unknown> = {
    __deskNative: { post: (text: string) => posts.push(JSON.parse(text)) },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  new Function("globalThis", SOURCE)(scope);
  const fire = (type: string, x = 0, y = 0, types = ["Files"]): FakeDrag => {
    const event: FakeDrag = {
      type,
      clientX: x,
      clientY: y,
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      dataTransfer: { types, dropEffect: "none" },
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  const parent = scope.parent as { postMessage(message: unknown): void };
  return { posts, fire, parent, kinds: () => posts.map((p) => p.type) };
}

describe("the shim and files dragged in from the OS", () => {
  it("says where the drag is, once a place, and keeps the page's handlers from it", () => {
    const p = page();
    const entered = p.fire("dragenter", 10, 20);
    expect([entered.prevented, entered.stopped, entered.dataTransfer.dropEffect]).toEqual([
      true,
      true,
      "copy",
    ]);
    p.fire("dragover", 10, 20);
    p.fire("dragover", 12, 20);
    expect(p.posts).toEqual([
      { type: "desk:os-dragover", x: 10, y: 20, keys: expect.any(Object) },
      { type: "desk:os-dragover", x: 12, y: 20, keys: expect.any(Object) },
    ]);
  });

  it("says it left only once it left the page, past the elements it crossed", () => {
    const p = page();
    p.fire("dragenter", 10, 20);
    p.fire("dragenter", 11, 20);
    p.fire("dragleave", 11, 20);
    expect(p.kinds()).not.toContain("desk:os-dragleave");
    p.fire("dragleave", 0, 0);
    expect(p.kinds().at(-1)).toBe("desk:os-dragleave");
  });

  it("says where it dropped, and a drag with no files is the page's own", () => {
    const p = page();
    p.fire("dragenter", 10, 20);
    const dropped = p.fire("drop", 30, 40);
    expect(dropped.prevented).toBe(true);
    expect(p.posts.at(-1)).toMatchObject({ type: "desk:os-drop", x: 30, y: 40 });
    const text = page();
    const over = text.fire("dragover", 1, 1, ["text/plain"]);
    expect([over.prevented, text.posts]).toEqual([false, []]);
  });

  it("never passes on what the page says in the shim's name", () => {
    const p = page();
    p.parent.postMessage({ type: "desk:os-drop", x: 1, y: 1 });
    p.parent.postMessage({ type: "desk:hello" });
    expect(p.kinds()).toEqual(["desk:hello"]);
  });
});
