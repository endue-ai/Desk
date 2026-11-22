// Roles and privileges through the plugin (PG-54, ui/features/privileges/), over the scripted
// server of privileges-fixture.ts: a connection's roles with their attributes, members and
// memberships, read without a password column; a matrix change become the dialog's script and run in
// one transaction; a role's password kept out of every history entry, store key, status line,
// question, panel state and dialog model; a catalog the role cannot read said in its section; a
// read-only connection refused before any dialog; a policy created and changed from its form; and
// agents' commands that only fill the dialog.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { ChangeModel } from "../ui/features/privileges/models.js";
import { MASK } from "../ui/features/privileges/roles.js";
import { scriptOf } from "../ui/features/privileges/script.js";
import { fixtureScript } from "./fixtures";
import { mount, SAVED } from "./harness";
import { privilegesServer } from "./privileges-fixture";

const [NOTES, SHOP] = SAVED as [Connection, Connection];
const DEV: Connection = { ...SHOP, id: "c-dev", name: "Dev", tag: "none" };
const LOCKED: Connection = { ...SHOP, id: "c-locked", name: "Locked", tag: "none", readOnly: true };
const PASSWORD = "Tr0ub4dor&3-horse";

type Answer = { values: Record<string, string>; choices: string[] };
const asShown = (
  model: ChangeModel,
  values: Record<string, string> = {},
  on: string[] = [],
): Answer => ({
  values: { ...Object.fromEntries(model.fields.map((f) => [f.name, f.value])), ...values },
  choices: [...model.choices.filter((c) => c.checked && !c.disabled).map((c) => c.name), ...on],
});

async function mounted(answer: (model: ChangeModel) => unknown = (m) => asShown(m)) {
  const server = privilegesServer(fixtureScript);
  const m = await mount({
    store: { connections: [DEV, SHOP, LOCKED, NOTES] },
    script: server.script,
    pick: (asked) => (asked.title.startsWith("Run ") ? "yes" : ""),
    dialog: (_type, given) => answer(given as ChangeModel),
  });
  return { m, server };
}
const ran = (m: Awaited<ReturnType<typeof mount>>) => m.sessions().flat();
const panel = (m: Awaited<ReturnType<typeof mount>>) =>
  // biome-ignore lint/suspicious/noExplicitAny: the panel's state is read field by field
  m.shown() as unknown as { id: string; privileges: Record<string, any> };
const action = (m: Awaited<ReturnType<typeof mount>>, name: string) =>
  (m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[name] as (
    ...args: unknown[]
  ) => Promise<unknown>;

describe("the privileges feature", () => {
  it("opens a connection's roles with attributes, members and memberships, reading no password", async () => {
    const { m } = await mounted();
    const answer = (await m.host.command("endue.database.privileges", { connection: "Dev" })) as {
      user: string;
      roles: Array<Record<string, unknown>>;
    };
    expect(answer.user).toBe("app");
    expect(answer.roles.map((r) => r.name)).toEqual(["ana", "app", "reports"]);
    expect(answer.roles[0]).toMatchObject({
      login: true,
      limit: 3,
      until: "2027-01-01 00:00:00+00",
      memberOf: ["reports"],
    });
    expect(answer.roles[2]).toMatchObject({
      login: false,
      memberOf: ["pg_read_all_data"],
      members: ["ana"],
    });
    expect(panel(m).privileges.tab).toBe("roles");
    for (const sql of ran(m)) expect(sql).not.toMatch(/rolpassword|pg_authid|pg_shadow/u);

    await action(
      m,
      "privileges",
    )({
      key: "k",
      kind: "object",
      label: "ana",
      connection: DEV.id,
      object: { kind: "role", name: "ana", schema: "" },
    });
    const view = panel(m).privileges.view.view;
    expect(view.powers).toEqual(["may read every table, view and sequence (pg_read_all_data)"]);
    expect(panel(m).privileges.tab).toBe("role");
  });

  it("turns matrix changes into the dialog's GRANT and REVOKE script and runs it in one transaction", async () => {
    const { m, server } = await mounted();
    await m.host.command("endue.database.object-privileges", {
      connection: "Dev",
      schema: "public",
      name: "orders",
      kind: "table",
    });
    const { id, privileges: s } = panel(m);
    expect(s.object.acl.owner).toBe("app");
    expect(s.object.security.policies[0].name).toBe("own_rows");
    await action(m, "privilegesPress")(id, {
      grantee: "ana",
      column: "",
      privilege: "SELECT",
      now: "none",
    });
    await action(m, "privilegesPress")(id, {
      grantee: "reports",
      column: "",
      privilege: "SELECT",
      now: "option",
    });
    await action(m, "privilegesAdd")(id, "public", "");
    await action(m, "privilegesPress")(id, {
      grantee: "PUBLIC",
      column: "",
      privilege: "TRUNCATE",
      now: "none",
    });
    await action(m, "privilegesReview")(id);
    const model = m.view.dialogs.at(-1)?.model as ChangeModel;
    expect(m.view.dialogs.at(-1)?.type).toBe("privileges-change");
    expect(model.title).toBe("Change the privileges of table public.orders");
    const script = scriptOf(model, asShown(model));
    expect(script.split("\n")).toEqual([
      'GRANT TRUNCATE ON TABLE "public"."orders" TO PUBLIC;',
      'GRANT SELECT ON TABLE "public"."orders" TO "ana";',
      'REVOKE SELECT ON TABLE "public"."orders" FROM "reports";',
    ]);
    expect(model.choices.map((c) => c.name)).toEqual(["cascade"]);
    expect(server.ran).toEqual(script.split("\n").map((line) => line.replace(/;$/u, "")));
    expect(
      m.host.calls.some(
        (c) => c.method === "db.run" && /^BEGIN/iu.test((c.params as { sql: string }).sql),
      ),
    ).toBe(true);
    expect(panel(m).privileges.edits).toEqual({});
  });

  it("keeps a role's password out of the history, the store, the status line, the question and every model", async () => {
    const { m } = await mounted((model) => asShown(model, { name: "zoe", password: PASSWORD }));
    await m.host.command("endue.database.create-role", {
      connection: "Shop",
      login: true,
      memberOf: ["reports"],
    });
    const model = m.view.dialogs.at(-1)?.model as ChangeModel;
    expect(model.fields.find((f) => f.name === "password")).toMatchObject({
      kind: "password",
      value: "",
    });
    const sent = ran(m).find((sql) => sql.startsWith("CREATE ROLE")) ?? "";
    expect(sent).toMatch(
      /^CREATE ROLE "zoe" WITH LOGIN PASSWORD 'SCRAM-SHA-256\$4096:[^']+' IN ROLE "reports"$/u,
    );
    expect(sent).not.toContain(PASSWORD);
    const question = m.picks.find((p) => p.title.startsWith("Run "));
    expect(JSON.stringify(question)).toContain(`PASSWORD ${MASK}`);
    const elsewhere = JSON.stringify([
      m.store,
      m.view.said,
      m.view.dialogs,
      m.picks,
      m.view.consoles,
    ]);
    expect(elsewhere).not.toContain(PASSWORD);
    expect(elsewhere).not.toContain("SCRAM-SHA-256$");
  });

  it("says what the role cannot read in its section and shows the rest", async () => {
    const { m, server } = await mounted();
    server.cannot.add("pg_auth_members");
    const answer = (await m.host.command("endue.database.privileges", { connection: "Dev" })) as {
      roles: unknown[];
      error: string;
      cannot: string[];
    };
    expect(answer.roles).toHaveLength(3);
    expect(answer.cannot).toEqual(["pg_auth_members"]);
    expect(answer.error).toBe("app may not read pg_auth_members: memberships cannot be shown.");
    await expect(
      m.host.command("endue.database.role-privileges", { connection: "Dev", role: "ana" }),
    ).rejects.toThrow("app may not read pg_auth_members: what it may do cannot be shown.");
    server.cannot.add("pg_default_acl");
    const defaults = (await m.host.command("endue.database.default-privileges", {
      connection: "Dev",
    })) as { error: string };
    expect(defaults.error).toBe(
      "app may not read pg_default_acl: default privileges cannot be shown.",
    );
    for (const sql of ran(m)) expect(sql).not.toContain("pg_default_acl d");
  });

  it("refuses a read-only connection before any dialog", async () => {
    const { m, server } = await mounted();
    await expect(
      m.host.command("endue.database.create-role", { connection: "Locked", name: "x" }),
    ).rejects.toThrow("Locked is read-only: roles and privileges are not changed from here.");
    await expect(
      m.host.command("endue.database.change-privileges", {
        connection: "Locked",
        schema: "public",
        name: "orders",
        kind: "table",
        grantee: "ana",
        grant: ["SELECT"],
      }),
    ).rejects.toThrow("read-only");
    expect(m.view.dialogs).toEqual([]);
    expect(server.ran).toEqual([]);
    await expect(
      m.host.command("endue.database.privileges", { connection: "Notes" }),
    ).rejects.toThrow("SQLite");
  });

  it("creates and changes a policy from its form", async () => {
    const { m, server } = await mounted();
    await m.host.command("endue.database.policy", {
      connection: "Dev",
      schema: "public",
      table: "orders",
      name: "own_rows",
      roles: ["ana", "reports"],
      using: "person = 2",
    });
    const changed = m.view.dialogs.at(-1)?.model as ChangeModel;
    expect(changed.title).toBe("Change policy own_rows on public.orders");
    await m.host.command("endue.database.policy", {
      connection: "Dev",
      schema: "public",
      table: "orders",
      name: "writers",
      command: "INSERT",
      check: "total > 0",
    });
    await m.host.command("endue.database.drop-policy", {
      connection: "Dev",
      schema: "public",
      table: "orders",
      name: "own_rows",
    });
    await m.host.command("endue.database.row-security", {
      connection: "Dev",
      schema: "public",
      table: "orders",
      force: true,
    });
    expect(server.ran).toEqual([
      'ALTER POLICY "own_rows" ON "public"."orders" TO "ana", "reports" USING (person = 2)',
      'CREATE POLICY "writers" ON "public"."orders" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (total > 0)',
      'DROP POLICY "own_rows" ON "public"."orders"',
      'ALTER TABLE "public"."orders" FORCE ROW LEVEL SECURITY',
    ]);
  });

  it("lets agents' commands fill the dialog, never run without it", async () => {
    const { m, server } = await mounted(() => undefined);
    await m.host
      .command("endue.database.change-privileges", {
        connection: "Dev",
        schema: "public",
        name: "orders",
        kind: "table",
        grantee: "ana",
        grant: ["SELECT", "update"],
        grantOption: true,
      })
      .catch(() => {});
    const model = m.view.dialogs.at(-1)?.model as ChangeModel;
    expect(scriptOf(model, asShown(model))).toBe(
      'GRANT SELECT, UPDATE ON TABLE "public"."orders" TO "ana" WITH GRANT OPTION;',
    );
    await m.host
      .command("endue.database.change-membership", {
        connection: "Dev",
        role: "reports",
        member: "app",
        admin: true,
      })
      .catch(() => {});
    const membership = m.view.dialogs.at(-1)?.model as ChangeModel;
    expect(scriptOf(membership, asShown(membership))).toBe(
      'GRANT "reports" TO "app" WITH ADMIN TRUE;',
    );
    await m.host
      .command("endue.database.change-default-privileges", {
        connection: "Dev",
        owner: "app",
        schema: "public",
        on: "sequences",
        grantee: "ana",
        grant: ["usage"],
      })
      .catch(() => {});
    const defaults = m.view.dialogs.at(-1)?.model as ChangeModel;
    expect(scriptOf(defaults, asShown(defaults))).toBe(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "app" IN SCHEMA "public" GRANT USAGE ON SEQUENCES TO "ana";',
    );
    await expect(
      m.host.command("endue.database.change-privileges", {
        connection: "Dev",
        schema: "public",
        name: "orders",
        kind: "table",
        grantee: "ana",
        grant: ["EXECUTE"],
      }),
    ).rejects.toThrow("EXECUTE is not a privilege of table public.orders");
    expect(server.ran).toEqual([]);
  });
});
