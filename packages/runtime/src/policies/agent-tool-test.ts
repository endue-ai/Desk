// A command invoked from the agent's side of the bridge, for policy integration tests.
import type { BridgeClient, CmdAnsweredData } from "@endue-ai/bridge";
import { expect } from "vitest";

export async function invokeAsEris(
  bridge: BridgeClient,
  id: string,
  args: Record<string, unknown> = {},
) {
  const heard: CmdAnsweredData[] = [];
  const off = bridge.onEvent((e) => {
    if (e.event === "cmd.answered") heard.push(e.data);
  });
  try {
    const { invocationId } = await bridge.call(
      "cmd.invoke",
      { id, args, scope: { permission: "cmd:invoke", ids: [id] } },
      { caller: "agent:eris" },
    );
    await expect
      .poll(() => heard.some((answer) => answer.invocationId === invocationId))
      .toBe(true);
    const answer = heard.find((a) => a.invocationId === invocationId);
    if (!answer?.ok) throw new Error(answer?.error?.message);
    return answer.result;
  } finally {
    off();
  }
}
