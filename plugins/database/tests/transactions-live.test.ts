// A console's manual transaction on a real server (PG-20), through the desk core's sessions
// (core-bridge.ts): rows stay invisible to another session until Commit, Rollback discards them,
// the isolation level and read-only are what the server says, rolling back to a savepoint keeps the
// earlier work, and a failed statement leaves the transaction failed until Rollback. It runs when
// ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database (live.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { messages, run, state } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue transactions");
const LIVE = (uri ? normalize({ ...fields, id: "c-live-tx", name: "live" }) : {}) as Connection;
const TABLE = "transactions_live";

/** The plugin on the real core with the live connection's console on screen, in Manual mode. */
async function live(): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const m = await mount({ store: { connections: [LIVE] }, handlers: procs.handlers });
  procs.attach((event) => m.host.emit(event));
  await m.host.command("endue.database.console", { connection: "live" });
  await m.host.command("endue.database.transaction-mode", { mode: "manual" });
  return m;
}

/** The first value of the result on screen. */
const first = (m: Mounted) =>
  m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0];
const count = () => server.admin(`select count(*) from ${TABLE}`);
const command = async (m: Mounted, id: string, args?: Record<string, unknown>) => {
  await m.host.command(id, args);
  await m.settle();
};
const done = (m: Mounted) => m.host.command("endue.database.disconnect", { connection: "live" });

describe.skipIf(!uri)("a console's manual transaction on a real server", () => {
  beforeAll(async () => {
    await server.end();
    await server.admin(`DROP TABLE IF EXISTS ${TABLE}`);
    await server.admin(`CREATE TABLE ${TABLE} (id int)`);
  });
  afterAll(async () => {
    await server.end();
    await server.admin(`DROP TABLE IF EXISTS ${TABLE}`);
  });

  it("two runs stay invisible to another session until Commit", async () => {
    await server.admin(`TRUNCATE ${TABLE}`);
    const m = await live();
    await run(m, `insert into ${TABLE} values (1)`);
    await run(m, `insert into ${TABLE} values (2)`);
    expect(state(m)).toBe("open");
    expect(m.shown()?.session).toMatchObject({ statements: 2 });
    expect(await count()).toBe("0");
    await command(m, "endue.database.commit");
    expect(state(m)).toBe("idle");
    expect(await count()).toBe("2");
    await done(m);
  });

  it("Rollback discards both runs", async () => {
    await server.admin(`TRUNCATE ${TABLE}`);
    const m = await live();
    await run(m, `insert into ${TABLE} values (1)`);
    await run(m, `insert into ${TABLE} values (2)`);
    await run(m, `select count(*) from ${TABLE}`);
    expect(first(m)).toBe("2");
    await command(m, "endue.database.rollback");
    expect(state(m)).toBe("idle");
    await run(m, `select count(*) from ${TABLE}`);
    expect(first(m)).toBe("0");
    await command(m, "endue.database.rollback");
    expect(await count()).toBe("0");
    await done(m);
  });

  it("the isolation level and read-only are what the server says", async () => {
    const m = await live();
    await command(m, "endue.database.transaction-options", {
      isolation: "serializable",
      readOnly: true,
    });
    await run(m, "select current_setting('transaction_isolation')");
    expect(first(m)).toBe("serializable");
    await run(m, "select current_setting('transaction_read_only')");
    expect(first(m)).toBe("on");
    await command(m, "endue.database.rollback");
    await command(m, "endue.database.transaction-options", {
      isolation: "repeatable-read",
      readOnly: false,
    });
    await run(m, "select current_setting('transaction_isolation')");
    expect(first(m)).toBe("repeatable read");
    await command(m, "endue.database.rollback");
    await done(m);
  });

  it("rolling back to a savepoint keeps the earlier work", async () => {
    await server.admin(`TRUNCATE ${TABLE}`);
    const m = await live();
    await run(m, `insert into ${TABLE} values (10)`);
    await command(m, "endue.database.savepoint", { name: "before_eleven" });
    await run(m, `insert into ${TABLE} values (11)`);
    await command(m, "endue.database.rollback-to-savepoint", { name: "before_eleven" });
    await command(m, "endue.database.release-savepoint", { name: "before_eleven" });
    await command(m, "endue.database.commit");
    expect(await server.admin(`select string_agg(id::text, ',') from ${TABLE}`)).toBe("10");
    await done(m);
  });

  it("a failed statement leaves the transaction failed until Rollback", async () => {
    const m = await live();
    await run(m, "select 1");
    await run(m, "select 1/0");
    expect(state(m)).toBe("failed");
    await run(m, "select 2");
    expect(messages(m).join("\n")).toMatch(/25P02|aborted/u);
    expect(state(m)).toBe("failed");
    await expect(m.host.command("endue.database.commit")).rejects.toThrow(/Rollback/u);
    await command(m, "endue.database.rollback");
    expect(state(m)).toBe("idle");
    await run(m, "select 3");
    expect(first(m)).toBe("3");
    await command(m, "endue.database.rollback");
    await done(m);
  });
});
