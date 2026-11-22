import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  type DbConnectPermission,
  type StubDatabase,
  stubCommands,
} from "./index";

// The stub's db.describe (ADR 0353): what a scripted statement takes and answers, without running
// it; and db.run's bound values reach the script's `answer`.
const DB = { caller: "example.database" };
const scope: DbConnectPermission = { permission: "db:connect", hosts: ["db.example.test:5432"] };
const column = { typeModifier: -1, typeSize: -1, tableOid: 0, columnNumber: 0 };
const heard: { sql: string; params?: unknown[]; paramTypes?: number[] }[] = [];
const SCRIPT: StubDatabase = {
  statements: [
    {
      sql: "SELECT name FROM t WHERE id = $1",
      paramTypes: [23],
      columns: [{ name: "name", typeOid: 25, ...column }],
      rows: [["ran"]],
    },
    { sql: "INSERT INTO t VALUES ($1)", paramTypes: [23], tag: "INSERT 0 1" },
    {
      sql: "SELECT nope FROM t",
      error: {
        severity: "ERROR",
        localSeverity: "ERROR",
        code: "42703",
        message: 'column "nope" does not exist',
        position: 8,
      },
    },
  ],
  answer: (sql, _session, bound) => {
    heard.push({ sql, ...bound });
    return sql === "SELECT $1"
      ? { sql, columns: [{ name: "v", typeOid: 25, ...column }] }
      : undefined;
  },
};

async function setup() {
  const core = stubCommands(() => {}, { grants: { [DB.caller]: [scope] }, db: SCRIPT });
  const client = new BridgeClient(browserStub(core.handlers));
  const params = { engine: "postgresql", host: "db.example.test", database: "shop", user: "r" };
  const opened = await client.call("db.open", { ...params, scope }, DB);
  return { client, sessionId: opened.sessionId ?? "" };
}

describe("stub db.describe", () => {
  it("answers the parameter types and the columns, and runs nothing", async () => {
    const { client, sessionId } = await setup();
    const sql = "SELECT name FROM t WHERE id = $1";
    const described = await client.call("db.describe", { sessionId, sql }, DB);
    expect(described.paramTypes).toEqual([23]);
    expect(described.columns?.map((c) => c.name)).toEqual(["name"]);
    expect(described.transaction).toBe("idle");
    const list = await client.call("db.list", {}, DB);
    expect(list.sessions[0]?.more).toBe(false);
  });

  it("answers NoData for a write and the server's error with its position", async () => {
    const { client, sessionId } = await setup();
    const write = await client.call(
      "db.describe",
      { sessionId, sql: "INSERT INTO t VALUES ($1)" },
      DB,
    );
    expect(write).toEqual({ paramTypes: [23], transaction: "idle" });
    const wrong = await client.call("db.describe", { sessionId, sql: "SELECT nope FROM t" }, DB);
    expect(wrong.error?.position).toBe(8);
    expect(wrong.paramTypes).toEqual([]);
  });

  it("hands db.run's and db.script's bound values to the script", async () => {
    const { client, sessionId } = await setup();
    heard.length = 0;
    await client.call(
      "db.run",
      { sessionId, sql: "SELECT $1", params: ["it's"], paramTypes: [25] },
      DB,
    );
    await client.call(
      "db.script",
      { sessionId, statements: [{ sql: "SELECT $1", params: [null], paramTypes: [25] }] },
      DB,
    );
    expect(heard).toEqual([
      { sql: "SELECT $1", params: ["it's"], paramTypes: [25] },
      { sql: "SELECT $1", params: [null], paramTypes: [25] },
    ]);
  });
});
