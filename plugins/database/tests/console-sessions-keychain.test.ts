// A console's kept PostgreSQL session and the keychain (PG-02 with PG-03, ADR 0320 and ADR 0311): the
// password the keychain keeps signs in the console's own session, an agent's short one, and, after a
// restart, the console's new session, by name and with no prompt.
import { describe, expect, it } from "vitest";
import { type Handlers, type Mounted, mount, SAVED } from "./harness";

const PASSWORD = "fixture-keychain-password";
const DB = ["open", "run", "fetch", "copy", "cancel", "close", "list"].map((m) => `db.${m}`);
const KEPT = ["set", "delete", "list"].map((m) => `db.passwords.${m}`);
const one = () => ({ rows: [["?column?"], ["1"]] });

/** Every db.open's sign-in: whether it carried a typed password, and the kept one it named. */
const signIns = (m: Mounted) =>
  m.host.calls
    .filter((c) => c.method === "db.open")
    .map((c) => {
      const params = c.params as { password?: string; passwordRef?: string };
      return { typed: params.password !== undefined, ref: params.passwordRef };
    });
const runOn = async (m: Mounted, sql: string) => {
  m.view.text = sql;
  await m.host.command("endue.database.run");
  await m.settle();
};

describe("a console's session and the keychain", () => {
  it("signs in the console's session, an agent's and, after a restart, the console's new one by the kept password's name", async () => {
    const first = await mount({
      store: { connections: SAVED },
      script: one,
      password: PASSWORD,
      pick: () => "yes",
    });
    await first.host.command("endue.database.console", { connection: "Shop" });
    first.view.text = "select 1";
    const asked = first.host.command("endue.database.run");
    await first.settle();
    first.app.password(PASSWORD, true);
    await asked;
    await first.settle();
    // Disconnect closes the console's session and forgets the typed password; the keychain keeps it.
    await first.host.command("endue.database.disconnect", { connection: "Shop" });
    await runOn(first, "select 2");
    await runOn(first, "select 3");
    await first.host.invoke("endue.database.query", { connection: "Shop", sql: "select 4" });
    expect(signIns(first).slice(-2)).toEqual([
      { typed: false, ref: "c-prod" },
      { typed: false, ref: "c-prod" },
    ]);
    const prompts = first.view.passwords.filter(Boolean).length;

    // A restart: a new frame, no session kept, the same core and keychain.
    const relay = Object.fromEntries(
      [...DB, ...KEPT].map((name) => [
        name,
        (params: unknown) => first.host.call(name as never, params as never, "endue.database"),
      ]),
    ) as Handlers;
    const again = await mount({ store: first.store, script: one, handlers: relay });
    await again.host.command("endue.database.console", { connection: "Shop" });
    await runOn(again, "select 5");
    expect(signIns(again).at(-1)).toEqual({ typed: false, ref: "c-prod" });
    expect(again.view.passwords.filter(Boolean)).toHaveLength(0);
    expect(first.view.passwords.filter(Boolean)).toHaveLength(prompts);
    expect(again.shown()?.session?.state).toBe("idle");
  });
});
