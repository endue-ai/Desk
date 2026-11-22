import { describe, expect, it } from "vitest";
import {
  type BridgeEvent,
  BridgeClient,
  browserStub,
  type DbConnectPermission,
  type StubDatabase,
  stubCommands,
} from "./index";

// The stub's LISTEN and NOTIFY, and a statement's notices as they arrive (ADR 0358): a NOTIFY
// reaches the sessions of the same database that listen, with the sender's pid; UNLISTEN stops it;
// a statement's notices come as db.call.notice with the number its answer carries.
const DB = { caller: "example.database" };
const scope: DbConnectPermission = { permission: "db:connect", hosts: ["db.example.test:5432"] };
const note = (message: string) => ({
  severity: "NOTICE",
  localSeverity: "NOTICE",
  code: "00000",
  message,
});
const SCRIPT: StubDatabase = {
  statements: [{ sql: "CALL restock()", tag: "CALL", notices: [note("one"), note("two")] }],
};

async function setup() {
  const events: BridgeEvent[] = [];
  const core = stubCommands((event) => events.push(event), {
    grants: { [DB.caller]: [scope] },
    db: SCRIPT,
  });
  const client = new BridgeClient(browserStub(core.handlers));
  const open = async (database = "shop") => {
    const params = { engine: "postgresql", host: "db.example.test", database, user: "r" };
    const opened = await client.call("db.open", { ...params, scope }, DB);
    return { sessionId: opened.sessionId ?? "", pid: opened.pid ?? 0 };
  };
  const run = (sessionId: string, sql: string) => client.call("db.run", { sessionId, sql }, DB);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return { events, open, run, settle };
}

describe("the stub's LISTEN, NOTIFY and live notices", () => {
  it("a NOTIFY reaches the listening sessions of its database until UNLISTEN", async () => {
    const { events, open, run, settle } = await setup();
    const [listener, sender, elsewhere] = [await open(), await open(), await open("other")];
    expect((await run(listener.sessionId, "LISTEN Jobs")).tag).toBe("LISTEN");
    await run(elsewhere.sessionId, "LISTEN jobs");
    expect((await run(sender.sessionId, "NOTIFY jobs, 'it''s done'")).tag).toBe("NOTIFY");
    await run(sender.sessionId, "SELECT pg_notify('jobs', 'second')");
    await settle();
    const heard = events.filter((e) => e.event === "db.notification").map((e) => e.data);
    expect(heard).toEqual([
      { sessionId: listener.sessionId, pid: sender.pid, channel: "jobs", payload: "it's done" },
      { sessionId: listener.sessionId, pid: sender.pid, channel: "jobs", payload: "second" },
    ]);
    await run(listener.sessionId, "UNLISTEN *");
    await run(sender.sessionId, "NOTIFY jobs");
    await settle();
    expect(events.filter((e) => e.event === "db.notification")).toHaveLength(2);
  });

  it("a statement's notices come as db.call.notice with its call's number", async () => {
    const { events, open, run, settle } = await setup();
    const { sessionId } = await open();
    await run(sessionId, "LISTEN jobs");
    const page = await run(sessionId, "CALL restock()");
    await settle();
    const raised = events.filter((e) => e.event === "db.call.notice").map((e) => e.data);
    expect(page.call).toBe(2);
    expect(raised).toEqual([
      { sessionId, call: 2, notice: note("one") },
      { sessionId, call: 2, notice: note("two") },
    ]);
    expect(page.notices).toEqual([note("one"), note("two")]);
  });
});
