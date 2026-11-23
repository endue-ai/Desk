// Live notices and LISTEN on a real server (PG-25, ADR 0358), through the desk core's sessions
// (core-bridge.ts): a long statement's RAISE NOTICEs show in its Messages before it ends, in order;
// a NOTIFY from another console of the same database reaches a listening console's Notifications
// tab with the sender's pid; UNLISTEN stops it; a listening console whose session the server ends
// says it stopped listening. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database
// (live.test.ts).
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { messages, run, start } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue listen");
const LIVE = (uri ? normalize({ ...fields, id: "c-live-listen", name: "live" }) : {}) as Connection;
const granted = { "perm.query": () => ({ grants: [{ permission: "db:connect" }] }) as never };

async function live(): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const m = await mount({
    store: { connections: [LIVE] },
    handlers: { ...procs.handlers, ...granted },
  });
  procs.attach((event) => m.host.emit(event));
  await m.host.command("endue.database.console", { connection: "live" });
  return m;
}
const until = async (test: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const notifications = (m: Mounted) =>
  (m.shown()?.shown?.tabs ?? []).find((t) => t.kind === "notifications");
const go = (m: Mounted, name: string) =>
  m.host.command("endue.database.consoles", { console: name });
const done = (m: Mounted) => m.host.command("endue.database.disconnect", { connection: "live" });

describe.skipIf(!uri)("live notices and LISTEN on a real server", () => {
  afterAll(async () => {
    await server.end("application_name = 'endue'");
  });

  it("a long statement's RAISE NOTICEs show before it ends, in order, and once after", async () => {
    const m = await live();
    await run(m, "select 1");
    const slow =
      "DO $$ BEGIN RAISE NOTICE 't458 step %', 1; PERFORM pg_sleep(0.2); RAISE WARNING 't458 step %', 2; " +
      "PERFORM pg_sleep(0.2); RAISE NOTICE 't458 step %', 3; PERFORM pg_sleep(3); END $$";
    const going = await start(m, slow);
    await until(() => messages(m).filter((l) => /t458 step/u.test(l)).length === 3);
    expect(m.shown()?.running).toBe(true);
    expect(messages(m).filter((l) => /t458 step/u.test(l))).toEqual([
      "NOTICE:  t458 step 1",
      "WARNING:  t458 step 2",
      "NOTICE:  t458 step 3",
    ]);
    await going.done;
    await m.settle();
    expect(m.shown()?.running).toBe(false);
    const lines = (m.shown()?.shown?.tabs ?? []).flatMap((t) => t.lines ?? []);
    const steps = lines.filter((l) => /t458 step/u.test(l.text));
    expect(steps.map((l) => [l.statement, l.text.split("\n")[0]])).toEqual([
      [0, "NOTICE:  t458 step 1"],
      [0, "WARNING:  t458 step 2"],
      [0, "NOTICE:  t458 step 3"],
    ]);
    await done(m);
  }, 30_000);

  it("a NOTIFY from another console reaches a listening one until UNLISTEN", async () => {
    const m = await live();
    await run(m, "LISTEN t458_jobs");
    await m.host.command("endue.database.new-console", { connection: "live" });
    await run(m, "NOTIFY t458_jobs, 'order 7 paid'");
    const sender = m.shown()?.session?.pid;
    await go(m, "live");
    await until(() => (notifications(m)?.set?.rows.length ?? 0) === 1);
    const [row] = notifications(m)?.set?.rows ?? [];
    expect(row?.slice(1)).toEqual(["t458_jobs", "order 7 paid", String(sender)]);
    expect(notifications(m)?.label).toMatch(/^Notifications/u);
    expect(notifications(m)?.note).toBe("Listening on t458_jobs.");

    await run(m, "UNLISTEN t458_jobs");
    await go(m, "live 2");
    await run(m, "NOTIFY t458_jobs, 'not heard'");
    await go(m, "live");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await m.settle();
    expect(notifications(m)?.set?.rows.map((r) => r[2])).toEqual(["order 7 paid"]);
    expect(notifications(m)?.note).toBe("Not listening.");
    await done(m);
  }, 30_000);

  it("a listening console whose session the server ends says it stopped listening", async () => {
    const m = await live();
    await run(m, "LISTEN t458_lost");
    const pid = Number(m.shown()?.session?.pid);
    await server.admin(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid = ${pid}`,
    );
    await until(() => /stopped listening on t458_lost/u.test(m.view.said.join("\n")));
    await until(() => m.shown()?.session?.state === "idle");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await m.settle();
    expect(notifications(m)).toMatchObject({ stopped: true });
    // The new session listens to nothing: a NOTIFY on the channel is not heard.
    await m.host.command("endue.database.new-console", { connection: "live" });
    await run(m, "NOTIFY t458_lost, 'after'");
    await go(m, "live");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await m.settle();
    expect(notifications(m)?.set?.rows ?? []).toEqual([]);
    await done(m);
  }, 30_000);
});
