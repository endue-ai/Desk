// desk.windows.focus from the palette's Windows group (#304): a window on another desktop brings its
// desktop to the front first, then takes the focus; one nowhere is still refused.
import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { Commands } from "../commands";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import type { Ctx } from "../shell/actions";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import { defineArrangeCommands, FOCUS } from "./commands";

const at = (id: string): SurfacePlacement => ({
  id,
  plugin: "endue.notes",
  x: 10,
  y: 20,
  w: 400,
  h: 300,
  pinned: false,
});
const place = (desktop: DesktopId, placement: SurfacePlacement): Edit => ({
  op: "place",
  desktop,
  placement,
});

describe("desk.windows.focus", () => {
  it("focusing a window on another desktop switches desktops first", async () => {
    const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
    const stub = browserStub({ ...registry.handlers });
    const commands = new Commands(new BridgeClient(stub));
    const store = new Store(sampleState("en", 0));
    const wm = testWindowManager();
    wm.connect((published) => takeDesk(store, published));
    await wm.edit([
      place("1", at("notes")),
      place("2", at("tomorrow")),
      { op: "focus", window: "notes" },
    ]);
    const keys: string[] = [];
    const ctx = {
      store,
      wm,
      runtime: { commands, shortcuts: { focused: null }, focusSurface() {}, followSurface() {} },
      bridge: undefined,
      now: () => 0,
      wall: () => 0,
    } as unknown as Ctx;
    defineArrangeCommands(ctx, (window) => keys.push(window));
    await commands.settled();
    expect(store.get().wm.here).toBe("1");
    expect(await commands.run(FOCUS, { window: "tomorrow" })).toEqual({ window: "tomorrow" });
    expect(store.get().wm.here).toBe("2");
    expect(store.get().focused).toBe("tomorrow");
    expect(keys).toEqual(["tomorrow"]);
    await expect(commands.run(FOCUS, { window: "gone" })).rejects.toThrow(/not on this desktop/);
  });
});
