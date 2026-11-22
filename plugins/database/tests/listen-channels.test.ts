// The channels a console listens to (PG-25, ADR 0358), read from the statements it ran: LISTEN,
// UNLISTEN, UNLISTEN * and DISCARD ALL, taking effect at COMMIT inside a transaction and dropped at
// ROLLBACK, in a failed transaction and in a dry run; the list keeps 1,000 notifications and counts
// what it dropped and what is unseen.
import { describe, expect, it } from "vitest";
import type { RunResult } from "../ui/engines/common.js";
import { split } from "../ui/sql/split.js";
import { createListening, KEEP, listens } from "../ui/session/listen.js";

type Mode = "run" | "transaction" | "dry-run";
const OWNER = "console:c-pg:1";

/** A run of `sql` in which every statement ran, but those `failing` names. */
function ran(sql: string, failing: number[] = []) {
  const statements = split(sql, "postgresql");
  const result: RunResult = {
    statements: statements.map((_, index) => ({
      index,
      ran: true,
      sets: [],
      affected: null,
      warnings: 0,
      notices: [],
      ...(failing.includes(index) ? { error: { kind: "sql", message: "failed" } } : {}),
    })),
    notices: [],
    ms: 0,
  };
  return { statements, result };
}

function listening() {
  const l = createListening({ now: () => 0 });
  const run = (sql: string, mode: Mode = "run", before: "idle" | "open" | "failed" = "idle", failing: number[] = []) => {
    const { statements, result } = ran(sql, failing);
    l.ran(OWNER, statements, result, mode, before);
    return l.model(OWNER)?.channels ?? [];
  };
  return { l, run };
}

describe("the channels a console listens to", () => {
  it("LISTEN adds, UNLISTEN takes one or all, DISCARD ALL takes all, a quoted name keeps its case", () => {
    const { run } = listening();
    expect(run('LISTEN Jobs; listen "Orders"; LISTEN jobs')).toEqual(["Orders", "jobs"]);
    expect(run("UNLISTEN jobs")).toEqual(["Orders"]);
    expect(run('LISTEN a; UNLISTEN *')).toEqual([]);
    expect(run("LISTEN a; LISTEN b; DISCARD ALL")).toEqual([]);
  });

  it("inside a transaction they wait for COMMIT, and go at ROLLBACK or when it failed", () => {
    const { run } = listening();
    expect(run("BEGIN; LISTEN a")).toEqual([]);
    expect(run("COMMIT")).toEqual(["a"]);
    expect(run("BEGIN; LISTEN b; ROLLBACK")).toEqual(["a"]);
    expect(run("BEGIN; LISTEN c; SELECT 1/0; COMMIT", "run", "idle", [2])).toEqual(["a"]);
    expect(run("LISTEN d", "run", "open")).toEqual(["a"]);
    expect(run("ROLLBACK TO SAVEPOINT s; COMMIT", "run", "open")).toEqual(["a", "d"]);
  });

  it("a run in one transaction commits them at its end; a dry run and a failed one do not", () => {
    const { run } = listening();
    expect(run("LISTEN a; LISTEN b", "transaction")).toEqual(["a", "b"]);
    expect(run("UNLISTEN a", "dry-run")).toEqual(["a", "b"]);
    expect(run("UNLISTEN a; SELECT 1/0", "transaction", "idle", [1])).toEqual(["a", "b"]);
  });

  it("a statement that failed changes nothing", () => {
    const { run } = listening();
    expect(run("LISTEN a", "run", "idle", [0])).toEqual([]);
  });

  it("keeps the latest 1,000, counts what it dropped and what is unseen, and Clear empties it", () => {
    const { l, run } = listening();
    run("LISTEN jobs");
    for (let i = 0; i < KEEP + 250; i++) l.heard(OWNER, { channel: "jobs", payload: String(i), pid: 7 });
    const model = l.model(OWNER);
    expect(model?.heard).toHaveLength(KEEP);
    expect(model?.heard[0]?.payload).toBe("250");
    expect([model?.dropped, model?.unseen]).toEqual([250, KEEP + 250]);
    l.seen(OWNER);
    expect(l.model(OWNER)?.unseen).toBe(0);
    l.clear(OWNER);
    expect(l.model(OWNER)).toMatchObject({ heard: [], dropped: 0, channels: ["jobs"] });
  });

  it("a session that ends stops them, kept to be offered again until a LISTEN", () => {
    const { l, run } = listening();
    run("LISTEN a; LISTEN b");
    expect(l.listening(OWNER)).toBe(true);
    expect(l.ended(OWNER)).toEqual(["a", "b"]);
    expect(l.listening(OWNER)).toBe(false);
    expect(l.model(OWNER)).toMatchObject({ channels: [], stopped: ["a", "b"] });
    run("LISTEN a");
    expect(l.model(OWNER)).toMatchObject({ channels: ["a"], stopped: [] });
  });

  it("names what an agent's run may not hold", () => {
    const [listen, unlisten, all, discard, select] = split(
      "LISTEN a; UNLISTEN a; UNLISTEN *; DISCARD ALL; SELECT 1",
      "postgresql",
    );
    expect([listen, unlisten, all, discard, select].map((s) => s && listens(s))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
