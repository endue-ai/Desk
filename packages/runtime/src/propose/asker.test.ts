import { type BridgeEvent, BridgeClient, browserStub, type StubHandlers } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { type AskRequest, createAsker, jsonIn } from "./asker";

const TOOL = {
  name: "propose_note",
  description: "Propose a note.",
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
};
const request = (prompt = "Make a note about lunch."): AskRequest => ({
  prompt: () => prompt,
  tool: TOOL,
  compact: TOOL.schema,
});
const said = (core: { stub: { log: ReadonlyArray<{ request: { method: string; params: unknown } }> } }) =>
  core.stub.log
    .filter((entry) => entry.request.method === "brain.say")
    .map((entry) => (entry.request.params as { text: string }).text);
const asked = (core: { stub: { log: ReadonlyArray<{ request: { method: string; params: unknown } }> } }) =>
  core.stub.log
    .filter((entry) => (entry.request.method as string) === "brain.ask")
    .map((entry) => entry.request.params);

describe("the asker", () => {
  it("brain.ask answers with the tool's structured values when the core serves it", async () => {
    const core = browserCore({
      manifests: [],
      brain: { ask: true, answer: () => ({ structured: { title: "Lunch" } }) },
    });
    const asker = createAsker(core.client);
    const answer = await asker.ask(request());
    expect(answer).toMatchObject({ value: { title: "Lunch" }, via: "ask" });
    expect(asked(core)).toEqual([
      {
        prompt: "Make a note about lunch.",
        tool: TOOL,
        scope: { permission: "brain:ask" },
      },
    ]);
    expect(said(core)).toEqual([]);
  });

  it("an unsupported brain.ask falls back to brain.say with the schema in the prompt, and the JSON is taken from the answer", async () => {
    const answers = [
      'Here it is:\n```json\n{ "title": "Lunch" }\n```\nTell me if you want more.',
      'Sure. {"title": "Dinner", "tags": ["a {b} c"]} is my answer.',
    ];
    const core = browserCore({ manifests: [], brain: { answer: () => answers.shift() ?? "" } });
    const asker = createAsker(core.client);
    expect(await asker.ask(request())).toMatchObject({ value: { title: "Lunch" }, via: "say" });
    const [text] = said(core);
    expect(text).toContain("Make a note about lunch.");
    expect(text).toContain(JSON.stringify(TOOL.schema));
    expect((text ?? "").length).toBeLessThanOrEqual(8000);
    // The core said it does not serve brain.ask: the next question goes straight to brain.say.
    expect(await asker.ask(request("And dinner."))).toMatchObject({
      value: { title: "Dinner", tags: ["a {b} c"] },
      via: "say",
    });
    expect(asked(core)).toHaveLength(1);
    expect(said(core)).toHaveLength(2);
  });

  it("gives the fallback's prompt the room the schema leaves under 8000 characters", async () => {
    const core = browserCore({ manifests: [], brain: { answer: () => '{"title": "x"}' } });
    const budgets: number[] = [];
    await createAsker(core.client).ask({
      ...request(),
      prompt: (budget) => {
        budgets.push(budget);
        return "Make a note.".padEnd(Math.min(budget, 20000), ".");
      },
    });
    const [text] = said(core);
    expect(budgets.at(-1)).toBeLessThan(8000 - JSON.stringify(TOOL.schema).length);
    expect((text ?? "").length).toBeLessThanOrEqual(8000);
  });

  it("a brain.turn error rejects with its sentence; turn events that arrive before the call's answer are kept", async () => {
    const failing = browserCore({ manifests: [], brain: { answer: () => ({ error: "No credits left." }) } });
    await expect(createAsker(failing.client).ask(request())).rejects.toThrow("No credits left.");

    // A core whose brain answers before brain.say itself has answered with the turn's id.
    let emit: (event: BridgeEvent) => void = () => {};
    const handlers: StubHandlers = {
      "brain.say": () => {
        for (const [kind, text] of [
          ["started", undefined],
          ["delta", '{"title": '],
          ["delta", '"Early"}'],
          ["completed", undefined],
        ] as const)
          emit({
            event: "brain.turn",
            data: { turnId: "t1", kind, ...(text === undefined ? {} : { text }) },
          });
        return { turnId: "t1" };
      },
    };
    const stub = browserStub(handlers);
    emit = stub.emit;
    const answer = await createAsker(new BridgeClient(stub)).ask(request());
    expect(answer).toMatchObject({ value: { title: "Early" }, text: '{"title": "Early"}' });
  });

  it("jsonIn takes a fenced json block first, else the first object that parses", () => {
    expect(jsonIn('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(jsonIn('{not json} then {"b": "}"}')).toEqual({ b: "}" });
    expect(jsonIn("no object here")).toBeUndefined();
    expect(jsonIn('```\n{"c": [1, 2]}\n```')).toEqual({ c: [1, 2] });
  });
});
