// A session never outlives what ended it (ADR 0339), on a real server through the desk core's
// sessions (core-bridge.ts): Disconnect while a console's statement runs leaves no backend of it,
// and a core that quits (the test bridge's standard input ends, as the desk's quit) leaves none of
// its sessions or their statements. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch
// database (live.test.ts).
import { afterAll, describe, expect, it } from "vitest";
import type { DbOpenResult } from "../../../packages/bridge/src/index";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { coreBridge } from "./core-bridge";
import { mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { start } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const PREFIX = "endue lifetime";
const server = liveSessions(uri, PREFIX);
const LIVE = (
  uri ? normalize({ ...fields, id: "c-live-lifetime", name: "live" }) : {}
) as Connection;

/** Whether the server lets go of backend `pid` within five seconds. */
async function goneWithin(pid: number) {
  const end = Date.now() + 5_000;
  while (Date.now() < end) {
    const held = await server.admin(`SELECT count(*) FROM pg_stat_activity WHERE pid = ${pid}`);
    if (held === "0") return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe.skipIf(!uri)("a session's lifetime on a real server", () => {
  afterAll(() => server.end());

  it("Disconnect while a console's statement runs leaves no backend of it", async () => {
    const procs = realProcs(password ? { password } : {});
    const m = await mount({ store: { connections: [LIVE] }, handlers: procs.handlers });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.console", { connection: "live" });
    const { done } = await start(m, "select pg_sleep(30)");
    const pid = m.shown()?.session?.pid as number;
    expect(pid).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await m.host.command("endue.database.disconnect", { connection: "live" });
    await done.catch(() => {});
    expect(await goneWithin(pid)).toBe(true);
  }, 30_000);

  it("a core that quits leaves none of its sessions or statements", async () => {
    const core = coreBridge();
    const host = fields.host || "localhost";
    const port = fields.port ?? 5432;
    const open = async () =>
      (await core.call("db.open", {
        engine: "postgresql",
        host,
        port,
        database: fields.database || fields.user,
        user: fields.user,
        ...(password ? { password } : {}),
        settings: { application_name: `${PREFIX} quit` },
        scope: { permission: "db:connect", hosts: [`${host}:${port}`] },
      })) as DbOpenResult;
    const busy = await open();
    const idle = await open();
    void core
      .call("db.run", { sessionId: busy.sessionId, sql: "SELECT pg_sleep(30)" })
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    core.close();
    expect(await goneWithin(busy.pid ?? 0)).toBe(true);
    expect(await goneWithin(idle.pid ?? 0)).toBe(true);
  }, 30_000);
});
