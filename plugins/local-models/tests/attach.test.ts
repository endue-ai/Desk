// Attachments and documents: files read as images or text, short files sent whole, long ones cut
// into passages and searched (by an embedding model on Ollama, else by words), the passages sent
// with the question and shown as its sources, vectors kept so a file is embedded once.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeLlm } from "../dev/fake-llm.mjs";
import { createApp } from "../ui/app.js";
import { docOf, htmlText, inlineDocs, readAttachment } from "../ui/attach.js";
import { chunk, cosine, excerptOf, keywordScores, retrieve } from "../ui/rag.js";
import { path } from "../ui/threads.js";
import { type NodeBridge, nodeBridge } from "./node-bridge.js";

let fake: Awaited<ReturnType<typeof startFakeLlm>>;
let bridge: NodeBridge;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const longDoc = () =>
  Array.from({ length: 60 }, (_, i) =>
    i === 41
      ? "The context length decides how much of a conversation the model can see at once; a longer context needs more memory for its cache."
      : `Section ${i}. ${"Local models keep every word on this computer, and quantized files trade a little quality for size. ".repeat(4)}`,
  ).join("\n\n");

beforeAll(async () => {
  fake = await startFakeLlm({ tokenMs: 0 });
  bridge = nodeBridge({ remap: new Map([[11434, fake.ollamaPort]]) });
  mkdirSync(join(bridge.root, "docs"), { recursive: true });
  writeFileSync(join(bridge.root, "docs/notes.md"), "# Notes\n\nLocal models stay here.\n");
  writeFileSync(join(bridge.root, "docs/guide.md"), longDoc());
  writeFileSync(
    join(bridge.root, "docs/page.html"),
    "<html><style>x{}</style><p>Hello <b>there</b></p><script>bad()</script></html>",
  );
  writeFileSync(join(bridge.root, "docs/shot.png"), PNG);
  writeFileSync(join(bridge.root, "docs/blob.bin"), Buffer.from([0, 159, 146, 150, 0, 1, 2]));
});
afterAll(async () => {
  bridge.close();
  await fake.close();
});

describe("reading attachments", () => {
  it("reads images as images and text files as documents", async () => {
    const img = await readAttachment(bridge, "~/docs/shot.png");
    expect(img).toMatchObject({
      kind: "image",
      image: { name: "shot.png", type: "image/png", data: PNG.toString("base64") },
    });
    const doc = await readAttachment(bridge, "~/docs/notes.md");
    expect(doc).toMatchObject({ kind: "doc", doc: { name: "notes.md", chars: 33 } });
    const page = await readAttachment(bridge, "~/docs/page.html");
    expect(page.kind === "doc" && page.doc.text).toBe("Hello there");
    await expect(readAttachment(bridge, "~/docs/blob.bin")).rejects.toThrow(/not text/);
  });

  it("sends a short file whole, fenced by its name", () => {
    expect(inlineDocs([docOf("a.txt", "hi")])).toBe('<file name="a.txt">\nhi\n</file>');
    expect(htmlText("<p>a&amp;b</p><p>c</p>")).toBe("a&b\nc");
  });
});

describe("searching documents", () => {
  it("cuts text into overlapping passages on paragraph ends", () => {
    const parts = chunk(longDoc());
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.every((p) => p.length <= 1200)).toBe(true);
    expect(parts[1]).toContain(parts[0]!.slice(-40).trim());
  });

  it("ranks by words without an embedding model, and by vectors with one", async () => {
    const texts = ["the cat sat", "context length and memory", "nothing here"];
    const scores = keywordScores(texts, "how long is the context length?");
    expect(scores.indexOf(Math.max(...scores))).toBe(1);
    expect(excerptOf("## Size\n\nPick **Q4_K_M** for most.", "which size")).toBe(
      "Size Pick Q4_K_M for most.",
    );
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);

    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const doc = docOf("guide.md", longDoc());
    const found = await retrieve(app, [doc], "What does the context length decide?");
    expect(found).toMatchObject({ method: "vectors", model: "Nomic Embed Text" });
    expect(found.passages[0]!.text).toContain("context length decides");
    const embeds = fake.requests.filter((r) => r.path === "/api/embed").length;
    await retrieve(app, [doc], "And the memory?");
    expect(fake.requests.filter((r) => r.path === "/api/embed").length).toBe(embeds + 1);
    expect(readdirSync(join(bridge.root, ".endue/local-models/rag"))).toHaveLength(1);
  });

  it("sends a long file's closest passages with the question and keeps them as sources", async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    app.choose("127.0.0.1:11434|llama3.2:3b");
    const guide = await readAttachment(bridge, "~/docs/guide.md");
    if (guide.kind !== "doc") throw new Error("not a doc");
    await app.send("What does the context length decide?", { docs: [guide.doc] });
    const thread = app.S.get().thread;
    if (!thread) throw new Error("no thread");
    const [question, answer] = path(thread);
    expect(question!.files).toEqual([
      { name: "guide.md", path: "~/docs/guide.md", chars: guide.doc.chars },
    ]);
    expect(question!.sources?.[0]?.excerpt).toContain("context length decides");
    expect(question!.searched).toBe("Nomic Embed Text");
    const sent = fake.requests
      .filter((r) => r.path === "/api/chat")
      .at(-1)
      ?.body.messages.at(-1).content;
    expect(sent).toMatch(/^Passages from the files attached/);
    expect(sent).toMatch(/What does the context length decide\?$/);
    expect(answer!.content).toContain("[1]");
    await app.send("And how much memory?");
    const again = path(thread).at(-2);
    expect(again?.sources?.length).toBeGreaterThan(0);
    expect(again?.files).toBeUndefined();
  });

  it("sends a short file whole with the first question only", async () => {
    const app = createApp(bridge, { storeDelayMs: 5, autoTitle: false });
    await app.start();
    const notes = await readAttachment(bridge, "~/docs/notes.md");
    if (notes.kind !== "doc") throw new Error("not a doc");
    await app.send("", { docs: [notes.doc] });
    const thread = app.S.get().thread;
    expect(path(thread as NonNullable<typeof thread>)[0]).toMatchObject({
      content: "Summarize the attached files.",
      context: '<file name="notes.md">\n# Notes\n\nLocal models stay here.\n\n</file>',
    });
    expect(thread?.title).toBe("notes.md");
  });
});
