import { describe, expect, it } from "vitest";
import { tiles } from "../ui/tiles.js";

type Info = {
  id: string;
  status: "ready" | "failed";
  enabled: boolean;
  builtIn: boolean;
  revision: number;
  manifest?: Record<string, unknown>;
  error?: string;
};

const ui = (id: string, name: string, placement?: string, extra: Partial<Info> = {}): Info => ({
  id,
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 1,
  manifest: {
    id,
    name,
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    ...(placement === undefined ? {} : { surfaces: [{ id: "main", placement }] }),
  },
  ...extra,
});

describe("dock tiles", () => {
  it("shows the plugins that open on the desk, in list order", () => {
    const list = [
      ui("example.notes", "Notes", "center"),
      ui("example.clock", "Clock", "floating"),
      ui("example.bare", "Bare"),
    ];
    expect(tiles(list).map((tile) => tile.id)).toEqual([
      "example.notes",
      "example.clock",
      "example.bare",
    ]);
  });

  it("leaves out the desk's own chrome and plugins without a surface", () => {
    const list = [
      ui("endue.dock", "Dock", "bottom"),
      ui("endue.eris", "Eris", "right"),
      ui("endue.toolbar", "Status", "right"),
      ui("endue.sidebar", "Plugins", "left"),
      ui("endue.onboarding", "Welcome", "overlay"),
      {
        ...ui("example.logic", "Logic"),
        manifest: { id: "example.logic", version: "0.1.0", kind: "logic", entry: "a.wasm" },
      },
      ui("example.notes", "Notes", "center"),
    ];
    expect(tiles(list).map((tile) => tile.id)).toEqual(["example.notes"]);
  });

  it("marks a tile open when its plugin is enabled and ready", () => {
    const [on, off] = tiles([
      ui("example.on", "On", "center"),
      ui("example.off", "Off", "center", { enabled: false }),
    ]);
    expect(on).toMatchObject({ open: true, available: true });
    expect(off).toMatchObject({ open: false, available: true });
  });

  it("keeps a failed plugin's tile but makes it unavailable, with the reason", () => {
    const [broken] = tiles([
      ui("example.broken", "Broken", "center", { status: "failed", error: "entry is missing" }),
    ]);
    expect(broken).toMatchObject({ open: false, available: false, reason: "entry is missing" });
    const [silent] = tiles([ui("example.silent", "Silent", "center", { status: "failed" })]);
    expect(silent?.reason).toBe("failed");
  });

  it("skips a failed plugin without a manifest, since nothing says where it opens", () => {
    const list: Info[] = [
      { id: "example.gone", status: "failed", enabled: true, builtIn: false, revision: 1 },
    ];
    expect(tiles(list)).toEqual([]);
  });

  it("names a tile after the plugin and shows the first letter as its initial", () => {
    const [named, unnamed, korean] = tiles([
      ui("example.notes", "notes", "center"),
      {
        ...ui("example.anon", "", "center"),
        manifest: { id: "example.anon", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
      },
      ui("example.memo", "메모", "center"),
    ]);
    expect(named).toMatchObject({ name: "notes", initial: "N" });
    expect(unnamed).toMatchObject({ name: "example.anon", initial: "E" });
    expect(korean).toMatchObject({ name: "메모", initial: "메" });
  });
});
