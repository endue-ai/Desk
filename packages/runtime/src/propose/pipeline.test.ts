import { type BrainAskParams, FIXTURE_NOW, type PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import type { ScriptedAnswer } from "../bridge/scripted-brain";
import type { NoticeInput } from "../notify";
import { createAsker } from "./asker";
import { type Choice, createProposals } from "./pipeline";
import { universalKind } from "./universal";

// desk.propose's pipeline (ADR 0073) on its view kind, a universal view (ADR 0102, 0103), over the
// stub core with a scripted brain that answers brain.ask as the core does.
const VIEWS = { permission: "view:manage" } as const;
const SENTENCE = "show my events this week as a board";
const ID = "eris.events-this-week";
const manifests: PluginManifest[] = [
  { id: "desk.universal", version: "0.1.0", kind: "ui", entry: "ui/index.html" },
];
const BOARD = {
  title: "Events this week",
  description: "This week's events, one column per calendar.",
  type: "kanban",
  source: { items: { kinds: ["event"] } },
  map: { group: "calendar" },
};
const BOARD_WORK = {
  ...BOARD,
  title: "Work this week",
  source: { items: { kinds: ["event"], where: [{ field: "calendar", op: "eq", value: "Work" }] } },
};
/** An answer as a brain gives it through brain.ask: a few words and the tool's arguments. */
const called = (structured: Record<string, unknown>) => ({ text: "Here is the view.", structured });
/** Arguments the tool's schema refuses: the core leaves them out of the turn. */
const invalid = called({ ...BOARD, type: "board" });
/** Arguments the schema allows but the desk does not: a command the desk does not have. */
const unknownCommand = called({ ...BOARD, actions: [{ command: "example.nope" }] });

/** The pipeline on the stub core, its brain answering `answers` in order, desk.universal recorded. */
function setup(answers: ScriptedAnswer[], choices: Choice[] = [{ choice: "apply" }]) {
  const core = browserCore({ manifests, brain: { answer: () => answers.shift() ?? "" } });
  const runs: Array<{ id: string; args: unknown }> = [];
  const commands = {
    run: async (id: string, args?: unknown) => {
      runs.push({ id, args });
      if (id === "desk.universal.preview") return choices.shift() ?? { choice: "discard" };
      return {};
    },
    has: (id: string) => id.startsWith("desk."),
  };
  const said: string[] = [];
  const states: string[] = [];
  const notices: NoticeInput[] = [];
  const view = universalKind({
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
  const previews = () => runs.filter((run) => run.id === "desk.universal.preview");
  return { core, runs, previews, said, states, notices, proposals, asks, prompts, calls };
}

describe("desk.propose for views", () => {
  it("a valid answer is previewed, applied as ~/.desk/views/eris.<slug>.yaml through view.save, and Eris says one line", async () => {
    const m = setup([called(BOARD)]);
    const outcome = await m.proposals.propose("view", SENTENCE);
    expect(outcome).toEqual({ status: "applied", kind: "view", id: ID });

    const [asked] = m.asks();
    expect(m.asks()).toHaveLength(1);
    const prompt = asked?.prompt ?? "";
    expect(prompt).toContain(SENTENCE);
    // The context: the presentations, the kinds and sources in the index, the profile.
    expect(prompt).toContain('"connector":"desk.fixtures"');
    expect(prompt).toContain('"kind":"event"');
    expect(prompt).toContain('"presentations":["list"');
    expect(prompt).toContain('"profile":"morning"');
    // The UniversalView schema is the tool's, without the parts the desk writes.
    expect(asked?.scope).toEqual({ permission: "brain:ask" });
    expect(asked?.tool.name).toBe("propose_universal_view");
    expect(asked?.tool.schema.required).toEqual(["type", "source"]);
    expect(JSON.stringify(asked?.tool.schema)).not.toContain('"ViewProvenance"');
    expect(prompt).not.toContain('"UniversalSource"');

    const made = {
      ...BOARD,
      types: ["kanban", "list", "timeline", "calendar"],
      id: ID,
      provenance: {
        author: "eris",
        createdAt: "2026-10-30T00:00:00.000Z",
        words: SENTENCE,
        brain: "scripted",
      },
    };
    expect(m.runs.map((run) => run.id)).toEqual([
      "desk.universal.drafting",
      "desk.universal.preview",
      "desk.universal.open",
    ]);
    expect(m.runs[1]?.args).toEqual({ view: made, note: `Eris made this from “${SENTENCE}”.` });
    expect(await m.core.client.call("view.get", { id: ID, scope: VIEWS })).toMatchObject({
      view: made,
      source: "file",
    });
    expect(m.calls("view.save")).toEqual([{ view: made, scope: VIEWS }]);
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

  it("an answer the desk refuses is asked again once with what was wrong, then the valid one is previewed", async () => {
    const m = setup([unknownCommand, called(BOARD)]);
    expect(await m.proposals.propose("view", SENTENCE)).toMatchObject({ status: "applied" });
    const [first = "", second = ""] = m.prompts();
    expect(m.prompts()).toHaveLength(2);
    expect(first).not.toContain("was not valid");
    expect(second).toContain("Your last answer was not valid");
    expect(second).toContain("/actions/0/command: example.nope is not a command on this desk");
    expect(second).not.toContain("JSON Schema");
    expect(m.previews()).toHaveLength(1);
  });

  it("an answer that was no call the tool's schema allows is asked again with the schema in the prompt", async () => {
    const m = setup([invalid, called(BOARD)]);
    expect(await m.proposals.propose("view", SENTENCE)).toMatchObject({ status: "applied" });
    const [first = "", second = ""] = m.prompts();
    expect(first).not.toContain("JSON Schema");
    expect(second).toContain(
      "/: the answer was not a call of propose_universal_view with arguments its schema allows",
    );
    expect(second).toContain("The arguments must match this JSON Schema: {");
    expect(second).toContain('"UniversalSource"');
    expect(second.length).toBeLessThanOrEqual(32000);
  });

  it("two refused answers stop with a notice naming the problem, and nothing is previewed or saved", async () => {
    const m = setup([unknownCommand, unknownCommand]);
    const outcome = await m.proposals.propose("view", SENTENCE);
    expect(outcome).toMatchObject({ status: "failed" });
    expect(m.prompts()).toHaveLength(2);
    expect(m.runs.map((run) => run.id)).toEqual([
      "desk.universal.drafting",
      "desk.universal.close",
    ]);
    expect(m.calls("view.save")).toEqual([]);
    expect(m.notices).toEqual([
      expect.objectContaining({
        caller: "desk",
        title: "Eris could not make that view",
        level: "error",
        body: expect.stringContaining("example.nope is not a command on this desk"),
      }),
    ]);
    expect(m.said).toEqual(["I couldn't make a view from that. Try saying it another way."]);
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
    expect(m.previews()).toHaveLength(2);
    const again = m.previews()[1]?.args as { view: { title: string } } | undefined;
    expect(again?.view.title).toBe("Work this week");
    expect(m.calls("view.save")).toEqual([]);
    expect(m.said).toEqual([]);
    expect(m.states).toEqual(["thinking", "thinking", "idle"]);
  });

  it("Undo closes the view and removes the file; only what this session applied can be undone", async () => {
    const m = setup([called(BOARD)]);
    await m.proposals.propose("view", SENTENCE);
    await m.proposals.undo({ kind: "view", id: ID });
    expect(m.runs.at(-1)).toEqual({ id: "desk.universal.close", args: { id: ID } });
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

  it("a kind's drafting shows before the brain answers, so its preview opens at once, and a failure takes it away", async () => {
    const order: string[] = [];
    let answer: (value: ScriptedAnswer) => void = () => {};
    const core = browserCore({
      manifests,
      brain: {
        answer: () => {
          order.push("asked");
          return new Promise<ScriptedAnswer>((resolve) => {
            answer = resolve;
          });
        },
      },
    });
    const kind = {
      ...universalKind({
        bridge: core.client,
        commands: { run: async () => ({}) },
        now: () => Date.parse(FIXTURE_NOW),
        profile: () => undefined,
      }),
      drafting: async () => void order.push("drafting"),
      dismiss: async () => void order.push("dismissed"),
    };
    const proposals = createProposals({
      asker: createAsker(core.client),
      kinds: [kind],
      notify: () => {},
    });
    const done = proposals.propose("view", SENTENCE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order[0]).toBe("drafting");
    for (let n = 0; n < 2; n++) {
      await expect.poll(() => order.filter((o) => o === "asked").length).toBe(n + 1);
      answer("Not a view.");
    }
    expect(await done).toMatchObject({ status: "failed" });
    expect(order.at(-1)).toBe("dismissed");
  });
});
