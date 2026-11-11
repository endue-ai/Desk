// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ViewModel } from "../ui/model.js";
import { createView } from "../ui/view.js";
import { computer, mount } from "./harness";

const page = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");

/** The plugin's page in the test document, a view on it, and what it asked the controller. */
function dom() {
  const body = /<body>([\s\S]*)<\/body>/.exec(page)?.[1] ?? "";
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
  const acts: unknown[][] = [];
  const view = createView(document, (action, ...args) => {
    acts.push([action, ...args]);
  });
  return { view, acts };
}

/** A view model from a mounted plugin whose state the test sets up. */
async function model(setup?: (m: Awaited<ReturnType<typeof mount>>) => Promise<unknown>) {
  const m = await mount();
  await setup?.(m);
  await m.settle();
  return m.view.latest();
}

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const $$ = (selector: string) => [...document.querySelectorAll(selector)] as HTMLElement[];
const key = (k: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("the view", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("draws five tabs and shows one view at a time; number keys change it", async () => {
    const { view, acts } = dom();
    const vm = await model();
    view.render(vm);
    expect($$("#tabs button").map((b) => b.textContent)).toEqual([
      "1 Agents",
      "2 Chat",
      "3 Compare",
      "4 Board",
      "5 Activity",
    ]);
    expect($("#tab-agents").getAttribute("aria-selected")).toBe("true");
    expect($("#view-chat").hidden).toBe(true);
    expect($("#found").textContent).toBe("2 of 8 agents installed");
    expect($("#access").textContent).toBe("Read-only");
    view.render({ ...vm, view: "board" });
    expect($("#view-board").hidden).toBe(false);
    expect($("#view-agents").hidden).toBe(true);
    key("2");
    $("#tab-activity").click();
    expect(acts).toEqual([
      ["show", "chat"],
      ["show", "activity"],
    ]);
  });

  it("lists every agent with its version, guard and how to install a missing one", async () => {
    const { view, acts } = dom();
    view.render(await model());
    const cards = $$("#agents-list .agent");
    expect(cards).toHaveLength(8);
    expect(cards[0]?.textContent).toContain("Claude Code");
    expect(cards[0]?.textContent).toContain("2.0.14");
    expect(cards[0]?.textContent).toContain("Kept read-only by a flag");
    expect(cards[2]?.textContent).toContain("Not installed");
    expect(cards[2]?.textContent).toContain("npm install -g @google/gemini-cli");
    const chat = cards[1]?.querySelector(".actions button") as HTMLElement;
    chat.click();
    key("ArrowDown", $("#agents-list"));
    key("Enter", $("#agents-list"));
    expect(acts).toEqual([
      ["useAgent", "codex"],
      ["useAgent", "codex"],
    ]);
  });

  it("draws the conversation and sends with Enter, a new line with Shift+Enter", async () => {
    const { view, acts } = dom();
    const vm = await model(async (m) => {
      m.app.show("chat");
      await m.talk.send("What does b.ts export?");
    });
    view.render(vm);
    const messages = $$("#chat-log .msg");
    expect(messages.map((m) => m.className)).toEqual(["msg user done", "msg agent done"]);
    expect(messages[1]?.textContent).toContain("It exports **two** functions.");
    expect(messages[1]?.querySelector(".tools")?.textContent).toBe("Read /a/b.ts");
    expect(
      $$("#chat-bar .picker button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]),
    ).toEqual([
      ["Claude Code", "true"],
      ["Codex", "false"],
    ]);
    const input = $("#chat-input") as HTMLTextAreaElement;
    input.value = "line one";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    expect(acts).toEqual([]);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(acts).toEqual([["send", "line one"]]);
    expect(input.value).toBe("");
    // Keys in the composer are text, not commands.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    expect(acts).toHaveLength(1);
    key("n");
    expect(acts.at(-1)).toEqual(["newChat"]);
  });

  it("keeps a message's element while it does not change", async () => {
    const { view } = dom();
    const vm = await model(async (m) => {
      m.app.show("chat");
      await m.talk.send("hi");
    });
    view.render(vm);
    const first = $$("#chat-log .msg")[0];
    view.render(structuredClone(vm));
    expect($$("#chat-log .msg")[0]).toBe(first);
  });

  it("draws the comparison as one pane per agent", async () => {
    const { view } = dom();
    view.render(await model((m) => m.talk.compare("What is here?")));
    expect($$("#compare-panes .pane strong").map((s) => s.textContent)).toEqual([
      "Claude Code",
      "Codex",
    ]);
    expect($("#compare-send").textContent).toBe("Ask 2 agents");
  });

  it("draws the board's columns, and a drop moves the card there", async () => {
    const { view, acts } = dom();
    const vm = await model(async (m) => {
      m.app.show("board");
      await m.tasks.addCard({ title: "Notes", prompt: "Write them" });
    });
    view.render(vm);
    expect($$(".column h2").map((h) => h.textContent)).toEqual([
      "To do1",
      "Running0",
      "Done0",
      "Failed0",
    ]);
    const card = $(".card");
    expect(card.getAttribute("draggable")).toBe("true");
    expect($("#card-detail").hidden).toBe(false);
    const done = $(".column.done");
    const drop = new Event("drop", { bubbles: true }) as Event & {
      dataTransfer: unknown;
      clientY: number;
    };
    Object.assign(drop, { dataTransfer: { getData: () => vm.board.selected }, clientY: 0 });
    done.dispatchEvent(drop);
    expect(acts.at(-1)).toEqual(["moveCard", vm.board.selected, "done", undefined]);
    key("r");
    key("]");
    expect(acts.slice(-2)).toEqual([
      ["runCard", vm.board.selected],
      ["shiftCard", vm.board.selected, 1],
    ]);
  });

  it("adds a card from the form, with the agent picked", async () => {
    const { view, acts } = dom();
    const vm = await model((m) => Promise.resolve(m.app.show("board")));
    view.render(vm);
    ($("#card-prompt") as HTMLTextAreaElement).value = "Summarise the README";
    ($("#card-agent") as HTMLSelectElement).value = "codex";
    $("#card-add-run").click();
    expect(acts).toEqual([
      ["addCard", { title: "", prompt: "Summarise the README", agent: "codex", run: true }],
    ]);
  });

  it("lists the runs and opens one", async () => {
    const { view, acts } = dom();
    const m = await mount({ script: computer() });
    await m.talk.ask("one", "codex");
    m.app.show("activity");
    const vm: ViewModel = m.view.latest();
    view.render(vm);
    expect($$(".run").map((r) => r.textContent)).toEqual([expect.stringContaining("Codex")]);
    expect($("#run-detail").textContent).toContain(
      "codex exec --json --skip-git-repo-check --sandbox read-only <prompt>",
    );
    key("x", $("#activity-list"));
    expect(acts).toEqual([["stopRun", vm.activity.runs[0]?.id]]);
  });
});
