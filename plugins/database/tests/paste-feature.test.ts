// Pasting through the plugin (PG-43, #470): on the SDK's test host with the fixture's scripted psql
// and its typed table public.items, Database: paste (an agent's too, with `text`) makes pending
// changes from the grid's caret, a result that cannot change says why, a large paste asks first,
// and duplicate, fill down, clear and undo work by command. The grid is a stand-in that answers
// where the cells land and reads the text as the real one does in the frame.
import { describe, expect, it } from "vitest";
import { readPaste } from "../ui/edit/paste-text.js";
import { FIXTURE_PG_CONNECTION, fixtureScript } from "./fixtures";
import { type Mounted, mount } from "./harness";

const ITEMS = ["id", "mood", "doc", "flag", "tags", "seen"];
const c = (name: string) => ITEMS.indexOf(name);

/** The grid on screen: its block from (top, left) to (bottom, right), all columns shown. */
function onGrid(m: Mounted, top: number, left: number, bottom = top, right = left) {
  m.view.grid = (op, args) => {
    const shown = m.shown()?.shown?.tabs[0]?.set;
    if (!shown) return undefined;
    const added = m.shown()?.edit?.changes.inserts.length ?? 0;
    const rows = shown.rows.length;
    if (op === "cells")
      return {
        order: Array.from({ length: rows + added }, (_, i) => i),
        columns: ITEMS.map((_, i) => i),
        top,
        left,
        bottom,
        right,
      };
    if (op === "readPaste") return readPaste(String(args?.text ?? ""));
    return "";
  };
}

async function items(options: Parameters<typeof mount>[0] = {}) {
  const m = await mount({
    store: { connections: [FIXTURE_PG_CONNECTION] },
    script: fixtureScript,
    ...options,
  });
  await m.host.command("endue.database.open-table", {
    connection: "fixture-pg",
    schema: "public",
    table: "items",
  });
  await m.settle();
  return m;
}

describe("pasting through the plugin", () => {
  it("pastes tab-separated text from the caret as pending changes, and one undo takes it back", async () => {
    const m = await items();
    onGrid(m, 1, c("doc"));
    const said = await m.host.command("endue.database.paste", {
      text: '{"x": 1}\tf\n[2]\tt\n{}\t\n',
    });
    await m.settle();
    expect(said).toBe("Pasted 6 cells into 3 rows, 1 of them new: pending until Submit.");
    expect(m.shown()?.edit).toMatchObject({ status: "ready", count: 3 });
    const preview = await m.host.command("endue.database.preview-changes");
    expect(preview).toContain(
      `UPDATE "public"."items" SET "doc" = '{"x": 1}'::jsonb, "flag" = FALSE WHERE "id" = 2;`,
    );
    expect(preview).toContain(
      `INSERT INTO "public"."items" ("doc", "flag") VALUES ('{}'::jsonb, NULL);`,
    );
    expect(await m.host.command("endue.database.undo-change")).toBe(
      "Took back the last pending change.",
    );
    await m.settle();
    expect(m.shown()?.edit?.count).toBe(0);
    expect(await m.host.command("endue.database.undo-change")).toBe("Nothing to undo.");
  });

  it("refuses a bad value with its row and column, and nothing becomes pending", async () => {
    const m = await items();
    onGrid(m, 0, c("flag"));
    await expect(m.host.command("endue.database.paste", { text: "t\nnope\n" })).rejects.toThrow(
      /^Nothing pasted: row 2, flag: /u,
    );
    expect(m.shown()?.edit?.count ?? 0).toBe(0);
    // The grid's own paste event goes the same way, said on the status line.
    await m.app.pasteText("maybe");
    expect(m.view.said.at(-1)).toMatch(/^Nothing pasted: row 1, flag: /u);
  });

  it("says why a read-only connection or a result of no one table takes no paste", async () => {
    const readOnly = await items({
      store: { connections: [{ ...FIXTURE_PG_CONNECTION, readOnly: true }] },
    });
    onGrid(readOnly, 0, 2);
    await expect(readOnly.host.command("endue.database.paste", { text: "x" })).rejects.toThrow(
      "fixture-pg is read-only: its rows cannot be changed here.",
    );
    const join = await mount({
      store: { connections: [FIXTURE_PG_CONNECTION] },
      script: (sql, env) =>
        sql.includes("JOIN items b")
          ? {
              rows: [
                ["id", "id"],
                ["1", "1"],
              ],
            }
          : fixtureScript(sql, env),
    });
    await join.host.command("endue.database.console", { connection: "fixture-pg" });
    join.view.text = "SELECT a.id, b.id FROM items a JOIN items b ON a.id = b.id";
    await join.host.command("endue.database.run");
    onGrid(join, 0, 0);
    await expect(join.host.command("endue.database.paste", { text: "x" })).rejects.toThrow(
      /^Only one table's rows can be changed/u,
    );
    expect(join.shown()?.edit?.count ?? 0).toBe(0);
  });

  it("asks before a paste of more than 1,000 cells, and No changes nothing", async () => {
    let answer = "";
    const m = await items({ pick: () => answer });
    onGrid(m, 0, c("doc"));
    const text = Array.from({ length: 501 }, (_, i) => `{"n": ${i}}\tt`).join("\n");
    await expect(m.host.command("endue.database.paste", { text })).rejects.toThrow(/Not pasted/u);
    expect(m.picks.at(-1)?.title).toBe("Paste 1,002 cells?");
    expect(m.shown()?.edit?.count ?? 0).toBe(0);
    answer = "yes";
    await m.host.command("endue.database.paste", { text });
    await m.settle();
    expect(m.shown()?.edit?.count).toBe(501);
  });

  it("duplicates, fills down and clears by command, each one undo step", async () => {
    const m = await items();
    onGrid(m, 0, c("doc"), 1, c("flag"));
    expect(await m.host.command("endue.database.duplicate-rows")).toBe(
      "Duplicated 2 rows as pending rows at the end. Change id before Submit: a key must differ.",
    );
    expect(m.shown()?.edit?.changes.inserts[0]).toEqual([
      "1",
      "ok",
      '{"size": 1, "tags": ["a"]}',
      "t",
      "{a,b}",
      "2026-11-21 09:00:00+00",
    ]);
    expect(await m.host.command("endue.database.fill-down")).toBe(
      "Filled 2 cells down: pending until Submit.",
    );
    expect(m.shown()?.edit?.changes.updates.get(1)?.get(c("flag"))).toBe("t");
    expect(await m.host.command("endue.database.clear-cells")).toBe(
      "Set 4 cells to NULL: pending until Submit.",
    );
    expect(m.shown()?.edit?.count).toBe(4);
    await m.host.command("endue.database.undo-change");
    await m.host.command("endue.database.undo-change");
    expect(m.shown()?.edit?.count).toBe(2);
    await m.host.command("endue.database.undo-change");
    expect(m.shown()?.edit?.count ?? 0).toBe(0);
  });

  it("names the grid that is missing", async () => {
    const m = await items();
    await expect(m.host.command("endue.database.paste", { text: "x" })).rejects.toThrow(
      "No result is on screen: run a query or open a table.",
    );
  });
});
