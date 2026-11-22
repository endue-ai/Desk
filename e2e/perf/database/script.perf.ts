// A 1 MB script's problems (PG-30, ADR 0294) and warnings (ADR 0328): checked whole in the real parse
// worker across its thread, then again after an edit, which parses the statement edited alone; and
// with its warnings, in process. These were the 1 MB budgets of problems-incremental.test.ts and
// warnings.test.ts, which keep their checks of what is found (ADR 0362). Timed on the process's CPU
// clock, the worker thread's included: the work, not the machine's other runs. No server.
import { describe, expect, it } from "vitest";
import { checker, PROBLEM_MODEL } from "../../../plugins/database/tests/problems-fixture";
import { WARN_MODEL } from "../../../plugins/database/tests/warnings-fixture";
import { createSqlParser } from "../../../plugins/database/ui/sql/parse/client.js";
import { cpuClock, fastest } from "../lib/calibrated";
import { calibration, hold } from "./hold";
import { threadWorker } from "./worker";

const MB = 1024 * 1024;

function scriptOf(unit: (n: number) => string) {
  let script = "";
  for (let n = 0; script.length < MB; n++) script += `${unit(n)};\n`;
  return script;
}

const PROBLEMS = scriptOf((n) =>
  [
    `select p.id, p.name, sum(o.total) as total from people p join orders o on o.person = p.id where p.email is not null and o.total > ${n} group by p.id, p.name order by total desc limit 10`,
    `insert into orders (id, person, total) values (${n}, 2, 3.5), (2, 3, 4.5) on conflict (id) do update set total = excluded.total`,
    `update people set name = 'x', email = 'é😀' where id in (select person from orders where total > ${n})`,
    `with t as (select person, count(*) c from orders group by person) select * from people join t on t.person = people.id and t.c > ${n}`,
    `delete from orders where person not in (select id from people) and id > ${n} returning *`,
  ].join(";\n"),
);

const WARNED = scriptOf((n) =>
  [
    `select p.id, p.name from people p join orders o on o.person = p.id where p.email = 'x' and o.total > ${n} order by p.id limit 10`,
    `select * from people where name = null and id not in (select person from orders) limit ${n}`,
    `update people set name = 'x' where lower(email) = 'a' and id = 1.5`,
    `insert into people values (${n}, 'a')`,
  ].join(";\n"),
);

const edit = (script: string) => script.replace("o.total > 7 ", "o.totl > 7 ");

describe("a 1 MB script", () => {
  it("is checked for problems in the worker, and again after an edit", async () => {
    const parser = createSqlParser(threadWorker);
    try {
      const options = { syntax: true, names: true };
      // The worker's start and its first model, before anything is timed.
      await parser.check("select 1", PROBLEM_MODEL, { ...options, doc: "warm" });
      let at = calibration(cpuClock);
      const first = await fastest(
        3,
        async (run) => {
          const done = await parser.check(PROBLEMS, PROBLEM_MODEL, { ...options, doc: `a${run}` });
          expect(done.problems).toEqual([]);
        },
        cpuClock,
      );
      hold("script.problemsMs", first, at);
      const edited = edit(PROBLEMS);
      at = calibration(cpuClock);
      const again = await fastest(3, async (run) => {
        await parser.check(PROBLEMS, PROBLEM_MODEL, { ...options, doc: `b${run}` });
        const at = cpuClock();
        const next = await parser.check(edited, PROBLEM_MODEL, { ...options, doc: `b${run}` });
        const ms = cpuClock() - at;
        expect(next.parsed).toBe(1);
        expect(next.problems).toHaveLength(1);
        return ms;
      });
      hold("script.problemsAgainMs", again, at);
    } finally {
      parser.close();
    }
  });

  it("is checked with its warnings, and again after an edit", async () => {
    const c = await checker();
    let at = calibration(cpuClock);
    const first = await fastest(
      3,
      (run) => {
        const done = c.check({ sql: WARNED, doc: `w${run}`, warnings: true }, WARN_MODEL);
        expect(done.problems.length).toBeGreaterThan(100);
      },
      cpuClock,
    );
    hold("script.warningsMs", first, at);
    const edited = edit(WARNED);
    at = calibration(cpuClock);
    const again = await fastest(3, (run) => {
      c.check({ sql: WARNED, doc: `v${run}`, warnings: true }, WARN_MODEL);
      const at = cpuClock();
      const next = c.check({ sql: edited, doc: `v${run}`, warnings: true }, WARN_MODEL);
      const ms = cpuClock() - at;
      expect(next.parsed).toBe(1);
      return ms;
    });
    hold("script.warningsAgainMs", again, at);
  });
});
