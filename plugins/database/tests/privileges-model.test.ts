// The privileges feature's reads as data (PG-54): ACL entries as a matrix with grant options and
// grantors and the person's edits as changes, a role's view explained through its memberships,
// PUBLIC, ownership and predefined roles, and the default privileges grouped per owner and schema.
// Pure.
import { describe, expect, it } from "vitest";
import {
  changesOf,
  dependentGrants,
  editKey,
  matrixOf,
  nextState,
  othersGrants,
} from "../ui/features/privileges/acl.js";
import { grantsLine, roleViewOf, throughWords } from "../ui/features/privileges/effective.js";
import { privilegesOf } from "../ui/features/privileges/kinds.js";
import {
  defaultsOf,
  objectAclOf,
  probeOf,
  rowSecurityOf,
} from "../ui/features/privileges/model.js";

const ACL = [
  ["", "app", "SELECT", "f", "app", "app", "f", '["id", "note"]'],
  ["", "reports", "SELECT", "t", "app", "app", "f", null],
  ["", "reports", "SELECT", "f", "ana", "app", "f", null],
  ["", "ana", "INSERT", "f", "reports", "app", "f", null],
  ["", "PUBLIC", "TRUNCATE", "f", "app", "app", "f", null],
  ["note", "ana", "UPDATE", "f", "app", null, null, null],
];

describe("privileges model", () => {
  it("turns ACL entries into a matrix of grantees and privileges, with grant options and grantors", () => {
    const acl = objectAclOf(ACL);
    expect(acl?.owner).toBe("app");
    expect(acl?.extra).toEqual(["id", "note"]);
    const privileges = privilegesOf("table", 170000);
    expect(privileges).toContain("MAINTAIN");
    expect(privilegesOf("table", 160000)).not.toContain("MAINTAIN");
    const m = matrixOf(acl?.entries ?? [], privileges, "app", [{ grantee: "zoe", column: "" }]);
    expect(m.rows.map((r) => [r.grantee, r.column])).toEqual([
      ["app", ""],
      ["PUBLIC", ""],
      ["ana", ""],
      ["ana", "note"],
      ["reports", ""],
      ["zoe", ""],
    ]);
    const reports = m.rows.find((r) => r.grantee === "reports");
    expect(reports?.cells.SELECT).toEqual({
      state: "option",
      grantors: [
        { name: "app", option: true },
        { name: "ana", option: false },
      ],
    });
    expect(Object.keys(m.rows[3]?.cells ?? {})).toEqual([
      "SELECT",
      "INSERT",
      "UPDATE",
      "REFERENCES",
    ]);
    expect([nextState("none"), nextState("granted"), nextState("option")]).toEqual([
      "granted",
      "option",
      "none",
    ]);
    const edits = {
      [editKey("reports", "", "SELECT")]: "granted" as const,
      [editKey("zoe", "", "DELETE")]: "granted" as const,
      [editKey("app", "", "SELECT")]: "granted" as const,
    };
    const changes = changesOf(m, edits);
    expect(changes).toEqual([
      { grantee: "reports", column: "", privilege: "SELECT", from: "option", to: "granted" },
      { grantee: "zoe", column: "", privilege: "DELETE", from: "none", to: "granted" },
    ]);
    // reports gave SELECT on to nobody, but ana's INSERT came from reports: a revoke of reports'
    // INSERT grant option would take it.
    expect(
      dependentGrants(acl?.entries ?? [], [
        { grantee: "reports", column: "", privilege: "INSERT", from: "option", to: "none" },
      ]),
    ).toEqual([
      { grantee: "ana", column: "", privilege: "INSERT", grantable: false, grantor: "reports" },
    ]);
    expect(
      othersGrants(
        m,
        [{ grantee: "reports", column: "", privilege: "SELECT", from: "option", to: "none" }],
        ["app"],
      ),
    ).toEqual(["SELECT to reports granted by ana"]);
  });

  it("explains what a role may do through its memberships, PUBLIC, ownership and predefined roles", () => {
    const view = roleViewOf("ana", [
      ["member", "", "", "reports", "t", "t", '["ana","reports"]', "", "", "7"],
      [
        "member",
        "",
        "",
        "pg_read_all_data",
        "t",
        "t",
        '["ana","reports","pg_read_all_data"]',
        "",
        "",
        "7",
      ],
      ["member", "", "", "admins", "f", "t", '["ana","admins"]', "", "", "7"],
      ["owner", "table", "public", "notes", "OWNER", "true", '["ana"]', "", "ana", "7"],
      ["grant", "table", "public", "orders", "SELECT", "t", '["ana","reports"]', "app", "app", "7"],
      ["grant", "table", "public", "orders", "INSERT", "f", '["ana"]', "reports", "app", "7"],
      ["grant", "schema", "", "public", "USAGE", "f", '["PUBLIC"]', "app", "app", "7"],
    ]);
    expect(view.reach.map((r) => [r.role, r.inherits, r.sets])).toEqual([
      ["admins", false, true],
      ["reports", true, true],
      ["pg_read_all_data", true, true],
    ]);
    expect(view.powers).toEqual(["may read every table, view and sequence (pg_read_all_data)"]);
    expect(view.total).toBe(7);
    const orders = view.objects.find((o) => o.name === "orders");
    expect(orders && grantsLine(orders)).toBe(
      "SELECT (may grant it) through reports (ana → reports); INSERT directly",
    );
    const notes = view.objects.find((o) => o.name === "notes");
    expect(notes && grantsLine(notes)).toBe("owns it");
    expect(throughWords(["PUBLIC"])).toBe("to PUBLIC");
  });

  it("groups default privileges per owner and schema, and reads row security and the probe", () => {
    const entries = defaultsOf([
      ["app", "public", "r", "reports", "SELECT", "f", "app"],
      ["app", "public", "r", "reports", "INSERT", "t", "app"],
      ["app", "", "f", "app", "EXECUTE", "f", "app"],
      ["ana", "", "T", null, null, null, null],
    ]);
    expect(entries.map((e) => [e.owner, e.schema, e.letter, e.entries.length])).toEqual([
      ["app", "public", "r", 2],
      ["app", "", "f", 1],
      ["ana", "", "T", 0],
    ]);
    expect(rowSecurityOf([["t", "f", "own", "w", "f", '["PUBLIC"]', "(a = 1)", null]])).toEqual({
      on: true,
      forced: false,
      policies: [
        {
          name: "own",
          command: "UPDATE",
          permissive: false,
          roles: ["PUBLIC"],
          using: "(a = 1)",
          check: "",
        },
      ],
    });
    const probe = probeOf([
      "app",
      "160002",
      "off",
      "shop",
      "true",
      "false",
      ...Array(12).fill("true"),
    ]);
    expect(probe).toMatchObject({
      user: "app",
      version: 160002,
      superuser: false,
      cannot: ["pg_auth_members"],
    });
  });
});
