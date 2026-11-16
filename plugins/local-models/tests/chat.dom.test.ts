// @vitest-environment jsdom
// The whole window on real things: mounted with a bridge whose sockets reach the made-up servers and
// whose files live in a temporary folder. The servers are found, a question is typed and sent, the
// answer streams in as markdown with its stats, the thread is saved as a file, and asking again keeps
// both versions.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeLlm } from "../dev/fake-llm.mjs";
import { createApp } from "../ui/app.js";
import { parseBlocks, renderMarkdown } from "../ui/markdown.js";
import { mountShell } from "../ui/view-shell.js";
import { type NodeBridge, nodeBridge, until } from "./node-bridge.js";

let fake: Awaited<ReturnType<typeof startFakeLlm>>;
let bridge: NodeBridge;

beforeAll(async () => {
  fake = await startFakeLlm({ tokenMs: 1 });
  bridge = nodeBridge({
    remap: new Map([
      [11434, fake.ollamaPort],
      [8080, fake.openaiPort],
    ]),
  });
  // jsdom has no layout: what the views ask of it, answered plainly.
  globalThis.requestAnimationFrame ??= ((fn: FrameRequestCallback) =>
    setTimeout(() => fn(0), 0)) as typeof requestAnimationFrame;
  Element.prototype.scrollIntoView ??= () => {};
});
afterAll(async () => {
  bridge.close();
  await fake.close();
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

describe("the chat window", () => {
  it("finds the servers, sends a question and streams the answer", { timeout: 30000 }, async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    mountShell(app, document.body);
    await app.start();
    expect(app.S.get().servers.map((s) => s.label)).toEqual(["Ollama :11434", "llama.cpp :8080"]);
    expect(app.S.get().selected).toBe("127.0.0.1:11434|qwen3:8b");
    expect($(".lm-model-pill").textContent).toContain("Qwen3 8B");
    expect($(".lm-empty-title").textContent).toBe("What can I help with?");

    const field = $(".lm-input") as HTMLTextAreaElement;
    field.value = "Write a Python function to dedupe lines";
    field.dispatchEvent(new Event("input"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => app.S.get().generating !== null);
    await until(() => app.S.get().generating === null);

    const answer = $(".lm-msg[data-role='assistant']");
    expect(answer.querySelector(".lm-code-lang")?.textContent).toBe("python");
    expect(answer.querySelector(".lm-tk-keyword")?.textContent).toBe("from");
    expect(answer.querySelector(".lm-reasoning summary")?.textContent).toMatch(/Thought for/);
    expect(answer.querySelector(".lm-stats")?.textContent).toMatch(/tok\/s/);
    expect($$("li[data-task='done']")).toHaveLength(2);
    expect($(".lm-thread-title").textContent).toContain("Write a Python function");

    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    await app.store.flush();
    const file = join(bridge.root, ".endue/local-models/threads", `${thread.id}.json`);
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.values(saved.nodes).map((n) => (n as { role: string }).role)).toEqual([
      "user",
      "assistant",
    ]);
    const index = JSON.parse(
      readFileSync(join(bridge.root, ".endue/local-models/threads.json"), "utf8"),
    );
    expect(index.threads[0]).toMatchObject({ id: thread.id, model: "127.0.0.1:11434|qwen3:8b" });

    $(".lm-msg[data-role='assistant'] [aria-label='Ask again']").click();
    await until(() => app.S.get().generating !== null);
    await until(() => app.S.get().generating === null);
    expect($(".lm-branch-count").textContent).toBe("2 / 2");
    $("[aria-label='Previous version']").click();
    expect($(".lm-branch-count").textContent).toBe("1 / 2");
  });

  it("stops an answer and keeps what came", { timeout: 30000 }, async () => {
    const slow = await startFakeLlm({ tokenMs: 25 });
    const b = nodeBridge({ remap: new Map([[11434, slow.ollamaPort]]) });
    const app = createApp(b, { storeDelayMs: 5 });
    await app.start();
    const sending = app.send("Explain transformers");
    await until(
      () =>
        (app.S.get().thread &&
          Object.values(app.S.get().thread?.nodes ?? {}).some(
            (n) => n.role === "assistant" && n.content.length > 40,
          )) ||
        false,
    );
    app.stop();
    await sending;
    const node = Object.values(app.S.get().thread?.nodes ?? {}).find((n) => n.role === "assistant");
    expect(node?.stats?.stopReason).toBe("stopped");
    expect(node?.content.length).toBeGreaterThan(0);
    b.close();
    await slow.close();
  });

  it("says when no server answers", async () => {
    const b = nodeBridge({ remap: new Map() });
    document.body.replaceChildren();
    const app = createApp(b);
    mountShell(app, document.body);
    await app.start();
    expect($(".lm-empty-title").textContent).toBe("No model server is running");
    b.close();
  });
});

describe("markdown", () => {
  it("parses the blocks models write", () => {
    const blocks = parseBlocks(
      "# Title\n\nSome **bold** text\n\n- a\n- [x] b\n\n| x | y |\n| :-- | --: |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n\n> quoted\n\n---",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "para",
      "list",
      "table",
      "code",
      "quote",
      "hr",
    ]);
  });

  it("draws an unclosed fence as code while streaming, and never HTML", () => {
    const el = document.createElement("div");
    renderMarkdown(el, "Here:\n\n```python\nprint('<b>hi</b>')", { live: true });
    expect(el.querySelector(".lm-code")?.getAttribute("data-open")).toBe("1");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("print('<b>hi</b>')");
    renderMarkdown(el, "[a link](javascript:alert(1)) and <https://example.com>");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(el.textContent).toContain("a link");
  });
});
