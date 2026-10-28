import { describe, expect, test } from "vitest";
import { modesFromFiles } from "./load";
import {
  copyMode,
  effectiveLayout,
  isDirty,
  leftBehind,
  saveAsNew,
  savedLayout,
  saveInto,
  uniqueId,
  validateMode,
} from "./model";
import type { Mode } from "./types";

const files = import.meta.glob("./sample/**/*.json", { eager: true });
const modes = modesFromFiles(files);
const get = (id: string) => modes.find((m) => m.manifest.id === id) as Mode;
const base = get("base");

describe("modes", () => {
  test("the samples are base plus Morning, Deep work, Review, Studio and Night, all valid", () => {
    expect(modes.map((m) => m.manifest.name)).toEqual([
      "Base",
      "Morning",
      "Deep work",
      "Review",
      "Studio",
      "Night",
    ]);
    for (const m of modes) expect(validateMode(m, modes)).toEqual([]);
  });

  test("layers: base, then the mode, then the desktop file, then the session", () => {
    const morning = get("morning");
    expect(savedLayout(morning, base, 1).surfaces).toEqual([]);
    expect(savedLayout(morning, base, 2).surfaces.map((s) => s.id)).toEqual([
      "calendar",
      "tomorrow",
    ]);
    expect(savedLayout(morning, base, 2).rail.visible).toBe(true);
    const moved = { ...savedLayout(morning, base, 2), eris: { x: 10, y: 10 } };
    expect(effectiveLayout(morning, base, 2, { 2: moved }).eris).toEqual({ x: 10, y: 10 });
  });

  test("a session change makes the mode dirty until saved into it", () => {
    const morning = get("morning");
    const session = { 1: { ...savedLayout(morning, base, 1), eris: { x: 1, y: 2 } } };
    expect(isDirty(morning, base, {})).toBe(false);
    expect(isDirty(morning, base, session)).toBe(true);
    const saved = saveInto(morning, session);
    expect(isDirty(saved, base, session)).toBe(false);
    expect(saved.manifest.version).toBe("1.1.0");
  });

  test("save as new keeps every desktop as it is now, under a new id", () => {
    const morning = get("morning");
    const fresh = saveAsNew(morning, base, {}, "Morning", "me", ["morning"]);
    expect(fresh.manifest).toMatchObject({ id: "morning-2", name: "Morning", extends: "base" });
    expect(savedLayout(fresh, base, 2).surfaces.map((s) => s.id)).toEqual(["calendar", "tomorrow"]);
  });

  test("copying empties agent bindings and remembers the author", () => {
    const copy = copyMode(get("morning"), "jin", ["morning"]);
    expect(copy.roles.roles.every((r) => r.agent === null)).toBe(true);
    expect(copy.manifest.copiedFrom).toEqual({ author: "me", id: "morning", version: "1.0.0" });
    expect(get("studio").roles.roles[0]?.agent).toBeNull();
  });

  test("a mode may hide the rail for every desktop: Night does", () => {
    for (const d of [1, 2, 3, 4] as const)
      expect(savedLayout(get("night"), base, d).rail.visible).toBe(false);
    expect(savedLayout(get("morning"), base, 1).rail.visible).toBe(true);
  });

  test("switching modes sends surfaces the next mode does not place to the drawer", () => {
    const sent = leftBehind(get("morning"), get("deep-work"), base, {});
    expect(sent.map((s) => s.id)).toEqual(["calendar", "tomorrow"]);
  });

  test("ids are slugs and unique", () => {
    expect(uniqueId("Deep work", ["deep-work"])).toBe("deep-work-2");
    expect(uniqueId("집중", [])).toBe("mode");
  });

  test("a mode can only extend base", () => {
    const bad = {
      ...get("night"),
      manifest: { ...get("night").manifest, extends: "morning" as "base" },
    };
    expect(validateMode(bad, modes)).toContain('extends must be "base" or null');
  });
});
