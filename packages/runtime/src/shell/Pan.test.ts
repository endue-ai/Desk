// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellCtx } from "./context";
import { mountPan, wheelPan } from "./Pan";
import { Store, sampleState } from "./state";

describe("the wheel's pan", () => {
  it("sends the wheel's own step, in pixels, lines of 16 or pages", () => {
    const sent: unknown[] = [];
    const ctx = {
      wm: {
        edit: (edits: unknown[]) => {
          sent.push(...edits);
          return Promise.resolve([]);
        },
      },
    } as unknown as ShellCtx;
    const wheel = (init: WheelEventInit) => new WheelEvent("wheel", init);
    // Never a pan worked out from the store's: two wheels before a publish are two steps.
    wheelPan(ctx, wheel({ deltaX: 5, deltaY: -3 }), 800);
    wheelPan(ctx, wheel({ deltaX: 5, deltaY: -3 }), 800);
    wheelPan(ctx, wheel({ deltaX: 1, deltaY: 2, deltaMode: 1 }), 800);
    wheelPan(ctx, wheel({ deltaX: 1, deltaY: 1, deltaMode: 2 }), 800);
    expect(sent).toEqual([
      { op: "pan-by", by: { x: -5, y: 3 } },
      { op: "pan-by", by: { x: -5, y: 3 } },
      { op: "pan-by", by: { x: -16, y: -32 } },
      { op: "pan-by", by: { x: -800, y: -800 } },
    ]);
  });
});

describe("the canvas hint", () => {
  let root: HTMLDivElement;
  let control: HTMLButtonElement;
  let dispose: () => void;

  beforeEach(() => {
    root = document.createElement("div");
    control = document.createElement("button");
    root.append(control);
    document.body.append(root);
    const ctx = {
      store: new Store(sampleState("en", 0)),
      tr: (key: string) => key,
    } as unknown as ShellCtx;
    dispose = mountPan(root, ctx);
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  const over = (target: Element) =>
    target.dispatchEvent(new Event("pointerover", { bubbles: true }));

  it("is the empty canvas's alone, never a control's tooltip", () => {
    expect(root.hasAttribute("title")).toBe(false);
    over(root);
    expect(root.title).toBe("panHint");
    over(control);
    expect(control.closest("[title]")).toBeNull();
  });
});

describe("the pan", () => {
  it("the pan mounts no button of its own", () => {
    // The way back to the origin is the strip's under the canvas map (MapStrip.ts, issue 296).
    const root = document.createElement("div");
    document.body.append(root);
    const store = new Store({ ...sampleState("en", 0), pan: { "1": { x: -300, y: -200 } } });
    const dispose = mountPan(root, { store, tr: (key: string) => key } as unknown as ShellCtx);
    expect(root.classList.contains("has-canvas")).toBe(true);
    expect(root.style.getPropertyValue("--pan-x")).toBe("-300px");
    expect(root.querySelector(".canvas-reset")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
    dispose();
    root.remove();
  });
});
