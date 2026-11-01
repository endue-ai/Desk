// RAR 4 and RAR 5 through endue.formats (#182): the archives RARLAB's rar made for the library's
// tests (plugins/formats/tests/rar/make-fixtures.sh) list, preview and extract to the byte, in the
// frame and in the library worker; a solid archive extracts in one pass; encrypted entries and
// archives refuse with the library's sentence; a RAR inside a ZIP opens one level down.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { openLevel } from "../ui/opening.js";
import { memorySource } from "../ui/source.js";
import { entry, expected, files, fixture, open, read, sha256, TREE, zipOf } from "./fixtures";
import { file, type MountOptions, mount, READ, type RecordingView, rowNames } from "./harness";
import { localWorkers } from "./local-worker";

const dir = join(import.meta.dirname, "../../formats/tests/rar/fixtures");
const rar = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const ORIGINALS = JSON.parse(readFileSync(join(dir, "originals.json"), "utf8")) as Record<
  string,
  { size: number; sha256: string }
>;
/** The files of the tree the method-level archives hold (link.txt is a link, empty-folder a folder). */
const TREE_FILES = [
  "data.bin",
  "docs/notes/readme.md",
  "empty.txt",
  "text.txt",
  "unicode/Ünïcödé.txt",
  "unicode/日本語.txt",
  "unicode/한국어 이름.txt",
];
const TARGET = "~/Downloads/out";

/** The plugin with `bytes` open at ~/Downloads/<name>; extraction writes into `written`. */
async function visit(
  bytes: Uint8Array,
  name: string,
  options: Partial<MountOptions<RecordingView>> = {},
) {
  const path = `~/Downloads/${name}`;
  const written: Record<string, Uint8Array> = {};
  const mounted = await mount({
    files: { [path]: bytes },
    grants: [READ("~/Downloads")],
    handlers: {
      "fs.write": ({ path, content }) => {
        written[path] = new Uint8Array(Buffer.from(content, "base64"));
        return { bytesWritten: content.length };
      },
      "fs.list": () => {
        throw new StubError("not_found", "nothing is there yet");
      },
    },
    commands: { "desk.palette.pick": () => TARGET },
    ...options,
  });
  await mounted.host.command("desk.files.visit", file(path));
  return { ...mounted, written };
}

/** Each written file's SHA-256 by its path in the archive. */
const hashes = (written: Record<string, Uint8Array>) =>
  Object.fromEntries(
    Object.entries(written).map(([path, bytes]) => [path.slice(TARGET.length + 1), sha256(bytes)]),
  );
const originals = (paths: string[]) =>
  Object.fromEntries(paths.map((path) => [path, ORIGINALS[path]?.sha256]));

describe("RAR 5 and RAR 4, compressed", () => {
  for (const [name, format] of [
    ["rar5-m3.rar", "RAR 5"],
    ["rar4-m3.rar", "RAR 4"],
  ] as const) {
    it(`${format}: lists the tree, previews text and extracts every file to the byte`, async () => {
      const archive = await open(rar(name), name);
      expect(archive.format).toBe(format);
      expect(archive.refusal).toBeUndefined();
      expect(files(archive)).toEqual(expect.arrayContaining([...TREE_FILES, "link.txt"]));
      expect(entry(archive, "text.txt")).toMatchObject({ size: 98304, method: "Normal" });
      expect(entry(archive, "link.txt")).toMatchObject({ kind: "link" });

      const { app, view, written, settle } = await visit(rar(name), name);
      await app.select("text.txt");
      await settle();
      expect(view.previews.at(-1)).toMatchObject({ kind: "text", name: "text.txt" });
      await app.extract("all");
      expect(hashes(written)).toEqual(originals(TREE_FILES));
      expect(view.statuses.at(-1)).toMatch(/^Extracted 7 files \(.*\) to ~\/Downloads\/out\./);
      expect(view.statuses.at(-1)).toContain("Links are not created: link.txt.");
    });
  }

  it("the plugin's own RAR fixtures: stored entries and a compressed one", async () => {
    const five = await open(fixture("rar5.rar"), "rar5.rar");
    expect(entry(five, "hello.txt")).toMatchObject({ size: 17, method: "Stored" });
    expect(await read(five, "docs/readme.md")).toBe(TREE.readme);
    expect(sha256(await five.read(entry(five, "words.txt")))).toBe(expected.words.sha256);
    const four = await open(fixture("rar4.rar"), "rar4.rar");
    expect(four.format).toBe("RAR 4");
    expect(await read(four, "hello.txt")).toBe(TREE.hello);
  });
});

describe("solid archives", () => {
  for (const [name, paths] of [
    [
      "rar5-solid.rar",
      [
        "chapters/one.txt",
        "chapters/two.txt",
        "chapters/three.txt",
        "text.txt",
        "data.bin",
        "tool.exe",
      ],
    ],
    [
      "rar4-solid.rar",
      ["chapters/one.txt", "chapters/two.txt", "chapters/three.txt", "text.txt", "data.bin"],
    ],
  ] as const) {
    it(`${name} extracts in one pass in the library worker`, async () => {
      const startWorker = localWorkers();
      const { app, view, written } = await visit(rar(name), name, { startWorker });
      expect(startWorker.urls[0]?.href).toMatch(/\/ui\/library-worker\.js$/);
      expect(view.archives.at(-1)?.details).toContainEqual({ label: "Solid", value: "Yes" });
      const worker = startWorker.workers[0];
      const before = worker?.asked.length ?? 0;
      await app.extract("all");
      expect(hashes(written)).toEqual(originals([...paths]));
      // One "each" for the whole run; no entry was decoded on its own.
      expect(worker?.asked.slice(before)).toEqual(["each"]);
    });
  }

  it("a decode in the worker stops when its signal fires, and the next read works", async () => {
    const startWorker = localWorkers();
    const level = await openLevel(memorySource(rar("rar5-solid.rar")), "solid.rar", {
      startWorker,
    });
    const archive = level.archive;
    if (!archive) throw new Error(level.note);
    const last = entry(archive, "tool.exe");
    const stop = new AbortController();
    const reading = archive.read(last, Number.POSITIVE_INFINITY, { signal: stop.signal });
    stop.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(startWorker.workers[0]?.asked).toContain("cancel");
    expect(sha256(await archive.read(last))).toBe(ORIGINALS["tool.exe"]?.sha256);
    archive.close?.();
    expect(startWorker.workers[0]?.terminated).toBe(true);
  });

  it("a worker that cannot load endue.formats leaves the RAR to the frame", async () => {
    const startWorker = localWorkers(() => Promise.reject(new Error("404")));
    const { app, written } = await visit(rar("rar5-m1.rar"), "m1.rar", { startWorker });
    expect(startWorker.workers[0]?.terminated).toBe(true);
    await app.extract("all");
    expect(hashes(written)).toEqual(originals(TREE_FILES));
  });
});

describe("refusals", () => {
  for (const name of ["rar5-encrypted.rar", "rar4-encrypted.rar"]) {
    it(`${name}: encrypted entries are listed, previewed and extracted as refusals`, async () => {
      const archive = await open(rar(name), name);
      expect(entry(archive, "text.txt")).toMatchObject({
        encrypted: true,
        refusal: "Encrypted: not extracted.",
      });
      const { app, view, written, settle } = await visit(rar(name), name);
      await app.select("text.txt");
      await settle();
      expect(view.previews.at(-1)).toMatchObject({
        kind: "message",
        text: "Encrypted: not extracted.",
      });
      await app.extract("all");
      expect(written).toEqual({});
      expect(view.statuses.at(-1)).toContain("Encrypted, not extracted: ");
      expect(view.statuses.at(-1)).toContain("text.txt");
    });
  }

  it("encrypted headers: the details and the library's sentence, nothing to extract", async () => {
    const { app, view, written } = await visit(rar("rar5-locked.rar"), "locked.rar");
    expect(view.archives.at(-1)).toMatchObject({
      format: "RAR 5",
      note: "The RAR's headers are encrypted, so its names cannot be listed.",
      rows: [],
    });
    await app.extract("all");
    expect(written).toEqual({});
  });

  it("a volume of a split archive refuses its split entry", async () => {
    const archive = await open(rar("rar5-split.part1.rar"), "split.part1.rar");
    expect(entry(archive, "data.bin").refusal).toBe("Split across volumes: not extracted.");
  });
});

describe("a RAR inside another archive", () => {
  it("opens one level down and extracts from there", async () => {
    const outer = zipOf([
      { name: "inner.rar", data: rar("rar5-m1.rar") },
      { name: "top.txt", data: "top\n" },
    ]);
    const { app, view, written, settle } = await visit(outer, "outer.zip");
    await app.open("inner.rar");
    await settle();
    expect(view.archives.at(-1)).toMatchObject({
      levels: ["outer.zip", "inner.rar"],
      format: "RAR 5",
    });
    expect(rowNames(view)).toEqual(expect.arrayContaining(["docs", "unicode", "text.txt"]));
    await app.select("data.bin");
    await app.extract("selected");
    expect(hashes(written)).toEqual(originals(["data.bin"]));
  });
});
