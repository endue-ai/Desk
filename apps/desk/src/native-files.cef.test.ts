// @vitest-environment jsdom
// The file picker and drags from the OS on the CEF shell (#45): the shell's own command for the
// dialog and its word when files enter, never a Tauri call.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installNativeFileDrops, pickNativeFile } from "./native-files";
import { DRAG_ENTER } from "./page-drags";

type Handler = (event: { payload: unknown }) => void;
const cef = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, Handler>(),
  tauri: vi.fn(),
}));
vi.mock("./host", () => ({
  shell: "cef",
  invoke: cef.invoke,
  listen: async (event: string, handler: Handler) => {
    cef.handlers.set(event, handler);
    return () => cef.handlers.delete(event);
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: cef.tauri }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: cef.tauri }));

beforeEach(() => {
  vi.clearAllMocks();
  cef.handlers.clear();
  document.body.replaceChildren();
});

const drag = (type: string, target: EventTarget, x = 0, y = 0) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );

describe("files from the OS on the CEF shell", () => {
  it("picks one local file through the shell's dialog command", async () => {
    cef.invoke.mockResolvedValue(null);
    expect(await pickNativeFile()).toBeNull();
    expect(cef.invoke).toHaveBeenCalledWith("plugin:dialog|open", {
      options: { multiple: false, directory: false },
    });
    cef.invoke.mockResolvedValue("C:\\Users\\Person\\notes.md");
    expect(await pickNativeFile()).toBe("C:/Users/Person/notes.md");
    cef.invoke.mockResolvedValue("relative.md");
    expect(await pickNativeFile()).toBeNull();
    expect(cef.tauri).not.toHaveBeenCalled();
  });

  it("opens the files dropped where no plugin takes them, in CSS pixels", async () => {
    const run = vi.fn(async () => {});
    const page = new EventTarget();
    const seen: unknown[] = [];
    page.addEventListener("desk:native-drag", (event) => {
      seen.push((event as CustomEvent).detail);
    });
    const dispose = installNativeFileDrops({
      ready: Promise.resolve(),
      commands: { run },
      report: vi.fn(),
      page,
      doc: document,
      // Tauri's positions were physical; the page's own are CSS pixels already.
      scale: () => 2,
    });
    await Promise.resolve();
    cef.handlers.get(DRAG_ENTER)?.({ payload: { paths: ["/one.md", "/one.md", "name-only.md"] } });
    const cover = document.querySelector("[data-desk-os-drag]") as HTMLElement;
    drag("dragover", cover, 100, 50);
    drag("drop", cover, 110, 60);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run).toHaveBeenCalledWith("desk.files.open", { path: "/one.md" });
    expect(seen).toMatchObject([
      { phase: "enter", paths: ["/one.md"] },
      { phase: "over", x: 100, y: 50 },
      { phase: "drop", paths: ["/one.md"], x: 110, y: 60 },
    ]);
    expect(cef.tauri).not.toHaveBeenCalled();
    dispose();
    expect(cef.handlers.has(DRAG_ENTER)).toBe(false);
  });
});
