// The settings followed on a real PostgreSQL server (PG-104), through the desk core's sessions: a
// statement timeout and a row limit changed while the plugin runs are in force at the next run, with
// no reload. Runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database.
import { describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { type Mounted, mount } from "./harness";
import { realProcs } from "./scripted";

const postgres = process.env.ENDUE_DB_TEST_POSTGRES;

const setting = async (m: Mounted, key: string, value: unknown) => {
  await m.host.call("settings.set", { key, value }, "endue.database");
  await m.settle();
};
const typeAndRun = async (m: Mounted, sql: string) => {
  m.view.text = sql;
  m.view.caret = sql.length;
  m.app.edited(sql);
  await m.host.command("endue.database.run-all");
  await m.settle();
};
const messages = (m: Mounted) =>
  JSON.stringify(m.shown()?.shown?.tabs.find((tab) => tab.kind === "messages")?.lines ?? []);

describe.skipIf(!postgres)("settings on a real PostgreSQL server", () => {
  it("a changed statement timeout and row limit are in force at the next run", {
    timeout: 60_000,
  }, async () => {
    const { fields, password } = parseUri(postgres ?? "");
    const conn = normalize({ ...fields, id: "c-pg", name: "Scratch" });
    const procs = realProcs(password ? { password } : {});
    const m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.console", { connection: "Scratch" });

    await typeAndRun(m, "select pg_sleep(1.5) as slept");
    expect(m.shown()?.shown?.summary).toMatch(/^Done: 1 of 1 statement/u);
    await setting(m, "timeout-seconds", 1);
    await typeAndRun(m, "select pg_sleep(4) as slept");
    expect(m.shown()?.shown?.summary).toMatch(/^Failed/u);
    expect(messages(m)).toMatch(/statement timeout/u);

    await setting(m, "timeout-seconds", 0);
    await setting(m, "max-rows", 3);
    await typeAndRun(m, "select generate_series(1, 10) as n");
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["1"], ["2"], ["3"]]);
  });
});
