import { expect, it, vi } from "vitest";
import type { CommandCaller, CommandSpec } from "../commands";
import type { ShellCtx } from "../shell/context";
import { ASK_ENDUE, defineEndueCommands } from "./endue-commands";
import { agentConversationPage, spaceConversationPage } from "./endue-ids";

function desk() {
  const defined = new Map<string, CommandSpec>();
  const reply = {
    agentId: "ag_cloud",
    spaceId: "sp_team",
    conversationId: "cnv_room",
    runId: "run_result",
    state: "done",
    text: "The outline is ready.",
  };
  const ask = vi.fn(async () => reply);
  const ctx = {
    bridge: {
      studio: {
        agents: async () => [
          { id: "ag_cloud", name: "Cloud", status: "active" },
          { id: "ag_archived", name: "Archived", status: "archived" },
        ],
        spaces: async () => [{ id: "sp_team", name: "Team", frontAgentId: "ag_cloud" }],
        ask,
      },
    },
    runtime: {
      commands: {
        define: (id: string, spec: CommandSpec) => {
          defined.set(id, spec);
          return () => defined.delete(id);
        },
      },
    },
  } as unknown as ShellCtx;
  const off = defineEndueCommands(ctx);
  const run = async (id: string, args: unknown, from: CommandCaller = { caller: "agent:eris" }) => {
    const spec = defined.get(id);
    if (!spec) throw new Error(`Missing command ${id}.`);
    return spec.run(args, from);
  };
  return { defined, ask, reply, run, off };
}

it("finds eligible cloud targets and returns an exact reviewed reply to Eris", async () => {
  const { defined, ask, reply, run, off } = desk();
  expect(defined.get("desk.endue.agents")?.agent).toMatchObject({ readOnly: true });
  expect(defined.get("desk.endue.spaces")?.agent).toMatchObject({ readOnly: true });
  expect(defined.get(ASK_ENDUE)?.agent).toMatchObject({ irreversible: true });
  await expect(run("desk.endue.agents", {})).resolves.toEqual({
    agents: [{ id: "ag_cloud", name: "Cloud", status: "active" }],
  });
  await expect(run("desk.endue.spaces", {})).resolves.toEqual({
    spaces: [{ id: "sp_team", name: "Team", frontAgentId: "ag_cloud" }],
  });
  const request = { agentId: "ag_cloud", spaceId: "sp_team", question: "What is ready?" };
  await expect(run(ASK_ENDUE, request, { caller: "example.unrelated" })).rejects.toThrow(
    "Use the desk",
  );
  await expect(run(ASK_ENDUE, { ...request, agentId: "../another" })).rejects.toThrow(
    "exact agent",
  );
  expect(ask).not.toHaveBeenCalled();
  await expect(run(ASK_ENDUE, request)).resolves.toEqual({
    ...reply,
    conversationUrl: "https://endue.ai/spaces/sp_team/admin",
  });
  expect(ask).toHaveBeenCalledExactlyOnceWith(request);
  off();
  expect(defined.size).toBe(0);
});

it("links to the current web conversation and space Front Desk paths", () => {
  expect(agentConversationPage("ag_cloud", "cnv_room")).toBe(
    "https://endue.ai/agents/ag_cloud/conversations/cnv_room",
  );
  expect(spaceConversationPage("sp_team")).toBe("https://endue.ai/spaces/sp_team/admin");
});
