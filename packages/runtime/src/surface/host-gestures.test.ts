// @vitest-environment jsdom
// A window's gestures, which the window manager runs (the compositor, ADR 0153): the page still
// finds what a press lands on, as the runtime's handles accept it (the title bar away from its
// buttons, one of the eight grips, Shift on the canvas or a title bar), and tells the host with the
// press's point; it moves nothing itself, not even under a drag.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "../shell/context";
import { mountPan } from "../shell/Pan";
import { Store, sampleState } from "../shell/state";
import { hostGestures } from "./host-gestures";

const placement: SurfacePlacement = {
  id: "window-1",
  plugin: "endue.window",
  x: 480,
  y: 240,
  w: 480,
  h: 320,
  pinned: false,
};

function press(target: Element, x: number, y: number, shiftKey = false) {
  const init = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 };
  target.dispatchEvent(
    new PointerEvent("pointerdown", { ...init, clientX: x, clientY: y, shiftKey }),
  );
  for (const [type, dx] of [
    ["pointermove", 40],
    ["pointerup", 40],
  ] as const) {
    window.dispatchEvent(
      new PointerEvent(type, { ...init, clientX: x + dx, clientY: y, shiftKey }),
    );
  }
}

describe("gestures a host runs", () => {
  let root: HTMLDivElement;
  let el: HTMLElement;
  let bar: HTMLElement;
  let button: HTMLButtonElement;
  let p: SurfacePlacement;
  let dispose: () => void;
  const host = { grab: vi.fn(), run: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    p = { ...placement };
    root = document.createElement("div");
    el = document.createElement("section");
    bar = document.createElement("header");
    bar.className = "surface-title";
    button = document.createElement("button");
    bar.append(button);
    el.append(bar);
    root.append(el);
    document.body.append(root);
    for (const node of [bar, el, root]) {
      node.setPointerCapture = vi.fn();
      node.releasePointerCapture = vi.fn();
    }
    const ctx = {
      store: new Store(sampleState("en", 0)),
      tr: (key: string) => key,
      wm: host,
    } as unknown as ShellCtx;
    const off = [hostGestures(el, bar, () => p, ctx), mountPan(root, ctx)];
    dispose = () => {
      for (const o of off) o();
    };
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  it("a press on the title bar starts a move at the press's point, and nothing moves here", () => {
    press(bar, 560, 260);
    expect(host.grab.mock.calls).toEqual([
      [
        { kind: "move", window: "window-1" },
        { x: 560, y: 260 },
      ],
    ]);
    expect(el.style.left).toBe("");
    expect(el.parentElement?.querySelector(".surface-snap")).toBeNull();
  });

  it("each grip starts a resize from it", () => {
    const grips = [...el.querySelectorAll<HTMLElement>(".surface-resize")];
    expect(grips.map((g) => g.dataset.resize)).toEqual([
      "n",
      "ne",
      "e",
      "se",
      "s",
      "sw",
      "w",
      "nw",
    ]);
    for (const grip of grips) {
      grip.setPointerCapture = vi.fn();
      grip.releasePointerCapture = vi.fn();
      press(grip, 700, 400);
    }
    const kinds = host.grab.mock.calls.map(([g]) => `${g.kind} ${g.grip}`);
    expect(kinds).toEqual(grips.map((g) => `resize ${g.dataset.resize}`));
  });

  it("a button in the title bar, a pinned window and Shift start no move", () => {
    press(button, 900, 260);
    p = { ...p, pinned: true };
    press(bar, 560, 260);
    expect(host.grab).not.toHaveBeenCalled();
    p = { ...p, pinned: false };
    press(bar, 560, 260, true);
    // Shift on a title bar pans instead.
    expect(host.grab.mock.calls).toEqual([[{ kind: "pan" }, { x: 560, y: 260 }]]);
  });

  it("Shift on the empty canvas starts a pan; a plain press there does not", () => {
    press(root, 100, 700);
    expect(host.grab).not.toHaveBeenCalled();
    press(root, 100, 700, true);
    expect(host.grab.mock.calls).toEqual([[{ kind: "pan" }, { x: 100, y: 700 }]]);
  });
});
