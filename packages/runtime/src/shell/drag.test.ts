// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draggable } from "./drag";

describe("pointer drags", () => {
  let handle: HTMLDivElement;
  let dispose: () => void;
  const handlers = { start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() };

  function pointer(target: EventTarget, type: string, x: number, id = 1) {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: 20,
    });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    handle = document.createElement("div");
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    document.body.append(handle);
    dispose = draggable(handle, handlers);
  });
  afterEach(() => {
    dispose();
    handle.remove();
    document.getSelection()?.removeAllRanges();
  });

  it("blocks native text selection as soon as an accepted handle is pressed", () => {
    const down = pointer(handle, "pointerdown", 10);
    expect(down.defaultPrevented).toBe(true);
    expect(handlers.start).not.toHaveBeenCalled();
  });

  it("leaves controls inside the title bar clickable and focusable", () => {
    dispose();
    dispose = draggable(handle, { ...handlers, accept: (e) => e.target === handle });
    const button = document.createElement("button");
    handle.append(button);
    expect(pointer(button, "pointerdown", 10).defaultPrevented).toBe(false);
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
  });

  it("clears an existing document selection only when a click becomes a drag", () => {
    handle.textContent = "Selected text";
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(handle);
    selection?.addRange(range);
    pointer(handle, "pointerdown", 10);
    pointer(window, "pointermove", 15);
    expect(selection?.toString()).toBe("Selected text");
    pointer(window, "pointermove", 30);
    expect(selection?.isCollapsed).toBe(true);
    pointer(window, "pointerup", 30);
    expect(selection?.isCollapsed).toBe(true);
  });

  it("captures before crossing a frame, but leaves clicks below the threshold alone", () => {
    pointer(handle, "pointerdown", 10);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    pointer(window, "pointermove", 15);
    pointer(window, "pointerup", 15);
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.end).not.toHaveBeenCalled();
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("ignores another pointer until the original pointer finishes", () => {
    pointer(handle, "pointerdown", 10);
    pointer(window, "pointermove", 60, 2);
    pointer(window, "pointerup", 60, 2);
    expect(handlers.start).not.toHaveBeenCalled();
    pointer(window, "pointermove", 30);
    pointer(window, "pointerup", 40);
    expect(handlers.start).toHaveBeenCalledOnce();
    expect(handlers.end).toHaveBeenCalledWith(30, 0, expect.any(PointerEvent));
  });

  for (const reason of ["pointercancel", "lostpointercapture", "blur", "Escape", "dispose"]) {
    it(`cancels on ${reason}, removes global state and never commits stale coordinates`, () => {
      pointer(handle, "pointerdown", 10);
      pointer(window, "pointermove", 30);
      expect(document.documentElement.classList.contains("is-grabbing")).toBe(true);
      if (reason === "dispose") dispose();
      else if (reason === "Escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      else if (reason === "blur") window.dispatchEvent(new Event("blur"));
      else pointer(reason === "lostpointercapture" ? handle : window, reason, 0);
      expect(handlers.cancel).toHaveBeenCalledOnce();
      expect(handlers.end).not.toHaveBeenCalled();
      expect(document.documentElement.classList.contains("is-grabbing")).toBe(false);
      pointer(window, "pointermove", 100);
      pointer(window, "pointerup", 100);
      expect(handlers.move).toHaveBeenCalledTimes(1);
      expect(handlers.end).not.toHaveBeenCalled();
    });
  }
});
