// A chat's settings reach the server: presets fill them, the person's presets are kept as a file,
// the defaults start new chats, Ollama's context length and reasoning switch, JSON output, and the
// context meter's count.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeLlm } from "../dev/fake-llm.mjs";
import { createApp } from "../ui/app.js";
import { compact, contextUse } from "../ui/context.js";
import { BUILT_IN, clean, matches, settingsOf } from "../ui/presets.js";
import { path } from "../ui/threads.js";
import { type NodeBridge, nodeBridge } from "./node-bridge.js";

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

const lastChat = (p = "/api/chat") => fake.requests.filter((r) => r.path === p).at(-1)?.body;

async function ready() {
  const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
  await app.start();
  return app;
}

describe("chat settings", () => {
  it("sends a preset's system prompt and sampling to Ollama", async () => {
    const app = await ready();
    app.choose("127.0.0.1:11434|llama3.2:3b");
    const thread = app.newChat();
    const coder = BUILT_IN.find((p) => p.id === "coder");
    if (!coder) throw new Error("no preset");
    Object.assign(thread, settingsOf(coder));
    thread.params = { ...thread.params, contextLength: 8192, stop: ["</end>"], seed: 7 };
    await app.send("write python code");
    const body = lastChat();
    expect(body.messages[0]).toEqual({ role: "system", content: coder.system });
    expect(body.options).toEqual({
      temperature: 0.2,
      top_p: 0.9,
      num_ctx: 8192,
      stop: ["</end>"],
      seed: 7,
    });
  });

  it("asks a reasoning model to think unless the chat says not to", async () => {
    const app = await ready();
    app.choose("127.0.0.1:11434|qwen3:8b");
    await app.send("hello");
    expect(lastChat().think).toBe(true);
    const thread = app.newChat();
    thread.think = false;
    await app.send("hello again");
    expect(lastChat().think).toBe(false);
    expect(path(thread)[1]!.reasoning).toBeUndefined();
  });

  it("holds an answer to JSON, on either kind of server", async () => {
    const app = await ready();
    app.choose("127.0.0.1:8080|mistral-small-3.2-24b-instruct-2506-Q4_K_M.gguf");
    const thread = app.newChat();
    thread.format = { type: "object", properties: { answer: { type: "string" } } };
    await app.send("give me json");
    expect(lastChat("/v1/chat/completions").response_format).toMatchObject({ type: "json_schema" });
    const answer = path(thread)[1];
    expect(answer!.format).toBe("schema");
    expect(JSON.parse(answer!.content).tags).toEqual(["local", "structured"]);
    app.choose("127.0.0.1:11434|llama3.2:3b");
    const t2 = app.newChat();
    t2.format = "json";
    await app.send("json please");
    expect(lastChat().format).toBe("json");
  });

  it("keeps the person's presets in a file and new chats start from the defaults", async () => {
    const app = await ready();
    const thread = app.newChat();
    thread.system = "Speak like a pirate.";
    thread.params = { temperature: 1.3 };
    const preset = await app.presets.save("Pirate", thread);
    const file = JSON.parse(
      readFileSync(join(bridge.root, ".endue/local-models/presets.json"), "utf8"),
    );
    expect(file.presets).toEqual([
      {
        id: "mine-pirate",
        name: "Pirate",
        system: "Speak like a pirate.",
        params: { temperature: 1.3 },
      },
    ]);
    expect(matches({ system: "Speak like a pirate.", params: { temperature: 1.3 } }, preset)).toBe(
      true,
    );
    await app.saveDefaults(thread);
    const again = await ready();
    expect(again.presets.get("mine-pirate")?.name).toBe("Pirate");
    expect(again.newChat()).toMatchObject({
      system: "Speak like a pirate.",
      params: { temperature: 1.3 },
    });
  });

  it("drops unset sampling fields and keeps their order", () => {
    expect(clean({ topP: undefined, temperature: 0.5, stop: [] })).toEqual({ temperature: 0.5 });
  });

  it("learns a model's context length from Ollama and counts what a chat uses", async () => {
    const app = await ready();
    app.choose("127.0.0.1:11434|gemma3:12b");
    await new Promise((r) => setTimeout(r, 100));
    expect(app.S.get().models.find((m: any) => m.id === "gemma3:12b")?.ctx).toBe(131072);
    const empty = contextUse(app.S.get(), "x".repeat(400));
    expect(empty).toMatchObject({ used: 100, limit: 131072, exact: false });
    await app.send("Explain transformers");
    await app.refreshModels("127.0.0.1:11434");
    expect(app.S.get().models.find((m: any) => m.id === "gemma3:12b")).toMatchObject({
      loaded: true,
      ctx: 131072,
    });
    const use = contextUse(app.S.get());
    expect(use.exact).toBe(true);
    expect(use.used).toBeGreaterThan(100);
    expect(use.limit).toBe(8192);
    expect(compact(1234)).toBe("1.2K");
    expect(compact(131072)).toBe("128K");
    expect(compact(651.75)).toBe("652");
  });
});
