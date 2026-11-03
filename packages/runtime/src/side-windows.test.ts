// @vitest-environment jsdom
import { expect, it } from "vitest";
import { browserCore } from "./bridge/core";
import { ManualClock } from "./clock";
import { createRuntime } from "./runtime";

it("left and right surfaces become ordinary hosted windows, with buffers and no edge bars", async () => {
  const root = document.createElement("div");
  const windows = document.createElement("div");
  document.body.append(root, windows);
  const adopted = new Map<string, HTMLElement>();
  const core = browserCore({ manifests: [] });
  const runtime = createRuntime({
    root,
    bridge: core.client,
    clock: new ManualClock(),
    windows: {
      adopt: (spec, section) => {
        adopted.set(spec.id, section);
        windows.append(section);
      },
      release: (id) => {
        adopted.delete(id);
      },
    },
  });
  try {
    await runtime.ready;
    for (const placement of ["left", "right"]) {
      runtime.openSurface({ id: placement, title: placement, placement });
      expect(adopted.get(placement)?.classList.contains("desk-surface--windowed")).toBe(true);
      expect(runtime.buffers.list().some((b) => b.plugin === placement && b.surface)).toBe(true);
      expect(runtime.layout().cells[placement]).toBeUndefined();
    }
    expect(root.querySelector(".desk-edge")).toBeNull();
    for (const placement of ["overlay", "bottom"]) {
      runtime.openSurface({ id: placement, title: placement, placement });
      expect(adopted.has(placement)).toBe(false);
    }
    expect(
      root.querySelector('[data-surface="bottom"]')?.classList.contains("desk-surface--edge"),
    ).toBe(true);
    runtime.closeSurface("left");
    expect(adopted.has("left")).toBe(false);
  } finally {
    runtime.dispose();
    root.remove();
    windows.remove();
  }
});
