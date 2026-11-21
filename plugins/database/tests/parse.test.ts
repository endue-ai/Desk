// The SQL parser (ADR 0283): PostgreSQL's own grammar, every statement's raw parse tree with where it
// starts and ends, the server's message and position for a statement that does not parse, and every
// location a UTF-8 byte of the whole script that positions.js turns into offsets, lines and columns.
import { describe, expect, it } from "vitest";
import { createPositions } from "../ui/sql/parse/positions.js";
import { walk } from "../ui/sql/parse/tree.js";
import { STATEMENTS } from "./pg-corpus";
import { loadParse } from "./pg-parser";

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Every location in a tree, by the kind of node that holds it. */
function locations(tree: unknown) {
  const found: Array<[string, number]> = [];
  walk(tree, (kind, fields) => {
    if (typeof fields?.location === "number") found.push([kind, fields.location]);
  });
  return found;
}

describe("parse", () => {
  it("answers every statement's tree with its start and end", async () => {
    const parse = await loadParse();
    const sql = "select 1;\n  insert into t values (2)  ;\n-- note\nupdate t set a = 1 -- end\n";
    const parsed = parse(sql);
    expect(parsed.whole).toBe(true);
    expect(parsed.version).toBeGreaterThanOrEqual(180000);
    expect(parsed.statements.map((s) => s.kind)).toEqual([
      "SelectStmt",
      "InsertStmt",
      "UpdateStmt",
    ]);
    expect(parsed.statements.map((s) => sql.slice(s.start.offset, s.end.offset))).toEqual([
      "select 1",
      "insert into t values (2)",
      "update t set a = 1",
    ]);
    const [, insert, update] = parsed.statements;
    expect(insert?.start).toEqual({ byte: 12, offset: 12, line: 2, column: 3 });
    expect(insert?.end).toEqual({ byte: 36, offset: 36, line: 2, column: 27 });
    expect(update?.start).toMatchObject({ line: 4, column: 1 });
    expect(insert?.tree).toHaveProperty("InsertStmt.relation.relname", "t");
    expect(locations(update?.tree)).toContainEqual(["A_Const", sql.indexOf("1 -- end")]);
    expect(parsed.statements.every((s) => s.error === undefined)).toBe(true);
  });

  it("a statement that does not parse answers the server's message and position", async () => {
    const parse = await loadParse();
    const sql = "select 1;\nselec 2;\nselect 'x' frm t;\nselect 3 + 4";
    const parsed = parse(sql);
    expect(parsed.whole).toBe(false);
    expect(parsed.statements.map((s) => s.kind)).toEqual(["SelectStmt", null, null, "SelectStmt"]);
    const [, first, second, last] = parsed.statements;
    expect(first?.error?.message).toBe('syntax error at or near "selec"');
    expect(first?.error?.position).toEqual({ byte: 10, offset: 10, line: 2, column: 1 });
    expect(first?.tree).toBeNull();
    expect(second?.error?.message).toBe('syntax error at or near "t"');
    expect(second?.error?.position).toMatchObject({ offset: sql.indexOf("t;\nselect 3"), line: 3 });
    expect(sql.slice(second?.start.offset, second?.end.offset)).toBe("select 'x' frm t");
    // The statements around it keep trees whose locations count from the script's start.
    expect(locations(last?.tree)).toContainEqual(["A_Const", sql.indexOf("4")]);
    expect(last?.start).toMatchObject({ offset: sql.indexOf("select 3"), line: 4, column: 1 });
  });

  it("counts bytes in UTF-8 and offsets, lines and columns as the editor does", async () => {
    const parse = await loadParse();
    const sql = "select 'é😀', x\r\nfrom t; select 'ü', y frm z";
    const parsed = parse(sql);
    const [first, second] = parsed.statements;
    const x = sql.indexOf("x\r");
    expect(locations(first?.tree)).toContainEqual(["ColumnRef", bytes(sql.slice(0, x))]);
    const positions = createPositions(sql);
    expect(positions.at(bytes(sql.slice(0, x)))).toEqual({
      byte: bytes(sql.slice(0, x)),
      offset: x,
      line: 1,
      column: x + 1,
    });
    expect(first?.end).toMatchObject({ offset: sql.indexOf(";"), line: 2, column: 7 });
    const z = sql.indexOf("z");
    expect(second?.error?.position).toEqual({
      byte: bytes(sql.slice(0, z)),
      offset: z,
      line: 2,
      column: z - sql.indexOf("from") + 1,
    });
  });

  it("parses every statement kind of the corpus", async () => {
    const parse = await loadParse();
    const read = STATEMENTS.map(([, sql]) => {
      const { statements } = parse(sql);
      return [statements.length, statements[0]?.kind ?? statements[0]?.error?.message, sql];
    });
    expect(read).toEqual(STATEMENTS.map(([kind, sql]) => [1, kind, sql]));
    expect(new Set(STATEMENTS.map(([kind]) => kind)).size).toBeGreaterThanOrEqual(80);
  });

  it("keeps a routine's body an opaque string", async () => {
    const parse = await loadParse();
    const body = " BEGIN NEW.at := now(); RETURN NEW; END; ";
    const sql = `create function touch() returns trigger language plpgsql as $fn$${body}$fn$`;
    const [statement] = parse(sql).statements;
    const kinds: string[] = [];
    const strings: string[] = [];
    walk(statement?.tree, (kind, fields) => {
      kinds.push(kind);
      if (kind === "String") strings.push(fields.sval);
    });
    expect(strings).toContain(body);
    expect(kinds).not.toContain("ReturnStmt");
    expect(kinds).not.toContain("ColumnRef");
  });

  it("reads scripts without statements, and a NUL does not end the script", async () => {
    const parse = await loadParse();
    expect(parse("").statements).toEqual([]);
    expect(parse("  -- only a comment\n/* and another */ ;;").statements).toEqual([]);
    const parsed = parse("select 1;\0select 2");
    expect(parsed.statements).toHaveLength(2);
    expect(parsed.statements[1]?.start.offset).toBe(10);
  });
});

describe("positions", () => {
  it("turns bytes, offsets and characters into each other around wide characters", () => {
    const text = "aé😀\nb";
    const positions = createPositions(text);
    expect(positions.bytes).toBe(bytes(text));
    expect([0, 1, 3, 7, 8, 9].map((b) => positions.at(b).offset)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(positions.at(4)).toEqual({ byte: 3, offset: 2, line: 1, column: 3 });
    expect(positions.ofCharacter(3)).toEqual({ byte: 7, offset: 4, line: 1, column: 5 });
    expect(positions.ofCharacter(4)).toEqual({ byte: 8, offset: 5, line: 2, column: 1 });
    expect(positions.characterOf(5)).toBe(4);
    expect(positions.byteOf(6)).toBe(9);
  });
});
