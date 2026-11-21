// A connection's password kept in the OS keychain (#443, ADR 0311), on the SDK's test host, whose
// stub keeps db.passwords.* as the core does: the choice per connection, off by default and only for
// PostgreSQL; a typed password kept once it works; a URI's on Save; forgotten by the command, by
// unticking, by a new server and with the connection; the list's mark; the name db.open takes; and no
// store key, state or answer holding the password.
import { describe, expect, it } from "vitest";
import type { Feature } from "../ui/feature-host.js";
import * as builtins from "../ui/features/index.js";
import { endpoint } from "../ui/keychain.js";
import { type Mounted, mount, SAVED } from "./harness";

type Deps = Parameters<NonNullable<Feature["commands"]>>[0];

const PASSWORD = "fixture-keychain-password";
const SHOP = SAVED[1] as (typeof SAVED)[number];
const KEPT = { name: "c-prod", host: "db.example", port: 5432, user: "app" };
const asks = (_sql: string, env: Record<string, string>) =>
  env.PGPASSWORD === PASSWORD ? { rows: [["?column?"], ["1"]] } : ("auth" as const);

/** The plugin with a feature that hands back the deps every feature gets. */
async function mounted(options: Parameters<typeof mount>[0] = {}) {
  let deps: Deps | undefined;
  const probe: Feature = {
    id: "probe",
    commands: (given) => {
      deps = given;
      return {};
    },
  };
  const m = await mount({
    store: { connections: SAVED },
    script: asks,
    pick: () => "yes",
    ...options,
    features: [...Object.values(builtins), probe],
  });
  return { m, deps: deps as Deps };
}

const kept = async (deps: Deps) => (await deps.bridge.call("db.passwords.list", {})).passwords;
const stored = (m: Mounted, id: string) =>
  (m.store.connections as Array<Record<string, unknown>>).find((c) => c.id === id);

/** Run a statement on Shop, answer the prompt with `password`, ticked or not. */
async function typed(m: Mounted, password: string, remember: boolean) {
  await m.host.command("endue.database.console", { connection: "Shop" });
  m.view.text = "select 1";
  const running = m.host.command("endue.database.run");
  await m.settle();
  m.app.password(password, remember);
  await running;
  await m.settle();
}

async function edit(m: Mounted, changes: Record<string, unknown>) {
  await m.host.command("endue.database.edit-connection", { connection: "Shop" });
  await m.app.formSave({ ...m.view.forms.at(-1)?.fields, ...changes });
  await m.settle();
}

describe("a password kept in the keychain", () => {
  it("is offered off by default and only for PostgreSQL, and the choice is kept per connection", async () => {
    const { m } = await mounted();
    await m.host.command("endue.database.edit-connection", { connection: "Shop" });
    expect(m.view.forms.at(-1)?.fields).not.toHaveProperty("keychain", true);
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, keychain: true });
    await m.settle();
    expect(stored(m, "c-prod")).toMatchObject({ keychain: true });
    await m.host.command("endue.database.edit-connection", { connection: "Notes" });
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, keychain: true });
    await m.settle();
    expect(stored(m, "c-lite")).not.toHaveProperty("keychain");
    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text = "select 1";
    const running = m.host.command("endue.database.run");
    await m.settle();
    expect(m.view.passwords.at(-1)).toMatchObject({ connection: "Shop", remember: true });
    m.app.password(undefined);
    await running.catch(() => {});
    expect(JSON.stringify(m.store)).not.toMatch(/password/iu);
  });

  it("keeps a typed password once a run with it works, when the prompt's choice is ticked", async () => {
    const { m, deps } = await mounted();
    await typed(m, "not-it", true);
    expect(await kept(deps)).toEqual([]);
    expect(m.view.passwords.at(-1)).toBeNull();
    await typed(m, PASSWORD, false);
    expect(await kept(deps)).toEqual([]);
    const fresh = await mounted();
    await typed(fresh.m, PASSWORD, true);
    expect(await kept(fresh.deps)).toEqual([KEPT]);
    expect(stored(fresh.m, "c-prod")).toMatchObject({ keychain: true });
    expect(fresh.m.view.said.at(-1)).toMatch(/keychain/u);
  });

  it("keeps a URI's password on Save when the form's choice is ticked", async () => {
    const { m, deps } = await mounted({ store: {} });
    await m.host.command("endue.database.import-uri", {
      uri: `postgresql://app:${PASSWORD}@db.example:5432/shop`,
    });
    await m.app.formSave({ ...m.view.forms.at(-1)?.fields, name: "Shop", keychain: true });
    await m.settle();
    const [one] = await kept(deps);
    expect(one).toMatchObject({ host: "db.example", port: 5432, user: "app" });
    expect(JSON.stringify(m.store)).not.toContain(PASSWORD);
  });

  it("is forgotten by the command, by unticking, by a new server and with the connection, not by Disconnect", async () => {
    const forget = await mounted();
    await typed(forget.m, PASSWORD, true);
    await forget.m.host.command("endue.database.disconnect", { connection: "Shop" });
    expect(await kept(forget.deps)).toEqual([KEPT]);
    await forget.m.host.command("endue.database.forget-password", { connection: "Shop" });
    expect(await kept(forget.deps)).toEqual([]);
    expect(stored(forget.m, "c-prod")).not.toHaveProperty("keychain");

    const untick = await mounted();
    await typed(untick.m, PASSWORD, true);
    await edit(untick.m, { keychain: false });
    expect(await kept(untick.deps)).toEqual([]);

    const moved = await mounted();
    await typed(moved.m, PASSWORD, true);
    await edit(moved.m, { host: "db2.example" });
    expect(await kept(moved.deps)).toEqual([]);
    expect(stored(moved.m, "c-prod")).toMatchObject({ keychain: true });

    const removed = await mounted();
    await typed(removed.m, PASSWORD, true);
    await removed.m.host.command("endue.database.remove-connection", { connection: "Shop" });
    expect(await kept(removed.deps)).toEqual([]);
  });

  it("marks the connections whose password the keychain holds", async () => {
    const { m } = await mounted();
    const detail = (label: string) => m.view.trees.at(-1)?.find((r) => r.label === label)?.detail;
    expect(detail("Shop")).not.toMatch(/keychain/u);
    await typed(m, PASSWORD, true);
    expect(detail("Shop")).toMatch(/keychain/u);
    expect(detail("Notes")).not.toMatch(/keychain/u);
  });

  it("names the kept password for db.open and never holds it: no store key, no state, no answer", async () => {
    const { m, deps } = await mounted({ db: { password: PASSWORD, statements: [] } });
    expect(deps.manager.passwords.ref(SHOP)).toBeUndefined();
    await typed(m, PASSWORD, true);
    expect(deps.manager.passwords.ref(SHOP)).toBe("c-prod");
    expect(endpoint(SHOP)).toEqual({ host: "db.example", port: 5432, user: "app" });
    const scope = { permission: "db:connect" as const, hosts: ["db.example:5432"] };
    await deps.bridge.call("perm.request", { permission: scope });
    const { user, ...at } = endpoint(SHOP);
    const answers = [
      await deps.bridge.call("db.open", {
        engine: "postgresql",
        ...at,
        database: SHOP.database,
        user,
        passwordRef: "c-prod",
        scope,
      }),
      await deps.bridge.call("db.passwords.list", {}),
    ];
    expect(answers[0]).toMatchObject({ sessionId: expect.any(String) });
    expect(JSON.stringify(answers)).not.toContain(PASSWORD);
    expect(JSON.stringify(m.store)).not.toContain(PASSWORD);
    expect(JSON.stringify(m.host.state)).not.toContain(PASSWORD);
    const carriers = m.host.calls.filter((c) => JSON.stringify(c.params).includes(PASSWORD));
    expect(new Set(carriers.map((c) => c.method))).toEqual(
      new Set(["proc.spawn", "db.passwords.set"]),
    );
  });
});
