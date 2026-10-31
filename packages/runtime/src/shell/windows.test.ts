import { describe, expect, it } from "vitest";
import { FREE } from "../surface/geometry";
import { layoutOf, openSurface } from "./actions";
import { Store, sampleState } from "./state";
import { toggleMaximize } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

function ctx() {
  const store = new Store(sampleState("en", epoch));
  return {
    store,
    runtime: { shortcuts: { focused: null }, focusSurface() {} } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

describe("maximize", () => {
  it("fills the free area and keeps the place to restore; a second call restores it", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    toggleMaximize(c, "calendar");
    const full = layoutOf(c.store.get()).surfaces[0];
    expect(full).toMatchObject({
      ...FREE,
      restore: { x: before?.x, y: before?.y, w: before?.w, h: before?.h },
    });
    toggleMaximize(c, "calendar");
    const back = layoutOf(c.store.get()).surfaces[0];
    expect(back).toMatchObject({ x: before?.x, y: before?.y, w: before?.w, h: before?.h });
    expect(back?.restore).toBeUndefined();
  });
});
