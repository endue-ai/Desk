// A Submit the lost connection interrupted (PG-105, ADR 0355): ended before COMMIT, nothing was
// committed (the server rolls an open transaction back when its session ends) and the changes stay
// pending; ended during COMMIT, whether the server committed is unknown, and the words say how to
// check; a COMMIT the server refused changed nothing.
import { describe, expect, it } from "vitest";
import { editCell, emptyChanges, targetOf } from "../ui/edit/pending.js";
import { submitChanges } from "../ui/edit/submit.js";

const set = {
  columns: ["id", "name"],
  rows: [
    ["1", "ann"],
    ["2", "bob"],
  ] as (string | null)[][],
  truncated: false,
};
const made = targetOf(
  "postgresql",
  { schema: "app", name: "people" },
  set.columns,
  set.columns.map((name, i) => ({ name, type: i === 0 ? "integer" : "text", primary: i === 0 })),
);
if (!made.target) throw new Error(made.reason);
const target = made.target;

const ok = (index: number) => ({
  index,
  ran: true,
  sets: [],
  affected: 1,
  warnings: 0,
  notices: [],
});
const notRun = (index: number) => ({
  index,
  ran: false,
  sets: [],
  affected: null,
  warnings: 0,
  notices: [],
});
const TERMINATED = {
  kind: "sql",
  code: "57P01",
  message: "terminating connection due to administrator command",
};

function submit(result: Record<string, unknown>) {
  const changes = emptyChanges();
  editCell(changes, target, set, 0, 1, "ann b");
  editCell(changes, target, set, 1, 1, "bob c");
  const execute = async () =>
    ({ result: { notices: [], ms: 1, ...result }, statements: [], at: 0 }) as never;
  return submitChanges({ execute, conn: {} as never, target, set, changes });
}

describe("a Submit the lost connection interrupted", () => {
  it("ended at a statement before COMMIT: nothing was committed, and the changes stay to submit again", async () => {
    const done = await submit({
      statements: [ok(0), { ...ok(1), affected: null, error: TERMINATED }],
    });
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(
      /^Not committed: the session ended at row 2 \(update\), before COMMIT, so the server rolled the changes back\. They are still pending: Submit again once the server answers\./u,
    );
  });

  it("whose call failed before COMMIT says the same", async () => {
    const done = await submit({
      statements: [
        ok(0),
        { ...ok(1), error: { kind: "client", message: "The session ended: io_error" } },
      ],
    });
    expect(done.message).toMatch(/^Not committed: the session ended/u);
  });

  it("ended during COMMIT: unknown, with how to check", async () => {
    const done = await submit({
      statements: [ok(0), ok(1)],
      error: { ...TERMINATED, message: TERMINATED.message },
    });
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(
      /^Unknown whether the server committed 2 changes: the session ended while COMMIT was on its way\. They are still pending\. Refresh reads the rows again: if the changes are there, Revert them; if not, Submit again\./u,
    );
    const io = await submit({
      statements: [ok(0), ok(1)],
      error: { kind: "client", message: "COMMIT: the session has ended" },
    });
    expect(io.message).toMatch(/^Unknown whether the server committed/u);
  });

  it("a COMMIT the server refused changed nothing", async () => {
    const done = await submit({
      statements: [ok(0), ok(1)],
      error: { kind: "sql", code: "40001", message: "could not serialize access" },
    });
    expect(done.message).toBe("Nothing was changed: could not serialize access");
  });

  it("BEGIN that could not be sent changed nothing", async () => {
    const done = await submit({
      statements: [notRun(0), notRun(1)],
      error: { kind: "client", message: "BEGIN: the session has ended" },
    });
    expect(done.message).toMatch(/^Nothing was changed: /u);
  });
});
