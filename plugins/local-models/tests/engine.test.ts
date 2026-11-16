// Model files on this computer and the built-in engine: GGUF headers read in ranges, the library's
// split files and projectors, memory fits, and llama-server (the made-up one in dev/) loaded with the
// person's settings, chatted with, ejected, and failing in words.
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ggufBytes, modelMeta, writeGguf } from "../dev/gguf-write.mjs";
import { createApp } from "../ui/app.js";
import { failureOf, progressOf, serverArgs } from "../ui/engine.js";
import { describeGguf, readGguf } from "../ui/gguf.js";
import { fitOf, gpuLayersFor, kvBytes, needBytes } from "../ui/memory.js";
import { path } from "../ui/threads.js";
import { type NodeBridge, nodeBridge } from "./node-bridge.js";

const GB = 1_000_000_000;
const qwen = {
  arch: "qwen3",
  name: "Qwen3 4B",
  sizeLabel: "4B",
  fileType: 15,
  ctx: 262144,
  layers: 36,
  embd: 2560,
  heads: 32,
  kvHeads: 8,
  vocab: 40000,
};
let bridge: NodeBridge;
const models = (b: NodeBridge) => join(b.root, ".endue/local-models/models");

beforeAll(() => {
  bridge = nodeBridge({ remap: new Map(), memory: 24 * 1024 ** 3 });
  writeGguf(
    join(models(bridge), "Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf"),
    modelMeta(qwen),
    2.5 * GB,
  );
  writeGguf(
    join(models(bridge), "big/Huge-GGUF/Huge-Q4_K_M-00001-of-00002.gguf"),
    modelMeta({ ...qwen, name: "Huge", layers: 80 }),
    30 * GB,
  );
  writeGguf(
    join(models(bridge), "big/Huge-GGUF/Huge-Q4_K_M-00002-of-00002.gguf"),
    modelMeta({ ...qwen, name: "Huge part" }),
    30 * GB,
  );
  writeGguf(
    join(models(bridge), "google/gemma/gemma-3-4b-it-Q4_K_M.gguf"),
    modelMeta({ ...qwen, arch: "gemma3", name: "Gemma 3 4B" }),
    2.4 * GB,
  );
  writeGguf(
    join(models(bridge), "google/gemma/mmproj-gemma-3-4b-f16.gguf"),
    modelMeta({ ...qwen, arch: "clip", name: "projector" }),
    0.8 * GB,
  );
});
afterAll(() => bridge.close());

describe("GGUF headers", () => {
  it("reads the metadata in chunks, walking past the vocabulary", async () => {
    const bytes = ggufBytes(modelMeta(qwen));
    const reads: [number, number][] = [];
    const header = await readGguf(async (offset, length) => {
      reads.push([offset, length]);
      return new Uint8Array(bytes.subarray(offset, offset + Math.min(length, 4096)));
    });
    expect(header.version).toBe(3);
    expect(reads.length).toBeGreaterThan(10);
    const info = describeGguf(header, { size: 2.5 * GB });
    expect(info).toMatchObject({
      arch: "qwen3",
      name: "Qwen3 4B",
      quant: "Q4_K_M",
      ctx: 262144,
      layers: 36,
      heads: 32,
      kvHeads: 8,
      headDim: 80,
      vocab: 40000,
    });
    expect(info.chatTemplate).toContain("<|im_start|>");
  });

  it("refuses what is not GGUF", async () => {
    await expect(
      readGguf(async () => new TextEncoder().encode("PK\u0003\u0004 not a model")),
    ).rejects.toThrow("Not a GGUF file");
  });
});

describe("memory", () => {
  it("adds the cache a context needs to the weights, and judges the fit", () => {
    const shape = { layers: 36, kvHeads: 8, headDim: 80, size: 2.5 * GB };
    expect(kvBytes(shape, 8192)).toBe(2 * 36 * 8192 * 8 * 80 * 2);
    const mem = { total: 24 * 1024 ** 3, kind: "unified" as const };
    expect(fitOf(needBytes(shape, { ctx: 8192 }), mem)).toBe("fits");
    expect(fitOf(needBytes({ ...shape, size: 17.5 * GB }, { ctx: 8192 }), mem)).toBe("tight");
    expect(fitOf(60 * GB, mem)).toBe("too-big");
    expect(gpuLayersFor({ ...shape, layers: 40 }, 30 * GB, mem)).toBeLessThan(40);
    expect(gpuLayersFor(shape, 3 * GB, mem)).toBe(36);
  });
});

describe("the built-in engine", () => {
  it("lists the files, a split model once and the projector with its model", async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const local = app.S.get().local;
    expect(local.map((m) => m.name)).toEqual(["Gemma 3 4B", "Huge", "Qwen3 4B"]);
    expect(local.find((m) => m.name === "Huge")).toMatchObject({
      parts: 2,
      size: 60 * GB,
      repo: "big/Huge-GGUF",
    });
    expect(local.find((m) => m.name === "Gemma 3 4B")?.projector).toMatch(/mmproj-gemma/);
    expect(app.S.get().memory).toEqual({ total: 24 * 1024 ** 3, kind: "unified" });
    expect(app.local.configFor(local[2])).toMatchObject({
      ctx: 8192,
      gpuLayers: 36,
      flashAttention: true,
    });
  });

  it("loads a file with its settings, chats with it and ejects it", async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const qwenFile = app.S.get().local.find((m) => m.name === "Qwen3 4B");
    if (!qwenFile) throw new Error("no file");
    const loaded = await app.local.load(qwenFile, {
      ...app.local.configFor(qwenFile),
      ctx: 16384,
      cacheType: "q8_0",
    });
    expect(loaded).toMatchObject({
      id: "Qwen3-4B-Q4_K_M",
      serverId: expect.stringMatching(/^127\.0\.0\.1:39\d{3}$/),
    });
    const port = Number(loaded?.serverId.split(":")[1]);
    const spawn = bridge.calls.find(
      (c) => c.method === "proc.spawn" && c.params.command === "llama-server",
    );
    expect(spawn?.params.args).toEqual(
      expect.arrayContaining([
        "-c",
        "16384",
        "--cache-type-k",
        "q8_0",
        "--alias",
        "Qwen3-4B-Q4_K_M",
      ]),
    );
    expect(app.S.get().servers.find((s) => s.port === port)).toMatchObject({
      managed: true,
      label: "Built-in · Qwen3-4B-Q4_K_M",
    });
    expect(app.S.get().selected).toBe(`127.0.0.1:${port}|Qwen3-4B-Q4_K_M`);
    await app.send("Explain transformers");
    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    expect(path(thread)[1].content).toContain("transformer");
    const [engine] = app.S.get().engines;
    expect(engine).toMatchObject({ state: "ready", progress: 1 });
    expect(app.local.logOf(engine.id).join("\n")).toContain("server is listening");
    await app.local.eject(engine.id);
    expect(app.S.get().engines).toEqual([]);
    expect(app.S.get().servers.some((s) => s.port === port)).toBe(false);
  });

  it("says when llama-server is not installed", async () => {
    const b = nodeBridge({ remap: new Map(), engine: false });
    writeGguf(join(models(b), "x/y/Small-Q8_0.gguf"), modelMeta({ ...qwen, name: "Small" }), GB);
    const app = createApp(b, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const file = app.S.get().local[0];
    expect(await app.local.load(file)).toBeUndefined();
    expect(app.S.get().engines[0]).toMatchObject({
      state: "failed",
      error: expect.stringContaining("not installed"),
    });
    expect(app.S.get().toast?.level).toBe("error");
    b.close();
  });

  it("builds llama-server's arguments and reads its log", () => {
    expect(
      serverArgs(
        "/m/a.gguf",
        "a",
        39281,
        { ctx: 4096, gpuLayers: 20, threads: 6, flashAttention: true, mlock: true, mmap: false },
        "/m/mmproj.gguf",
      ),
    ).toEqual([
      "-m",
      "/m/a.gguf",
      "--alias",
      "a",
      "--host",
      "127.0.0.1",
      "--port",
      "39281",
      "-c",
      "4096",
      "-ngl",
      "20",
      "-t",
      "6",
      "-fa",
      "on",
      "--mlock",
      "--no-mmap",
      "--mmproj",
      "/m/mmproj.gguf",
      "--jinja",
      "--metrics",
    ]);
    expect(progressOf("load_tensors: offloaded 37/37 layers to GPU", 0.1)).toBe(0.55);
    expect(
      failureOf(["ggml_metal_buffer: error: failed to allocate buffer of size 9000 MiB"], 1),
    ).toMatch(/Not enough memory/);
    expect(
      failureOf(
        ["llama_model_load: error loading model architecture: unknown model architecture: 'foo'"],
        1,
      ),
    ).toMatch(/architecture/);
  });
});
