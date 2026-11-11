// @vitest-environment jsdom
// The page wired to the plugin as main.js wires it: the DOM view draws what the controller paints,
// and its tabs, keys and buttons run the controller's own actions.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";
import { CLAUDE_STREAM } from "./fixtures";
import { computer, mount } from "./harness";

const page = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");

/** The plugin mounted on the test host with the page's DOM view, as main.js mounts it. */
async function wired(options: Parameters<typeof mount>[0] = {}) {
  const body = /<body>([\s\S]*)<\/body>/.exec(page)?.[1] ?? "";
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
  let actions: Record<string, (...args: unknown[]) => unknown> = {};
  const view = createView(document, (action, ...args) => actions[action]?.(...args));
  const m = await mount({ ...options, also: view });
  actions = m.actions;
  return m;
}

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const $$ = (selector: string) => [...document.querySelectorAll(selector)] as HTMLElement[];
const key = (k: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const shown = () => $$("main > .view:not([hidden])").map((v) => v.id);
const enter = (input: HTMLTextAreaElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};

/** Codex answering in a line, with no tool used. */
const SHORT_CODEX = `${[
  { type: "thread.started", thread_id: "0199a213-0000-7000-8000-000000000001" },
  { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Fine." } },
  { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 } },
]
  .map((line) => JSON.stringify(line))
  .join("\n")}\n`;

describe("the page wired to the plugin", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens every view by its tab and by its key, Compare too, and says nothing", async () => {
    const m = await wired();
    const views = ["agents", "chat", "compare", "board", "activity"];
    for (const name of views) {
      $(`#tab-${name}`).click();
      await m.settle();
      expect(shown()).toEqual([`view-${name}`]);
    }
    for (const [index, name] of [...views.entries()].reverse()) {
      key(String(index + 1));
      await m.settle();
      expect(shown()).toEqual([`view-${name}`]);
    }
    $("#tab-chat").click();
    await m.settle();
    $("#tab-compare").click();
    await m.settle();
    expect(shown()).toEqual(["view-compare"]);
    expect($("#tab-compare").getAttribute("aria-selected")).toBe("true");
    expect($("#status").textContent).toBe("");
    expect(m.view.said).toEqual([]);
    expect(m.programs.asked("claude")).toHaveLength(0);
    expect(m.programs.asked("codex")).toHaveLength(0);
  });

  it("asks every agent picked from the Compare composer", async () => {
    const m = await wired();
    key("3");
    await m.settle();
    enter($("#compare-input") as HTMLTextAreaElement, "What is here?");
    await m.settle();
    expect(m.programs.asked("claude")).toHaveLength(1);
    expect(m.programs.asked("codex")).toHaveLength(1);
    expect($$("#compare-panes .pane strong").map((s) => s.textContent)).toEqual([
      "Claude Code",
      "Codex",
    ]);
    expect($("#status").textContent).toBe("");
  });

  it("prints no undefined in a bar or a detail", async () => {
    const m = await wired({
      script: computer({ claude: { stdout: CLAUDE_STREAM }, codex: { stdout: SHORT_CODEX } }),
    });
    const words = () => document.body.textContent ?? "";
    key("2");
    await m.settle();
    expect($("#chat-bar").textContent).toContain("Opens its own session");
    expect(words()).not.toContain("undefined");
    key("3");
    await m.settle();
    expect(words()).not.toContain("undefined");
    key("4");
    await m.settle();
    ($("#card-prompt") as HTMLTextAreaElement).value = "Write the notes";
    $("#card-add").click();
    await m.settle();
    expect($("#card-detail").hidden).toBe(false);
    expect($("#card-detail").textContent).toContain("Not run yet.");
    expect(words()).not.toContain("undefined");
    // A command's question opens its run in Activity.
    await m.talk.ask("one", "codex");
    key("5");
    await m.settle();
    expect($("#run-detail").hidden).toBe(false);
    expect($("#run-detail").textContent).toContain("Fine.");
    expect(words()).not.toContain("undefined");
  });

  it("offers the model's default and the one in use, so the pick is never an empty list", async () => {
    const m = await wired({ picks: ["opus", ""] });
    key("2");
    await m.settle();
    $$("#chat-bar button")
      .find((b) => b.textContent === "Model: default")
      ?.click();
    await m.settle();
    expect(m.picked[0]).toMatchObject({
      title: "Local agents: Claude Code's model",
      free: true,
      items: [{ id: "", label: "Its default model" }],
    });
    expect($("#chat-bar").textContent).toContain("Model: opus");
    key("m");
    await m.settle();
    expect(m.picked[1]).toMatchObject({
      items: [{ id: "" }, { id: "opus", label: "opus", detail: "In use" }],
    });
    expect($("#chat-bar").textContent).toContain("Model: default");
    expect($("#status").textContent).toBe("");
  });

  it("lists every key of the view in words on ?, and Escape closes the list", async () => {
    const m = await wired();
    key("4");
    await m.settle();
    const hint = $("#hints").textContent;
    expect($("#keys").hidden).toBe(true);
    key("?");
    expect($("#keys").hidden).toBe(false);
    expect($$("#keys dt").map((d) => d.textContent)).toContain("[ ]");
    expect($("#keys").textContent).toContain("clear Done");
    expect($("#hints").textContent).toBe(hint);
    expect($("#status").textContent).toBe("");
    key("2");
    await m.settle();
    expect($("#keys h2").textContent).toBe("Keys in Chat");
    key("Escape");
    expect($("#keys").hidden).toBe(true);
    key("?");
    key("?");
    expect($("#keys").hidden).toBe(true);
  });

  it("names settings as Settings shows them, never by their keys", async () => {
    await wired();
    expect(document.body.textContent).toContain("Settings › Local agents › Folder");
    expect(document.body.textContent).not.toMatch(/endue\.local-agents\.\w/);
  });
});
