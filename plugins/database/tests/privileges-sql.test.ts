// The statements the privileges feature writes (PG-54, ui/features/privileges/): GRANT and REVOKE
// from a matrix's changes, ALTER DEFAULT PRIVILEGES, CREATE ROLE and ALTER ROLE with a masked
// password, memberships on PostgreSQL 16 and before, row security policies, and the SCRAM-SHA-256
// verifier a password goes as. Pure.
import { describe, expect, it } from "vitest";
import type { Change } from "../ui/features/privileges/acl.js";
import { defaultScript, grantScript, objectRef } from "../ui/features/privileges/grants.js";
import {
  createPolicy,
  dropPolicy,
  policyScript,
  rowSecurityScript,
} from "../ui/features/privileges/policies.js";
import { MASK, membershipScript, roleScript } from "../ui/features/privileges/roles.js";
import { saslPrep, scramVerifier } from "../ui/features/privileges/scram.js";

const change = (grantee: string, privilege: string, from: string, to: string, column = "") =>
  ({ grantee, column, privilege, from, to }) as Change;
const answers = (values: Record<string, string>, choices: string[] = []) => ({ values, choices });
const ANA = {
  name: "ana",
  superuser: false,
  inherit: true,
  createRole: false,
  createDb: false,
  login: true,
  replication: false,
  bypassRls: false,
  limit: 3,
  until: "",
};

describe("privileges statements", () => {
  it("writes GRANT and REVOKE from the matrix's changes", () => {
    const on = objectRef({ kind: "table", schema: "public", name: 'Ord"ers' });
    expect(on).toBe('TABLE "public"."Ord""ers"');
    const script = grantScript(on, [
      change("reports", "SELECT", "none", "granted"),
      change("reports", "INSERT", "none", "granted"),
      change("reports", "UPDATE", "granted", "option"),
      change("reports", "DELETE", "granted", "none"),
      change("PUBLIC", "SELECT", "option", "granted"),
      change("ana", "UPDATE", "none", "granted", "note"),
      change("ana", "SELECT", "none", "granted", "note"),
    ]);
    expect(script.split("\n")).toEqual([
      'REVOKE DELETE ON TABLE "public"."Ord""ers" FROM "reports";',
      'GRANT SELECT, INSERT ON TABLE "public"."Ord""ers" TO "reports";',
      'GRANT UPDATE ON TABLE "public"."Ord""ers" TO "reports" WITH GRANT OPTION;',
      'REVOKE GRANT OPTION FOR SELECT ON TABLE "public"."Ord""ers" FROM PUBLIC;',
      'GRANT UPDATE ("note"), SELECT ("note") ON TABLE "public"."Ord""ers" TO "ana";',
    ]);
    expect(
      grantScript(on, [change("reports", "DELETE", "option", "none")], { cascade: true }),
    ).toBe('REVOKE DELETE ON TABLE "public"."Ord""ers" FROM "reports" CASCADE;');
    expect(
      grantScript(on, [change("reports", "SELECT", "none", "granted")], { cascade: true }),
    ).toBe('GRANT SELECT ON TABLE "public"."Ord""ers" TO "reports";');
    expect(() => grantScript(on, [])).toThrow("Nothing changed");
    expect(
      objectRef({ kind: "function", schema: "public", name: "add(integer, integer)" }, [
        "add",
        "a integer, b integer",
      ]),
    ).toBe('FUNCTION "public"."add"(a integer, b integer)');
    expect(() => objectRef({ kind: "function", schema: "public", name: "add" })).toThrow(
      "arguments",
    );
    expect(objectRef({ kind: "sequence", schema: "s", name: "n" })).toBe('SEQUENCE "s"."n"');
    expect(objectRef({ kind: "schema", schema: "s", name: "s" })).toBe('SCHEMA "s"');
    expect(objectRef({ kind: "database", schema: "", name: "shop" })).toBe('DATABASE "shop"');
    expect(objectRef({ kind: "foreign server", schema: "", name: "far" })).toBe(
      'FOREIGN SERVER "far"',
    );
    expect(objectRef({ kind: "type", schema: "public", name: "mood" })).toBe(
      'TYPE "public"."mood"',
    );
    expect(() => objectRef({ kind: "index", schema: "s", name: "i" })).toThrow(
      "no privileges of its own",
    );
  });

  it("writes ALTER DEFAULT PRIVILEGES per owner and schema", () => {
    expect(
      defaultScript({ owner: "app", schema: "public", letter: "r" }, [
        change("reports", "SELECT", "none", "granted"),
        change("PUBLIC", "INSERT", "granted", "none"),
      ]),
    ).toBe(
      [
        'ALTER DEFAULT PRIVILEGES FOR ROLE "app" IN SCHEMA "public" GRANT SELECT ON TABLES TO "reports";',
        'ALTER DEFAULT PRIVILEGES FOR ROLE "app" IN SCHEMA "public" REVOKE INSERT ON TABLES FROM PUBLIC;',
      ].join("\n"),
    );
    expect(
      defaultScript({ owner: "app", schema: "", letter: "f" }, [
        change("PUBLIC", "EXECUTE", "granted", "none"),
      ]),
    ).toBe('ALTER DEFAULT PRIVILEGES FOR ROLE "app" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;');
    expect(
      defaultScript({ owner: "app", schema: "", letter: "S" }, [
        change("ana", "USAGE", "none", "option"),
      ]),
    ).toBe(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "app" GRANT USAGE ON SEQUENCES TO "ana" WITH GRANT OPTION;',
    );
    expect(() =>
      defaultScript({ owner: "app", schema: "public", letter: "n" }, [
        change("ana", "USAGE", "none", "granted"),
      ]),
    ).toThrow("every schema");
    expect(() =>
      defaultScript({ owner: "", schema: "", letter: "T" }, [
        change("ana", "USAGE", "none", "granted"),
      ]),
    ).toThrow("Name the role");
  });

  it("writes CREATE ROLE and ALTER ROLE with only what changed", () => {
    expect(
      roleScript(
        null,
        answers(
          { name: "Ana B", limit: "-1", until: "", password: "s3cret", memberOf: "reports, app" },
          ["login", "inherit"],
        ),
      ),
    ).toBe(`CREATE ROLE "Ana B" WITH LOGIN PASSWORD ${MASK} IN ROLE "reports", "app";`);
    expect(
      roleScript(null, answers({ name: "r", password: "s3cret" }, ["login", "inherit"]), {
        verifier: "SCRAM-SHA-256$4096:a$b:c",
      }),
    ).toBe("CREATE ROLE \"r\" WITH LOGIN PASSWORD 'SCRAM-SHA-256$4096:a$b:c';");
    expect(MASK).not.toMatch(/s3cret/u);
    expect(roleScript(null, answers({ name: "g" }, ["createDb"]))).toBe(
      'CREATE ROLE "g" WITH CREATEDB NOINHERIT;',
    );
    expect(
      roleScript(
        ANA,
        answers({ limit: "5", until: "2028-01-01" }, ["login", "inherit", "createDb"]),
      ),
    ).toBe("ALTER ROLE \"ana\" WITH CREATEDB CONNECTION LIMIT 5 VALID UNTIL '2028-01-01';");
    expect(
      roleScript(
        { ...ANA, until: "2027-01-01" },
        answers({ limit: "3", until: "" }, ["inherit", "clearPassword"]),
      ),
    ).toBe("ALTER ROLE \"ana\" WITH NOLOGIN VALID UNTIL 'infinity' PASSWORD NULL;");
    expect(() => roleScript(ANA, answers({ limit: "3" }, ["login", "inherit"]))).toThrow(
      "Nothing changed: ana is as it was.",
    );
    expect(() => roleScript(null, answers({ name: "x".repeat(64) }))).toThrow("63 bytes");
    expect(() => roleScript(null, answers({ name: "pg_mine" }))).toThrow("PostgreSQL's own");
    expect(() => roleScript(null, answers({ name: "" }))).toThrow("Type the role's name.");
    expect(() => roleScript(ANA, answers({ limit: "-2" }, ["login"]))).toThrow("connection limit");
    expect(() => roleScript(ANA, answers({ password: "x" }, ["clearPassword"]))).toThrow(
      "not both",
    );
  });

  it("writes membership GRANT and REVOKE", () => {
    const at = (
      version: number,
      now: { admin: boolean; inherit: boolean | null; set: boolean | null } | null,
    ) => ({
      role: "reports",
      member: "ana",
      now,
      inheritDefault: true,
      version,
    });
    expect(membershipScript(at(170000, null), answers({}, ["inherit", "set"]))).toBe(
      'GRANT "reports" TO "ana";',
    );
    expect(membershipScript(at(170000, null), answers({}, ["admin"]))).toBe(
      'GRANT "reports" TO "ana" WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;',
    );
    expect(membershipScript(at(150000, null), answers({}, ["admin"]))).toBe(
      'GRANT "reports" TO "ana" WITH ADMIN OPTION;',
    );
    expect(
      membershipScript(
        at(170000, { admin: false, inherit: true, set: true }),
        answers({}, ["admin", "set"]),
      ),
    ).toBe(
      [
        'GRANT "reports" TO "ana" WITH ADMIN TRUE;',
        'REVOKE INHERIT OPTION FOR "reports" FROM "ana";',
      ].join("\n"),
    );
    expect(
      membershipScript(at(150000, { admin: true, inherit: null, set: null }), answers({}, [])),
    ).toBe('REVOKE ADMIN OPTION FOR "reports" FROM "ana";');
    expect(
      membershipScript(
        at(170000, { admin: false, inherit: true, set: true }),
        answers({}, ["revoke"]),
      ),
    ).toBe('REVOKE "reports" FROM "ana";');
    expect(() =>
      membershipScript(
        at(170000, { admin: false, inherit: true, set: true }),
        answers({}, ["inherit", "set"]),
      ),
    ).toThrow("Nothing changed");
    expect(() => membershipScript(at(170000, null), answers({ member: "reports" }, []))).toThrow(
      "itself",
    );
  });

  it("writes CREATE, ALTER and DROP POLICY and row security from the form", () => {
    const table = { schema: "public", table: "orders" };
    const form = (values: Record<string, string>, choices: string[] = []) =>
      answers({ name: "own", command: "ALL", roles: "", using: "", check: "", ...values }, choices);
    expect(
      policyScript(
        table,
        undefined,
        form({ command: "SELECT", roles: "ana, PUBLIC", using: "person = 1" }),
      ),
    ).toBe(
      'CREATE POLICY "own" ON "public"."orders" AS PERMISSIVE FOR SELECT TO "ana", PUBLIC USING (person = 1);',
    );
    expect(
      policyScript(
        table,
        undefined,
        form({ command: "INSERT", check: "total > 0" }, ["restrictive"]),
      ),
    ).toBe(
      'CREATE POLICY "own" ON "public"."orders" AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (total > 0);',
    );
    expect(() =>
      policyScript(table, undefined, form({ command: "INSERT", using: "true" })),
    ).toThrow("only WITH CHECK");
    expect(() =>
      policyScript(table, undefined, form({ command: "SELECT", check: "true" })),
    ).toThrow("only USING");
    expect(() =>
      policyScript(table, undefined, form({ using: "true; drop table orders" })),
    ).toThrow("one expression");
    expect(() => policyScript(table, undefined, form({ name: "" }))).toThrow("name");
    const before = {
      name: "own",
      command: "SELECT",
      permissive: true,
      roles: ["ana"],
      using: "person = 1",
      check: "",
    };
    expect(
      policyScript(
        table,
        before,
        form({ name: "mine", command: "SELECT", roles: "ana, reports", using: "person = 2" }),
      ),
    ).toBe(
      [
        'ALTER POLICY "own" ON "public"."orders" RENAME TO "mine";',
        'ALTER POLICY "mine" ON "public"."orders" TO "ana", "reports" USING (person = 2);',
      ].join("\n"),
    );
    expect(
      policyScript(table, before, form({ command: "UPDATE", roles: "ana", using: "person = 1" })),
    ).toBe(
      [
        'DROP POLICY "own" ON "public"."orders";',
        'CREATE POLICY "own" ON "public"."orders" AS PERMISSIVE FOR UPDATE TO "ana" USING (person = 1);',
      ].join("\n"),
    );
    expect(() =>
      policyScript(table, before, form({ command: "SELECT", roles: "ana", using: "person = 1" })),
    ).toThrow("Nothing changed");
    expect(createPolicy(table, { ...before, using: "", roles: ["PUBLIC"] })).toBe(
      'CREATE POLICY "own" ON "public"."orders" AS PERMISSIVE FOR SELECT TO PUBLIC;',
    );
    expect(dropPolicy(table, 'my "p"')).toBe('DROP POLICY "my ""p""" ON "public"."orders";');
    expect(
      rowSecurityScript(table, { on: false, forced: false }, answers({}, ["enable", "force"])),
    ).toBe(
      [
        'ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "public"."orders" FORCE ROW LEVEL SECURITY;',
      ].join("\n"),
    );
    expect(rowSecurityScript(table, { on: true, forced: true }, answers({}, ["enable"]))).toBe(
      'ALTER TABLE "public"."orders" NO FORCE ROW LEVEL SECURITY;',
    );
    expect(() =>
      rowSecurityScript(table, { on: true, forced: false }, answers({}, ["enable"])),
    ).toThrow("Nothing changed");
  });

  it("makes the SCRAM-SHA-256 verifier PostgreSQL stores", async () => {
    // Computed apart from this code (PBKDF2-HMAC-SHA-256, 4096 iterations, salt bytes 0 to 15).
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(await scramVerifier("pencil", { salt })).toBe(
      "SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$zHCdol2044/ZyWzPLi7oxApCkamKw9Z+E4U/QApd/5Y=:dd5peBOitVnLNFu7VmwP+HiDaaw4OUCv396eVCWhYiE=",
    );
    const other = await scramVerifier("pencil");
    expect(other).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/u,
    );
    expect(other).not.toContain("pencil");
    expect(saslPrep("plain ASCII")).toBe("plain ASCII");
    expect(saslPrep("ﬁ x­")).toBe("fi x");
  });
});
