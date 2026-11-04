import type { UniversalData } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { byStart, movedTo, rowsOf, toneOf, valueAt, withValueAt } from "./index";

const SEOUL = "Asia/Seoul";
const board: UniversalData = {
  universal: "v0",
  map: { group: "column", start: "due" },
  entries: [
    { id: "t1", title: "Write the spec", column: "done", due: "2026-11-02", tags: ["spec"] },
    { id: "t2", title: "Build", column: "doing", due: "2026-11-06T18:00:00+09:00", owner: "Mina" },
    { id: "t2", title: "Twice", column: "todo", raw: { owner: "Jun" } },
    { title: 3, status: "In-Progress", tags: "solo", estimate: 3 },
  ],
};

describe("rowsOf", () => {
  it("reads every role through the data's map, the view's map on top", () => {
    const rows = rowsOf(board, { zone: SEOUL, map: { author: "raw.owner" } });
    expect(rows.map((row) => row.key)).toEqual(["t1", "t2", "t2#2", "4"]);
    expect(rows.map((row) => row.group)).toEqual(["done", "doing", "todo", ""]);
    expect(rows.map((row) => row.title)).toEqual(["Write the spec", "Build", "Twice", "3"]);
    expect(rows[2]?.author).toBe("Jun");
    expect(rows[3]?.tags).toEqual(["solo"]);
    expect(rows[3]?.status).toBe("in-progress");
    expect(rows[3]?.tone).toBe("running");
    expect(rows[1]?.entry).toBe(board.entries[1]);
  });

  it("takes a whole day from its midnight in the zone to the next, and a timed start as an instant", () => {
    const [day, timed, none] = rowsOf(board, { zone: SEOUL });
    expect(day?.allDay).toBe(true);
    expect(day?.start).toBe(Date.parse("2026-11-02T00:00:00+09:00"));
    expect(day?.end).toBe(Date.parse("2026-11-03T00:00:00+09:00"));
    expect(timed?.allDay).toBe(false);
    expect(timed?.start).toBe(Date.parse("2026-11-06T09:00:00Z"));
    expect(timed?.end).toBeUndefined();
    expect(none?.start).toBeUndefined();
  });

  it("ends a span of whole days after its last day, reads wall times in the zone and drops nonsense", () => {
    const rows = rowsOf(
      {
        entries: [
          { start: "2026-11-02", end: "2026-11-04" },
          { start: "2026-11-04 09:30", end: "2026-11-04T10:00" },
          { start: "2026-02-30" },
          { start: "soon", end: "later" },
          { start: "2026-11-04T10:00:00Z", end: "2026-11-04T09:00:00Z" },
        ],
      },
      { zone: SEOUL },
    );
    expect(rows[0]?.end).toBe(Date.parse("2026-11-05T00:00:00+09:00"));
    expect(rows[1]?.start).toBe(Date.parse("2026-11-04T09:30:00+09:00"));
    expect(rows[1]?.end).toBe(Date.parse("2026-11-04T10:00:00+09:00"));
    expect(rows[2]?.start).toBeUndefined();
    expect(rows[3]?.start).toBeUndefined();
    expect(rows[4]?.end).toBeUndefined();
  });

  it("answers no rows for no data", () => {
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf({ entries: [] })).toEqual([]);
  });
});

describe("the helpers", () => {
  it("read and write dotted paths without touching the original", () => {
    const entry = { raw: { owner: "Mina" }, tags: ["a", "b"] };
    expect(valueAt(entry, "raw.owner")).toBe("Mina");
    expect(valueAt(entry, "tags.1")).toBe("b");
    expect(valueAt(entry, "raw.owner.name")).toBeUndefined();
    const next = withValueAt(entry, "raw.column", "done");
    expect(next).toEqual({ raw: { owner: "Mina", column: "done" }, tags: ["a", "b"] });
    expect(entry.raw).toEqual({ owner: "Mina" });
  });

  it("move a row by setting its entry's group field through the map", () => {
    const rows = rowsOf(board);
    const moved = movedTo(board, rows[1] as (typeof rows)[number], "done");
    expect(moved.entries[1]).toMatchObject({ id: "t2", column: "done" });
    expect(moved.entries[0]).toBe(board.entries[0]);
    expect(board.entries[1]).toMatchObject({ column: "doing" });
    const own = movedTo({ entries: [{ title: "A" }] }, { index: 0 }, "later");
    expect(own.entries[0]).toEqual({ title: "A", group: "later" });
  });

  it("name the tone of the usual status words and keep the rest as other", () => {
    expect(["queued", "Running", "complete", "error", "blocked", "maybe"].map(toneOf)).toEqual([
      "pending",
      "running",
      "done",
      "failed",
      "waiting",
      "other",
    ]);
  });

  it("order by start with whole days first on a tie and undated rows last", () => {
    const rows = rowsOf(
      {
        entries: [
          { id: "late", start: "2026-11-04T18:00:00Z" },
          { id: "none" },
          { id: "day", start: "2026-11-04" },
          { id: "early", start: "2026-11-03T09:00:00Z" },
        ],
      },
      { zone: "UTC" },
    );
    expect(byStart(rows).map((row) => row.id)).toEqual(["early", "day", "late", "none"]);
    expect(byStart(rows, "desc").map((row) => row.id)).toEqual(["late", "day", "early", "none"]);
  });
});
