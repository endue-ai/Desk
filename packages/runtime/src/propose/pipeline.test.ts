import { type BrainAskParams, FIXTURE_NOW, type PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import type { ScriptedAnswer } from "../bridge/scripted-brain";
import type { NoticeInput } from "../notify";
import { createAsker } from "./asker";
import { BOARD, BOARD_WORK } from "./fixtures";
import { type Choice, createProposals } from "./pipeline";
import { viewKind } from "./view";

const VIEWS = { permission: "view:manage" } as const;
const SENTENCE = "show my events this week as a board";
const ID = "eris.events-this-week";
const manifests: PluginManifest[] = [
  { id: "desk.views", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
  { id: "endue.notes", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
];
/** An answer as a brain gives it through brain.ask: a few words and the tool's arguments. */
const called = (structured: Record<string, unknown>) => ({ text: "Here is the view.", structured });
/** Arguments propose_view's schema refuses: the core leaves them out of the turn. */
const invalid = called({ ...BOARD, layout: { type: "board", children: [] } });
/** Arguments the schema allows but the desk does not: a source the view does not require. */
const unknownSource = called({
  ...BOARD_WORK,
  layout: { ...BOARD_WORK.layout, binding: { ...BOARD_WORK.layout.binding, sources: ["$cal"] } },
});

/** The pipeline for views on the stub core, its brain answering `answers` in order, desk.views recorded. */
function setup(answers: ScriptedAnswer[], choices: Choice[] = [{ choice: "apply" }]) {
  const core = browserCore({
    manifests,
    off: ["endue.notes"],
    brain: { answer: () => answers.shift() ?? "" },
  });
  const runs: Array<{ id: string; args: unknown }> = [];
  const commands = {
    run: async (id: string, args?: unknown) => {
      runs.push({ id, args });
      if (id === "desk.views.preview") return choices.shift() ?? { choice: "discard" };
      return {};
    },
  };
  const said: string[] = [];
  const states: string[] = [];
  const notices: NoticeInput[] = [];
  const view = viewKind({
    bridge: core.client,
    commands,
    now: () => Date.parse(FIXTURE_NOW),
    profile: () => "morning",
  });
  const proposals = createProposals({
    asker: createAsker(core.client),
    kinds: [view],
    notify: (input) => void notices.push(input),
    eris: { say: (text) => void said.push(text), setState: (state) => void states.push(state) },
  });
  const asks = () =>
    core.stub.log
      .filter((entry) => entry.request.method === "brain.ask")
      .map((entry) => entry.request.params as BrainAskParams);
  const prompts = () => asks().map((params) => params.prompt);
  const calls = (method: string) =>
    core.stub.log.filter((entry) => entry.request.method === method).map((e) => e.request.params);
  return { core, runs, said, states, notices, proposals, asks, prompts, calls };
}

describe("desk.propose for views", () => {
  it("a valid answer is previewed, applied as ~/.desk/views/eris.<slug>.yaml through view.save, and Eris says one line", async () => {
    const m = setup([called(BOARD)]);
    const outcome = await m.proposals.propose("view", SENTENCE);
    expect(outcome).toEqual({ status: "applied", kind: "view", id: ID });

    const [asked] = m.asks();
    expect(m.asks()).toHaveLength(1);
    expect(m.calls("brain.say")).toEqual([]);
    const prompt = asked?.prompt ?? "";
    expect(prompt).toContain(SENTENCE);
    // The context: the kinds and sources in the index, the plugins that are on, the profile.
    expect(prompt).toContain('"connector":"desk.fixtures"');
    expect(prompt).toContain('"kind":"event"');
    expect(prompt).toContain('"plugins":["desk.views"]');
    expect(prompt).toContain('"profile":"morning"');
    // The View schema is the tool's, without the parts the desk writes; the prompt does not repeat it.
    expect(asked?.scope).toEqual({ permission: "brain:ask" });
    expect(asked?.tool.name).toBe("propose_view");
    const schema = JSON.stringify(asked?.tool.schema);
    expect(asked?.tool.schema.type).toBe("object");
    expect(schema).toContain('"ViewComponent"');
    expect(schema).not.toContain('"ViewProvenance"');
    expect(asked?.tool.schema.required).toEqual(["title", "layout"]);
    expect(prompt).not.toContain('"ViewComponent"');

    const made = {
      ...BOARD,
      id: ID,
      version: "0.1.0",
      provenance: {
        author: "eris",
        createdAt: "2026-10-30T00:00:00.000Z",
        words: SENTENCE,
        brain: "scripted",
      },
    };
    expect(m.runs.map((run) => run.id)).toEqual(["desk.views.preview", "desk.views.open"]);
    expect(m.runs[0]?.args).toEqual({
      view: made,
      note: `Eris made this from “${SENTENCE}”.`,
    });
    expect(await m.core.client.call("view.get", { id: ID, scope: VIEWS })).toMatchObject({
      view: made,
      source: "file",
    });
    expect(m.calls("view.save")).toEqual([{ view: made, scope: VIEWS }]);
    expect(m.runs[1]?.args).toEqual({
      id: ID,
      notice: {
        text: `Eris made this view: ~/.desk/views/${ID}.yaml`,
        action: { title: "Undo", command: "desk.propose.undo", args: { kind: "view", id: ID } },
      },
    });
    expect(m.said).toEqual(["I made “Events this week” and saved it in your views."]);
    expect(m.states).toEqual(["thinking"]);
    expect(m.notices).toEqual([
      {
        caller: "desk",
        title: "Eris made “Events this week”",
        body: `~/.desk/views/${ID}.yaml`,
        level: "success",
      },
    ]);
  });

  it("an invalid answer is asked again once with the validation error, then the valid one is previewed", async () => {
    const m = setup([unknownSource, called(BOARD)]);
    expect(await m.proposals.propose("view", SENTENCE)).toMatchObject({ status: "applied" });
    const [first = "", second = ""] = m.prompts();
    expect(m.prompts()).toHaveLength(2);
    expect(first).not.toContain("was not valid");
    expect(second).toContain("Your last answer was not valid");
    expect(second).toContain("/layout/binding/sources/0: $cal is not one of the view's requires");
    expect(second).not.toContain("JSON Schema");
    expect(m.runs.filter((run) => run.id === "desk.views.preview")).toHaveLength(1);
  });

  it("an answer that was no call the tool's schema allows is asked again with the schema in the prompt", async () => {
    const m = setup([invalid, called(BOARD)]);
    expect(await m.proposals.propose("view", SENTENCE)).toMatchObject({ status: "applied" });
    const [first = "", second = ""] = m.prompts();
    expect(first).not.toContain("JSON Schema");
    expect(second).toContain(
      "/: the answer was not a call of propose_view with arguments its schema allows",
    );
    expect(second).toContain("The arguments must match this JSON Schema: {");
    expect(second).toContain('"ViewComponent"');
    expect(second.length).toBeLessThanOrEqual(32000);
  });

  it("two invalid answers stop with a notice naming the problem, and nothing is previewed or saved", async () => {
    const m = setup([unknownSource, unknownSource]);
    const outcome = await m.proposals.propose("view", SENTENCE);
    expect(outcome).toMatchObject({ status: "failed" });
    expect(m.prompts()).toHaveLength(2);
    expect(m.runs).toEqual([]);
    expect(m.calls("view.save")).toEqual([]);
    expect(m.notices).toEqual([
      expect.objectContaining({
        caller: "desk",
        title: "Eris could not make that view",
        level: "error",
        body: expect.stringContaining("/layout/binding/sources/0: $cal is not one of"),
      }),
    ]);
    expect(m.said).toEqual(["I couldn't make a view from that. Try saying it another way."]);
    expect(m.states).toEqual(["thinking"]);
  });

  it("Try again sends the person's correction with the last proposal; Discard saves nothing", async () => {
    const m = setup(
      [called(BOARD), called(BOARD_WORK)],
      [{ choice: "retry", correction: "only the work calendar" }, { choice: "discard" }],
    );
    expect(await m.proposals.propose("view", SENTENCE)).toEqual({ status: "discarded" });
    const [, second = ""] = m.prompts();
    expect(second).toContain("only the work calendar");
    expect(second).toContain("Your last proposal");
    expect(second).toContain('"title":"Events this week"');
    expect(m.runs.map((run) => run.id)).toEqual(["desk.views.preview", "desk.views.preview"]);
    const again = m.runs[1]?.args as { view: { title: string } } | undefined;
    expect(again?.view.title).toBe("Work this week");
    expect(m.calls("view.save")).toEqual([]);
    expect(m.said).toEqual([]);
    expect(m.states).toEqual(["thinking", "thinking", "idle"]);
  });

  it("Undo closes the view and removes the file; only what this session applied can be undone", async () => {
    const m = setup([called(BOARD)]);
    await m.proposals.propose("view", SENTENCE);
    await m.proposals.undo({ kind: "view", id: ID });
    expect(m.runs.map((run) => run.id)).toEqual([
      "desk.views.preview",
      "desk.views.open",
      "desk.views.close",
    ]);
    expect(m.calls("view.remove")).toEqual([{ id: ID, scope: VIEWS }]);
    await expect(m.core.client.call("view.get", { id: ID, scope: VIEWS })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(m.said.at(-1)).toBe("I took “Events this week” away.");
    await expect(m.proposals.undo({ kind: "view", id: ID })).rejects.toThrow(/nothing/i);
    await expect(m.proposals.undo({ kind: "view", id: "desk.today" })).rejects.toThrow(/nothing/i);
    expect(m.calls("view.remove")).toHaveLength(1);
  });

  it("another proposal while the brain is still answering is refused with a notice", async () => {
    const m = setup([called(BOARD), called(BOARD)]);
    const first = m.proposals.propose("view", SENTENCE);
    expect(await m.proposals.propose("view", "make a list of my notes")).toEqual({
      status: "busy",
    });
    expect(m.notices.at(-1)).toMatchObject({
      level: "info",
      title: "Eris is still making the last one",
    });
    expect(await first).toMatchObject({ status: "applied" });
    await expect(m.proposals.propose("ui", SENTENCE)).rejects.toThrow(/no kind ui/);
  });
});
