// A PostgreSQL notice is shown with the statement that raised it, whatever order the frame hears
// things in (#541, ADR 0334): a statement's notices come with its page, the last statement's
// included; those of the plugin's own COMMIT are the run's; a notice the session sends after an
// answer (a db.notice event) is the session's own, never the next statement's.
import { describe, expect, it } from "vitest";
import type { Script } from "./harness";
import { shop, run as typed } from "./session-helpers";

const script: Script = (sql) => {
  if (sql === "insert into t values (1)")
    return { notices: ["NOTICE:  first raised"], afterwards: ["NOTICE:  from a trigger"] };
  if (sql === "insert into t values (2)") return { notices: ["WARNING:  last raised"] };
  if (sql === "COMMIT") return { notices: ["NOTICE:  deferred check ran"] };
  return {};
};

type Line = { level: string; text: string; statement: number };
const linesOf = (m: Awaited<ReturnType<typeof shop>>): Line[] =>
  (m.shown()?.shown?.tabs ?? []).flatMap((t) => (t.lines ?? []) as Line[]);
const notices = (lines: Line[]) =>
  lines.filter((l) => l.level === "notice").map((l) => [l.statement, l.text]);

describe("notices and the statements that raised them", () => {
  it("each statement's notices are on it, the last one's too, and the COMMIT's are the run's", async () => {
    const m = await shop({ script });
    await typed(
      m,
      "insert into t values (1);\ninsert into t values (2)",
      "endue.database.run-transaction",
    );
    const shown = notices(linesOf(m));
    expect(shown).toContainEqual([0, "NOTICE:  first raised"]);
    expect(shown).toContainEqual([1, "WARNING:  last raised"]);
    expect(shown).toContainEqual([-1, "NOTICE:  deferred check ran"]);
    expect(shown.filter(([, text]) => /raised|deferred/u.test(String(text)))).toHaveLength(3);
  });

  it("a notice that comes after its statement's answer is the session's own, never the next statement's", async () => {
    const m = await shop({ script });
    await typed(m, "insert into t values (1);\ninsert into t values (2)");
    const first = notices(linesOf(m));
    await m.settle();
    await typed(m, "select 1");
    const both = [...first, ...notices(linesOf(m))];
    const late = both.filter(([, text]) => /from a trigger/u.test(String(text)));
    expect(late).toEqual([[-1, "NOTICE:  from a trigger"]]);
    expect(first).toContainEqual([0, "NOTICE:  first raised"]);
    expect(first).toContainEqual([1, "WARNING:  last raised"]);
  });
});
