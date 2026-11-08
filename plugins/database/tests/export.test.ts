// Copy and export formats quote and escape every value (CSV, JSON, Markdown, INSERT and UPDATE),
// and an export is written into ~/Downloads under a name of its own, asking once for the grant.
import { describe, expect, it } from "vitest";
import { exportName, exportResult } from "../ui/export.js";
import { formatRows } from "../ui/results.js";

const set = {
  columns: ["id", "label", "data", "note"],
  rows: [
    ["1", 'say "hi", then\r\nleave', "0x00FF", null],
    ["2", "a|b\\|c", "0x", ""],
    ["9007199254740993", "=SUM(A1)", null, "NULL"],
  ] as (string | null)[][],
  truncated: false,
};

describe("export formats", () => {
  it("writes CSV with quotes only where needed, '' apart from NULL", () => {
    expect(formatRows(set, "csv").split("\r\n")).toEqual([
      "id,label,data,note",
      '1,"say ""hi"", then',
      'leave",0x00FF,',
      '2,a|b\\|c,0x,""',
      "9007199254740993,=SUM(A1),,NULL",
    ]);
  });

  it("writes JSON numbers only when they read back exactly", () => {
    expect(JSON.parse(formatRows(set, "json"))).toEqual([
      { id: 1, label: 'say "hi", then\r\nleave', data: "0x00FF", note: null },
      { id: 2, label: "a|b\\|c", data: "0x", note: "" },
      { id: "9007199254740993", label: "=SUM(A1)", data: null, note: "NULL" },
    ]);
  });

  it("writes Markdown with bars and backslashes escaped and line breaks as <br>", () => {
    expect(formatRows(set, "markdown").split("\n")).toEqual([
      "| id | label | data | note |",
      "| --- | --- | --- | --- |",
      '| 1 | say "hi", then<br>leave | 0x00FF | NULL |',
      "| 2 | a\\|b\\\\\\|c | 0x |  |",
      "| 9007199254740993 | =SUM(A1) | NULL | NULL |",
    ]);
  });

  it("writes INSERT and UPDATE with each value a literal of its column's type", () => {
    const options = {
      dialect: "mysql" as const,
      table: "`t`",
      types: ["bigint", "text", "varbinary(8)", "text"],
      rows: set.rows.slice(0, 2),
    };
    expect(formatRows(set, "insert", options)).toBe(
      [
        "INSERT INTO `t` (`id`, `label`, `data`, `note`) VALUES (1, 'say \"hi\", then\r\nleave', 0x00FF, NULL);",
        "INSERT INTO `t` (`id`, `label`, `data`, `note`) VALUES (2, 'a|b\\\\|c', '', '');",
      ].join("\n"),
    );
    const pg = {
      ...options,
      dialect: "postgresql" as const,
      table: '"t"',
      types: ["bigint", "text", "bytea", "text"],
    };
    expect(formatRows(set, "insert", { ...pg, rows: [["3", "it's", "\\x0a", null]] })).toBe(
      `INSERT INTO "t" ("id", "label", "data", "note") VALUES (3, 'it''s', E'\\\\x0a', NULL);`,
    );
    expect(
      formatRows(set, "update", {
        ...pg,
        key: [0],
        columns: [1, 3],
        rows: [["3", "x", null, null]],
      }),
    ).toBe(`UPDATE "t" SET "label" = 'x', "note" = NULL WHERE "id" = 3;`);
    expect(
      formatRows(set, "update", {
        dialect: "sqlite",
        table: '"t"',
        columns: [1, 3],
        rows: [["3", "x", null, null]],
      }),
    ).toBe(`UPDATE "t" SET "label" = 'x', "note" = NULL WHERE "label" = 'x' AND "note" IS NULL;`);
  });
});

describe("export to a file", () => {
  const at = new Date(2026, 10, 7, 9, 5, 3);

  it("names the file after the table and the time, safe for every file system", () => {
    expect(exportName("shop.orders", "csv", at)).toBe("shop.orders-20261107-090503.csv");
    expect(exportName('a/b: "c"?', "markdown", at)).toBe("a-b-c-20261107-090503.md");
    expect(exportName("..", "insert", at)).toBe("result-20261107-090503.sql");
  });

  it("writes into ~/Downloads under fs:write, asking for the grant once when it is missing", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let granted = false;
    const bridge = {
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        if (method === "perm.request") {
          granted = true;
          return { granted: true };
        }
        if (!granted) throw Object.assign(new Error("denied"), { code: "permission_denied" });
        return { bytesWritten: 10 };
      },
    };
    const done = await exportResult(bridge as never, { set, format: "csv", name: "orders", at });
    expect(done.path).toBe("~/Downloads/orders-20261107-090503.csv");
    expect(done.rows).toBe(3);
    const writes = calls.filter((c) => c.method === "fs.write");
    expect(writes).toHaveLength(2);
    expect(writes[1]?.params).toMatchObject({
      path: "~/Downloads/orders-20261107-090503.csv",
      encoding: "utf8",
      scope: { permission: "fs:write", paths: ["~/Downloads/**"] },
    });
    expect(String(writes[1]?.params.content).endsWith("NULL\r\n")).toBe(true);
    expect(calls.filter((c) => c.method === "perm.request")).toHaveLength(1);
  });

  it("says when the person refuses the grant", async () => {
    const bridge = {
      call: async (method: string) => {
        if (method === "perm.request") return { granted: false };
        throw Object.assign(new Error("denied"), { code: "permission_denied" });
      },
    };
    await expect(
      exportResult(bridge as never, { set, format: "json", name: "orders", at }),
    ).rejects.toThrow("Not allowed to write ~/Downloads/orders-20261107-090503.json.");
  });
});
