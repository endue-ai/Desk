// Typed cell editors (PG-40, #467): the editor a column gets, from the catalog's reading of its type
// (internal name and category, enum labels, domains by their base type, arrays by their element),
// from a built-in type OID, or from the declared type's name when nothing more was read.
import { describe, expect, it } from "vitest";
import { builtinType, readTypes, typesOf, typesSql } from "../ui/cell-editors/pg-types.js";
import { attachEditors, editorOf, kindOf } from "../ui/cell-editors/resolve.js";
import { targetOf } from "../ui/edit/pending.js";

/** One row of the types query: name, type, base, category, element, its category, labels, ... */
const row = (
  name: string,
  type: string,
  base: string,
  category: string,
  more: Partial<{
    element: string;
    elementCategory: string;
    labels: string;
    nullable: string;
    hasDefault: string;
    generated: string;
    identity: string;
  }> = {},
) => [
  name,
  type,
  base,
  category,
  more.element ?? "",
  more.elementCategory ?? "",
  more.labels ?? "{}",
  more.nullable ?? "YES",
  more.hasDefault ?? "NO",
  more.generated ?? "",
  more.identity ?? "",
  "Asia/Seoul",
];

const types = typesOf([
  row("flag", "boolean", "bool", "B"),
  row("mood", "mood", "mood", "E", { labels: '{sad,ok,"so so"}' }),
  row("pos", "posint", "int4", "N", { nullable: "NO", hasDefault: "YES" }),
  row("day", "date", "date", "D"),
  row("at_time", "time without time zone", "time", "D"),
  row("at_tz", "time with time zone", "timetz", "D"),
  row("ts", "timestamp(3) without time zone", "timestamp", "D"),
  row("tstz", "timestamp with time zone", "timestamptz", "D"),
  row("span", "interval", "interval", "T"),
  row("j", "json", "json", "U"),
  row("jb", "jsonb", "jsonb", "U"),
  row("ints", "integer[]", "_int4", "A", { element: "int4", elementCategory: "N" }),
  row("tags", "text[]", "_text", "A", { element: "text", elementCategory: "S" }),
  row("codes", "character varying(4)[]", "_varchar", "A", {
    element: "varchar",
    elementCategory: "S",
  }),
  row("moods", "mood[]", "_mood", "A", {
    element: "mood",
    elementCategory: "E",
    labels: "{sad,ok}",
  }),
  row("bytes", "bytea", "bytea", "U"),
  row("id", "uuid", "uuid", "U"),
  row("total", "numeric(8,2)", "numeric", "N"),
  row("big", "bigint", "int8", "N"),
  row("rel", "regclass", "regclass", "N"),
  row("spot", "point", "point", "G"),
  row("twice", "integer", "int4", "N", { generated: "s", hasDefault: "YES" }),
  row("num", "integer", "int4", "N", { identity: "a", hasDefault: "YES", nullable: "NO" }),
  row("seq", "bigint", "int8", "N", { identity: "d", hasDefault: "YES", nullable: "NO" }),
]);

const editor = (name: string) => {
  const info = types.get(name);
  return editorOf(
    "postgresql",
    { name, type: info?.type ?? "", nullable: true, default: null },
    info,
  );
};

describe("picks the editor by type name and category", () => {
  it("reads the catalog query's rows into types", () => {
    expect(types.get("mood")).toMatchObject({
      type: "mood",
      typname: "mood",
      category: "E",
      labels: ["sad", "ok", "so so"],
      nullable: true,
      timeZone: "Asia/Seoul",
    });
    expect(types.get("pos")).toMatchObject({ typname: "int4", nullable: false, hasDefault: true });
    expect(types.get("ints")?.element).toEqual({ typname: "int4", category: "N" });
    const sql = typesSql("app's", 'My "T"');
    expect(sql).toMatch(/pg_catalog\.pg_enum/u);
    expect(sql).toMatch(/typbasetype/u);
    expect(sql).toContain("'app''s'");
    expect(sql).toContain(`'My "T"'`);
    expect(sql).toMatch(/current_setting\('TimeZone'\)/u);
  });

  it("gives each kind of value its editor", () => {
    expect(editor("flag")).toMatchObject({ kind: "boolean", cast: "" });
    expect(editor("mood")).toMatchObject({
      kind: "enum",
      labels: ["sad", "ok", "so so"],
      cast: "mood",
    });
    // A domain is edited as its base type, with the domain's own NOT NULL and default.
    expect(editor("pos")).toMatchObject({
      kind: "number",
      integer: "int4",
      nullable: false,
      hasDefault: true,
    });
    expect(editor("day")).toMatchObject({ kind: "date", zone: false, cast: "date" });
    expect(editor("at_time")).toMatchObject({ kind: "time", zone: false });
    expect(editor("at_tz")).toMatchObject({ kind: "time", zone: true, timeZone: "Asia/Seoul" });
    expect(editor("ts")).toMatchObject({ kind: "timestamp", zone: false });
    expect(editor("tstz")).toMatchObject({ kind: "timestamp", zone: true });
    expect(editor("span")).toMatchObject({ kind: "interval", cast: "interval" });
    expect(editor("j")).toMatchObject({ kind: "json", cast: "json" });
    expect(editor("jb")).toMatchObject({ kind: "json", cast: "jsonb" });
    expect(editor("bytes")).toMatchObject({ kind: "bytes", prefix: "\\x", cast: "bytea" });
    expect(editor("id")).toMatchObject({ kind: "uuid", cast: "uuid" });
    expect(editor("total")).toMatchObject({ kind: "number", integer: "" });
    expect(editor("big")).toMatchObject({ kind: "number", integer: "int8" });
    expect(editor("rel").kind).toBe("text");
    expect(editor("spot").kind).toBe("text");
  });

  it("edits an array as a list of its element's editor", () => {
    expect(editor("ints")).toMatchObject({
      kind: "array",
      cast: "integer[]",
      element: { kind: "number", integer: "int4" },
    });
    expect(editor("tags")).toMatchObject({ kind: "array", element: { kind: "text" } });
    // A cast to varchar(4)[] would cut a longer element instead of refusing it.
    expect(editor("codes")).toMatchObject({ kind: "array", cast: "" });
    expect(editor("moods")).toMatchObject({
      kind: "array",
      element: { kind: "enum", labels: ["sad", "ok"] },
    });
  });

  it("fixes a generated or always-identity column, with the reason", () => {
    expect(editor("twice").fixed).toMatch(/twice is generated .*the server computes it/u);
    expect(editor("num").fixed).toMatch(/num is an identity column GENERATED ALWAYS/u);
    expect(editor("seq")).toMatchObject({ fixed: "", hasDefault: true });
    expect(editor("flag").fixed).toBe("");
  });

  it("maps built-in type OIDs to the same editors", () => {
    expect(kindOf(builtinType(16))).toBe("boolean");
    expect(kindOf(builtinType(3802))).toBe("json");
    expect(kindOf(builtinType(1184))).toBe("timestamp");
    expect(kindOf(builtinType(1186))).toBe("interval");
    expect(kindOf(builtinType(17))).toBe("bytes");
    expect(kindOf(builtinType(2950))).toBe("uuid");
    expect(kindOf(builtinType(1007))).toBe("array");
    expect(builtinType(1007)?.element).toEqual({ typname: "int4", category: "N" });
    expect(builtinType(999_999)).toBeUndefined();
  });

  it("falls back to the declared type's name when the types were not read", () => {
    const declared = (dialect: "postgresql" | "mysql" | "sqlite", type: string) =>
      editorOf(dialect, { name: "c", type, nullable: true, default: null }, undefined);
    expect(declared("postgresql", "timestamp with time zone")).toMatchObject({
      kind: "timestamp",
      zone: true,
    });
    expect(declared("postgresql", "integer[]")).toMatchObject({
      kind: "array",
      element: { kind: "number", integer: "int4" },
    });
    expect(declared("postgresql", "character varying(20)").kind).toBe("text");
    expect(declared("postgresql", "boolean").kind).toBe("boolean");
    expect(declared("mysql", "enum('a','b c','it''s')")).toMatchObject({
      kind: "enum",
      labels: ["a", "b c", "it's"],
    });
    expect(declared("mysql", "json").kind).toBe("json");
    expect(declared("mysql", "int(11)")).toMatchObject({ kind: "number", integer: "int4" });
    expect(declared("mysql", "varbinary(16)")).toMatchObject({ kind: "bytes", prefix: "0x" });
    expect(declared("sqlite", "BLOB")).toMatchObject({ kind: "bytes", prefix: "0x" });
    expect(declared("sqlite", "INTEGER").kind).toBe("text");
    expect(declared("sqlite", "TEXT")).toMatchObject({ kind: "text", nullable: true });
  });

  it("gives a table's target columns their editors, from the catalog and the types read", async () => {
    const execute = async () => ({
      result: {
        statements: [
          {
            index: 0,
            ran: true,
            sets: [
              {
                columns: [],
                rows: [row("mood", "mood", "mood", "E", { labels: "{a,b}" })],
                truncated: false,
              },
            ],
            affected: null,
            warnings: 0,
            notices: [],
          },
        ],
        notices: [],
        ms: 1,
      },
    });
    const read = await readTypes(execute as never, {} as never, "public", "t");
    expect(read.get("mood")?.labels).toEqual(["a", "b"]);
    const columns = [
      { name: "id", type: "integer", nullable: false, default: null, primary: true },
      { name: "mood", type: "mood", nullable: true, default: "'a'::mood", primary: false },
    ];
    const made = targetOf(
      "postgresql",
      { schema: "public", name: "t" },
      ["id", "mood", "x"],
      columns,
    );
    if (!made.target) throw new Error(made.reason);
    const target = attachEditors(made.target, columns, read);
    expect(target.columns[0]?.editor).toMatchObject({ kind: "number", nullable: false });
    expect(target.columns[1]?.editor).toMatchObject({ kind: "enum", labels: ["a", "b"] });
    expect(target.columns[2]?.editor).toBeUndefined();
  });
});
