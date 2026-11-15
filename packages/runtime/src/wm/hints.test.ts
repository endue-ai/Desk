// A plugin's window hints (ADR 0226) from its manifest to its window on the canvas: the runtime's
// window host hands them to desk-wm (as WebAssembly) with the plugin's surface, and the window
// opens at the page's first size, stops at its smallest and keeps a size the plugin fixed.
import { describe, expect, it } from "vitest";
import { windowsOf } from "../shell/actions";
import { Store, sampleState } from "../shell/state";
import { pluginWindows } from "../surface/host";
import { windowHints } from "./hints";
import { testWindowManager } from "./testing";
import { takeDesk } from "./view";

const epoch = Date.parse("2026-11-15T09:00:00.000Z");
/** A window on the canvas is its title bar (40 px) and border (1 px a side) larger than its page. */
const framed = (w: number, h: number) => ({ w: w + 2, h: h + 42 });

async function adopted(window: Parameters<typeof windowHints>[0]) {
  const store = new Store(sampleState("en", epoch));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const host = pluginWindows(store, () => wm);
  host.adopt({ id: "example.app", title: "App", window }, {} as HTMLElement);
  await wm.edit([]);
  const size = () => {
    const p = windowsOf(store.get()).find((w) => w.id === "example.app");
    return p && { w: p.w, h: p.h };
  };
  return { wm, size };
}

describe("a plugin's window hints", () => {
  it("reads the manifest's block as the window manager's hints", () => {
    expect(
      windowHints({
        size: { width: 480, height: 360 },
        minSize: { width: 320, height: 240 },
        resizable: false,
        opens: "out",
      }),
    ).toEqual({ size: { w: 480, h: 360 }, min: { w: 320, h: 240 }, fixed: true });
    expect(windowHints({ resizable: true, opens: "out" })).toBeUndefined();
    expect(windowHints(undefined)).toBeUndefined();
  });

  it("opens the window at the page's first size", async () => {
    const { size } = await adopted({ size: { width: 480, height: 360 } });
    expect(size()).toEqual(framed(480, 360));
  });

  it("stops a resize at the page's smallest size", async () => {
    const { wm, size } = await adopted({
      size: { width: 480, height: 360 },
      minSize: { width: 320, height: 240 },
    });
    wm.run({ op: "resize", dw: -1000, dh: -1000 }, "example.app");
    await wm.edit([]);
    expect(size()).toEqual(framed(320, 240));
  });

  it("leaves a window its plugin fixed at the size it opened with", async () => {
    const { wm, size } = await adopted({ size: { width: 480, height: 360 }, resizable: false });
    wm.run({ op: "resize", dw: 200, dh: 200 }, "example.app");
    await wm.edit([]);
    expect(size()).toEqual(framed(480, 360));
  });
});
