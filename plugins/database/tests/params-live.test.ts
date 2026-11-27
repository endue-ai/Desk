// Bound parameters and the check without running against a real server (PG-21, ADR 0353): the
// plugin asks with the types the server infers, sends the values beside the SQL on the desk core's
// sessions (core-bridge.ts), and quotes, NULL, arrays, json, bytea and timestamps come back exactly;
// a value shaped like an injection is stored as text; a check answers the server's error at its
// place and runs nothing, a write's on a read-only connection too. It runs when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database, as live.test.ts does.
import { describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { type Bound, numbered } from "../ui/editor/bind.js";
import { createBoundAsk } from "../ui/editor/bind-ask.js";
import { paramsOf } from "../ui/editor/params.js";
import type { Connection } from "../ui/engines/common.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { fromValues } from "../ui/settings.js";
import { split } from "../ui/sql/split.js";
import { sharedCore } from "./core-bridge";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const conn = (uri ? normalize({ ...fields, id: "c-live", name: "live" }) : {}) as Connection;

function onCore() {
  const core = sharedCore();
  const sessions = createSessions({ call: core.call, onEvent: core.onEvent } as never);
  return createExecutor({
    runner: { run: async () => Promise.reject(new Error("no client runs for PostgreSQL")) },
    output: { read: async () => Promise.reject(new Error("nothing to read")) },
    clients: { get: async () => Promise.reject(new Error("no client")) },
    sessions,
    settings: () => fromValues({}),
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message: string) => new Error(message),
  } as never);
}

const VALUES: Record<string, string> = {
  ":t": `it's "quoted" \\ and $1 and :t`,
  ":n": "NULL",
  ":tags": '{a,"b c",NULL}',
  ":j": '{"k": [1, "two", null]}',
  ":b": "\\x00ff10",
  ":at": "2026-11-22 10:11:12.123456+00",
  ":note": "'); drop table t454_vals; --",
};

describe.skipIf(!uri)("bound parameters and the check, on a real server", () => {
  it("values round-trip exactly as bound values, with the inferred types asked", async () => {
    const executor = onCore();
    const one = async (sql: string) => {
      const done = await executor.execute(conn, sql);
      const first = done.result.statements.find((s) => s.error);
      if (first?.error) throw new Error(first.error.message);
      return done.result.statements.at(-1)?.sets[0]?.rows ?? [];
    };
    await one(
      "drop table if exists t454_vals; create table t454_vals (t text, n int, tags text[], j jsonb, b bytea, at timestamptz, note text)",
    );
    const titles: string[] = [];
    const given = new Map(Object.entries(VALUES));
    let refused = 0;
    const ask = createBoundAsk({
      ask: async (title) => {
        titles.push(title);
        const key = /^Value for (:\w+)/u.exec(title)?.[1] ?? "";
        // The first answer for :n does not fit an integer: it is asked again.
        if (key === ":n" && refused++ === 0) return "abc";
        return given.get(key);
      },
      cancelled: (message) => new Error(message),
      execute: executor.execute,
      typed: new Map(),
    });
    const text =
      "insert into t454_vals (t, n, tags, j, b, at, note) values (:t, :n, :tags, :j, :b, :at, :note)";
    const { statements } = await ask(conn, split(text, "postgresql"), "c-live");
    expect(titles).toEqual([
      "Value for :t (text)",
      "Value for :n (integer)",
      "Value for :n (integer): integer takes a whole number",
      "Value for :tags (text[])",
      "Value for :j (jsonb)",
      "Value for :b (bytea)",
      "Value for :at (timestamp with time zone)",
      "Value for :note (text)",
    ]);
    expect(statements[0]?.text).toBe(
      "insert into t454_vals (t, n, tags, j, b, at, note) values ($1, $2, $3, $4, $5, $6, $7)",
    );
    const ran = await executor.execute(conn, text, { statements });
    expect(ran.result.statements[0]?.error).toBeUndefined();
    expect(ran.result.statements[0]?.affected).toBe(1);
    const rows = await one(
      "select t, n, tags::text, (tags[3] is null)::text, j::text, b::text, (at = '2026-11-22 10:11:12.123456+00')::text, note from t454_vals",
    );
    expect(rows).toEqual([
      [
        VALUES[":t"],
        null,
        VALUES[":tags"],
        "true",
        VALUES[":j"],
        "\\x00ff10",
        "true",
        VALUES[":note"],
      ],
    ]);
    expect(await one("select count(*) from t454_vals")).toEqual([["1"]]);
  });

  it("a check answers the server's error at its place and runs nothing, on a read-only connection too", async () => {
    const executor = onCore();
    await executor.execute(
      conn,
      "drop table if exists t454_check; create table t454_check (id int, name text)",
    );
    const checked = async (text: string, on: Connection) => {
      const [statement] = split(text, "postgresql");
      if (!statement) throw new Error("no statement");
      const sent = numbered(statement.text, paramsOf(statement.text, "postgresql"));
      const done = await executor.execute(on, text, {
        mode: "describe",
        statements: [
          { ...statement, text: sent.text, keys: sent.keys, shifts: sent.shifts } as Bound,
        ],
      });
      return done.result.statements[0] as {
        error?: { code?: string; position?: number };
        described?: { params: { key: string; type: string }[]; columns: { name: string }[] | null };
      };
    };
    const wrong = "select :long_name, nosuch from t454_check";
    const bad = await checked(wrong, conn);
    expect(bad.error?.code).toBe("42703");
    expect(bad.error?.position).toBe(wrong.indexOf("nosuch"));
    const write = await checked("insert into t454_check values (:id, :name)", {
      ...conn,
      readOnly: true,
    });
    expect(write.error).toBeUndefined();
    expect(write.described?.params).toEqual([
      { key: ":id", oid: 23, type: "integer" },
      { key: ":name", oid: 25, type: "text" },
    ]);
    expect(write.described?.columns).toBeNull();
    const read = await checked("select name, id + 1 as next from t454_check where id = $1", conn);
    expect(read.described?.columns?.map((c) => c.name)).toEqual(["name", "next"]);
    const count = await executor.execute(conn, "select count(*) from t454_check");
    expect(count.result.statements[0]?.sets[0]?.rows).toEqual([["0"]]);
  });
});
