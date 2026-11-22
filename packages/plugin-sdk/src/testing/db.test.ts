import { describe, expect, it } from "vitest";
import { defineUiPlugin } from "../index";
import { createTestHost } from "./index";

const scope = { permission: "db:connect" as const, hosts: ["db.example.test:5432"] };
const open = {
  engine: "postgresql",
  host: "db.example.test",
  database: "shop",
  user: "reader",
  password: "fixture-password",
  scope,
};

describe("the test host's database sessions (ADR 0281)", () => {
  it("answers db.* from a scripted server under the plugin's grant, and its events reach the plugin", async () => {
    const host = createTestHost({
      pluginId: "example.database",
      grants: [scope],
      db: {
        password: "fixture-password",
        statements: [
          {
            sql: "SELECT 1 AS one",
            columns: [
              {
                name: "one",
                typeOid: 23,
                typeModifier: -1,
                typeSize: 4,
                tableOid: 0,
                columnNumber: 0,
              },
            ],
            rows: [["1"]],
            notices: [
              { severity: "NOTICE", localSeverity: "NOTICE", code: "00000", message: "hi" },
            ],
          },
        ],
      },
    });
    const seen: string[] = [];
    let page: unknown;
    let refused: unknown;
    await defineUiPlugin(
      {
        async mount(ctx) {
          ctx.bridge.onEvent((event) => seen.push(event.event));
          const { sessionId = "" } = await ctx.bridge.call("db.open", open);
          page = await ctx.bridge.call("db.run", { sessionId, sql: "SELECT 1 AS one" });
          await ctx.bridge.call("db.close", { sessionId });
          const elsewhere = {
            ...open,
            host: "other.example.test",
            scope: { ...scope, hosts: ["*"] },
          };
          refused = await ctx.bridge
            .call("db.open", elsewhere)
            .catch((e: { code?: string }) => e.code);
        },
      },
      host.transport,
    );
    await host.settle();
    expect(page).toMatchObject({
      rows: [["1"]],
      more: false,
      tag: "SELECT 1",
      rowCount: 1,
      notices: [expect.objectContaining({ message: "hi" })],
    });
    expect(seen).toEqual(["db.closed"]);
    expect(refused).toBe("permission_denied");
  });

  it("without a script, db.open is an io_error, as a server nobody runs", async () => {
    const host = createTestHost({ pluginId: "example.database", grants: [scope] });
    let code: unknown;
    await defineUiPlugin(
      {
        async mount(ctx) {
          code = await ctx.bridge.call("db.open", open).catch((e: { code?: string }) => e.code);
        },
      },
      host.transport,
    );
    await host.settle();
    expect(code).toBe("io_error");
  });
});
