// The rows a console holds of a read its cursor keeps (PG-22, ADR 0352): the window model
// (rows/window.js) and the console's requests on the browser stub's cursors (rows/control.js):
// pages forward let the far ones go, pages back are fetched again, the end makes the count exact,
// Count every row and Fetch every row, and a cursor whose session ended.
import { describe, expect, it } from "vitest";
import type { ResultSet } from "../ui/engines/common.js";
import { ALL_MAX } from "../ui/rows/control.js";
import { askFor, HOLD_ROWS, placed, rowsLine, whole } from "../ui/rows/window.js";
import type { Script } from "./harness";
import { rawRunsOf } from "./runs-of";
import { script as base, run, shop, state } from "./session-helpers";

const numbers = (count: number) => [
  ["n"],
  ...Array.from({ length: count }, (_, i) => [String(i + 1)]),
];
const script: Script = (sql, who) => {
  if (sql === "select n from big") return { rows: numbers(5000) };
  if (sql === "select n from huge") return { rows: numbers(ALL_MAX + 1) };
  if (/pg_sleep/u.test(sql)) return { waits: true };
  return base(sql, who);
};
type Mounted = Awaited<ReturnType<typeof shop>>;
const sent = (m: Mounted) =>
  rawRunsOf(m.host.calls)
    .filter((c) => c.method === "db.run")
    .map((c) => (c.params as { sql: string }).sql);
const set = (m: Mounted) => m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set as ResultSet;
const count = (n: number) => n.toLocaleString("en-US");

describe("the window over a read its cursor keeps", () => {
  const start: ResultSet = {
    columns: ["n"],
    rows: Array.from({ length: 1000 }, (_, i) => [String(i)]),
    truncated: true,
    window: { id: "w", first: 0, known: 1000, done: false, page: 1000 },
  };

  it("asks for the next page after the last row held, none before the first", () => {
    expect(askFor(start, "next")).toEqual({ from: 1000, count: 1000 });
    expect(askFor(start, "back")).toBeUndefined();
    expect(whole(start)).toBe(false);
    expect(rowsLine(start, count)).toBe("Rows 1–1,000 of at least 1,000");
  });

  it("lets the far pages go and keeps the rows held bounded, and fetches them again going back", () => {
    let held = start;
    for (let page = 1; page < 10; page++) {
      const from = askFor(held, "next")?.from ?? 0;
      const rows = Array.from({ length: 1000 }, (_, i) => [String(from + i)]);
      held = placed(held, "next", { rows, done: false });
      expect(held.rows.length).toBeLessThanOrEqual(Math.max(4000, HOLD_ROWS));
    }
    expect(held.window).toMatchObject({ first: 6000, known: 10_000, done: false });
    expect(held.rows[0]).toEqual(["6000"]);
    expect(askFor(held, "back")).toEqual({ from: 5000, count: 1000 });
    const back = placed(held, "back", {
      rows: Array.from({ length: 1000 }, (_, i) => [String(5000 + i)]),
      done: false,
    });
    expect(back.window?.first).toBe(5000);
    expect(back.rows[0]).toEqual(["5000"]);
    expect(back.rows.at(-1)).toEqual(["8999"]);
  });

  it("the end makes the count exact, and a result read to its end and held whole is whole", () => {
    const end = placed(start, "next", { rows: [["1000"]], done: true, total: 1001 });
    expect(end.window).toMatchObject({ known: 1001, done: true });
    expect(askFor(end, "next")).toBeUndefined();
    expect(whole(end)).toBe(true);
    expect(end.truncated).toBe(false);
    expect(rowsLine(end, count)).toBe("Rows 1–1,001 of 1,001");
  });
});

describe("a console's requests for the rows of its cursor", () => {
  it("the next page comes by FETCH from where the cursor is, a page back by MOVE ABSOLUTE then FETCH", async () => {
    const m = await shop({ script });
    await run(m, "select n from big");
    for (let i = 0; i < 6; i++) await m.app.page({ rows: "next" });
    const w = set(m).window;
    expect(w).toMatchObject({ known: 3500, done: false });
    expect(set(m).rows.length).toBeLessThanOrEqual(HOLD_ROWS);
    expect(set(m).rows.at(-1)).toEqual(["3500"]);
    expect(sent(m).filter((s) => s.startsWith("MOVE"))).toEqual([]);
    const first = w?.first ?? 0;
    await m.app.page({ rows: "back" });
    expect(sent(m).slice(-2)).toEqual([
      `MOVE ABSOLUTE ${first - 500} IN endue_desk_rows`,
      "FETCH FORWARD 500 FROM endue_desk_rows",
    ]);
    expect(set(m).rows[0]).toEqual([String(first - 500 + 1)]);
    expect(state(m)).toBe("idle");
  });

  it("Count every row moves the cursor to its end; the count is exact and the rows held stay", async () => {
    const m = await shop({ script });
    await run(m, "select n from big");
    const said = await m.host.command("endue.database.count-result-rows");
    expect(said).toBe("5,000 rows");
    expect(sent(m).slice(-2)).toEqual([
      "MOVE ABSOLUTE 0 IN endue_desk_rows",
      "MOVE FORWARD ALL IN endue_desk_rows",
    ]);
    expect(set(m).window).toMatchObject({ known: 5000, done: true });
    expect(set(m).rows).toHaveLength(500);
    expect(m.view.said.at(-1) ?? "").toMatch(/5,000 rows/u);
  });

  it("Fetch every row holds them all, after which the result sorts here; past 100,000 it says so", async () => {
    const m = await shop({ script });
    await run(m, "select n from big");
    expect(await m.host.command("endue.database.fetch-all-rows")).toBe("Fetched every row: 5,000.");
    expect(set(m).rows).toHaveLength(5000);
    expect(whole(set(m))).toBe(true);
    await run(m, "select n from huge");
    expect(await m.host.command("endue.database.fetch-all-rows")).toMatch(
      /More than 100,000 rows/u,
    );
    expect(set(m).rows).toHaveLength(500);
  });

  it("a cursor whose session ended keeps the rows held, says the rest is gone and fetches nothing", async () => {
    const m = await shop({ script });
    await run(m, "select n from big");
    // Disconnect ends the console's session, and the cursor with it.
    await m.host.command("endue.database.disconnect", { connection: "Shop" });
    const before = sent(m).length;
    await m.app.page({ rows: "next" });
    expect(sent(m).slice(before)).toEqual([]);
    expect(set(m).rows).toHaveLength(500);
    expect(set(m).window?.gone).toMatch(/went with its session/u);
  });
});
