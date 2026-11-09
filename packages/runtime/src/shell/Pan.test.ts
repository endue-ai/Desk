// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellCtx } from "./context";
import { mountPan } from "./Pan";
import { Store, sampleState } from "./state";

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
