// PL/pgSQL bodies against a real PostgreSQL (PG-35, ADR 0343), when ENDUE_DB_TEST_POSTGRES holds the
// URI of a scratch database, on the desk core's sessions (no psql). Routines the server creates and
// runs are told nothing; each one it refuses on CREATE is told as a syntax problem with the server's
// message on the line its position points to; each one that fails when called because a name is
// not declared is told on the line the server's context names. `r.` of a `%ROWTYPE` record completes
// with the columns the server lists, and a routine's source as the server writes it back
// (pg_get_functiondef: CREATE OR REPLACE) checks clean, and broken, fails where the check marks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbPage } from "../../../packages/bridge/src/index";
import type { SchemaModel } from "../ui/sql/parse/model.js";
import { createService } from "../ui/sql/parse/worker.js";
import { serverSession } from "./core-bridge";
import { checker, loadRaw } from "./problems-fixture";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const S = "t465_plpgsql";

const fn = (name: string, ...lines: string[]) =>
  `CREATE OR REPLACE FUNCTION ${name}(a int, b text) RETURNS int LANGUAGE plpgsql AS $$\n${lines.join("\n")}\n$$`;

/** Created and called with (2, 'Ada'): the server runs each. */
const RUNS: Array<[string, string]> = [
  [fn("r1", "declare x int := 1;", "begin", "  x := x + a;", "  return x;", "end"), "r1(2, 'Ada')"],
  [
    fn(
      "r2",
      "declare r people%rowtype;",
      "begin",
      "  select * into r from people where id = a;",
      "  return r.id;",
      "end",
    ),
    "r2(2, 'Ada')",
  ],
  [
    fn(
      "r3",
      "begin",
      "  for i in 1..a loop",
      "    raise notice '%', i;",
      "  end loop;",
      "  return 0;",
      "end",
    ),
    "r3(2, 'Ada')",
  ],
  [
    fn(
      "r4",
      "declare n int;",
      "begin",
      "  select count(*) into n from people where name = b;",
      "  if not found then return 0; end if;",
      "  return n;",
      "end",
    ),
    "r4(2, 'Ada')",
  ],
  [
    fn("r5", "<<blk>>", "declare x int;", "begin", "  blk.x := a;", "  return blk.x;", "end"),
    "r5(2, 'Ada')",
  ],
  [
    fn(
      "r6",
      "begin",
      "  return a / 0;",
      "exception when division_by_zero then",
      "  raise notice '% %', sqlstate, sqlerrm;",
      "  return -1;",
      "end",
    ),
    "r6(2, 'Ada')",
  ],
  [
    fn(
      "r7",
      "declare c cursor for select id from people; v int;",
      "begin",
      "  open c;",
      "  fetch c into v;",
      "  close c;",
      "  return v;",
      "end",
    ),
    "r7(2, 'Ada')",
  ],
  [
    fn("r8", "begin", "  return (select max(id) from people where name = b);", "end"),
    "r8(2, 'Ada')",
  ],
];

/** Refused on CREATE: the server's message and position. */
const REFUSED = [
  fn("e1", "begin", "  if a > 0 then", "    return 1", "  end if;", "end"),
  fn("e2", "begin", "  return a +;", "end"),
  fn("e3", "begin", "  select from where;", "end"),
  fn("e4", "begin", "  nope := 1;", "  return 1;", "end"),
  fn("e5", "declare x int;", "begin", "  x := 1;", "  retrun x;", "end"),
  fn("e6", "begin", "  loop", "    exit", "  end loop;", "  return 1;", "end"),
];

/** Created, then refused when called: a name nothing declares. */
const FAILS: Array<[string, string]> = [
  [fn("f1", "declare x int;", "begin", "  x := a + y;", "  return x;", "end"), "f1(2, 'Ada')"],
  [
    fn(
      "f2",
      "declare total int := 1;",
      "begin",
      "  if totl > 0 then return 1; end if;",
      "  return total;",
      "end",
    ),
    "f2(2, 'Ada')",
  ],
  [fn("f3", "begin", "  raise notice '%', missing;", "  return 1;", "end"), "f3(2, 'Ada')"],
];

/** The line of the statement an offset is on, from 1. */
const lineOf = (text: string, at: number) => text.slice(0, at).split("\n").length;
const bodyStart = (text: string) => lineOf(text, text.indexOf("$$"));

describe.skipIf(!uri)("PL/pgSQL bodies on a real PostgreSQL", () => {
  let own: Awaited<ReturnType<typeof serverSession>>;
  let model: SchemaModel;
  const page = (sql: string) => own.page(sql) as Promise<DbPage>;
  const ok = async (sql: string) => {
    const done = await page(sql);
    if (done.error) throw new Error(`${sql}: ${done.error.message}`);
    return done;
  };

  beforeAll(async () => {
    own = await serverSession(uri, "t465 plpgsql", { lock_timeout: "30s" });
    await ok(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
    await ok(`CREATE SCHEMA ${S}`);
    await ok(`SET search_path TO ${S}`);
    await ok("CREATE TABLE people (id int PRIMARY KEY, name text, email text, born date)");
    await ok(
      "INSERT INTO people VALUES (1, 'Ada', 'a@example.com', '1990-01-01'), (2, 'Bob', null, null)",
    );
    const columns = await ok(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '${S}' AND table_name = 'people' ORDER BY ordinal_position`,
    );
    model = {
      schemas: [
        {
          name: S,
          relations: [
            {
              name: "people",
              kind: "table",
              columns: columns.rows.map((r) => ({ name: String(r[0]), type: String(r[1]) })),
            },
          ],
          routines: [],
        },
      ],
    };
  }, 60_000);
  afterAll(async () => {
    await ok(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
    await own.close();
  }, 60_000);

  const check = async (sql: string) =>
    (await checker()).check({ sql, searchPath: [S], warnings: true }, model).problems;

  it("tells nothing of routines the server creates and runs", async () => {
    for (const [sql, call] of RUNS) {
      await ok(sql);
      await ok(`SELECT ${call}`);
      expect([sql, await check(sql)]).toEqual([sql, []]);
    }
  }, 60_000);

  it("tells each routine the server refuses on CREATE on the line its position points to", async () => {
    for (const sql of REFUSED) {
      const error = (await page(sql)).error;
      expect([sql, error?.position === undefined]).toEqual([sql, false]);
      const problems = await check(sql);
      expect([sql, problems.map((p) => p.kind)]).toEqual([sql, ["syntax"]]);
      const [p] = problems;
      expect([sql, p?.message.split("\n")[0]]).toEqual([sql, error?.message]);
      const server = lineOf(sql, (error?.position ?? 1) - 1);
      expect([sql, lineOf(sql, p?.from ?? 0)]).toEqual([sql, server]);
      expect(p?.message).toContain(`line ${server - bodyStart(sql) + 1} of the body`);
    }
  }, 60_000);

  it("tells a name nothing declares on the line the server's context names when it runs", async () => {
    for (const [sql, call] of FAILS) {
      await ok(sql);
      const error = (await page(`SELECT ${call}`)).error;
      expect([sql, error?.message]).toEqual([
        sql,
        expect.stringMatching(/^column ".+" does not exist$/u),
      ]);
      const problems = await check(sql);
      expect([sql, problems.map((p) => [p.kind, p.message.split("\n")[0]])]).toEqual([
        sql,
        [["names", error?.message]],
      ]);
      const line = Number(/line (\d+)/u.exec(error?.where ?? "")?.[1]);
      expect([sql, lineOf(sql, problems[0]?.from ?? 0) - bodyStart(sql) + 1]).toEqual([sql, line]);
    }
  }, 60_000);

  it("completes a %ROWTYPE record's fields with the columns the server lists", async () => {
    const service = createService(await loadRaw());
    service.answer({ type: "model", key: 1, model } as never);
    const sql = fn("c1", "declare r people%rowtype;", "begin", "  return r.|;", "end");
    const caret = sql.indexOf("|");
    const reply = service.answer({
      id: 1,
      type: "complete",
      doc: "live",
      sql: sql.replace("|", ""),
      caret,
      offset: 0,
      model: 1,
      searchPath: [S],
    } as never) as { result: { items: Array<{ label: string }> } };
    const listed = model.schemas[0]?.relations?.[0]?.columns?.map((c) => c.name) ?? [];
    expect(reply.result.items.map((i) => i.label).sort()).toEqual([...listed].sort());
    expect(listed).toEqual(["id", "name", "email", "born"]);
  });

  it("checks a routine's source as the server writes it back, and marks the line a broken one fails on", async () => {
    await ok(RUNS[3]?.[0] ?? "");
    const read = await ok(`SELECT pg_get_functiondef('${S}.r4'::regproc)`);
    const source = `${String(read.rows[0]?.[0]).trimEnd()};`;
    expect(source.startsWith(`CREATE OR REPLACE FUNCTION ${S}.r4(`)).toBe(true);
    expect(await check(source)).toEqual([]);
    const broken = source.replace("return n;", "retrun n;");
    const error = (await page(broken)).error;
    const problems = await check(broken);
    expect(problems.map((p) => [p.kind, broken.slice(p.from, p.to)])).toEqual([
      ["syntax", "retrun"],
    ]);
    expect(lineOf(broken, problems[0]?.from ?? 0)).toBe(lineOf(broken, (error?.position ?? 1) - 1));
    await ok(source);
  }, 60_000);
});
