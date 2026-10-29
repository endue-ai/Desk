import { expect, test } from "vitest";
import { agentId, sampleDirectory } from "../bridge/directory";
import { isOpen, presenceOf } from "./agents";

const d = sampleDirectory(Date.parse("2026-10-28T09:00:00Z"));
const agent = (n: number) => d.agents.map((a) => a.agent).find((a) => a.id === agentId(n));

test("an agent with a working A2A task is working; an inactive one waits at the edge", () => {
  const presence = (n: number) => {
    const a = agent(n);
    if (!a) throw new Error(`no agent ${n}`);
    return presenceOf(a, d.tasks);
  };
  expect(presence(1)).toBe("working");
  expect(presence(2)).toBe("idle");
  expect(presence(3)).toBe("waiting");
  expect(presence(4)).toBe("working");
  expect(presence(5)).toBe("idle");
});

test("open tasks are submitted, working or waiting for input", () => {
  expect(d.tasks.filter(isOpen).map((t) => t.status)).toEqual(["working", "working", "submitted"]);
});
