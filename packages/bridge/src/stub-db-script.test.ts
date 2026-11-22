import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  type DbConnectPermission,
  type StubDatabase,
  stubCommands,
} from "./index";

// The stub's db.script (ADR 0344): several statements in one call, each answered with its own
// first page and notices, stopping as the core's does.
const DB = { caller: "example.database" };
const scope: DbConnectPermission = { permission: "db:connect", hosts: ["db.example.test:5432"] };
const note = (message: string) => ({
  severity: "NOTICE",
  localSeverity: "NOTICE",
  code: "00000",
  message,
});
const SCRIPT: StubDatabase = {
  statements: [
    { sql: "INSERT 1", tag: "INSERT 0 1", notices: [note("one")] },
    { sql: "INSERT 2", tag: "INSERT 0 1" },
    {
      sql: "SELECT many",
      columns: [
        {
          name: "n",
          typeOid: 23,
          typeModifier: -1,
          typeSize: 4,
          tableOid: 0,
          columnNumber: 0,
        },
      ],
      rows: Array.from({ length: 5 }, (_, i) => [String(i)]),
    },
    { sql: "SELECT 1/0", error: { ...note("division by zero"), code: "22012" } },
    { sql: /pg_sleep/, waits: true },
  ],
};

async function setup() {
  const core = stubCommands(() => {}, { grants: { [DB.caller]: [scope] }, db: SCRIPT });
  const client = new BridgeClient(browserStub(core.handlers));
  const params = { engine: "postgresql", host: "db.example.test", database: "shop", user: "r" };
  const opened = await client.call("db.open", { ...params, scope }, DB);
  const sessionId = opened.sessionId ?? "";
  const script = (sqls: string[], more: Record<string, unknown> = {}) =>
    client.call(
      "db.script",
      { sessionId, statements: sqls.map((sql) => ({ sql })), ...more },
      DB,
    );
  return { client, sessionId, script };
}

describe("the stub's db.script, as the core serves it (ADR 0344)", () => {
  it("answers each statement's first page in order, with its own notices", async () => {
    const { script } = await setup();
    const done = await script(["INSERT 1", "INSERT 2"]);
    expect(done.pages.map((p) => [p.tag, p.notices?.map((n) => n.message)])).toEqual([
      ["INSERT 0 1", ["one"]],
      ["INSERT 0 1", undefined],
    ]);
    expect(done.cancelled).toBeUndefined();
  });

  it("stops at the first error unless it goes on, and after a page with more", async () => {
    const { script, client, sessionId } = await setup();
    const stopped = await script(["INSERT 1", "SELECT 1/0", "INSERT 2"]);
    expect(stopped.pages.map((p) => p.error?.code)).toEqual([undefined, "22012"]);
    const went = await script(["INSERT 1", "SELECT 1/0", "INSERT 2"], { goOn: true });
    expect(went.pages).toHaveLength(3);
    const open = await script(["SELECT many", "INSERT 2"], { pageRows: 2 });
    expect(open.pages.map((p) => p.more)).toEqual([true]);
    const rest = await client.call("db.fetch", { sessionId, pageRows: 10 }, DB);
    expect(rest.rows).toHaveLength(3);
    await expect(script([])).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("a cancel stops it in a statement and before the next", async () => {
    const { script, client, sessionId } = await setup();
    const running = script(["INSERT 1", "SELECT pg_sleep(9)", "INSERT 2"], { goOn: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await client.call("db.list", {}, DB)).sessions[0]?.running).toBe(true);
    await expect(
      client.call("db.run", { sessionId, sql: "INSERT 2" }, DB),
    ).rejects.toMatchObject({ code: "invalid_params" });
    await client.call("db.cancel", { sessionId }, DB);
    const done = await running;
    expect(done.pages.map((p) => p.error?.code)).toEqual([undefined, "57014"]);
    expect(done.cancelled).toBe(true);
  });
});
