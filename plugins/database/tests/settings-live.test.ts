// The settings in force: what the person set (settings.list) over init.yaml's at the start, and a
// change while the plugin runs (settings.changed) taken at once, the clients found again when it
// names one (D5).
import { describe, expect, it } from "vitest";
import { fromValues, fullKey } from "../ui/settings.js";
import { mount, SAVED } from "./harness";

const setting = async (m: Awaited<ReturnType<typeof mount>>, key: string, value: unknown) => {
  await m.host.call("settings.set", { key, value }, "endue.database");
  await m.settle();
};

const deleteAll = async (m: Awaited<ReturnType<typeof mount>>) => {
  await m.host.command("endue.database.console", { connection: "Notes" });
  m.view.text = "delete from notes";
  await m.host.command("endue.database.run-all");
  await m.settle();
};

describe("settings", () => {
  it("names a key as the manifest does, with or without the prefix", () => {
    expect(fullKey("max-rows")).toBe("endue.database.max-rows");
    expect(fullKey("endue.database.max-rows")).toBe("endue.database.max-rows");
    expect(fromValues({ "endue.database.max-rows": 0 }).maxRows).toBe(500);
  });

  it("starts with what the person set, over init.yaml's value", async () => {
    const m = await mount({
      store: { connections: SAVED },
      init: { "endue.database.confirm": true },
      settings: { confirm: false },
      script: () => ({ changes: 3 }),
    });
    await deleteAll(m);
    expect(m.picks).toHaveLength(0);
  });

  it("takes a change while it runs, without a restart", async () => {
    const m = await mount({ store: { connections: SAVED }, script: () => ({ changes: 3 }) });
    await setting(m, "confirm", false);
    await deleteAll(m);
    expect(m.picks).toHaveLength(0);
    await setting(m, "confirm", true);
    m.view.text = "delete from notes";
    await m.host.command("endue.database.run-all").catch(() => undefined);
    expect(m.picks.at(-1)?.items[0]).toMatchObject({
      detail: "Statement 1: DELETE without WHERE changes every row.",
    });
  });

  it("finds the client again when the setting that names it changes", async () => {
    const m = await mount({ store: { connections: SAVED } });
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select 1";
    await m.host.command("endue.database.run");
    await m.settle();
    await setting(m, "sqlite3", "/opt/sqlite/bin/sqlite3");
    await m.host.command("endue.database.run");
    await m.settle();
    expect(m.clients.spawned.map((s) => s.command)).toContain("/opt/sqlite/bin/sqlite3");
  });
});
