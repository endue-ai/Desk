import { describe, expect, it } from "vitest";
import { BOARD_KEY, readCards, titleOf } from "../ui/board.js";
import { CLAUDE_STREAM, CODEX_STREAM } from "./fixtures";
import { computer, type Mounted, mount } from "./harness";

const columns = (m: Mounted) =>
  Object.fromEntries(
    m.view
      .latest()
      .board.columns.map((c) => [c.id, c.cards.map((card) => `${card.title}:${card.state}`)]),
  );

/** Wait until the board has no card running or waiting. */
async function idle(m: Mounted) {
  for (let i = 0; i < 50 && m.tasks.cards().some((c) => c.column === "running"); i++)
    await m.settle();
}

describe("the board", () => {
  it("adds a card to To do with its agent, titled by the prompt's first line", async () => {
    const m = await mount();
    const card = await m.tasks.addCard({ prompt: "Write the release notes\nfrom the changelog" });
    expect(card).toMatchObject({
      title: "Write the release notes",
      agent: "claude",
      column: "todo",
    });
    expect(columns(m)).toEqual({
      todo: ["Write the release notes:todo"],
      running: [],
      done: [],
      failed: [],
    });
    expect(m.view.latest().board.selected).toBe(card?.id);
  });

  it("runs a card: Running while the agent answers, then Done with the answer", async () => {
    const m = await mount();
    const card = await m.tasks.addCard({
      title: "Exports",
      prompt: "What does b.ts export?",
      run: true,
    });
    expect(m.view.models.some((vm) => vm.board.columns[1]?.cards.length === 1)).toBe(true);
    await idle(m);
    expect(columns(m)).toMatchObject({ running: [], done: ["Exports:done"] });
    const done = m.tasks.cards()[0];
    expect(done).toMatchObject({
      answer: "Let me look at the file.\n\nIt exports **two** functions.",
    });
    expect(m.view.latest().board.open).toMatchObject({ id: card?.id, state: "done" });
    expect(m.view.latest().activity.runs[0]).toMatchObject({ origin: "board", status: "done" });
  });

  it("puts a card whose agent fails, or is not installed, in Failed with why", async () => {
    const m = await mount({
      script: computer({
        claude: { code: 1, stderr: "Invalid API key" },
        codex: { stdout: CODEX_STREAM },
      }),
    });
    await m.tasks.addCard({ title: "A", prompt: "x", run: true });
    await m.tasks.addCard({ title: "B", prompt: "x", agent: "gemini" });
    await expect(m.tasks.runCard(undefined)).rejects.toThrow(/Gemini CLI is not installed/);
    await idle(m);
    expect(columns(m)).toMatchObject({ todo: ["B:todo"], failed: ["A:failed"] });
    expect(m.tasks.cards().find((c) => c.title === "A")?.error).toBe(
      "Claude Code: Invalid API key",
    );
  });

  it("runs as many cards at once as the settings allow; the others wait in Running", async () => {
    const m = await mount({
      script: computer({ claude: { hang: true } }),
      init: { "endue.local-agents.parallel": 2 },
    });
    for (const title of ["one", "two", "three"])
      await m.tasks.addCard({ title, prompt: title, run: true });
    await m.settle();
    expect(columns(m).running).toEqual(["one:running", "two:running", "three:waiting"]);
    expect(m.programs.asked("claude")).toHaveLength(2);
    // Stopping one gives the waiting card its place.
    const one = m.tasks.cards().find((c) => c.title === "one");
    await m.tasks.stopCard(one?.id);
    await m.settle();
    expect(columns(m)).toMatchObject({
      running: ["two:running", "three:running"],
      failed: ["one:failed"],
    });
    expect(m.programs.asked("claude")).toHaveLength(3);
  });

  it("stops a card taken out of Running, and leaves it where it was put", async () => {
    const m = await mount({ script: computer({ claude: { hang: true } }) });
    const card = await m.tasks.addCard({ title: "slow", prompt: "slow", run: true });
    await m.settle();
    await m.tasks.moveCard(card?.id, "todo");
    await m.settle();
    expect(columns(m)).toMatchObject({ todo: ["slow:todo"], running: [] });
    expect(m.programs.killed).toHaveLength(1);
  });

  it("moves cards between columns and within one, and runs one dropped on Running", async () => {
    const m = await mount();
    const a = await m.tasks.addCard({ title: "a", prompt: "a" });
    const b = await m.tasks.addCard({ title: "b", prompt: "b" });
    await m.tasks.moveCard(b?.id, "todo", 0);
    expect(columns(m).todo).toEqual(["b:todo", "a:todo"]);
    await m.tasks.shiftCard(a?.id, 1);
    await idle(m);
    expect(columns(m)).toMatchObject({ todo: ["b:todo"], done: ["a:done"] });
    await m.tasks.moveCard(b?.id, "done");
    expect(columns(m).done).toEqual(["a:done", "b:done"]);
    expect(m.programs.asked("claude")).toHaveLength(1);
    await expect(m.tasks.moveCard(a?.id, "later")).rejects.toThrow(/column is one of/);
    expect(m.tasks.clearDone()).toBe(2);
    expect(m.tasks.cards()).toEqual([]);
  });

  it("changes and removes a card", async () => {
    const m = await mount();
    const card = await m.tasks.addCard({ prompt: "x" });
    m.tasks.editCard(card?.id, { agent: "codex", title: "Renamed" });
    expect(m.tasks.cards()[0]).toMatchObject({ agent: "codex", title: "Renamed" });
    expect(() => m.tasks.editCard(card?.id, { agent: "nobody" })).toThrow(/agent id/);
    m.tasks.removeCard(card?.id);
    expect(m.tasks.cards()).toEqual([]);
    expect(() => m.tasks.removeCard(undefined)).toThrow(/Select a card/);
  });

  it("keeps the board in the store; a card that was running comes back to To do", async () => {
    const m = await mount({ script: computer({ claude: { hang: true } }) });
    await m.tasks.addCard({ title: "kept", prompt: "p", run: true });
    await m.settle();
    const stored = m.store[BOARD_KEY] as { cards: Array<Record<string, unknown>> };
    expect(stored.cards[0]).toMatchObject({ title: "kept", column: "running" });
    expect(stored.cards[0]).not.toHaveProperty("run");
    const again = await mount({
      store: { [BOARD_KEY]: stored },
      script: computer({ claude: { stdout: CLAUDE_STREAM } }),
    });
    expect(again.tasks.cards()[0]).toMatchObject({
      column: "todo",
      error: "Stopped when the desk closed.",
    });
  });
});

describe("readCards and titleOf", () => {
  it("keep only cards that make sense", () => {
    expect(
      readCards({ cards: [{ id: "1", title: "t", prompt: "p", agent: "nobody", column: "todo" }] }),
    ).toEqual([]);
    expect(
      readCards({ cards: [{ id: "1", title: "t", prompt: "p", agent: "codex", column: "done" }] }),
    ).toHaveLength(1);
    expect(readCards("junk")).toEqual([]);
  });

  it("title a card by its title, else the prompt's first line, short", () => {
    expect(titleOf("  ", "First\nsecond")).toBe("First");
    expect(titleOf("", "")).toBe("Untitled");
    expect(titleOf("x".repeat(300), "")).toHaveLength(120);
  });
});
