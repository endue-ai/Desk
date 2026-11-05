import { describe, expect, it } from "vitest";
import { COMMANDS } from "../ui/schemas.js";
import { CLAUDE_STREAM, CODEX_STREAM } from "./fixtures";
import { computer, mount } from "./harness";

describe("compare", () => {
  it("asks every agent picked the same question at once and shows the answers side by side", async () => {
    const m = await mount();
    const answers = await m.talk.compare("What is here?");
    expect(answers.map((a) => [a.agent, a.ending, a.answer])).toEqual([
      ["claude", "done", "Let me look at the file.\n\nIt exports **two** functions."],
      ["codex", "done", "Three files."],
    ]);
    const { compare, view } = m.view.latest();
    expect(view).toBe("compare");
    expect(compare).toMatchObject({ prompt: "What is here?", running: false });
    expect(compare.panes.map((p) => [p.name, p.status])).toEqual([
      ["Claude Code", "done"],
      ["Codex", "done"],
    ]);
    // Both programs were running at the same time.
    expect(
      m.view.models.some(
        (vm) => vm.compare.panes.filter((p) => p.status === "running").length === 2,
      ),
    ).toBe(true);
  });

  it("asks only the agents picked, at least one, and stops them all", async () => {
    const m = await mount({ script: computer({ claude: { hang: true }, codex: { hang: true } }) });
    m.talk.toggleCompared("claude");
    expect(m.app.ui.compare).toEqual(["codex"]);
    expect(m.talk.toggleCompared("codex")).toEqual(["codex"]);
    const pending = m.talk.compare("x");
    await m.settle();
    expect(m.programs.asked("claude")).toHaveLength(0);
    await expect(m.talk.compare("y")).rejects.toThrow(/still running/);
    expect(m.app.runs.stopAll("compare")).toBe(1);
    expect((await pending)[0]).toMatchObject({ agent: "codex", ending: "stopped" });
  });
});

describe("the commands", () => {
  it("register every command again with its description and argument schema", async () => {
    const m = await mount();
    const registered = m.host.calls.filter((c) => c.method === "cmd.register").map((c) => c.params);
    expect(registered.map((p) => (p as { id: string }).id)).toEqual(COMMANDS.map((c) => c.id));
  });

  it("list the agents and look for them again", async () => {
    const m = await mount();
    const list = (await m.host.invoke("endue.local-agents.list")) as Array<{
      id: string;
      state: string;
    }>;
    expect(list.filter((a) => a.state === "ready").map((a) => a.id)).toEqual(["claude", "codex"]);
    const before = m.programs.calls.length;
    await m.host.invoke("endue.local-agents.detect");
    expect(m.programs.calls.length - before).toBe(2);
  });

  it("ask an agent, asking for the prompt when it is absent", async () => {
    const m = await mount({ picks: ["What is up?"] });
    const answer = await m.host.invoke("endue.local-agents.ask", { agent: "codex" });
    expect(answer).toMatchObject({ agent: "codex", answer: "Three files.", ending: "done" });
    expect(m.picked[0]).toMatchObject({ title: "Local agents: ask Codex", free: true });
    expect(m.programs.asked("codex")[0]?.args.at(-1)).toBe("What is up?");
    expect(m.view.latest().activity.runs[0]).toMatchObject({
      origin: "command",
      prompt: "What is up?",
    });
    // A cancelled pick asks nothing.
    await expect(m.host.invoke("endue.local-agents.ask", {})).rejects.toThrow();
    expect(m.programs.asked("claude")).toHaveLength(0);
  });

  it("chat with an agent, compare, and work the board", async () => {
    const m = await mount();
    const chat = await m.host.invoke("endue.local-agents.chat", { agent: "codex", prompt: "hi" });
    expect(chat).toMatchObject({ agent: "codex", answer: "Three files." });
    expect(m.view.latest()).toMatchObject({ view: "chat", chat: { agent: "codex" } });
    const compared = (await m.host.invoke("endue.local-agents.compare", {
      prompt: "q",
      agents: ["claude"],
    })) as unknown[];
    expect(compared).toHaveLength(1);
    const card = (await m.host.invoke("endue.local-agents.add-card", {
      prompt: "task",
      agent: "claude",
    })) as { id: string };
    await m.host.invoke("endue.local-agents.move-card", { card: card.id, column: "done" });
    expect(await m.host.invoke("endue.local-agents.board")).toMatchObject([
      { id: card.id, column: "done" },
    ]);
    expect(await m.host.invoke("endue.local-agents.clear-done")).toBe(1);
    const runs = (await m.host.invoke("endue.local-agents.activity")) as Array<{ origin: string }>;
    expect(runs.map((r) => r.origin)).toEqual(["compare", "chat"]);
    expect(m.view.latest().view).toBe("activity");
  });

  it("open a view, and stop what runs", async () => {
    const m = await mount({
      script: computer({ claude: { hang: true }, codex: { stdout: CODEX_STREAM } }),
    });
    expect(await m.host.invoke("endue.local-agents.open", { view: "board" })).toBe("board");
    const pending = m.talk.send("slow");
    await m.settle();
    expect(await m.host.invoke("endue.local-agents.stop", {})).toBe(1);
    expect(await pending).toMatchObject({ ending: "stopped" });
    await expect(m.host.invoke("endue.local-agents.stop", { run: "nope" })).rejects.toThrow(
      /No run nope/,
    );
  });

  it("say a failure on the status line and end the command with it", async () => {
    const m = await mount({ script: computer({ claude: { stdout: CLAUDE_STREAM } }) });
    await expect(
      m.host.invoke("endue.local-agents.ask", { prompt: "x", agent: "grok" }),
    ).rejects.toThrow(/Grok CLI is not installed/);
    expect(m.view.said.at(-1)).toMatch(/Grok CLI is not installed/);
  });

  it("keep the view and the agents picked between runs", async () => {
    const m = await mount();
    m.app.show("board");
    m.talk.setCompared(["codex"]);
    await m.settle();
    const again = await mount({ store: { ...m.store } });
    expect(again.app.ui).toMatchObject({ view: "board", compare: ["codex"], chatAgent: "claude" });
  });
});

describe("runs in the desk's agent registry (ADR 0100)", () => {
  const reports = (m: Awaited<ReturnType<typeof mount>>) =>
    m.host.calls
      .filter((c) => c.method === "agent.report")
      .map((c) => c.params as unknown as Record<string, unknown>);

  it("reports every run when it starts and when it ends", async () => {
    const m = await mount({ handlers: { "agent.report": () => ({}) } });
    await m.host.invoke("endue.local-agents.ask", { agent: "codex", prompt: "What is here?" });
    const sent = reports(m);
    expect(sent.map((r) => r.state)).toEqual(["running", "done"]);
    expect(sent[0]).toMatchObject({
      agent: { id: "codex", name: "Codex", brain: "codex" },
      title: "What is here?",
    });
    expect(sent[1]).toMatchObject({ id: sent[0]?.id, result: "Three files." });
    expect(typeof sent[1]?.endedAt).toBe("string");
  });

  it("stops a run when the desk says agent.cancelled", async () => {
    const m = await mount({
      script: computer({ claude: { hang: true } }),
      handlers: { "agent.report": () => ({}) },
    });
    const pending = m.talk.send("slow");
    await m.settle();
    const runId = String(reports(m)[0]?.id);
    m.host.emit({ event: "agent.cancelled", data: { runId } });
    expect(await pending).toMatchObject({ ending: "stopped" });
    await m.settle();
    expect(reports(m).at(-1)).toMatchObject({ id: runId, state: "cancelled" });
  });
});

describe("commands for agents (ADR 0088, 0099)", () => {
  const work = { "endue.local-agents.folder": "~/work" };

  it("ask is read-only whatever the access setting, in a folder inside the work folder", async () => {
    const m = await mount({ init: { ...work, "endue.local-agents.access": "agent" } });
    const args = { agent: "codex", prompt: "Which tests fail?", folder: "desk" };
    expect(await m.host.invoke("endue.local-agents.ask", args)).toMatchObject({
      agent: "codex",
      answer: "Three files.",
    });
    const call = m.programs.asked("codex")[0];
    expect(call?.args.join(" ")).toContain("--sandbox read-only");
    expect(call?.cwd).toBe("~/work/desk");
    for (const folder of ["../x", "/etc", "~/other", "a/../../b", "C:\\x"])
      await expect(m.host.invoke("endue.local-agents.ask", { ...args, folder })).rejects.toThrow(
        /inside the work folder/,
      );
    expect(m.programs.asked("codex")).toHaveLength(1);
  });

  it("work runs with agent access in the folder and answers", async () => {
    const m = await mount({ init: work });
    const args = { agent: "codex", prompt: "Run the tests and fix them", folder: "desk" };
    expect(await m.host.invoke("endue.local-agents.work", args)).toMatchObject({
      agent: "codex",
      answer: "Three files.",
      ending: "done",
    });
    const call = m.programs.asked("codex")[0];
    expect(call?.args).not.toContain("read-only");
    expect(call?.cwd).toBe("~/work/desk");
    expect(m.view.latest().activity.runs[0]).toMatchObject({ origin: "command" });
  });

  it("an agent puts a task on the board without running it", async () => {
    const m = await mount();
    const card = await m.host.invoke("endue.local-agents.add-card", {
      prompt: "Write the release notes",
      agent: "claude",
    });
    expect(card).toMatchObject({ column: "todo", agent: "claude" });
    await m.host
      .invoke("endue.local-agents.add-card", { prompt: "Ship it", run: true })
      .catch(() => undefined);
    await m.settle();
    expect(m.programs.asked("claude")).toHaveLength(0);
  });
});
