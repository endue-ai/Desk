// A password kept in the keychain (#443, ADR 0311) on a real PostgreSQL, through the plugin and the
// desk core (core-bridge.ts, whose core keeps it in an in-memory keychain for as long as it runs):
// typed once with the choice ticked, then a fresh plugin on the same core, as after a restart, signs
// in with it by name and asks for nothing; forgetting it leaves the core with none. Runs when
// ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database whose role signs in with a password.
import { describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { sharedCore } from "./core-bridge";
import { type Handlers, type Mounted, mount } from "./harness";
import { realProcs } from "./scripted";

const postgres = process.env.ENDUE_DB_TEST_POSTGRES;

/** The plugin on the real core: its sessions and its kept passwords. */
async function live(store: Record<string, unknown>) {
  const procs = realProcs();
  const core = sharedCore();
  const kept = Object.fromEntries(
    ["set", "delete", "list"].map((name) => [
      `db.passwords.${name}`,
      (params: unknown) => core.call(`db.passwords.${name}`, params),
    ]),
  ) as Handlers;
  const m = await mount({ store, handlers: { ...procs.handlers, ...kept }, pick: () => "yes" });
  procs.attach((event) => m.host.emit(event));
  return m;
}

/** Run `sql` on Live, answering each password prompt with `answer` ticked (or cancelling it when
 * there is none); how many prompts came. */
async function run(m: Mounted, sql: string, answer?: string) {
  await m.host.command("endue.database.console", { connection: "Live" });
  m.view.text = sql;
  m.view.caret = sql.length;
  m.app.edited(sql);
  let settled = false;
  let prompts = 0;
  const done = m.host.command("endue.database.run-all").finally(() => {
    settled = true;
  });
  while (!settled) {
    if (m.view.passwords.at(-1)) {
      prompts++;
      m.app.password(answer, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await done;
  await m.settle();
  return prompts;
}

const rows = (m: Mounted) => m.shown()?.shown?.tabs[0]?.set?.rows;

describe.skipIf(!postgres)("a kept password on a real PostgreSQL, through the desk core", () => {
  it("is typed once; a fresh plugin on the same core signs in with it and asks for nothing", {
    timeout: 60_000,
  }, async () => {
    const { fields, password } = parseUri(postgres ?? "");
    const secret = password ?? "";
    const conn = normalize({ ...fields, id: "c-kept", name: "Live" });
    const host = conn.host || "localhost";
    const core = sharedCore();

    const first = await live({ connections: [conn] });
    expect(await run(first, "select current_user", secret)).toBe(1);
    expect(rows(first)).toEqual([[conn.user]]);
    expect(await core.call("db.passwords.list", {})).toEqual({
      passwords: [{ name: "c-kept", host, port: conn.port ?? 5432, user: conn.user }],
    });

    // A restart of the plugin: its memory gone, the connection's choice and the core's keychain kept.
    const second = await live({ connections: first.store.connections });
    expect(await run(second, "select current_user")).toBe(0);
    expect(rows(second)).toEqual([[conn.user]]);
    const opens = second.host.calls.filter((c) => c.method === "db.open");
    const named = opens.map((c) => c.params as { password?: string; passwordRef?: string });
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((p) => p.password === undefined && p.passwordRef === "c-kept")).toBe(true);
    expect(JSON.stringify(second.store).includes(secret)).toBe(false);

    await second.host.command("endue.database.forget-password", { connection: "Live" });
    expect(await core.call("db.passwords.list", {})).toEqual({ passwords: [] });
  });
});
