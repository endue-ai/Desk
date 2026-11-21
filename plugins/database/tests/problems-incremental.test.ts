// The SQL problems as the person types (PG-30, ADR 0294): the worker parses only the statements that
// changed, the page never sends a stale request, the server's answer wins over the check, and 1 MB
// of SQL is checked in the real parse worker (in a Node worker thread) within budget.
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { createChecks } from "../ui/diagnose/requests.js";
import { createSqlParser } from "../ui/sql/parse/client.js";
import { checker, PROBLEM_MODEL } from "./problems-fixture";

const THREAD = new URL("./parse-worker-thread.mjs", import.meta.url);

/** startWorker for Node: the module in a worker thread, behind a page Worker's surface. */
function threadWorker(url: URL) {
  const thread = new Worker(THREAD, { workerData: { url: url.href } });
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { message: string }) => void) | null,
    postMessage: (message: unknown) => thread.postMessage(message),
    terminate: () => void thread.terminate(),
  };
  thread.on("message", (data) => worker.onmessage?.({ data }));
  thread.on("error", (error: Error) => worker.onerror?.({ message: error.message }));
  return worker as unknown as globalThis.Worker;
}

const statements = (n: number) =>
  Array.from({ length: n }, (_, i) => `select id, name from people where id = ${i}`);

describe("SQL problems as the person types", () => {
  it("only the statements that changed are parsed again", async () => {
    const c = await checker();
    const list = statements(40);
    const first = c.check({ sql: list.join(";\n") });
    expect(first).toMatchObject({ problems: [], statements: 40, parsed: 40 });
    c.parsed.length = 0;
    expect(c.check({ sql: list.join(";\n") })).toMatchObject({ problems: [], parsed: 0 });
    expect(c.parsed).toEqual([]);

    list[10] = "select id, emial from people where id = 10";
    const edited = c.check({ sql: list.join(";\n") });
    expect(edited.parsed).toBe(1);
    expect(c.parsed).toEqual([list[10]]);
    expect(edited.problems.map((p) => p.message.split("\n")[0])).toEqual([
      'column "emial" does not exist',
    ]);

    // A statement that changes what the ones after it see makes them bind again.
    list[20] = "set search_path to app";
    const steered = c.check({ sql: list.join(";\n") });
    expect(steered.parsed).toBe(20);
    expect(steered.problems.map((p) => p.message.split("\n")[0])).toEqual([
      'column "emial" does not exist',
      ...Array.from({ length: 19 }, () => 'column "name" does not exist'),
    ]);
    list[20] = "create table made (a int)";
    expect(c.check({ sql: list.join(";\n") }).parsed).toBe(20);
    // Another console keeps its own statements.
    c.parsed.length = 0;
    expect(c.check({ doc: "other", sql: list.slice(0, 3).join(";\n") }).parsed).toBe(3);
  });

  it("a stale request is never sent and the newest wins", async () => {
    const sent: string[] = [];
    const answers: Array<(value: unknown) => void> = [];
    const parser = {
      check: vi.fn((sql: string) => {
        sent.push(sql);
        return new Promise((resolve) => answers.push(resolve));
      }),
    };
    const checks = createChecks(() => parser as never);
    const context = { model: PROBLEM_MODEL, searchPath: [], user: "", syntax: true, names: true };
    const a = checks.check("c1", "select 1", context);
    const b = checks.check("c1", "select 12", context);
    const c = checks.check("c1", "select 123", context);
    const other = checks.check("c2", "select 9", context);
    expect(sent).toEqual(["select 1", "select 9"]);
    answers[0]?.({ problems: [], statements: 1, parsed: 1 });
    expect(await a).toMatchObject({ statements: 1 });
    await vi.waitFor(() => expect(sent).toEqual(["select 1", "select 9", "select 123"]));
    answers[2]?.({ problems: [{ from: 0, to: 1, kind: "syntax", message: "x" }], statements: 1 });
    expect(await b).toEqual(await c);
    expect((await c)?.problems).toHaveLength(1);
    answers[1]?.({ problems: [], statements: 1, parsed: 1 });
    expect(await other).toMatchObject({ statements: 1 });
    // A parser that fails answers null, and the next request is sent.
    parser.check.mockImplementationOnce(() => Promise.reject(new Error("stopped")));
    expect(await checks.check("c1", "select 1", context)).toBeNull();
  });

  it("the server's answer wins", async () => {
    const c = await checker();
    const sql = "select * from ghost;\nselect * from peple;\nselect emial from people";
    const ok = { ok: true } as const;
    const refused = { message: 'relation "peple" does not exist', at: 14 };
    const won = c.check({
      sql,
      answers: [
        ["select * from ghost", ok],
        ["select * from peple", refused],
      ],
    });
    expect(won.problems.map((p) => [sql.slice(p.from, p.to), p.kind, p.message])).toEqual([
      ["peple", "server", 'relation "peple" does not exist'],
      ["emial", "names", expect.stringContaining('column "emial" does not exist')],
    ]);

    // The page keeps the answers of a console's runs by statement text.
    const checks = createChecks(() => undefined);
    const execution = {
      at: 1,
      statements: [
        { text: "select * from ghost" },
        { text: "select * from peple" },
        { text: "select 1" },
      ],
      result: {
        statements: [
          { index: 0, ran: true, sets: [] },
          {
            index: 1,
            ran: true,
            sets: [],
            error: { kind: "sql", message: refused.message, position: 14 },
          },
          { index: 2, ran: false, sets: [] },
        ],
      },
    };
    expect(checks.remember("c1", execution as never)).toBe(true);
    expect(checks.remember("c1", execution as never)).toBe(false);
    expect(checks.answers("c1")).toEqual([
      ["select * from ghost", ok],
      ["select * from peple", refused],
    ]);
    expect(checks.answers("c2")).toEqual([]);
    // Once the text changes, the answer no longer applies.
    const edited = c.check({ sql: sql.replace("ghost", "ghosts"), answers: checks.answers("c1") });
    expect(edited.problems.map((p) => sql.replace("ghost", "ghosts").slice(p.from, p.to))).toEqual([
      "ghosts",
      "peple",
      "emial",
    ]);
  });

  it("1 MB of SQL is checked in the worker within budget", async () => {
    const unit = (n: number) =>
      [
        `select p.id, p.name, sum(o.total) as total from people p join orders o on o.person = p.id where p.email is not null and o.total > ${n} group by p.id, p.name order by total desc limit 10`,
        `insert into orders (id, person, total) values (${n}, 2, 3.5), (2, 3, 4.5) on conflict (id) do update set total = excluded.total`,
        `update people set name = 'x', email = 'é😀' where id in (select person from orders where total > ${n})`,
        `with t as (select person, count(*) c from orders group by person) select * from people join t on t.person = people.id and t.c > ${n}`,
        `delete from orders where person not in (select id from people) and id > ${n} returning *`,
      ].join(";\n");
    let script = "";
    for (let n = 0; script.length < 1024 * 1024; n++) script += `${unit(n)};\n`;
    const parser = createSqlParser(threadWorker);
    try {
      const options = { doc: "big", syntax: true, names: true };
      const first: number[] = [];
      const again: number[] = [];
      for (let run = 0; run < 3; run++) {
        const doc = `${options.doc}-${run}`;
        let at = performance.now();
        const done = await parser.check(script, PROBLEM_MODEL, { ...options, doc });
        first.push(performance.now() - at);
        expect(done.problems).toEqual([]);
        const edited = script.replace("o.total > 7 ", "o.totl > 7 ");
        at = performance.now();
        const next = await parser.check(edited, PROBLEM_MODEL, { ...options, doc });
        again.push(performance.now() - at);
        expect(next.parsed).toBe(1);
        expect(next.problems).toHaveLength(1);
      }
      const best = { first: Math.min(...first), again: Math.min(...again) };
      console.log(`problems, 1 MB in the worker: ${JSON.stringify(best)}`);
      expect(best.first).toBeLessThan(2000);
      expect(best.again).toBeLessThan(300);
    } finally {
      parser.close();
    }
  }, 60_000);
});
