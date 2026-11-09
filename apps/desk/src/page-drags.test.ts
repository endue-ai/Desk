// @vitest-environment jsdom
// Drags from the OS on the CEF shell: the shell names the files when they enter, and the page
// follows the drag under a cover over its frames until it drops or leaves the window.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAG_ENTER, followPageDrags, type OsDrag } from "./page-drags";

type Handler = (event: { payload: unknown }) => void;

function shellSide() {
  const handlers = new Map<string, Handler>();
  const off = vi.fn();
  const listen = vi.fn(async (event: string, handler: Handler) => {
    handlers.set(event, handler);
    return off;
  }) as unknown as Parameters<typeof followPageDrags>[0]["listen"];
  const enter = (payload: unknown) => handlers.get(DRAG_ENTER)?.({ payload });
  return { listen, enter, off };
}

/** A drag event at (x, y) on `target`, as Chromium sends one (jsdom has no DragEvent). */
function drag(type: string, target: EventTarget, x = 0, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(event);
  return event;
}

const cover = () => document.querySelector<HTMLElement>("[data-desk-os-drag]");

afterEach(() => {
  document.body.replaceChildren();
});

describe("a drag from the OS on the CEF shell", () => {
  it("covers the page from the shell's word until the drop, which carries the paths", async () => {
    const side = shellSide();
    const heard: OsDrag[] = [];
    const stop = followPageDrags({
      doc: document,
      listen: side.listen,
      hear: (d) => heard.push(d),
      report: vi.fn(),
    });
    await Promise.resolve();
    // Moves before the shell named any files are not the desk's.
    expect(drag("dragover", document.body, 5, 5).defaultPrevented).toBe(false);
    side.enter({ paths: ["/Users/me/a.png", 7, "/Users/me/b.md"] });
    expect(cover()).not.toBeNull();
    expect(cover()?.style.position).toBe("fixed");
    const moved = drag("dragover", cover() as HTMLElement, 120, 40);
    expect(moved.defaultPrevented).toBe(true);
    const dropped = drag("drop", cover() as HTMLElement, 130, 45);
    expect(dropped.defaultPrevented).toBe(true);
    expect(heard).toEqual([
      { type: "enter", paths: ["/Users/me/a.png", "/Users/me/b.md"], position: { x: 0, y: 0 } },
      { type: "over", position: { x: 120, y: 40 } },
      { type: "drop", paths: ["/Users/me/a.png", "/Users/me/b.md"], position: { x: 130, y: 45 } },
    ]);
    expect(cover()).toBeNull();
    stop();
    expect(side.off).toHaveBeenCalledOnce();
  });

  it("ends when the drag leaves the window, and ignores leaves inside it", async () => {
    const side = shellSide();
    const heard: OsDrag[] = [];
    const stop = followPageDrags({
      doc: document,
      listen: side.listen,
      hear: (d) => heard.push(d),
      report: vi.fn(),
    });
    await Promise.resolve();
    side.enter({ paths: ["/a.md"] });
    drag("dragleave", document.body);
    expect(cover()).not.toBeNull();
    drag("dragleave", cover() as HTMLElement);
    expect(cover()).toBeNull();
    expect(heard.map((d) => d.type)).toEqual(["enter", "leave"]);
    // After it left, the page's own drags are its own again.
    expect(drag("drop", document.body).defaultPrevented).toBe(false);
    side.enter({ paths: [] });
    expect(cover()).toBeNull();
    stop();
  });

  it("stops following when disposed, even mid-drag", async () => {
    const side = shellSide();
    const hear = vi.fn();
    const stop = followPageDrags({ doc: document, listen: side.listen, hear, report: vi.fn() });
    await Promise.resolve();
    side.enter({ paths: ["/a.md"] });
    stop();
    expect(cover()).toBeNull();
    drag("drop", document.body);
    expect(hear).toHaveBeenCalledOnce();
  });
});
