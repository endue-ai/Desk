// What agents may not reach (ui/features/audit/gate.js, PG-91): a connection closed to agents is
// refused for every command an agent calls, and so is a call naming no connection while any is
// closed; the connections list leaves closed ones out; only the person changes agents' access or
// clears their list; and an agent is offered as granted only the tools its grants cover, while the
// person's own commands are no agent's tools at all.
import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";
import { asAgent, auditMount, register } from "./audit-fixture";

const close = (m: Awaited<ReturnType<typeof auditMount>>["m"], connection: string) =>
  m.host.command("endue.database.agent-access", { connection, closed: true });

describe("a connection closed to agents", () => {
  it("is refused for every command an agent calls, and runs nothing", async () => {
    const { m, seen } = await auditMount();
    await close(m, "shop");
    const before = seen.length;
    for (const [id, args] of [
      ["endue.database.query", { sql: "select 1" }],
      ["endue.database.schema", {}],
      ["endue.database.sample-rows", { schema: "public", table: "people" }],
      ["endue.database.sessions-list", {}],
      ["endue.database.activity", {}],
      ["endue.database.search-data", { value: "Ada" }],
    ] as const)
      await expect(asAgent(m, id, { connection: "shop", ...args })).rejects.toThrow(
        /shop is closed to agents/u,
      );
    expect(seen.length).toBe(before);
    // Another plugin, the assistant say, is refused the same way.
    await expect(
      asAgent(m, "endue.database.query", { connection: "shop", sql: "select 1" }, "endue.eris"),
    ).rejects.toThrow(/closed to agents/u);
  });

  it("refuses a call naming no connection while any is closed, and is not listed", async () => {
    const { m } = await auditMount();
    await close(m, "shop");
    await expect(asAgent(m, "endue.database.activity", {})).rejects.toThrow(/Name the connection/u);
    const listed = (await asAgent(m, "endue.database.connections", {})) as Array<{ name: string }>;
    expect(listed.map((c) => c.name)).toEqual(["Notes"]);
    // The person still reaches it.
    const answer = await m.host.command("endue.database.query", {
      connection: "shop",
      sql: "select 1",
    });
    expect(answer).toMatchObject({ statements: [{ ran: true }] });
  });

  it("opens again when the person says so", async () => {
    const { m } = await auditMount();
    await close(m, "shop");
    await m.host.command("endue.database.agent-access", { connection: "shop", closed: false });
    await expect(
      asAgent(m, "endue.database.query", { connection: "shop", sql: "select 1" }),
    ).resolves.toMatchObject({ statements: [{ ran: true }] });
  });
});

describe("the person's own commands", () => {
  it("are refused to an agent: its access and its list stay the person's", async () => {
    const { m } = await auditMount();
    await expect(
      asAgent(m, "endue.database.agent-access", {
        connection: "shop",
        closed: false,
        analyze: true,
      }),
    ).rejects.toThrow(/Only the person changes what agents may reach/u);
    await expect(
      asAgent(m, "endue.database.agent-audit-clear", { connection: "shop" }),
    ).rejects.toThrow(/Only the person/u);
    expect(m.store["agent-access"]).toBeUndefined();
  });

  it("run the console only for the person: an agent or an MCP server is refused and runs nothing", async () => {
    const { m, seen } = await auditMount();
    const before = seen.length;
    for (const [id, caller] of [
      ["endue.database.run", "agent:helper"],
      ["endue.database.run-all", "agent:helper"],
      ["endue.database.submit-changes", "mcp:tools"],
      ["endue.database.commit", "agent:helper"],
      ["endue.database.forget-password", "mcp:tools"],
    ] as const)
      await expect(asAgent(m, id, { connection: "shop" }, caller), id).rejects.toThrow(
        /Only the person runs this/u,
      );
    expect(seen.length).toBe(before);
  });

  it("are no agent's tools, and the tools are read-only", () => {
    const commands = manifest.contributes.commands as Array<{
      id: string;
      agent?: boolean;
      readOnly?: boolean;
    }>;
    const of = (id: string) => commands.find((c) => c.id === `endue.database.${id}`);
    for (const id of ["agent-audit", "agent-access", "agent-audit-export", "agent-audit-clear"])
      expect(of(id)?.agent ?? false, id).toBe(false);
    for (const id of [
      "explain-statement",
      "object-ddl",
      "sample-rows",
      "table-stats",
      "sessions-list",
      "check-statement",
    ])
      expect(of(id), id).toMatchObject({ agent: true, readOnly: true });
  });
});

describe("an agent's grants", () => {
  it("cover only the tools granted to it", async () => {
    const { m } = await auditMount();
    for (const id of [
      "endue.database.sample-rows",
      "endue.database.table-stats",
      "endue.database.agent-access",
    ])
      await register(m, id);
    const caller = "agent:narrow";
    await m.host.call(
      "perm.request",
      {
        permission: { permission: "cmd:invoke", ids: ["endue.database.sample-rows"] },
        reason: "test",
      },
      caller,
    );
    const { tools } = await m.host.call("cmd.tools", { query: "database" }, caller);
    const ours = tools.filter((t) => t.provider === "endue.database");
    expect(ours.filter((t) => t.granted).map((t) => t.command)).toEqual([
      "endue.database.sample-rows",
    ]);
    expect(ours.map((t) => t.command)).not.toContain("endue.database.agent-access");
    expect(ours.find((t) => t.command === "endue.database.sample-rows")).toMatchObject({
      readOnly: true,
    });
  });
});
