import { readFileSync } from "node:fs";
import type { PluginManifest, ProfileContribution } from "@endue-ai/bridge";
import { describe, expect, test } from "vitest";
import { effectiveLayout, isDirty, leftBehind, savedLayout, uniqueId } from "./model";
import { baseMode, LAYOUTS, MODE, profileMode, recipeOf } from "./profiles";
import type { Mode } from "./types";

// The sample profiles as desk.shell contributes them (plugins/shell/plugin.json).
const shell = JSON.parse(
  readFileSync(new URL("../../../../plugins/shell/plugin.json", import.meta.url), "utf8"),
) as PluginManifest;
const base = baseMode(shell.contributes?.settings?.[MODE]?.default);
const profiles = shell.contributes?.profiles ?? [];
const get = (id: string) =>
  profileMode(profiles.find((p) => p.id === id) as ProfileContribution, base);

describe("profiles as the shell lays them out", () => {
  test("the samples are Morning, Deep work, Review, Studio and Night, over the base", () => {
    expect(profiles.map((p) => p.name)).toEqual([
      "Morning",
      "Deep work",
      "Review",
      "Studio",
      "Night",
    ]);
    expect(base.manifest).toMatchObject({ id: "base", extends: null, author: "endue" });
    for (const p of profiles) expect(get(p.id).manifest.extends).toBe("base");
  });

  test("layers: the base, then the profile, then the desktop's own, then the session", () => {
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

  test("fields a profile leaves out come from the base", () => {
    expect(get("morning").eris).toEqual(base.eris);
    expect(get("morning").manifest.version).toBe("1.0.0");
    expect(get("studio").manifest.copiedFrom).toEqual({
      author: "jin",
      id: "studio",
      version: "2.1.0",
    });
    expect(get("studio").roles.roles[0]?.agent).toBeNull();
  });

  test("a session change makes the profile dirty until saved into it", () => {
    const morning = get("morning");
    const session = { 1: { ...savedLayout(morning, base, 1), eris: { x: 1, y: 2 } } };
    expect(isDirty(morning, base, {})).toBe(false);
    expect(isDirty(morning, base, session)).toBe(true);
    // desk.profiles.save keeps the profile's recipe and the moved desktops in one profile.
    const saved = profileMode(
      {
        id: "morning",
        name: "Morning",
        settings: { [MODE]: recipeOf(morning), [LAYOUTS]: session },
      },
      base,
    );
    expect(isDirty(saved, base, session)).toBe(false);
    expect(savedLayout(saved, base, 1).eris).toEqual({ x: 1, y: 2 });
  });

  test("a recipe lays the same desk out again", () => {
    const morning = get("morning");
    const again = profileMode(
      { id: "morning-2", name: "Morning", settings: { [MODE]: recipeOf(morning) } },
      base,
    );
    for (const d of [1, 2, 3, 4] as const)
      expect(savedLayout(again, base, d)).toEqual(savedLayout(morning, base, d));
  });

  test("a profile without a recipe (desk.profiles' own) lays out the base", () => {
    const focus: Mode = profileMode({ id: "focus", name: "Focus" }, base);
    expect(focus.manifest.icon).toBe(base.manifest.icon);
    expect(savedLayout(focus, base, 2).surfaces).toEqual([]);
  });

  test("a profile may hide the rail for every desktop: Night does", () => {
    for (const d of [1, 2, 3, 4] as const)
      expect(savedLayout(get("night"), base, d).rail.visible).toBe(false);
    expect(savedLayout(get("morning"), base, 1).rail.visible).toBe(true);
  });

  test("switching profiles sends surfaces the next one does not place to the drawer", () => {
    const sent = leftBehind(get("morning"), get("deep-work"), base, {});
    expect(sent.map((s) => s.id)).toEqual(["calendar", "tomorrow"]);
  });

  test("ids are slugs and unique", () => {
    expect(uniqueId("Deep work", ["deep-work"])).toBe("deep-work-2");
    expect(uniqueId("집중", [])).toBe("mode");
  });
});
