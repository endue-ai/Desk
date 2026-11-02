import {
  type BrainTurnData,
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type StubHandlers,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { OFFLINE_LINE, type ScriptedAnswer } from "../bridge/scripted-brain";
import { ASK_LIMIT, type AskRequest, createAsker } from "./asker";

const TOOL = {
  name: "propose_note",
  description: "Propose a note.",
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
};
const request = (prompt = "Make a note about lunch."): AskRequest => ({
  prompt: () => prompt,
  tool: TOOL,
});
type Logged = { stub: { log: ReadonlyArray<{ request: { method: string; params: unknown } }> } };
const calls = (core: Logged, method: string) =>
  core.stub.log.filter((entry) => entry.request.method === method).map((e) => e.request.params);

/** The stub core with a scripted brain answering `answers` in order, and every brain.turn it sent. */
function scripted(...answers: ScriptedAnswer[]) {
  const core = browserCore({ manifests: [], brain: { answer: () => answers.shift() ?? "" } });
  const turns: BrainTurnData[] = [];
  core.client.onEvent((event) => event.event === "brain.turn" && void turns.push(event.data));
  return { core, turns };
}

describe("the asker", () => {
  it("brain.ask answers with the tool's structured values", async () => {
    const { core, turns } = scripted({ text: "Here.", structured: { title: "Lunch" } });
    const answer = await createAsker(core.client).ask(request());
    expect(answer).toEqual({ value: { title: "Lunch" }, text: "Here." });
    expect(calls(core, "brain.ask")).toEqual([
      { prompt: "Make a note about lunch.", tool: TOOL, scope: { permission: "brain:ask" } },
    ]);
    expect(calls(core, "brain.say")).toEqual([]);
    expect(turns.map((t) => t.kind)).toEqual(["started", "delta", "delta", "completed"]);
    expect(turns.at(-1)).toEqual({
      turnId: turns[0]?.turnId,
      kind: "completed",
      structured: { title: "Lunch" },
    });
  });

  it("a brain that answers in words, or with arguments the tool's schema refuses, gives no value", async () => {
    const { core, turns } = scripted("I can only talk.", { structured: { title: 3 } });
    const asker = createAsker(core.client);
    expect(await asker.ask(request())).toEqual({ value: undefined, text: "I can only talk." });
    // The core (here the scripted brain, as the core does) leaves out what the schema refuses.
    expect(await asker.ask(request())).toEqual({ value: undefined, text: "" });
    expect(turns.filter((t) => t.kind === "completed").every((t) => !("structured" in t))).toBe(
      true,
    );
    expect(calls(core, "brain.ask")).toHaveLength(2);
  });

  it("an unreachable brain: the core's offline sentence once, then the answer once it is back", async () => {
    const { core, turns } = scripted(
      { offline: true },
      { offline: true },
      { structured: { title: "Later" } },
    );
    const offline: string[] = [];
    const asker = createAsker(core.client, { onOffline: (text) => void offline.push(text) });
    expect(await asker.ask(request())).toEqual({ value: { title: "Later" }, text: "" });
    expect(offline).toEqual([OFFLINE_LINE]);
    expect(turns.map((t) => t.kind)).toEqual(["offline", "online", "started", "completed"]);
  });

  it("a brain.turn error rejects with its sentence; turn events that arrive before the call's answer are kept", async () => {
    const failing = scripted({ error: "No credits left." });
    await expect(createAsker(failing.core.client).ask(request())).rejects.toThrow(
      "No credits left.",
    );

    // A core whose brain answers before brain.ask itself has answered with the turn's id, beside
    // another caller's turn.
    let emit: (event: BridgeEvent) => void = () => {};
    const handlers: StubHandlers = {
      "brain.ask": () => {
        const events: Array<[string, BrainTurnData["kind"], Partial<BrainTurnData>]> = [
          ["t1", "started", {}],
          ["t0", "completed", { structured: { title: "Not mine" } }],
          ["t1", "delta", { text: "Here." }],
          ["t1", "completed", { structured: { title: "Early" } }],
        ];
        for (const [turnId, kind, extra] of events)
          emit({ event: "brain.turn", data: { turnId, kind, ...extra } });
        return { turnId: "t1" };
      },
    };
    const stub = browserStub(handlers);
    emit = stub.emit;
    const answer = await createAsker(new BridgeClient(stub)).ask(request());
    expect(answer).toEqual({ value: { title: "Early" }, text: "Here." });
  });

  it("asks within brain.ask's 32000 characters, and the core refuses an empty prompt or a tool that takes no object", async () => {
    const { core } = scripted({ structured: { title: "x" } });
    const budgets: number[] = [];
    await createAsker(core.client).ask({
      ...request(),
      prompt: (budget) => {
        budgets.push(budget);
        return "Make a note.".padEnd(40000, ".");
      },
    });
    expect(budgets).toEqual([ASK_LIMIT]);
    const [asked] = calls(core, "brain.ask") as Array<{ prompt: string }>;
    expect(asked?.prompt.length).toBe(ASK_LIMIT);

    const asker = createAsker(core.client);
    await expect(asker.ask(request("  "))).rejects.toMatchObject({ code: "invalid_params" });
    await expect(
      asker.ask({ ...request(), tool: { ...TOOL, schema: { type: "array" } } }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });
});
