import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { decide } from "./display";
import { defaultLayout, place } from "./layout";

const defaults =
  (
    JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../plugins/display/plugin.json"), "utf8"),
    ) as PluginManifest
  ).contributes?.display?.map((rule) => ({ ...rule, owner: "desk.display" })) ?? [];

describe("decide", () => {
  it("keeps the manifest's placement through the default rules", () => {
    const at = (placement: "left" | "right" | "bottom" | "overlay" | "center") =>
      decide(defaults, { plugin: "example.p", surface: "main", placement });
    expect(at("left")).toMatchObject({ area: "left", pixels: 240, focus: false });
    expect(at("right")).toMatchObject({ area: "right", pixels: 320 });
    expect(at("bottom")).toMatchObject({ area: "bottom", pixels: 72 });
    expect(at("overlay")).toMatchObject({ area: "overlay", focus: true });
    expect(at("center")).toMatchObject({ area: "center", columns: 1, rows: 1, reuse: true });
  });

  it("asks a later layer first, and matches plugin globs and surface ids", () => {
    const rules = [
      {
        match: { plugin: "example.*", surface: "main" },
        area: "center" as const,
        size: { columns: 2, rows: 2 },
        focus: true,
        owner: "example.notes",
      },
      ...defaults,
    ];
    expect(decide(rules, { plugin: "example.notes", surface: "main", placement: "right" })).toEqual(
      {
        area: "center",
        columns: 2,
        rows: 2,
        pixels: undefined,
        reuse: true,
        focus: true,
        rule: "example.notes",
      },
    );
    expect(
      decide(rules, { plugin: "example.notes", surface: "side", placement: "right" }).area,
    ).toBe("right");
    expect(decide(rules, { plugin: "endue.eris", surface: "main", placement: "right" }).area).toBe(
      "right",
    );
  });

  it("falls back to the manifest's placement when no rule matches", () => {
    expect(decide([], { plugin: "example.p", surface: "main", placement: "bottom" })).toMatchObject(
      {
        area: "bottom",
        rule: undefined,
      },
    );
    expect(decide([], { plugin: "example.p", surface: "main", placement: undefined }).area).toBe(
      "center",
    );
  });
});

describe("place with a size", () => {
  it("finds the first free region that fits, row by row", () => {
    let layout = place(defaultLayout(), "a");
    layout = place(layout, "b", { colSpan: 2, rowSpan: 2 });
    layout = place(layout, "c");
    expect(layout.cells).toEqual({
      a: { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      b: { col: 2, row: 1, colSpan: 2, rowSpan: 2 },
      c: { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
    });
  });

  it("cuts a size larger than the grid to fit", () => {
    expect(place(defaultLayout(), "big", { colSpan: 9, rowSpan: 9 }).cells.big).toEqual({
      col: 1,
      row: 1,
      colSpan: 3,
      rowSpan: 2,
    });
  });
});
