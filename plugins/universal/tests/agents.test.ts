// What an agent may hand desk.universal (ui/agents.js, ADR 0367): a view it passes inline may not
// read a command source, which the plugin would run as itself before anyone said yes; the person,
// a plugin and a saved view are not limited.
import { describe, expect, it } from "vitest";
import { byAgent, refuseAgentCommandSource } from "../ui/agents.js";

const at = (caller: string) => ({ invocationId: "i-1", caller });
const sending = { type: "list", source: { command: "endue.mail.send-message", args: {} } };

describe("an agent's view", () => {
  it("cannot read a command source, from an agent of the brain or an MCP server", () => {
    for (const caller of ["agent:eris", "mcp:tools"])
      expect(() => refuseAgentCommandSource(at(caller), sending), caller).toThrow(
        /cannot read a command source \(endue\.mail\.send-message\)/u,
      );
  });

  it("may read data, items, a file or a URL", () => {
    for (const source of [
      { data: { entries: [] } },
      { file: "~/a.yaml" },
      { url: "https://a.test" },
    ])
      expect(() =>
        refuseAgentCommandSource(at("agent:eris"), { type: "list", source }),
      ).not.toThrow();
  });

  it("leaves the person, a plugin and a request the desk sends as they are", () => {
    for (const invocation of [at("desk"), at("endue.eris"), undefined])
      expect(() => refuseAgentCommandSource(invocation, sending)).not.toThrow();
    expect(byAgent(at("desk"))).toBe(false);
    expect(byAgent(at("agent:mira"))).toBe(true);
  });

  it("names no view when none is passed inline (a saved view by id)", () => {
    expect(() => refuseAgentCommandSource(at("agent:eris"), undefined)).not.toThrow();
  });
});
