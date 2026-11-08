import { readFileSync } from "node:fs";
import type { PluginManifest, ProfileContribution } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { isDirty, savedLayout } from "../modes/model";
import { baseMode, LAYOUTS, MODE, profileMode, recipeOf } from "../modes/profiles";
import type { DesktopLayout } from "../modes/types";
import { readCurrent, readMoved, readPan, readRecipe, writeMoved } from "./migrate";
import { defaultDesktops } from "./model";

const shell = JSON.parse(
  readFileSync(new URL("../../../../plugins/shell/plugin.json", import.meta.url), "utf8"),
) as PluginManifest;
const base = baseMode(shell.contributes?.settings?.[MODE]?.default);

const notes = { id: "notes", plugin: "endue.notes", x: 140, y: 260, w: 380, h: 300, pinned: false };
const calendar = { ...notes, id: "calendar", plugin: "endue.calendar", x: 120, y: 240 };
const moved: DesktopLayout = {
  surfaces: [{ ...notes, x: 600 }],
  eris: { x: 10, y: 20 },
  rail: { visible: true },
  drawer: { visible: false },
};

/** A profile as the four-desktop desk saved it: layouts by desktop number, moves by number too. */
const fourDesktops: ProfileContribution = {
  id: "mine",
  name: "Mine",
  settings: {
    [MODE]: {
      icon: "target",
      desktop: { rail: { visible: false } },
      desktops: { "2": { surfaces: [calendar] }, "4": { surfaces: [notes], eris: { x: 1, y: 2 } } },
    },
    [LAYOUTS]: { "3": moved },
  },
};

describe("four-desktop data loads as four named desktops", () => {
  it("a profile saved by the four-desktop desk: the same layouts on desktops named 1 to 4", () => {
    const mode = profileMode(fourDesktops, base);
    expect(mode.list).toEqual(defaultDesktops());
    expect(mode.list.map((d) => d.name)).toEqual(["1", "2", "3", "4"]);
    expect(savedLayout(mode, base, "1").surfaces).toEqual([]);
    expect(savedLayout(mode, base, "1").rail.visible).toBe(false);
    expect(savedLayout(mode, base, "2").surfaces).toEqual([calendar]);
    expect(savedLayout(mode, base, "3")).toEqual(moved);
    expect(savedLayout(mode, base, "4")).toMatchObject({ surfaces: [notes], eris: { x: 1, y: 2 } });
    // A number still names a desktop by its position.
    expect(savedLayout(mode, base, 2)).toEqual(savedLayout(mode, base, "2"));
  });

  it("the sample profiles, kept by number, load unchanged", () => {
    const morning = profileMode(
      shell.contributes?.profiles?.find((p) => p.id === "morning") as ProfileContribution,
      base,
    );
    expect(morning.list).toEqual(defaultDesktops());
    expect(savedLayout(morning, base, "2").surfaces.map((s) => s.id)).toEqual([
      "calendar",
      "tomorrow",
    ]);
    expect(savedLayout(morning, base, "3").surfaces.map((s) => s.id)).toEqual(["notes"]);
  });

  it("a session saved by the four-desktop desk: its moved desktops by number, its pan, its desktop", () => {
    const session = readMoved({ "2": moved, "9": "not a layout" });
    expect(session).toEqual({ layouts: { "2": moved } });
    expect(readPan({ "1": { x: -40, y: 8 }, "2": { x: Number.NaN, y: 0 }, "3": "x" })).toEqual({
      "1": { x: -40, y: 8 },
    });
    expect(readCurrent(3, defaultDesktops())).toBe("3");
    expect(readCurrent(7, defaultDesktops())).toBeUndefined();
    expect(readCurrent("2", defaultDesktops())).toBe("2");
  });

  it("saving writes the list, and the list loads the same desk again", () => {
    const mode = profileMode(fourDesktops, base);
    const recipe = recipeOf(mode);
    expect(recipe.desktops.map((d) => [d.id, d.name, d.layout !== undefined])).toEqual([
      ["1", "1", false],
      ["2", "2", true],
      ["3", "3", true],
      ["4", "4", true],
    ]);
    const again = profileMode({ id: "again", name: "Again", settings: { [MODE]: recipe } }, base);
    for (const d of mode.list)
      expect(savedLayout(again, base, d.id)).toEqual(savedLayout(mode, base, d.id));
  });

  it("a changed list in the session loads with its names, order and layouts", () => {
    const list = [
      { id: "3", name: "Write" },
      { id: "1", name: "1" },
      { id: "5", name: "Research" },
    ];
    const stored = writeMoved(list, { "5": moved });
    expect(stored.desktops[2]).toEqual({ id: "5", name: "Research", layout: moved });
    expect(readMoved(JSON.parse(JSON.stringify(stored)))).toEqual({
      list,
      layouts: { "5": moved },
    });
    const mode = profileMode({ ...fourDesktops, settings: { [LAYOUTS]: stored } }, base);
    expect(mode.list).toEqual(list);
    expect(isDirty(mode, base, {}, list)).toBe(false);
  });

  it("ignores what is not a list: duplicate ids, entries that are not desktops", () => {
    expect(
      readRecipe([
        { id: "1", name: "a" },
        { id: "1", name: "b" },
      ]),
    ).toEqual({ layouts: {} });
    expect(readRecipe([{ name: "no id" }])).toEqual({ layouts: {} });
    expect(readRecipe("nonsense")).toEqual({ layouts: {} });
    expect(readRecipe([{ id: "x", name: "" }]).list).toEqual([{ id: "x", name: "x" }]);
  });
});
