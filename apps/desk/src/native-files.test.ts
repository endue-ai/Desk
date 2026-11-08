import type { DragDropEvent } from "@tauri-apps/api/webview";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DragBroker } from "../../../packages/runtime/src/dnd/broker";
import { listenNative } from "../../../packages/runtime/src/dnd/native";
import type { DndHostMessage } from "../../../packages/runtime/src/dnd/types";
import { installNativeFileDrops, pickNativeFile } from "./native-files";

const native = vi.hoisted(() => ({ open: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: native.listen }),
}));
let handler: (event: { payload: DragDropEvent }) => void;
const off = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  native.open.mockResolvedValue(null);
  native.listen.mockImplementation(async (next) => {
    handler = next;
    return off;
  });
});
const drop = (paths: string[]) =>
  handler({ payload: { type: "drop", paths, position: { x: 0, y: 0 } } as DragDropEvent });

describe("native file entry", () => {
  it("picks one local file and preserves cancellation", async () => {
    expect(await pickNativeFile()).toBeNull();
    expect(native.open).toHaveBeenCalledWith({ multiple: false, directory: false });
    native.open.mockResolvedValue("C:\\Users\\Person\\notes.md");
    expect(await pickNativeFile()).toBe("C:/Users/Person/notes.md");
    native.open.mockResolvedValue("/notes/a\\b.md");
    expect(await pickNativeFile()).toBe("/notes/a\\b.md");
    native.open.mockResolvedValue("\\\\server\\share\\notes.md");
    expect(await pickNativeFile()).toBe("//server/share/notes.md");
  });

  it("queues drops until ready and opens distinct paths in order despite a failed file", async () => {
    let ready: () => void = () => {};
    const run = vi.fn(async (_id: string, args: { path: string }) => {
      if (args.path === "/bad.md") throw new Error("refused");
    });
    const report = vi.fn();
    const dispose = installNativeFileDrops({
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
      commands: { run },
      report,
    });
    drop(["/one.md", "/bad.md", "/one.md", "C:\\Users\\Person\\two.md"]);
    expect(run).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(run.mock.calls).toEqual([
      ["desk.files.open", { path: "/one.md" }],
      ["desk.files.open", { path: "/bad.md" }],
      ["desk.files.open", { path: "C:/Users/Person/two.md" }],
    ]);
    expect(report).toHaveBeenCalledOnce();
    dispose();
    expect(off).toHaveBeenCalledOnce();
  });

  it("ignores hover and browser-like relative paths", async () => {
    const run = vi.fn(async () => {});
    const dispose = installNativeFileDrops({
      ready: Promise.resolve(),
      commands: { run },
      report: vi.fn(),
    });
    handler({ payload: { type: "leave" } });
    drop(["name-only.md", "https://example.com/file.md", "", "/invalid\0.md"]);
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    dispose();
  });

  it("serializes separate batches and stops the remaining paths when disposed", async () => {
    let finish: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const dispose = installNativeFileDrops({
      ready: Promise.resolve(),
      commands: { run },
      report: vi.fn(),
    });
    drop(["/one.md", "/two.md"]);
    drop(["/three.md"]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    dispose();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    expect(off).toHaveBeenCalledOnce();
  });

  it("disposal cancels queued paths and also unlistens when registration resolves late", async () => {
    let registered: (off: () => void) => void = () => {};
    native.listen.mockImplementation((next) => {
      handler = next;
      return new Promise((resolve) => {
        registered = resolve;
      });
    });
    let ready: () => void = () => {};
    const run = vi.fn(async () => {});
    const dispose = installNativeFileDrops({
      ready: new Promise<void>((resolve) => {
        ready = resolve;
      }),
      commands: { run },
      report: vi.fn(),
    });
    drop(["/one.md"]);
    dispose();
    registered(off);
    ready();
    await vi.waitFor(() => expect(off).toHaveBeenCalledOnce());
    expect(run).not.toHaveBeenCalled();
  });
});

/** The desk's page, two frames side by side: a.one takes paths and answers copy, b.two takes text. */
function deskPage() {
  const page = new EventTarget();
  const posted: Record<string, DndHostMessage[]> = { "a.one": [], "b.two": [] };
  const broker: DragBroker = new DragBroker({
    pluginAt: (x) => (x < 400 ? "a.one" : "b.two"),
    toFrame: (id, at) => ({ x: at.x - (id === "a.one" ? 0 : 400), y: at.y }),
    toPage: (id, at) => ({ x: at.x + (id === "a.one" ? 0 : 400), y: at.y }),
    post: (id, message) => {
      posted[id]?.push(message);
      // The plugin's SDK answers each hover and the drop.
      if (message.type === "desk:dragenter" || message.type === "desk:dragover") {
        const { drag, seq } = message;
        queueMicrotask(() =>
          broker.message(id, { type: "desk:drag-status", drag, seq, effect: "copy" }),
        );
      }
      if (message.type === "desk:drop") {
        const { drag } = message;
        queueMicrotask(() => broker.message(id, { type: "desk:drop-done", drag, effect: "copy" }));
      }
    },
    layer: { show() {}, move() {}, hide() {} },
  });
  broker.message("a.one", { type: "desk:drop-types", types: ["desk/paths"] });
  broker.message("b.two", { type: "desk:drop-types", types: ["desk/text"] });
  listenNative(page as Window, () => broker);
  return { page, posted };
}
type Position = Extract<DragDropEvent, { type: "drop" }>["position"];
const at = (x: number, y: number) => ({ x, y }) as Position;

describe("a drag from the OS", () => {
  it("reaches the plugin under the pointer as desk/paths, and the desk does not open it", async () => {
    const { page, posted } = deskPage();
    const run = vi.fn(async () => {});
    const dispose = installNativeFileDrops({
      ready: Promise.resolve(),
      commands: { run },
      report: vi.fn(),
      page,
      scale: () => 2,
    });
    handler({ payload: { type: "enter", paths: ["/Users/me/a.png"], position: at(200, 100) } });
    expect(posted["a.one"]?.[0]).toEqual({
      type: "desk:dragenter",
      drag: 1,
      seq: 1,
      types: ["desk/paths"],
      effectAllowed: ["copy", "link"],
      from: "os",
      x: 100,
      y: 50,
      keys: { alt: false, shift: false, ctrl: false, meta: false },
    });
    handler({ payload: { type: "over", position: at(220, 100) } });
    await Promise.resolve();
    handler({ payload: { type: "drop", paths: ["/Users/me/a.png"], position: at(220, 100) } });
    await vi.waitFor(() =>
      expect(posted["a.one"]?.at(-1)).toEqual({
        type: "desk:drop",
        drag: 1,
        x: 110,
        y: 50,
        keys: { alt: false, shift: false, ctrl: false, meta: false },
        effect: "copy",
        items: [{ type: "desk/paths", paths: [{ path: "/Users/me/a.png" }] }],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).not.toHaveBeenCalled();
    expect(posted["b.two"]).toEqual([]);
    dispose();
  });

  it("opens the file as before when the frame under it does not take paths", async () => {
    const { page, posted } = deskPage();
    const run = vi.fn(async () => {});
    const dispose = installNativeFileDrops({
      ready: Promise.resolve(),
      commands: { run },
      report: vi.fn(),
      page,
      scale: () => 1,
    });
    handler({ payload: { type: "enter", paths: ["/Users/me/a.png"], position: at(500, 10) } });
    handler({ payload: { type: "drop", paths: ["/Users/me/a.png"], position: at(500, 10) } });
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith("desk.files.open", { path: "/Users/me/a.png" }),
    );
    expect(posted["b.two"]).toEqual([]);
    dispose();
  });
});
