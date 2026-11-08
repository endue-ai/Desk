import { describe, expect, it } from "vitest";
import { baseMode } from "../modes/profiles";
import type { Mode, SurfacePlacement } from "../modes/types";
import { defaultPlacement, editAt, layoutOf, openSurface, stash, switched } from "./actions";
import { type DrawerItem, Store, sampleState } from "./state";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const calendar = defaultPlacement("calendar");

/** A profile over the base that lays `surfaces` on desktop 2. */
function profile(id: string, surfaces: SurfacePlacement[]): Mode {
  const base = baseMode(undefined);
  return {
    ...base,
    manifest: { ...base.manifest, id, name: id, extends: "base" },
    desktops: { "2": { surfaces } },
  };
}

const modes = () => [baseMode(undefined), profile("morning", [calendar]), profile("focus", [])];

/** A store over the sample state with the two profiles, and a runtime with an empty session layer. */
function ctx() {
  const store = new Store({ ...sampleState("en", epoch), modes: modes(), modeId: "morning" });
  return {
    store,
    runtime: { settings: { reset() {}, layer: () => ({}) } } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

const drawerIds = (store: Store) => store.get().drawer.map((d) => d.placement?.id ?? d.id);
const inDrawer = (placement: SurfacePlacement): DrawerItem => ({
  id: `surface-${placement.id}`,
  kind: "surface",
  name: placement.id,
  at: epoch,
  placement,
});

describe("the drawer holds only what is away (#4)", () => {
  it("lets go of a surface when a profile that places it is in force again", () => {
    const c = ctx();
    switched(c, modes(), "focus");
    expect(drawerIds(c.store)).toContain("calendar");
    switched(c, modes(), "morning");
    expect(layoutOf(c.store.get(), "2").surfaces.map((p) => p.id)).toEqual(["calendar"]);
    expect(drawerIds(c.store)).not.toContain("calendar");
  });

  it("lets go of a surface a layout places on another desktop", () => {
    const c = ctx();
    openSurface(c, "notes");
    stash(c, "notes");
    expect(drawerIds(c.store)).toContain("notes");
    editAt(c, "3", (l) => ({ ...l, surfaces: [...l.surfaces, defaultPlacement("notes")] }));
    expect(drawerIds(c.store)).not.toContain("notes");
  });

  it("drops a placed surface from a drawer that comes back from a saved session", () => {
    const c = ctx();
    c.store.set({ drawer: [inDrawer(calendar), ...c.store.get().drawer] });
    expect(drawerIds(c.store)).not.toContain("calendar");
  });

  it("starts without a placed surface in the drawer it was seeded with", () => {
    const seed = sampleState("en", epoch);
    const store = new Store({
      ...seed,
      modes: modes(),
      modeId: "morning",
      drawer: [inDrawer(calendar), ...seed.drawer],
    });
    expect(drawerIds(store)).toEqual(seed.drawer.map((d) => d.id));
  });

  it("keeps what is away: a stashed surface, files and recent items", () => {
    const c = ctx();
    openSurface(c, "notes");
    stash(c, "notes");
    expect(drawerIds(c.store)).toEqual(["notes", "file-brief", "recent-weather", "recent-summary"]);
  });
});
