// The servers found on the usual ports, their models, and chat streamed from each kind, against
// the made-up Ollama and llama.cpp servers in dev/.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeLlm } from "../dev/fake-llm.mjs";
import { createSockets } from "../ui/net.js";
import * as ollama from "../ui/ollama.js";
import * as openai from "../ui/openai.js";
import { discover, labelOf } from "../ui/servers.js";
import { type NodeBridge, nodeBridge } from "./node-bridge.js";

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
});
afterAll(async () => {
  bridge.close();
  await fake.close();
});

describe("finding servers", () => {
  it("finds Ollama and llama.cpp on their usual ports and nothing on the others", async () => {
    const sockets = createSockets(bridge);
    const servers = await discover(sockets);
    expect(servers.map((s) => [s.id, s.kind, s.label, s.status])).toEqual([
      ["127.0.0.1:11434", "ollama", "Ollama :11434", "online"],
      ["127.0.0.1:8080", "openai", "llama.cpp :8080", "online"],
    ]);
    expect(servers[0].version).toBe("0.12.6");
  });

  it("keeps an added server that does not answer, as offline", async () => {
    const sockets = createSockets(bridge);
    const servers = await discover(sockets, [{ host: "127.0.0.1", port: 9999, kind: "openai" }]);
    expect(servers.find((s) => s.port === 9999)).toMatchObject({ status: "offline", added: true });
  });

  it("labels servers here and elsewhere", () => {
    expect(labelOf("openai", undefined, "127.0.0.1", 1234)).toBe("OpenAI-compatible :1234");
    expect(labelOf("ollama", undefined, "studio.local", 11434)).toBe("Ollama · studio.local:11434");
  });
});

describe("Ollama", () => {
  const server = () => ({ id: "127.0.0.1:11434", baseUrl: "http://127.0.0.1:11434" });

  it("lists models with what they are and can do, the loaded one marked", async () => {
    const models = await ollama.listModels(createSockets(bridge), server());
    const qwen = models.find((m) => m.id === "qwen3:8b");
    expect(qwen).toMatchObject({
      name: "Qwen3 8B",
      params: "8.2B",
      quant: "Q4_K_M",
      loaded: true,
      caps: ["tools", "reasoning"],
    });
    expect(models.find((m) => m.id === "gemma3:12b")?.caps).toEqual(["vision"]);
    expect(models.find((m) => m.id.startsWith("nomic"))?.caps).toEqual(["embedding"]);
  });

  it("streams an answer with its reasoning and the server's counts", async () => {
    const pieces: string[] = [];
    let thought = "";
    const result = await ollama.chat(
      createSockets(bridge),
      server(),
      {
        model: "qwen3:8b",
        messages: [{ role: "user", content: "Explain transformers" }],
        think: true,
        params: { temperature: 0.2 },
      },
      (d) => {
        if (d.content) pieces.push(d.content);
        if (d.reasoning) thought += d.reasoning;
      },
    );
    expect(pieces.length).toBeGreaterThan(20);
    expect(result.content).toBe(pieces.join(""));
    expect(result.content).toContain("A **transformer**");
    expect(thought).toContain("plain-words explanation");
    expect(result.stats).toMatchObject({ stopReason: "stop" });
    expect(result.stats.tokens).toBeGreaterThan(20);
    expect(result.stats.tokPerSec).toBeGreaterThan(0);
  });

  it("stops at the token limit and says so", async () => {
    const result = await ollama.chat(
      createSockets(bridge),
      server(),
      {
        model: "llama3.2:3b",
        messages: [{ role: "user", content: "hi" }],
        params: { maxTokens: 5 },
      },
      () => {},
    );
    expect(result.stats).toMatchObject({ tokens: 5, stopReason: "length" });
  });

  it("passes the server's refusal on in words", async () => {
    await expect(
      ollama.chat(
        createSockets(bridge),
        server(),
        { model: "missing:1b", messages: [{ role: "user", content: "hi" }] },
        () => {},
      ),
    ).rejects.toMatchObject({ status: 404, message: expect.stringContaining("not found") });
  });

  it("maps sampling settings to Ollama's options", () => {
    expect(
      ollama.optionsOf({
        temperature: 0.7,
        topK: 40,
        maxTokens: 256,
        contextLength: 8192,
        stop: ["</s>"],
      }),
    ).toEqual({
      temperature: 0.7,
      top_k: 40,
      num_predict: 256,
      num_ctx: 8192,
      stop: ["</s>"],
    });
  });
});

describe("OpenAI-compatible", () => {
  const server = () => ({ id: "127.0.0.1:8080", baseUrl: "http://127.0.0.1:8080" });

  it("lists the loaded model with llama.cpp's metadata", async () => {
    const models = await openai.listModels(createSockets(bridge), server());
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      name: "Mistral Small 3.2 24B Instruct 2506",
      params: "24B",
      quant: "Q4_K_M",
      ctx: 131072,
    });
  });

  it("streams events, with usage and timings at the end", async () => {
    let text = "";
    const result = await openai.chat(
      createSockets(bridge),
      server(),
      {
        model: "mistral-small-3.2-24b-instruct-2506-Q4_K_M.gguf",
        messages: [{ role: "user", content: "write python code" }],
        params: { temperature: 0.1, topP: 0.9 },
      },
      (d) => {
        text += d.content ?? "";
      },
    );
    expect(text).toContain("def dedupe_lines");
    expect(result.stats.tokens).toBeGreaterThan(50);
    expect(result.stats.promptTokens).toBe(31);
    expect(result.stats.tokPerSec).toBeCloseTo(625, 0);
  });

  it("puts images in the message as data URLs and sampling as fields", () => {
    expect(
      openai.messageOf({
        role: "user",
        content: "what is this",
        images: [{ name: "a.png", type: "image/png", data: "AAA" }],
      }),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    });
    expect(openai.samplingOf({ temperature: 0, repeatPenalty: 1.1, seed: 7 })).toEqual({
      temperature: 0,
      repeat_penalty: 1.1,
      seed: 7,
    });
  });
});
