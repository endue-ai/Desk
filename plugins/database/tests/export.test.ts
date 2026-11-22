// Copy and export formats quote and escape every value (CSV, JSON, Markdown, INSERT and UPDATE),
// and an export is written where the person chooses in the save dialog (PG-61), which starts in the
// last export's folder; the write is that path's alone, asking once for it when refused.
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

type Call = { method: string; params: Record<string, unknown> };

/** A bridge whose save dialog answers `chosen` (undefined: cancelled), with a store in memory. */
function host(chosen: string | undefined, { refuse = false, grant = true } = {}) {
  const calls: Call[] = [];
  const store = new Map<string, unknown>();
  let granted = !refuse;
  const bridge = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "store.get") return { value: store.get(String(params.key)) };
      if (method === "store.set") return store.set(String(params.key), params.value) && {};
      if (method === "dialog.save")
        return chosen ? { cancelled: false, path: chosen } : { cancelled: true };
      if (method === "perm.request") {
        granted = grant;
        return { granted: grant };
      }
      if (!granted) throw Object.assign(new Error("denied"), { code: "permission_denied" });
      return { bytesWritten: 10 };
    },
  };
  return { bridge: bridge as never, calls, store };
}

describe("saved where the person chooses", () => {
  const at = new Date(2026, 10, 7, 9, 5, 3);

  it("names the file after the table and the time, safe for every file system", () => {
    expect(exportName("shop.orders", "csv", at)).toBe("shop.orders-20261107-090503.csv");
    expect(exportName('a/b: "c"?', "markdown", at)).toBe("a-b-c-20261107-090503.md");
    expect(exportName("..", "insert", at)).toBe("result-20261107-090503.sql");
    expect(exportName("orders", "xlsx", at)).toBe("orders-20261107-090503.xlsx");
    expect(exportName("orders", "template", at)).toBe("orders-20261107-090503.txt");
  });

  it("asks the save dialog, writes only the path chosen and remembers its folder", async () => {
    const out = host("~/Reports/q4/orders.csv");
    const done = await exportResult(out.bridge, { set, format: "csv", name: "orders", at });
    expect(done).toEqual({
      path: "~/Reports/q4/orders.csv",
      format: "csv",
      rows: 3,
      bytes: expect.any(Number),
      partial: false,
    });
    const save = out.calls.find((c) => c.method === "dialog.save");
    expect(save?.params).toEqual({
      title: "Export the result",
      suggestedName: "orders-20261107-090503.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    const writes = out.calls.filter((c) => c.method === "fs.write");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.params).toMatchObject({
      path: "~/Reports/q4/orders.csv",
      encoding: "utf8",
      scope: { permission: "fs:write", paths: ["~/Reports/q4/orders.csv"] },
    });
    expect(String(writes[0]?.params.content).endsWith("NULL\r\n")).toBe(true);
    expect(out.store.get("export-folder")).toBe("~/Reports/q4");
    // The next export starts in that folder.
    await exportResult(out.bridge, { set, format: "xlsx", name: "orders", at });
    const next = out.calls.filter((c) => c.method === "dialog.save").at(-1);
    expect(next?.params).toMatchObject({
      startIn: "~/Reports/q4",
      suggestedName: "orders-20261107-090503.xlsx",
      filters: [{ name: "Spreadsheet (.xlsx)", extensions: ["xlsx"] }],
    });
    expect(out.calls.filter((c) => c.method === "fs.write").at(-1)?.params.encoding).toBe("base64");
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    const out = host(undefined);
    expect(
      await exportResult(out.bridge, { set, format: "json", name: "orders", at }),
    ).toBeUndefined();
    expect(out.calls.map((c) => c.method)).toEqual(["store.get", "dialog.save"]);
  });

  it("says when the server has more rows than the result holds", async () => {
    const out = host("~/orders.tsv");
    const partial = { ...set, truncated: true };
    expect(
      await exportResult(out.bridge, { set: partial, format: "tsv", name: "orders", at }),
    ).toMatchObject({ partial: true });
  });

  it("asks once for the chosen path alone when the write is refused, and says a refusal", async () => {
    const asked = host("~/Reports/orders.csv", { refuse: true });
    await exportResult(asked.bridge, { set, format: "csv", name: "orders", at });
    expect(
      asked.calls.filter((c) => c.method === "perm.request").map((c) => c.params.permission),
    ).toEqual([{ permission: "fs:write", paths: ["~/Reports/orders.csv"] }]);
    const refused = host("~/Reports/orders.json", { refuse: true, grant: false });
    await expect(
      exportResult(refused.bridge, { set, format: "json", name: "orders", at }),
    ).rejects.toThrow("Not allowed to write orders.json.");
    expect(refused.store.has("export-folder")).toBe(false);
  });

  it("refuses a format it does not write before asking anything", async () => {
    const out = host("~/x.yaml");
    await expect(
      exportResult(out.bridge, { set, format: "yaml" as never, name: "orders", at }),
    ).rejects.toThrow(
      /Export as yaml: pick tsv, csv, json, markdown, insert, update, xlsx, html, xml, template/u,
    );
    expect(out.calls).toEqual([]);
  });
});
