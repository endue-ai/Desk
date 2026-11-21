// Plans captured from real PostgreSQL servers, 13 to 18 (pg<major>.jsonl: a line with the version,
// then a line per plan as EXPLAIN (FORMAT JSON) printed it). Every server ran the same script: a
// table of 2,000 customers and one of 60,000 orders, with work_mem at 64kB and hash and merge
// joins off where a plan needs a nested loop, so the plans hold a misestimate, a sort and a hash
// that spill, a nested loop of 1,200 loops, filters after scans, and a write with a trigger, run
// in a transaction that was rolled back.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Captured {
  version: string;
  num: number;
  plans: Record<string, unknown>;
}

const folder = join("plugins", "database", "tests", "plans");

/** Every captured server's plans, oldest first. */
export function captured(): Captured[] {
  return readdirSync(folder)
    .filter((name) => /^pg\d+\.jsonl$/u.test(name))
    .sort((a, b) => Number(a.slice(2, -6)) - Number(b.slice(2, -6)))
    .map((name) => {
      const [head, ...lines] = readFileSync(join(folder, name), "utf8").trim().split("\n");
      const { version, num } = JSON.parse(head ?? "{}");
      const plans: Record<string, unknown> = {};
      for (const line of lines) {
        const { name: key, plan } = JSON.parse(line);
        plans[key] = plan;
      }
      return { version, num, plans };
    });
}

/** A captured plan as psql's one-column result set gives it: the JSON text, laid out. */
export function setOf(plan: unknown) {
  return { columns: ["QUERY PLAN"], rows: [[JSON.stringify(plan, null, 2)]], truncated: false };
}
