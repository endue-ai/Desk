// What a person does to a conversation: edit a question (a new version, answered again), correct an
// answer, let a cut-off answer go on, start a chat from a message, have the model name the chat, and
// export it — against the made-up servers, with files in a temporary folder.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeLlm } from "../dev/fake-llm.mjs";
import { createApp } from "../ui/app.js";
import {
  branchToNew,
  cleanTitle,
  continueAnswer,
  editAnswer,
  editQuestion,
  exportThread,
  fileNameOf,
  nameThread,
  threadMarkdown,
} from "../ui/edit.js";
import { messagesFor } from "../ui/run.js";
import { branchOf, path } from "../ui/threads.js";
import { type NodeBridge, nodeBridge, until } from "./node-bridge.js";

let fake: Awaited<ReturnType<typeof startFakeLlm>>;
let bridge: NodeBridge;

beforeAll(async () => {
  fake = await startFakeLlm({ tokenMs: 0 });
  bridge = nodeBridge({
    remap: new Map([
      [11434, fake.ollamaPort],
      [8080, fake.openaiPort],
    ]),
  });
});
afterAll(async () => {
  bridge.close();
  await fake.close();
});

async function ready() {
  const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
  await app.start();
  app.choose("127.0.0.1:11434|llama3.2:3b");
  return app;
}

describe("editing a conversation", () => {
  it("answers an edited question as a new version, keeping the old one", async () => {
    const app = await ready();
    await app.send("Tell me about unix");
    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    const [question] = path(thread);
    await editQuestion(app, question.id, "Explain transformers");
    const [edited, answer] = path(thread);
    expect(edited.content).toBe("Explain transformers");
    expect(branchOf(thread, edited)).toEqual({ index: 2, count: 2 });
    expect(answer.content).toContain("transformer");
    expect(Object.values(thread.nodes)).toHaveLength(4);
  });

  it("corrects an answer in place, and the next request sends the correction", async () => {
    const app = await ready();
    await app.send("hello");
    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    const answer = path(thread)[1];
    editAnswer(app, answer.id, "Corrected.");
    expect(answer).toMatchObject({ content: "Corrected.", edited: true });
    expect(messagesFor(thread, answer.id).at(-1)).toEqual({
      role: "assistant",
      content: "Corrected.",
    });
  });

  it("lets an answer cut off at the token limit go on, counting all its tokens", async () => {
    const app = await ready();
    const thread = app.newChat();
    thread.params = { maxTokens: 6 };
    await app.send("Explain transformers");
    const answer = path(thread)[1];
    expect(answer.stats).toMatchObject({ stopReason: "length", tokens: 6 });
    const before = answer.content;
    thread.params = {};
    await continueAnswer(app, answer.id);
    expect(answer.content.startsWith(before)).toBe(true);
    expect(answer.content.length).toBeGreaterThan(before.length);
    expect(answer.stats?.tokens).toBeGreaterThan(6);
    expect(Object.values(thread.nodes)).toHaveLength(2);
  });

  it("starts a new chat holding the conversation up to a message", async () => {
    const app = await ready();
    await app.send("first question");
    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    const fresh = branchToNew(app, path(thread)[1].id);
    expect(fresh?.id).not.toBe(thread.id);
    expect(path(fresh as typeof thread).map((n) => n.role)).toEqual(["user", "assistant"]);
    expect(app.S.get().thread?.id).toBe(fresh?.id);
  });

  it("has the model name the chat, without quotes", async () => {
    const app = await ready();
    await app.send("Write a python function to dedupe lines");
    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    await nameThread(app, thread);
    expect(thread).toMatchObject({ title: "Deduplicating Lines in Python", titled: true });
    expect(cleanTitle('Title: "Rust Lifetimes Explained."')).toBe("Rust Lifetimes Explained");
  });

  it("names a chat by itself after its first answer", async () => {
    const app = createApp(bridge, { storeDelayMs: 5 });
    await app.start();
    await app.send("Explain transformers please");
    await until(() => app.S.get().thread?.titled === true);
    expect(app.S.get().thread?.title).toBe("Transformers in Plain Words");
    expect(app.S.get().threads[0].title).toBe("Transformers in Plain Words");
  });

  it("exports the conversation shown as Markdown and JSON", async () => {
    const app = await ready();
    await app.send("Tell me about unix");
    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    thread.title = "Unix: a talk";
    await exportThread(app, "md");
    const md = readFileSync(join(bridge.root, "Downloads/Unix a talk.md"), "utf8");
    expect(md).toContain("# Unix: a talk");
    expect(md).toContain("### You\n\nTell me about unix");
    expect(md).toContain("### Llama3.2 3B");
    await exportThread(app, "json");
    expect(
      JSON.parse(readFileSync(join(bridge.root, "Downloads/Unix a talk.json"), "utf8")).id,
    ).toBe(thread.id);
    expect(threadMarkdown(thread)).toContain("Do one thing well");
    expect(fileNameOf('a/b: "c"?', "md")).toBe("a b c.md");
  });
});
