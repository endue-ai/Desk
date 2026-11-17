// Discover against the made-up Hugging Face: search and sort, a repository's files grouped by
// quantization with the one that fits suggested, a model card without its front matter, a download
// by curl into org/repo/file that the library then lists, pause and resume, and a pull into Ollama.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeLlm } from "../dev/fake-llm.mjs";
import { createApp } from "../ui/app.js";
import { curlError, targetOf } from "../ui/downloads.js";
import { bestQuant, details, fileUrl, groupFiles, readme, repoCaps, search } from "../ui/hub.js";
import { type NodeBridge, nodeBridge, until } from "./node-bridge.js";

let fake: Awaited<ReturnType<typeof startFakeLlm>>;
let bridge: NodeBridge;
beforeAll(async () => {
  fake = await startFakeLlm({ tokenMs: 1 });
  bridge = nodeBridge({ remap: new Map([[11434, fake.ollamaPort]]), memory: 24 * 1024 ** 3 });
});
afterAll(async () => {
  bridge.close();
  await fake.close();
});

describe("Hugging Face", () => {
  it("searches GGUF repositories, sorted as asked", async () => {
    const found = await search(bridge, { q: "qwen3", sort: "likes" });
    expect(found.map((r) => r.id)).toEqual([
      "Qwen/Qwen3-4B-GGUF",
      "unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF",
      "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    ]);
    const fetch = bridge.calls.findLast((c) => c.method === "net.fetch");
    expect(fetch?.params.url).toBe(
      "https://huggingface.co/api/models?filter=gguf&sort=likes&direction=-1&limit=30&search=qwen3",
    );
    expect(fetch?.params.scope).toEqual({ permission: "net:fetch", hosts: ["huggingface.co"] });
  });

  it("groups a repository's files by quantization, split parts and projectors apart", async () => {
    const d = await details(bridge, "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF");
    expect(d.quants.map((q) => [q.quant, q.parts])).toEqual([
      ["Q4_K_M", 1],
      ["Q8_0", 2],
    ]);
    expect(d.quants[1]!.size).toBe(32_500_000_000);
    const gemma = await details(bridge, "unsloth/gemma-3-12b-it-GGUF");
    expect(gemma.projectors).toEqual([{ file: "mmproj-F16.gguf", size: 854_000_000 }]);
    expect(repoCaps(gemma.repo)).toEqual(["vision"]);
    expect(gemma).toMatchObject({
      arch: "gemma3",
      ctx: 131072,
      license: "gemma",
      base: "google/gemma-3-12b-it",
    });
  });

  it("suggests the largest good quantization that fits", () => {
    const { quants } = groupFiles([
      { rfilename: "m-Q3_K_S.gguf", size: 3 },
      { rfilename: "m-Q4_K_M.gguf", size: 4 },
      { rfilename: "m-Q6_K.gguf", size: 6 },
      { rfilename: "m-Q8_0.gguf", size: 8 },
    ]);
    expect(bestQuant(quants, (s) => (s <= 6 ? "fits" : "too-big"))?.quant).toBe("Q6_K");
    expect(bestQuant(quants, (s) => (s <= 3 ? "fits" : "too-big"))?.quant).toBe("Q3_K_S");
    expect(bestQuant(quants, () => "too-big")?.quant).toBe("Q3_K_S");
  });

  it("reads a model card without its front matter or HTML", async () => {
    const card = await readme(bridge, "Qwen/Qwen3-4B-GGUF");
    expect(card.startsWith("# Qwen3-4B GGUF")).toBe(true);
    expect(card).not.toContain("<div");
    expect(card).toContain("| Q4_K_M |");
  });

  it("says when huggingface.co cannot be reached", async () => {
    const off = nodeBridge({ offline: true });
    await expect(search(off, { q: "x" })).rejects.toThrow("Could not reach huggingface.co");
    off.close();
  });
});

describe("downloads", () => {
  it("fetches a file with curl into org/repo, and the library lists it", async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const d = await details(bridge, "Qwen/Qwen3-4B-GGUF");
    const q4 = d.quants[0];
    app.local.downloads.add({
      kind: "file",
      name: q4!.quant,
      repo: d.repo.id,
      files: q4!.files,
      quant: q4!.quant,
      total: q4!.size,
      path: targetOf(d.repo.id, q4!.files[0]!),
    });
    await until(() => app.S.get().downloads[0]?.state === "done");
    const curl = bridge.calls.find((c) => c.method === "proc.spawn" && c.params.command === "curl");
    expect(curl?.params).toMatchObject({ cwd: "~" });
    expect(curl?.params.args).toEqual(
      expect.arrayContaining([
        "-C",
        "-",
        "-o",
        ".endue/local-models/models/Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf.part",
        fileUrl(d.repo.id, q4!.files[0]!),
      ]),
    );
    expect(
      existsSync(
        join(bridge.root, ".endue/local-models/models/Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf"),
      ),
    ).toBe(true);
    await until(() => app.S.get().local.some((m: any) => m.repo === "Qwen/Qwen3-4B-GGUF"));
    expect(app.S.get().local.find((m: any) => m.repo === "Qwen/Qwen3-4B-GGUF")).toMatchObject({
      size: 2_500_000_000,
      info: { arch: "qwen3", quant: "Q4_K_M" },
    });
    expect(app.S.get().toast?.text).toContain("is downloaded");
  });

  it("pauses, resumes where it stopped and finishes", async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const d = await details(bridge, "ggml-org/SmolLM3-3B-GGUF");
    const q8 = d.quants[1];
    app.local.downloads.add({
      kind: "file",
      name: q8!.quant,
      repo: d.repo.id,
      files: q8!.files,
      quant: q8!.quant,
      total: q8!.size,
    });
    const id = app.S.get().downloads[0].id;
    await until(() => app.S.get().downloads[0].state === "running");
    app.local.downloads.pause(id);
    await until(() => app.S.get().downloads[0].state === "paused");
    app.local.downloads.resume(id);
    await until(() => app.S.get().downloads[0].state === "done");
    expect(
      bridge.calls.filter(
        (c) => c.method === "proc.spawn" && c.params.args.at(-1).includes("SmolLM3-Q8_0"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("pulls a model into Ollama with its progress", async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const seen: number[] = [];
    app.S.on(["downloads"], (s: any) => {
      const d = s.downloads[0];
      if (d?.kind === "ollama") seen.push(d.received);
    });
    app.local.downloads.add({
      kind: "ollama",
      name: "llama3.2:3b",
      server: "127.0.0.1:11434",
      total: 0,
    });
    await until(() => app.S.get().downloads[0]?.state === "done");
    expect(seen.some((x) => x > 0 && x < 2_019_393_189)).toBe(true);
    expect(app.S.get().downloads[0]).toMatchObject({
      total: 2_019_393_189,
      received: 2_019_393_189,
    });
  });

  it("puts curl's failures in words", () => {
    expect(curlError(22, "curl: (22) The requested URL returned error: 401")).toMatch(/sign-in/);
    expect(curlError(6, "")).toMatch(/online/);
    expect(curlError(23, "")).toMatch(/disk/);
  });
});
