import { StubError, type StubHandlers } from "@endue-ai/bridge";
import type { StudioRecord } from "./studio-fixtures";
import type { StudioSpaceRecord } from "./studio-spaces";

export function chatHandler(
  agents: StudioRecord[],
  spaces: StudioSpaceRecord[],
  gate: (caller?: string) => void,
): NonNullable<StubHandlers["studio.chat.ask"]> {
  let asked = 0;
  return ({ agentId, spaceId, question }, caller) => {
    if (caller !== "desk")
      throw new StubError("permission_denied", "Only the desk sends questions.");
    gate(caller);
    const space = spaces.find(({ space }) => space.id === spaceId)?.space;
    const active = agents.some(({ agent }) => agent.id === agentId && agent.status === "active");
    const exact = space?.status === "active" && space.frontAgentId === agentId;
    if ((spaceId ? !exact : !active) || !question.trim())
      throw new StubError("invalid_params", "Choose the current agent and write a question.");
    const run = ++asked;
    return {
      agentId,
      ...(spaceId ? { spaceId } : {}),
      conversationId: spaceId ? `cnv_${spaceId}` : `cnv_fixture_${run}`,
      runId: `run_fixture_${run}`,
      state: "done",
      text: "The outline is ready.",
    };
  };
}
