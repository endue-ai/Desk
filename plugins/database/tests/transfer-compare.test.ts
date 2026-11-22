// What a copy says before anything runs (PG-63): versions, types the target lacks, tables already
// there or missing, and an append's columns.
import { describe, expect, it } from "vitest";
import { differences } from "../ui/transfer/compare.js";

const v = (number: number, text: string) => ({ number, text });
const base = {
  source: v(170002, "17.2"),
  target: v(170002, "17.2"),
  content: "both" as const,
  missingTypes: [],
  newSchemas: [],
  tables: [{ label: "public.items", exists: false }],
  columns: [],
};

describe("the report of a copy", () => {
  it("reports versions and types before anything runs", () => {
    expect(differences(base)).toEqual({ problems: [], notes: [] });
    const older = differences({
      ...base,
      target: v(150004, "15.4"),
      missingTypes: ["shop.mood"],
      newSchemas: ["archive"],
    });
    expect(older.notes).toEqual([
      "The target runs PostgreSQL 15.4, older than the source's 17.2: a type or a default it lacks fails before any row moves.",
      "Schema archive is created on the target.",
    ]);
    expect(older.problems).toEqual(["The target has no type shop.mood: create it there first."]);
    expect(differences({ ...base, source: v(150004, "15.4") }).notes).toEqual([
      "The source runs PostgreSQL 15.4, the target 17.2.",
    ]);
  });

  it("holds a structure copy onto a table already there, and data onto one that is not", () => {
    const there = { ...base, tables: [{ label: "public.items", exists: true }] };
    expect(differences(there).problems).toEqual([
      "public.items is already on the target: choose another name, or copy the data only.",
    ]);
    expect(differences({ ...base, content: "data" }).problems).toEqual([
      "public.items is not on the target: copy its structure too.",
    ]);
    // Data only asks for no type: the target's columns hold the values.
    expect(
      differences({ ...there, content: "data", missingTypes: ["shop.mood"] }).problems,
    ).toEqual([]);
  });

  it("an append's missing column holds it and a column of another type is a note", () => {
    const report = differences({
      ...base,
      content: "data",
      tables: [{ label: "public.items", exists: true }],
      columns: [
        { table: "public.items", column: "id", source: "integer", target: "bigint" },
        { table: "public.items", column: "name", source: "text", target: "text" },
        { table: "public.items", column: "gone", source: "text", target: null },
      ],
    });
    expect(report.problems).toEqual(["public.items on the target has no column gone."]);
    expect(report.notes).toEqual([
      "public.items.id is integer here and bigint on the target: each value is read as the target's type.",
    ]);
  });
});
