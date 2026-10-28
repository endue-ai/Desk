import { expect, test } from "vitest";
import { agentId, sampleDirectory } from "../bridge/directory";
import type { Task } from "../shell/state";
import { presenceOf } from "./agents";

const d = sampleDirectory();
const tasks: Task[] = [
  {
    id: "a",
    agent: agentId(1),
    title: "Sort the inbox",
    startedAt: 0,
    progress: 0.5,
    running: true,
  },
  { id: "b", agent: agentId(2), title: "Tidy notes", startedAt: 0, progress: 0, running: false },
];
const presence = (n: number) => {
  const agent = d.agents.find((a) => a.id === agentId(n));
  if (!agent) throw new Error(`no agent ${n}`);
  return presenceOf(agent, tasks);
};

test("an agent with a running task is working; an inactive one waits at the edge", () => {
  expect(presence(1)).toBe("working");
  expect(presence(2)).toBe("idle");
  expect(presence(3)).toBe("waiting");
  expect(presence(5)).toBe("idle");
});
