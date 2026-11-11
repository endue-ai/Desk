// A file no rule names opens in the desk's fallbacks, and one file is one buffer (#162 findings 10
// and 12): a name without an extension as text first, then desk.files.fallback, which shows the
// file's details when it cannot show the file; every spelling of a path names the same buffer.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { installFiles } from "./files";
import { onePath } from "./files-open";

const NOTES = "test.notes";
const DATA = "test.data";
const SHEETS = "test.sheets";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a bridge path root, not a placeholder
const HOME = "${home}";

const ui = (id: string, pattern: string): PluginManifest => ({
  id,
  kind: "ui",
  version: "0.1.0",
  entry: "ui/index.html",
  contributes: { files: [{ pattern, plugin: id }] },
});

interface Options {
  fallback?: string;
  /** The files the text opener cannot read as text. */
  binary?: string[];
  /** The core's name for a path: links followed, the home folder as `~`. */
  realPath?: (path: string) => Promise<string>;
}

async function desk({ fallback = DATA, binary = [], realPath }: Options = {}) {
  const manifests: PluginManifest[] = [
    { id: "desk.files", kind: "policy", version: "0.1.0" },
    { id: "desk.buffers", kind: "policy", version: "0.1.0" },
    ui(NOTES, "*.txt"),
    ui(DATA, "*.json"),
    ui(SHEETS, "*.csv"),
  ];
  const core = browserCore({ manifests });
  const hub = new PolicyHub(core.client);
  const visits: string[] = [];
  const request = vi.fn(async (plugin: string, command: string, args?: { path?: string }) => {
    if (command !== "desk.files.visit") return null;
    visits.push(`${plugin} ${args?.path}`);
    if (plugin === NOTES && binary.includes(args?.path ?? ""))
      throw new Error(`${args?.path} is not UTF-8 text`);
    return null;
  });
  const ctx = {
    hub,
    bridge: core.client,
    surfaces: { show: vi.fn() },
    request,
    mounted: () => true,
    launch: async () => {},
    whenReady: async () => {},
    unmount: vi.fn(),
  } as unknown as DeskContext;
  const buffers = installBuffers(ctx, { focus: vi.fn() });
  const notify = vi.fn();
  installFiles(ctx, buffers, notify, undefined, undefined, realPath);
  hub.apply(core.plugins);
  await hub.commands.settled();
  hub.settings.set("desk.files.fallback", fallback);
  const open = (path: string) => hub.commands.run("desk.files.open", { path });
  const files = () => buffers.buffers.list().map((b) => `${b.id} ${b.plugin}`);
  return { open, visits, notify, files };
}

describe("a file no plugin's rule names", () => {
  it("opens in desk.files.fallback, which shows its details, and answers its buffer", async () => {
    const d = await desk();
    await expect(d.open("~/files/blob.bin")).resolves.toBe("file:~/files/blob.bin");
    expect(d.visits).toEqual([`${DATA} ~/files/blob.bin`]);
    expect(d.files()).toEqual([`file:~/files/blob.bin ${DATA}`]);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("opens as text first when its name has no extension: README, Makefile, .zshrc", async () => {
    const d = await desk();
    for (const name of ["README", "Makefile", ".zshrc"])
      await expect(d.open(`~/src/${name}`)).resolves.toBe(`file:~/src/${name}`);
    expect(d.visits).toEqual([
      `${NOTES} ~/src/README`,
      `${NOTES} ~/src/Makefile`,
      `${NOTES} ~/src/.zshrc`,
    ]);
  });

  it("opens in the fallback when the text opener cannot read it, and says nothing of that try", async () => {
    const d = await desk({ binary: ["~/bin/tool"] });
    await expect(d.open("~/bin/tool")).resolves.toBe("file:~/bin/tool");
    expect(d.visits).toEqual([`${NOTES} ~/bin/tool`, `${DATA} ~/bin/tool`]);
    expect(d.files()).toEqual([`file:~/bin/tool ${DATA}`]);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("is refused with a warning when the fallback is off or not installed", async () => {
    for (const fallback of ["", "example.missing"]) {
      const d = await desk({ fallback });
      await expect(d.open("~/files/blob.bin")).rejects.toThrow("no plugin opens ~/files/blob.bin");
      expect(d.notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No plugin opens blob.bin", level: "warning" }),
      );
      expect(d.files()).toEqual([]);
    }
  });

  it("keeps its rule's opener when a rule names it", async () => {
    const d = await desk();
    await d.open("~/files/small.csv");
    expect(d.visits).toEqual([`${SHEETS} ~/files/small.csv`]);
  });
});

describe("one file is one buffer, however its path is spelled", () => {
  it("names the buffer from the path in one spelling", async () => {
    const d = await desk();
    for (const path of [
      "~/files/small.csv",
      `${HOME}/files/small.csv`,
      "~/files//./sub/../small.csv",
      "~/files/small.csv/",
    ])
      await expect(d.open(path)).resolves.toBe("file:~/files/small.csv");
    expect(d.visits).toEqual([`${SHEETS} ~/files/small.csv`]);
    expect(d.files()).toEqual([`file:~/files/small.csv ${SHEETS}`]);
  });

  it("names it as the core does, links followed and the home folder as ~", async () => {
    const real = new Map([
      ["/tmp/dq/files/small.csv", "~/files/small.csv"],
      ["/private/tmp/dq/files/small.csv", "~/files/small.csv"],
    ]);
    const realPath = vi.fn(async (path: string) => real.get(path) ?? path);
    const d = await desk({ realPath });
    for (const path of [
      "~/files/small.csv",
      "/tmp/dq/files/small.csv",
      "/private/tmp/dq/files/small.csv",
    ])
      await expect(d.open(path)).resolves.toBe("file:~/files/small.csv");
    expect(d.files()).toEqual([`file:~/files/small.csv ${SHEETS}`]);
    expect(realPath).toHaveBeenCalledWith("/private/tmp/dq/files/small.csv");
  });

  it("opens the path as given when the core cannot name it", async () => {
    const d = await desk({ realPath: async () => Promise.reject(new Error("no such file")) });
    await expect(d.open("~/files/./gone.csv")).resolves.toBe("file:~/files/gone.csv");
  });
});

describe("onePath", () => {
  it("leaves a path without a root, or one that leaves its root, as it was", () => {
    expect(onePath("files/a.md")).toBe("files/a.md");
    expect(onePath("~/../a.md")).toBe("~/../a.md");
    expect(onePath("/")).toBe("/");
    expect(onePath("C:/Users/me/./a.md")).toBe("C:/Users/me/a.md");
    expect(onePath(HOME)).toBe("~");
  });
});
