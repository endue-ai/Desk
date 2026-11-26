import { describe, expect, it } from "vitest";
import type { OperationModel } from "../ui/features/objects/models.js";
import { mounted } from "./objects-harness";

describe("object operation reviews", () => {
  it("uses one review for a direct truncate and reuses a matching core approval", async () => {
    const args = { connection: "Shop", schema: "public", name: "orders" };
    const person = await mounted();
    await person.m.host.command("endue.database.truncate-table", args);
    expect(person.m.view.dialogs.map(({ model }) => (model as OperationModel).op)).toEqual([
      "truncate",
    ]);
    expect(person.m.picks.filter(({ title }) => title.startsWith("Run "))).toEqual([]);
    expect(person.server.ran).toEqual(['TRUNCATE TABLE "public"."orders"']);

    const agent = await mounted(() => undefined);
    await agent.m.host.call(
      "perm.request",
      { permission: { permission: "db:connect", hosts: ["db.example:5432"] } },
      "endue.database",
    );
    agent.m.host.emit({
      event: "cmd.invoked",
      data: {
        invocationId: "reviewed-truncate",
        id: "endue.database.truncate-table",
        caller: "agent:eris",
        args,
        approved: true,
      },
    });
    await expect.poll(() => agent.server.ran).toEqual(['TRUNCATE TABLE "public"."orders"']);
    expect(agent.m.view.dialogs).toEqual([]);
    expect(agent.m.picks).toEqual([]);
  });
});
