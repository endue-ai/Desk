// Roles and privileges on a real PostgreSQL through the plugin's commands (PG-54), when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database (as in live.test.ts): a login role
// created with a password the page turned into a SCRAM verifier, which then logs in; a grant to a
// group the role reaches through its membership, read back with has_table_privilege and explained
// in the role's view; default privileges a new table gets; a policy created and changed; and a
// catalog the role may not read said in its section. On the desk core's sessions (core-bridge.ts).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { grantsLine } from "../ui/features/privileges/effective.js";
import type { ChangeModel } from "../ui/features/privileges/models.js";
import { mount } from "./harness";
import { databaseOf } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;
// Roles are the server's, and other runs use it at once, each in a database of its own: the roles
// are this database's.
const base = `t478_${databaseOf(uri ?? "")
  .toLowerCase()
  .replace(/[^a-z0-9_]/gu, "_")}`.slice(0, 50);
const GROUP = `${base}_group`;
const READER = `${base}_reader`;
// Made for this run and never written down.
const SECRET = `p-${randomUUID()}`;

const SETUP = `drop schema if exists priv478 cascade;
do $$ begin if exists (select from pg_roles where rolname = '${READER}') then execute 'drop owned by ${READER}'; drop role ${READER}; end if; end $$;
do $$ begin if exists (select from pg_roles where rolname = '${GROUP}') then execute 'drop owned by ${GROUP}'; drop role ${GROUP}; end if; end $$;
create role ${GROUP} nologin;
create schema priv478;
grant usage on schema priv478 to ${GROUP};
create table priv478.orders (id int primary key, person text not null, total numeric not null);
insert into priv478.orders values (1, 'ana', 120), (2, 'ben', 30)`;
const TEARDOWN = `grant select on pg_catalog.pg_default_acl to public;
drop schema if exists priv478 cascade;
do $$ begin if exists (select from pg_roles where rolname = '${READER}') then execute 'drop owned by ${READER}'; drop role ${READER}; end if; end $$;
do $$ begin if exists (select from pg_roles where rolname = '${GROUP}') then execute 'drop owned by ${GROUP}'; drop role ${GROUP}; end if; end $$`;

/** Run with what the dialog shows, `values` over it. */
const asShown =
  (values: Record<string, string> = {}) =>
  (_type: string, given: unknown) => {
    const model = given as ChangeModel;
    return {
      values: { ...Object.fromEntries(model.fields.map((f) => [f.name, f.value])), ...values },
      choices: model.choices.filter((c) => c.checked && !c.disabled).map((c) => c.name),
    };
  };

async function mounted(name: string, user: string | undefined, password: string | undefined) {
  const { fields } = parseUri(uri ?? "");
  const conn = normalize({
    ...fields,
    ...(user ? { user } : {}),
    id: `c-${name.toLowerCase()}`,
    name,
  });
  const procs = realProcs(password ? { password } : {});
  const m = await mount({
    store: { connections: [conn] },
    handlers: procs.handlers,
    pick: () => "yes",
  });
  procs.attach((event) => m.host.emit(event));
  return m;
}

describe.skipIf(!uri)("roles and privileges on a real PostgreSQL", () => {
  let m: Awaited<ReturnType<typeof mount>>;
  const on = { connection: "Privileges" };
  /** Run SQL in the connection's console and give back the first cell of the last result. */
  const value = async (sql: string) => {
    await m.host.command("endue.database.console", on);
    m.view.text = sql;
    await m.host.command("endue.database.run-all");
    return m.shown()?.shown?.tabs.findLast((t) => t.kind === "rows")?.set?.rows[0]?.[0];
  };

  beforeAll(async () => {
    m = await mounted("Privileges", undefined, parseUri(uri ?? "").password);
    await value(SETUP);
  });
  afterAll(async () => {
    if (m) await value(TEARDOWN).catch(() => {});
  });

  it("creates a login role whose password is a SCRAM verifier made in the page, and it logs in", async () => {
    m.view.answerDialog = asShown({ name: READER, password: SECRET });
    await m.host.command("endue.database.create-role", { ...on, login: true, memberOf: [GROUP] });
    expect(
      await value(
        `select rolpassword like 'SCRAM-SHA-256$4096:%' from pg_authid where rolname = '${READER}'`,
      ),
    ).toBe("t");
    expect(JSON.stringify([m.store, m.view.said, m.view.dialogs, m.picks])).not.toContain(SECRET);
    const reader = await mounted("Reader", READER, SECRET);
    await reader.host.command("endue.database.console", { connection: "Reader" });
    reader.view.text = "select current_user::text";
    await reader.host.command("endue.database.run");
    expect(reader.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0]).toBe(
      READER,
    );
  });

  it("grants to the group and explains that the role has it through its membership", async () => {
    m.view.answerDialog = asShown();
    await m.host.command("endue.database.change-privileges", {
      ...on,
      schema: "priv478",
      name: "orders",
      kind: "table",
      grantee: GROUP,
      grant: ["SELECT"],
    });
    expect(
      await value(`select has_table_privilege('${READER}', 'priv478.orders', 'SELECT')::text`),
    ).toBe("true");
    const view = (await m.host.command("endue.database.role-privileges", {
      ...on,
      role: READER,
    })) as {
      reach: Array<{ role: string }>;
      objects: Array<Parameters<typeof grantsLine>[0]>;
    };
    expect(view.reach.map((r) => r.role)).toContain(GROUP);
    const orders = view.objects.find((o) => o.schema === "priv478" && o.name === "orders");
    expect(orders && grantsLine(orders)).toBe(`SELECT through ${GROUP} (${READER} → ${GROUP})`);
    expect(
      view.objects.some(
        (o) => o.kind === "database" && /^CONNECT, TEMPORARY to PUBLIC$/u.test(grantsLine(o)),
      ),
    ).toBe(true);
    await m.host.command("endue.database.change-privileges", {
      ...on,
      schema: "priv478",
      name: "orders",
      kind: "table",
      grantee: GROUP,
      revoke: ["SELECT"],
    });
    expect(
      await value(`select has_table_privilege('${READER}', 'priv478.orders', 'SELECT')::text`),
    ).toBe("false");
  });

  it("sets default privileges a new table gets, and creates and changes a policy", async () => {
    m.view.answerDialog = asShown();
    const owner = String(await value("select current_user::text"));
    await m.host.command("endue.database.change-default-privileges", {
      ...on,
      owner,
      schema: "priv478",
      on: "tables",
      grantee: GROUP,
      grant: ["SELECT", "INSERT"],
    });
    await value("create table priv478.later (id int)");
    expect(
      await value(`select has_table_privilege('${READER}', 'priv478.later', 'INSERT')::text`),
    ).toBe("true");
    await m.host.command("endue.database.row-security", {
      ...on,
      schema: "priv478",
      table: "orders",
      enable: true,
    });
    await m.host.command("endue.database.policy", {
      ...on,
      schema: "priv478",
      table: "orders",
      name: "own_rows",
      roles: [GROUP],
      using: "person = 'ana'",
    });
    await m.host.command("endue.database.policy", {
      ...on,
      schema: "priv478",
      table: "orders",
      name: "own_rows",
      using: "total > 100",
    });
    expect(
      await value(
        "select qual from pg_policies where schemaname = 'priv478' and policyname = 'own_rows'",
      ),
    ).toBe("(total > (100)::numeric)");
    expect(
      await value(
        `select array_to_string(roles, ',') from pg_policies where policyname = 'own_rows' and schemaname = 'priv478'`,
      ),
    ).toBe(GROUP);
  });

  it("says what the role may not read in its section", async () => {
    await value("revoke select on pg_catalog.pg_default_acl from public");
    const reader = await mounted("Reader", READER, SECRET);
    const defaults = (await reader.host.command("endue.database.default-privileges", {
      connection: "Reader",
    })) as { error: string };
    expect(defaults.error).toBe(
      `${READER} may not read pg_default_acl: default privileges cannot be shown.`,
    );
    const roles = (await reader.host.command("endue.database.privileges", {
      connection: "Reader",
    })) as { roles: Array<{ name: string }> };
    expect(roles.roles.map((r) => r.name)).toContain(READER);
    await value("grant select on pg_catalog.pg_default_acl to public");
  });
});
