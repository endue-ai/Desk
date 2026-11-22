// @vitest-environment jsdom
// A refused connection is said in the plugin with a way to ask again (PG-01g, ADR 0335): the run's
// Messages tab has an "Allow connecting to host:port" button beside the refusal, whose action asks
// again; Database: allow connecting asks for a connection's server through perm.request, `again`.
import { describe, expect, it } from "vitest";
import { failedRun } from "../ui/engines/common.js";
import { lineOf } from "../ui/message-line.js";
import { show } from "../ui/tabs.js";
import { mount } from "./harness";
import { PG } from "./session-helpers";

const statement = { text: "select 1", start: 0, end: 8, line: 1, column: 1, tokens: [] };
const refusedRun = () => {
  const statements = [statement];
  const message = "Not allowed to connect to db.example:5432.";
  return {
    conn: PG,
    sql: "select 1",
    statements,
    classes: [],
    mode: "run" as const,
    result: failedRun(statements, { kind: "refused", message }),
    at: 0,
  };
};

describe("a refused connection offers to ask again (PG-01g)", () => {
  it("a refused run's Messages tab offers Allow connecting to host:port, and the button asks again", () => {
    const shown = show(refusedRun() as never);
    const lines = shown.tabs.flatMap((t) => t.lines ?? []);
    const offer = lines.find((l) => l.act);
    expect(offer?.act).toEqual({
      action: "allowConnect",
      args: ["c-pg"],
      label: "Allow connecting to db.example:5432",
    });

    const acted: unknown[][] = [];
    const li = lineOf(document, offer as never, (...args: unknown[]) => void acted.push(args));
    const button = li.querySelector("button");
    expect(button?.textContent).toBe("Allow connecting to db.example:5432");
    button?.click();
    expect(acted).toEqual([["allowConnect", "c-pg"]]);
  });

  it("a line without an offer is its text alone", () => {
    const li = lineOf(document, { level: "ok", text: "SELECT: 1 row", statement: 0 }, () => {});
    expect(li.textContent).toBe("SELECT: 1 row");
    expect(li.querySelector("button")).toBeNull();
  });

  it("Database: allow connecting asks again for the connection's server", async () => {
    const m = await mount({ store: { connections: [PG] } });
    await m.host.command("endue.database.allow-connect", { connection: "Shop" });
    await m.settle();
    const asked = m.host.calls
      .filter((c) => c.method === "perm.request")
      .map((c) => c.params as Record<string, unknown>);
    expect(asked.at(-1)).toMatchObject({
      permission: { permission: "db:connect", hosts: ["db.example:5432"] },
      again: true,
    });
    expect(m.view.said.at(-1)).toMatch(/Shop.*db\.example:5432/u);
  });
});
