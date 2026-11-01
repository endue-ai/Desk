import type { DragDropEvent } from "@tauri-apps/api/webview";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    drop(["name-only.md", "https://example.com/file.md", ""]);
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    dispose();
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
