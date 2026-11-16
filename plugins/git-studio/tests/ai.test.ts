// The asker: brain.ask with a tool and the scope, the answer from the turn's completed event (even
// one that arrives before the call's result), and plain words when the brain is offline or refused.
import { describe, expect, it } from "vitest";
import { COMMIT_TOOL, clip, commitPrompt, createAsker } from "../ui/ai.js";

type Listener = (event: { event: string; data: unknown }) => void;
type Bridge = Parameters<typeof createAsker>[0];

function fakeBridge(answer: (params: Record<string, unknown>, emit: Listener) => unknown) {
  const listeners = new Set<Listener>();
  const emit: Listener = (event) => {
    for (const l of listeners) l(event);
  };
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    bridge: {
      call: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return answer(params, emit);
      },
      onEvent: (l: Listener) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
  };
}

describe("createAsker", () => {
  it("asks with the tool and scope and resolves with the structured answer", async () => {
    const { bridge, calls } = fakeBridge((_p, emit) => {
      setTimeout(
        () =>
          emit({
            event: "brain.turn",
            data: { turnId: "t1", kind: "completed", structured: { summary: "Fix it", body: "" } },
          }),
        0,
      );
      return { turnId: "t1" };
    });
    const answer = await createAsker(bridge as unknown as Bridge).ask("prompt", COMMIT_TOOL);
    expect(answer).toEqual({ summary: "Fix it", body: "" });
    expect(calls[0]).toMatchObject({
      method: "brain.ask",
      params: {
        prompt: "prompt",
        tool: { name: "write_commit_message" },
        scope: { permission: "brain:ask" },
      },
    });
  });

  it("keeps an answer that comes before the call returns its turn id", async () => {
    const { bridge } = fakeBridge((_p, emit) => {
      emit({
        event: "brain.turn",
        data: { turnId: "t2", kind: "completed", structured: { ok: true } },
      });
      return { turnId: "t2" };
    });
    expect(await createAsker(bridge as unknown as Bridge).ask("p", COMMIT_TOOL)).toEqual({
      ok: true,
    });
  });

  it("says when the brain is offline, and when asking is not allowed", async () => {
    const offline = fakeBridge((_p, emit) => {
      setTimeout(
        () =>
          emit({
            event: "brain.turn",
            data: { turnId: "t3", kind: "offline", text: "No network." },
          }),
        0,
      );
      return { turnId: "t3" };
    });
    await expect(
      createAsker(offline.bridge as unknown as Bridge).ask("p", COMMIT_TOOL),
    ).rejects.toThrow("No network.");
    const refused = fakeBridge(() => {
      throw Object.assign(new Error("no"), { code: "permission_denied" });
    });
    await expect(
      createAsker(refused.bridge as unknown as Bridge).ask("p", COMMIT_TOOL),
    ).rejects.toThrow(/may not ask the brain/);
  });
});

describe("prompts", () => {
  it("cuts long diffs and says so", () => {
    expect(clip("abcdef", 3)).toBe("abc\n… (3 more characters cut)");
    const prompt = commitPrompt({
      diff: "x".repeat(40_000),
      stat: "a | 1 +",
      branch: "main",
      recent: ["feat: one"],
    });
    expect(prompt).toContain("- feat: one");
    expect(prompt).toContain("more characters cut");
    expect(prompt.length).toBeLessThan(30_000);
  });
});
