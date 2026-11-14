// What the launcher lists and in which order (ui/model.js).
import { describe, expect, it } from "vitest";
import type { PluginInfo } from "../../../packages/bridge/src/index";
import { KEPT, matching, moved, opened, RECENT, recent, tiles } from "../ui/model.js";

const ui = (id: string, name: string, placement?: string, more: Partial<PluginInfo> = {}) =>
  ({
    id,
    status: "ready",
    enabled: true,
    builtIn: true,
    revision: 1,
    manifest: {
      id,
      name,
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      ...(placement ? { surfaces: [{ id: "main", placement }] } : {}),
    },
    ...more,
  }) as PluginInfo;

const plugins = [
  ui("endue.terminal", "Terminal", "center"),
  ui("endue.browser", "Browser", "center", { enabled: false }),
  ui("endue.eris", "Eris", "floating"),
  ui("endue.notes", "Notes"),
  ui("endue.sidebar", "Plugins", "left"),
  ui("endue.toolbar", "Status", "right"),
  ui("desk.palette", "Palette", "overlay"),
  ui("endue.launcher", "Launcher", "overlay"),
  ui("endue.git", "Git", "center", { status: "failed", error: "entry is missing" }),
  {
    ...ui("desk.display", "Display"),
    manifest: { id: "desk.display", version: "0.1.0", kind: "policy" },
  } as PluginInfo,
];

describe("the launcher's tiles", () => {
  const all = tiles(plugins);

  it("are the plugins that open on the desk, by name, without the desk's chrome or itself", () => {
    expect(all.map((t) => t.name)).toEqual(["Browser", "Eris", "Git", "Notes", "Terminal"]);
    expect(all.find((t) => t.id === "endue.browser")).toMatchObject({
      initial: "B",
      open: false,
      available: true,
    });
    expect(all.find((t) => t.id === "endue.git")).toMatchObject({
      available: false,
      reason: "entry is missing",
    });
  });

  it("are filtered by what is typed: names that start with it, then hold it, then ids", () => {
    expect(matching(all, "").map((t) => t.name)).toEqual(all.map((t) => t.name));
    expect(matching(all, " NO ").map((t) => t.name)).toEqual(["Notes"]);
    expect(matching(all, "er").map((t) => t.name)).toEqual(["Eris", "Browser", "Terminal"]);
    expect(matching(all, "endue.g").map((t) => t.name)).toEqual(["Git"]);
    expect(matching(all, "zzz")).toEqual([]);
  });

  it("show what was opened lately first, only what is still installed, six at most", () => {
    expect(recent(all, ["endue.notes", "gone.plugin", "endue.browser"]).map((t) => t.name)).toEqual(
      ["Notes", "Browser"],
    );
    expect(recent(all, undefined)).toEqual([]);
    expect(recent(all, "endue.notes")).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => ui(`a.p${i}`, `P${i}`));
    expect(
      recent(
        tiles(many),
        many.map((p) => p.id),
      ),
    ).toHaveLength(RECENT);
  });

  it("remember an opened plugin first and once, and no more than they keep", () => {
    expect(opened(["a.b", "c.d"], "c.d")).toEqual(["c.d", "a.b"]);
    expect(opened(undefined, "a.b")).toEqual(["a.b"]);
    const full = Array.from({ length: KEPT }, (_, i) => `p.n${i}`);
    expect(opened(full, "new.one")).toHaveLength(KEPT);
    expect(opened(full, "new.one")[0]).toBe("new.one");
  });

  it("move the selection through a grid, staying where there is no tile", () => {
    // Seven tiles, three a row: 0 1 2 / 3 4 5 / 6.
    expect(moved(7, 1, "right", 3)).toBe(2);
    expect(moved(7, 0, "left", 3)).toBe(0);
    expect(moved(7, 1, "down", 3)).toBe(4);
    expect(moved(7, 4, "down", 3)).toBe(4);
    expect(moved(7, 3, "down", 3)).toBe(6);
    expect(moved(7, 6, "up", 3)).toBe(3);
    expect(moved(7, 6, "right", 3)).toBe(6);
    expect(moved(0, 0, "down", 3)).toBe(0);
  });
});
