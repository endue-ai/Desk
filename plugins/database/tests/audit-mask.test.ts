// Masking what agents read (ui/features/audit/mask.js, PG-91): the rules on their own, then through
// the plugin: a query's results, a table's sample rows and its statistics with the person's
// sensitive columns masked, and a read refused when it uses a sensitive column other than by
// selecting it by name.
import { describe, expect, it } from "vitest";
import { columnOf } from "../ui/features/audit/access.js";
import { leakOf, MASK, maskSet, namesOf, namesOn } from "../ui/features/audit/mask.js";
import { asAgent, auditMount } from "./audit-fixture";

const set = (columns: string[], ...rows: (string | null)[][]) => ({
  columns,
  rows,
  truncated: false,
});

describe("the rules", () => {
  it("reads a sensitive column as column, table.column or schema.table.column", () => {
    expect(columnOf(" public.people.email ")).toEqual({ name: "public.people.email" });
    expect(columnOf('"people"."email"')).toEqual({ name: "people.email" });
    expect(columnOf("a b").error).toMatch(/Name a column/u);
    expect(columnOf("a.b.c.d").error).toMatch(/Name a column/u);
  });

  it("masks a column of a sensitive name in any table, and one table's entries on that table", () => {
    const sensitive = ["email", "people.phone", "crm.contacts.note"];
    expect([...namesOf(sensitive)]).toEqual(["email", "phone", "note"]);
    expect([...namesOn(sensitive, "public", "people")]).toEqual(["email", "phone"]);
    expect([...namesOn(sensitive, "crm", "contacts")]).toEqual(["email", "note"]);
    const masked = maskSet(set(["id", "Email"], ["1", "a@x"], ["2", null]), new Set(["email"]));
    expect(masked.rows).toEqual([
      ["1", MASK],
      ["2", MASK],
    ]);
  });

  it("finds a sensitive column used other than by selecting it under its name", () => {
    const names = new Set(["email"]);
    const ok = set(["id", "email"]);
    expect(leakOf("select id, email from people", "postgresql", [ok], names)).toBe("");
    expect(leakOf("select p.email, id from people p", "postgresql", [ok], names)).toBe("");
    expect(
      leakOf("select id, 'email' from people", "postgresql", [set(["id", "?column?"])], names),
    ).toBe("");
    expect(
      leakOf("select id, upper(email) from people", "postgresql", [set(["id", "upper"])], names),
    ).toBe("email");
    expect(leakOf('select "email" as e from people', "postgresql", [set(["e"])], names)).toBe(
      "email",
    );
    expect(
      leakOf("select id from people where email = 'x'", "postgresql", [set(["id"])], names),
    ).toBe("email");
    expect(leakOf("select email from people order by email", "postgresql", [ok], names)).toBe(
      "email",
    );
  });
});

describe("through the plugin", () => {
  const sensitive = async (m: Awaited<ReturnType<typeof auditMount>>["m"], add: string) =>
    m.host.command("endue.database.agent-access", { connection: "shop", add });

  it("masks a query's results, the sample rows and the statistics' values", async () => {
    const { m } = await auditMount();
    await sensitive(m, "people.email");
    const query = (await asAgent(m, "endue.database.query", {
      connection: "shop",
      sql: "select id, name, email from people",
    })) as { statements: Array<{ results: Array<{ rows: string[][] }> }> };
    expect(query.statements[0]?.results[0]?.rows.map((r) => r[2])).toEqual([MASK, MASK, MASK]);
    const sample = (await asAgent(m, "endue.database.sample-rows", {
      connection: "shop",
      schema: "public",
      table: "people",
    })) as { rows: string[][]; masked: string[] };
    expect(sample.masked).toEqual(["email"]);
    expect(sample.rows.map((r) => r[2])).toEqual([MASK, MASK, MASK]);
    expect(JSON.stringify(sample)).not.toContain("example.test");
    const stats = (await asAgent(m, "endue.database.table-stats", {
      connection: "shop",
      schema: "public",
      table: "people",
    })) as { columns: Array<Record<string, unknown>> };
    expect(stats.columns[0]).toMatchObject({
      attname: "email",
      most_common_vals: MASK,
      null_frac: "0",
    });
    expect(stats.columns[1]).toMatchObject({ attname: "id", histogram_bounds: "{1,2,3}" });
  });

  it("refuses a read that carries a sensitive column out under another name", async () => {
    const { m } = await auditMount();
    await sensitive(m, "email");
    for (const sql of [
      "select id, upper(email) from people",
      "select id from people where email = 'x'",
    ]) {
      const answer = (await asAgent(m, "endue.database.query", { connection: "shop", sql })) as {
        statements: Array<{ results?: unknown; error?: string }>;
      };
      expect(answer.statements[0]?.results).toBeUndefined();
      expect(answer.statements[0]?.error).toMatch(
        /uses the sensitive column email other than by selecting it/u,
      );
      expect(JSON.stringify(answer)).not.toContain("EXAMPLE.TEST");
    }
  });

  it("leaves the person's own reads unmasked", async () => {
    const { m } = await auditMount();
    await sensitive(m, "email");
    await m.host.command("endue.database.console", { connection: "shop" });
    m.view.text = "select id, name, email from people";
    await m.host.command("endue.database.run");
    await m.settle();
    const rows = m.shown()?.shown?.tabs[0]?.set?.rows ?? [];
    expect(rows.map((r) => r[2])).toEqual([
      "ada@example.test",
      "bob@example.test",
      "cy@example.test",
    ]);
  });
});
