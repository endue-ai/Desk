// The console's tools through the plugin's commands: parameters asked before a run, Explain as a
// plan tab, Format SQL, a console SELECT paged, an object's DDL in a view of its own.
import { describe, expect, it } from "vitest";
import { mount, SAVED } from "./harness";

const runs = (m: Awaited<ReturnType<typeof mount>>) =>
  m.clients.spawned.filter((s) => s.command === "sqlite3" && s.args[0] !== "--version");

describe("console tools", () => {
  it("asks for each parameter once and runs the statement with them as literals", async () => {
    const answers: Record<string, string> = { "Value for :id": "7", "Value for :name": "it's" };
    const m = await mount({
      store: { connections: SAVED },
      script: () => ({ rows: [["n"], ["1"]] }),
      pick: (asked) => answers[asked.title] ?? "",
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select * from t where id = :id and name = :name or id = :id";
    await m.host.command("endue.database.run");
    expect(m.picks.map((p) => p.title)).toEqual(["Value for :id", "Value for :name"]);
    expect(runs(m).at(-1)?.args).toContain(
      "select * from t where id = 7 and name = 'it''s' or id = 7",
    );
  });

  it("does not run when a parameter is not given", async () => {
    const m = await mount({ store: { connections: SAVED }, pick: () => "" });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select :x";
    await expect(m.host.command("endue.database.run")).rejects.toThrow(/parameter has no value/u);
    expect(runs(m)).toHaveLength(0);
  });

  it("explains the statement at the caret as a plan tab", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: (sql) =>
        sql.startsWith("EXPLAIN QUERY PLAN")
          ? {
              rows: [
                ["id", "parent", "notused", "detail"],
                ["2", "0", "0", "SCAN notes"],
              ],
            }
          : {},
    });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select * from notes";
    await m.host.command("endue.database.explain");
    expect(runs(m).at(-1)?.args).toContain("EXPLAIN QUERY PLAN select * from notes");
    const tab = m.shown()?.shown?.tabs[0];
    expect(tab).toMatchObject({ label: "Plan", kind: "plan" });
    expect(tab?.plan?.children[0]).toMatchObject({ label: "SCAN notes", hot: "medium" });
    await expect(m.host.command("endue.database.explain-analyze")).rejects.toThrow(
      /no EXPLAIN ANALYZE/u,
    );
  });

  it("formats the script, and pages a SELECT that came back with more rows", async () => {
    const many = [["n"], ...Array.from({ length: 501 }, (_, i) => [String(i)])];
    const m = await mount({ store: { connections: SAVED }, script: () => ({ rows: many }) });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select n from numbers where n > 1 order by n";
    expect(await m.host.command("endue.database.format")).toBe("Formatted.");
    expect(m.view.text).toBe("SELECT n\nFROM numbers\nWHERE n > 1\nORDER BY n");
    await m.host.command("endue.database.run");
    expect(m.shown()?.page).toMatchObject({ offset: 0 });
    await m.host.command("endue.database.next-page");
    expect(runs(m).at(-1)?.args).toContain(
      "SELECT n\nFROM numbers\nWHERE n > 1\nORDER BY n\nLIMIT 501 OFFSET 500",
    );
    expect(m.shown()?.page).toMatchObject({ offset: 500 });
  });

  it("opens an object's DDL in a read-only view of its own", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: (sql) =>
        sql.includes("sqlite_master WHERE sql IS NOT NULL")
          ? { rows: [["sql"], ["CREATE TABLE notes (id INTEGER PRIMARY KEY)"]] }
          : sql.includes("FROM sqlite_master WHERE type IN")
            ? {
                rows: [
                  ["name", "type", "", "", ""],
                  ["notes", "table", "", "NULL", ""],
                ],
              }
            : {},
    });
    const text = await m.host.command("endue.database.ddl", {
      connection: "Notes",
      schema: "main",
      name: "notes",
    });
    expect(text).toBe("CREATE TABLE notes (id INTEGER PRIMARY KEY);\n");
    expect(m.shown()).toMatchObject({ kind: "ddl", name: "ddl: Notes · main.notes" });
  });
});
