import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type DbConnectPermission,
  type StubDatabase,
  type StubOptions,
  stubCommands,
} from "./index";

type Schema = { $id: string; $defs: Record<string, unknown> };
const specs = join(import.meta.dirname, "../../../specs");
const docs: Schema[] = ["plugin/v0", "item/v0", "view/v0", "connector/v0", "memory/v0", "agent/v0"]
  .concat(["market/v0", "bridge/v0"])
  .flatMap((folder) =>
    readdirSync(join(specs, folder))
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => JSON.parse(readFileSync(join(specs, folder, name), "utf8")) as Schema),
  );
const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
for (const doc of docs) ajv.addSchema(doc);
/** Whether `value` is a valid `target`, as the core's answers must be. */
const valid = (target: string, value: unknown) => {
  const doc = docs.find((d) => target in d.$defs);
  const validate = ajv.getSchema(`${doc?.$id}#/$defs/${target}`);
  if (!validate?.(value)) throw new Error(`${target}: ${JSON.stringify(validate?.errors)}`);
  return true;
};

const DB = { caller: "example.database" };
const scope: DbConnectPermission = { permission: "db:connect", hosts: ["db.example.test:5432"] };
const SCRIPT: StubDatabase = {
  password: "fixture-password",
  statements: [
    {
      sql: "SELECT id, note FROM orders",
      columns: [
        {
          name: "id",
          typeOid: 23,
          typeModifier: -1,
          typeSize: 4,
          tableOid: 16384,
          columnNumber: 1,
        },
        {
          name: "note",
          typeOid: 25,
          typeModifier: -1,
          typeSize: -1,
          tableOid: 16384,
          columnNumber: 2,
        },
      ],
      rows: Array.from({ length: 25 }, (_, i) => [
        `${i + 1}`,
        i === 0 ? null : i === 1 ? "" : "NULL",
      ]),
      notices: [{ severity: "NOTICE", localSeverity: "NOTICE", code: "00000", message: "hello" }],
    },
    { sql: /pg_sleep/, waits: true },
    {
      sql: "SELECT 1/0",
      error: {
        severity: "ERROR",
        localSeverity: "ERROR",
        code: "22012",
        message: "division by zero",
      },
    },
    { sql: "COPY orders FROM STDIN", copy: { direction: "in", columns: 2 } },
    { sql: "COPY orders TO STDOUT", copy: { direction: "out", data: "1\tada\n2\tbob\n" } },
  ],
};

function setup(options: StubOptions = {}) {
  const events: BridgeEvent[] = [];
  const core = stubCommands((event) => events.push(event), {
    grants: { [DB.caller]: [scope] },
    db: SCRIPT,
    ...options,
  });
  const client = new BridgeClient(browserStub(core.handlers));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const open = async (caller = DB) => {
    const params = {
      engine: "postgresql",
      host: "db.example.test",
      database: "shop",
      user: "reader",
    };
    const opened = await client.call(
      "db.open",
      { ...params, password: "fixture-password", scope },
      caller,
    );
    valid("DbOpenResult", opened);
    return opened.sessionId ?? "";
  };
  return { client, core, events, settle, open };
}

describe("the stub's database sessions, as the core serves db.* (ADR 0281)", () => {
  it("opens a session under the grant, and answers a refusal and a missing password as results", async () => {
    const { client, open } = setup();
    const base = {
      engine: "postgresql",
      host: "db.example.test",
      database: "shop",
      user: "reader",
    };
    expect(await open()).toBe("d-1");
    const asked = await client.call("db.open", { ...base, scope }, DB);
    expect(asked).toEqual({ needsPassword: true });
    const wrong = await client.call("db.open", { ...base, password: "no", scope }, DB);
    expect(valid("DbOpenResult", wrong) && wrong.error?.code).toBe("28P01");
    const other = { ...scope, hosts: ["db.example.test:6432"] };
    const outside = client.call("db.open", { ...base, port: 6432, scope: other }, DB);
    await expect(outside).rejects.toMatchObject({ code: "permission_denied" });
    const mysql = client.call("db.open", { ...base, engine: "mysql", scope }, DB);
    await expect(mysql).rejects.toMatchObject({ code: "unsupported" });
    const reserved = { ...base, settings: { Client_Encoding: "LATIN1" }, scope };
    await expect(client.call("db.open", reserved, DB)).rejects.toMatchObject({
      code: "invalid_params",
    });
    const agent = client.call("db.list", {}, { caller: "agent:helper" });
    await expect(agent).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("pages are exact, count every page, and keep NULL, '' and 'NULL' apart", async () => {
    const { client, open, events, settle } = setup();
    const sessionId = await open();
    const sql = "SELECT id, note FROM orders";
    const first = await client.call("db.run", { sessionId, sql, pageRows: 10 }, DB);
    expect(valid("DbPage", first) && first.rows.slice(0, 3)).toEqual([
      ["1", null],
      ["2", ""],
      ["3", "NULL"],
    ]);
    expect([first.rows.length, first.more, first.columns?.[0]?.typeOid]).toEqual([10, true, 23]);
    await settle();
    expect(events.find((e) => e.event === "db.notice")).toBeDefined();
    const listed = await client.call("db.list", {}, DB);
    expect(valid("DbListResult", listed) && listed.sessions[0]?.more).toBe(true);
    await client.call("db.fetch", { sessionId, pageRows: 10 }, DB);
    const last = await client.call("db.fetch", { sessionId, pageRows: 10 }, DB);
    expect(valid("DbPage", last) && [last.rows.length, last.more, last.tag, last.rowCount]).toEqual(
      [5, false, "SELECT 25", 25],
    );
    const none = client.call("db.fetch", { sessionId }, DB);
    await expect(none).rejects.toMatchObject({ code: "invalid_params" });
    const failed = await client.call("db.run", { sessionId, sql: "SELECT 1/0" }, DB);
    expect(valid("DbPage", failed) && failed.error?.code).toBe("22012");
    const limits = client.call("db.run", { sessionId, sql, pageRows: 0 }, DB);
    await expect(limits).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("one statement at a time, and cancel ends the running one with 57014", async () => {
    const { client, open } = setup();
    const sessionId = await open();
    const sleeping = client.call("db.run", { sessionId, sql: "SELECT pg_sleep(30)" }, DB);
    const busy = client.call("db.run", { sessionId, sql: "SELECT 1/0" }, DB);
    await expect(busy).rejects.toMatchObject({ code: "invalid_params" });
    expect((await client.call("db.list", {}, DB)).sessions[0]?.running).toBe(true);
    await client.call("db.cancel", { sessionId }, DB);
    const cancelled = await sleeping;
    expect(valid("DbPage", cancelled) && cancelled.error?.code).toBe("57014");
  });

  it("copies in by chunks and out in a page", async () => {
    const { client, open } = setup();
    const sessionId = await open();
    const start = await client.call("db.run", { sessionId, sql: "COPY orders FROM STDIN" }, DB);
    expect(valid("DbPage", start) && [start.more, start.copy?.direction]).toEqual([true, "in"]);
    const chunk = await client.call("db.copy", { sessionId, data: "1\tada\n" }, DB);
    expect(chunk.more).toBe(true);
    const params = { sessionId, data: btoa("2\tbob\n"), encoding: "base64" as const, done: true };
    const done = await client.call("db.copy", params, DB);
    expect(valid("DbPage", done) && [done.tag, done.rowCount]).toEqual(["COPY 2", 2]);
    const out = await client.call("db.run", { sessionId, sql: "COPY orders TO STDOUT" }, DB);
    expect(valid("DbPage", out) && [out.data, out.encoding]).toEqual(["1\tada\n2\tbob\n", "utf8"]);
  });

  it("a session is its caller's alone and ends with db.closed: closed, revoked, unloaded", async () => {
    const { client, core, events, open, settle } = setup({
      grants: { [DB.caller]: [scope], "example.other": [scope] },
    });
    const sessionId = await open();
    const theirs = client.call(
      "db.run",
      { sessionId, sql: "SELECT 1/0" },
      { caller: "example.other" },
    );
    await expect(theirs).rejects.toMatchObject({ code: "not_found" });
    await client.call("db.close", { sessionId }, DB);
    await client.call("db.close", { sessionId }, DB);
    const second = await open();
    const grantId = core.state().grants.find((g) => g.caller === DB.caller)?.grant.grantId ?? "";
    await client.call("perm.revoke", { grantId }, DB);
    const other = await open({ caller: "example.other" });
    core.drop("example.other");
    await settle();
    const closed = events.filter((e) => e.event === "db.closed");
    for (const event of closed) valid("BridgeEvent", event);
    expect(closed.map((e) => [e.data.sessionId, e.data.reason])).toEqual([
      [sessionId, "closed"],
      [second, "revoked"],
      [other, "unloaded"],
    ]);
    expect(closed.map((e) => core.audience(e))).toEqual([
      [DB.caller],
      [DB.caller],
      ["example.other"],
    ]);
  });

  it("a scripted server answers a statement its list lacks from its answer function, with the session it runs on", async () => {
    const seen: unknown[] = [];
    const { client, open } = setup({
      db: {
        ...SCRIPT,
        answer: (sql, session) => {
          seen.push({ sql, ...session });
          return sql === "SELECT 2" ? { sql, columns: SCRIPT.statements[0]?.columns } : undefined;
        },
      },
    });
    const sessionId = await open();
    const listed = await client.call(
      "db.run",
      { sessionId, sql: "SELECT id, note FROM orders" },
      DB,
    );
    expect(listed.rows.length).toBe(25);
    const two = await client.call("db.run", { sessionId, sql: "SELECT 2" }, DB);
    expect(valid("DbPage", two) && [two.columns?.length, two.tag]).toEqual([2, "SELECT 0"]);
    const none = await client.call("db.run", { sessionId, sql: "SELECT 3" }, DB);
    expect(none.error?.code).toBe("0A000");
    expect(seen).toEqual([
      expect.objectContaining({ sql: "SELECT 2", host: "db.example.test", port: 5432 }),
      expect.objectContaining({ sql: "SELECT 3", database: "shop", user: "reader" }),
    ]);
    expect(seen[0]).toMatchObject({ readOnly: false, settings: {} });
  });

  it("without a scripted server, db.open is an io_error", async () => {
    const { open } = setup({ db: undefined });
    await expect(open()).rejects.toMatchObject({ code: "io_error" });
  });
});
