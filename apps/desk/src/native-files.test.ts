// @vitest-environment jsdom
// Files from the OS on the CEF shell (#45): the picker through the shell's dialog command, and drags
// the shell names when they enter (`desk://drag-enter`) and the page follows under its cover, each
// drop opened in order once the desk is ready, or handed to the plugin under the pointer (ADR 0119).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DragBroker } from "../../../packages/runtime/src/dnd/broker";
import { listenNative } from "../../../packages/runtime/src/dnd/native";
import type { DndHostMessage } from "../../../packages/runtime/src/dnd/types";
import { installNativeFileDrops, pickNativeFile } from "./native-files";
import { DRAG_ENTER } from "./page-drags";

type Handler = (event: { payload: unknown }) => void;
const shell = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  off: vi.fn(),
  handlers: new Map<string, Handler>(),
}));
vi.mock("./host", () => ({ invoke: shell.invoke, listen: shell.listen }));

beforeEach(() => {
  vi.clearAllMocks();
  shell.handlers.clear();
  shell.invoke.mockResolvedValue(null);
  shell.listen.mockImplementation(async (event: string, handler: Handler) => {
    shell.handlers.set(event, handler);
    return shell.off;
  });
  document.body.replaceChildren();
});

/** A drag event at (x, y) on `target`, as Chromium sends one (jsdom has no DragEvent). */
const drag = (type: string, target: EventTarget, x = 0, y = 0) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
const cover = () => document.querySelector("[data-desk-os-drag]") as HTMLElement;
/** The shell's word that files from the OS entered the window. */
const enter = (paths: string[]) => shell.handlers.get(DRAG_ENTER)?.({ payload: { paths } });
/** Files dragged in from the OS and dropped at (x, y). */
const drop = (paths: string[], x = 0, y = 0) => {
  enter(paths);
  drag("drop", cover(), x, y);
};

describe("native file entry", () => {
  it("picks one local file through the shell's dialog command and preserves cancellation", async () => {
    expect(await pickNativeFile()).toBeNull();
    expect(shell.invoke).toHaveBeenCalledWith("plugin:dialog|open", {
      options: { multiple: false, directory: false },
    });
    shell.invoke.mockResolvedValue("C:\\Users\\Person\\notes.md");
    expect(await pickNativeFile()).toBe("C:/Users/Person/notes.md");
    shell.invoke.mockResolvedValue("/notes/a\\b.md");
    expect(await pickNativeFile()).toBe("/notes/a\\b.md");
    shell.invoke.mockResolvedValue("\\\\server\\share\\notes.md");
    expect(await pickNativeFile()).toBe("//server/share/notes.md");
    shell.invoke.mockResolvedValue("relative.md");
    expect(await pickNativeFile()).toBeNull();
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
    expect(shell.off).toHaveBeenCalledOnce();
    expect(cover()).toBeNull();
  });

  it("tells the page each phase in CSS pixels, and ignores hover, leave and browser-like paths", async () => {
    const run = vi.fn(async () => {});
    const page = new EventTarget();
    const seen: unknown[] = [];
    page.addEventListener("desk:native-drag", (event) => seen.push((event as CustomEvent).detail));
    const dispose = installNativeFileDrops({
      ready: Promise.resolve(),
      commands: { run },
      report: vi.fn(),
      page,
    });
    enter(["/one.md"]);
    drag("dragover", cover(), 100, 50);
    drag("dragleave", cover());
    drop(["name-only.md", "https://example.com/file.md", "", "/invalid\0.md"], 110, 60);
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    expect(seen).toMatchObject([
      { phase: "enter", paths: ["/one.md"] },
      { phase: "over", x: 100, y: 50 },
      { phase: "leave" },
      { phase: "enter", paths: [] },
      { phase: "drop", paths: [], x: 110, y: 60 },
    ]);
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
    expect(shell.off).toHaveBeenCalledOnce();
  });

  it("disposal cancels queued paths and also unlistens when registration resolves late", async () => {
    let registered: (off: () => void) => void = () => {};
    shell.listen.mockImplementation((event: string, handler: Handler) => {
      shell.handlers.set(event, handler);
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
    registered(shell.off);
    ready();
    await vi.waitFor(() => expect(shell.off).toHaveBeenCalledOnce());
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

describe("a drag from the OS", () => {
  it("reaches the plugin under the pointer as desk/paths, and the desk does not open it", async () => {
    const { page, posted } = deskPage();
    const run = vi.fn(async () => {});
    const dispose = installNativeFileDrops({
      ready: Promise.resolve(),
      commands: { run },
      report: vi.fn(),
      page,
    });
    // The shell's word comes before the page's first dragover: the drag enters where it was last.
    enter(["/Users/me/a.png"]);
    expect(posted["a.one"]?.[0]).toEqual({
      type: "desk:dragenter",
      drag: 1,
      seq: 1,
      types: ["desk/paths"],
      effectAllowed: ["copy", "link"],
      from: "os",
      x: 0,
      y: 0,
      keys: { alt: false, shift: false, ctrl: false, meta: false },
    });
    drag("dragover", cover(), 100, 50);
    await Promise.resolve();
    drag("drop", cover(), 110, 50);
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
    });
    enter(["/Users/me/a.png"]);
    drag("dragover", cover(), 500, 10);
    await Promise.resolve();
    drag("drop", cover(), 500, 10);
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith("desk.files.open", { path: "/Users/me/a.png" }),
    );
    expect(posted["b.two"]).toEqual([]);
    dispose();
  });
});
