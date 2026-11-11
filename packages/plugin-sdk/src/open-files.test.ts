// keepFiles (ADR 0070, ADR XXXX): what a file opener keeps when the desk puts its window to sleep,
// fitted into the 64 KiB the desk keeps, and how it reads it back once it shows again.
import { describe, expect, it } from "vitest";
import { defineUiPlugin, type PluginContext } from "./index";
import { fitFiles, type KeptState, keepFiles, type OpenFile } from "./open-files";
import { STATE_LIMIT } from "./surface-state";
import { createTestHost } from "./testing/index";

const file = (name: string, more: Partial<OpenFile> = {}): OpenFile => ({
  buffer: `file:~/Notes/${name}`,
  path: `~/Notes/${name}`,
  ...more,
});
const size = (state: unknown) => new TextEncoder().encode(JSON.stringify(state)).length;
const big = (n: number) => "x".repeat(n);

describe("fitFiles", () => {
  it("keeps every file with its place and its best edit when they fit", () => {
    const state = fitFiles(
      [file("a.md", { place: { caret: 4 } }), file("b.md", { edits: [{ text: "b2" }, "small"] })],
      "file:~/Notes/b.md",
    );
    expect(state).toEqual({
      v: 1,
      files: [
        { buffer: "file:~/Notes/a.md", path: "~/Notes/a.md", place: { caret: 4 } },
        { buffer: "file:~/Notes/b.md", path: "~/Notes/b.md", edit: { text: "b2" } },
      ],
      shown: "file:~/Notes/b.md",
    });
  });

  it("takes the smaller form of an edit that does not fit, from the file used longest ago first", () => {
    const files = [
      file("old.md", { edits: [{ text: big(40_000) }, { change: "old" }] }),
      file("new.md", { edits: [{ text: big(40_000) }, { change: "new" }] }),
    ];
    const state = fitFiles(files, null);
    expect(state.files.map((f) => f.edit)).toEqual([{ change: "old" }, { text: big(40_000) }]);
    expect(size(state)).toBeLessThanOrEqual(STATE_LIMIT);
  });

  it("keeps the file on screen longest, then the most recent ones", () => {
    const files = [
      file("shown.md", { edits: [{ text: big(30_000) }] }),
      file("old.md", { edits: [{ text: big(30_000) }] }),
      file("new.md", { edits: [{ text: big(30_000) }] }),
    ];
    const state = fitFiles(files, "file:~/Notes/shown.md");
    const byName = Object.fromEntries(state.files.map((f) => [f.path, f]));
    expect(byName["~/Notes/shown.md"]).toHaveProperty("edit");
    expect(byName["~/Notes/new.md"]).toHaveProperty("edit");
    // The edit that no longer fits is said to be lost; the file itself is kept.
    expect(byName["~/Notes/old.md"]).toEqual({
      buffer: "file:~/Notes/old.md",
      path: "~/Notes/old.md",
      lost: true,
    });
    expect(size(state)).toBeLessThanOrEqual(STATE_LIMIT);
  });

  it("gives up places, then files, but never the one on screen", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      file(`${i}.md`, { place: { pad: big(2_000) } }),
    );
    const placed = fitFiles(many, "file:~/Notes/0.md");
    expect(placed.files).toHaveLength(40);
    expect(placed.files.filter((f) => f.place).length).toBeLessThan(40);
    // The place of the file on screen goes last.
    expect(placed.files[0]).toHaveProperty("place");

    const paths = Array.from({ length: 300 }, (_, i) => file(`${big(300)}-${i}.md`));
    const fewer = fitFiles(paths, "file:~/Notes/x.md", STATE_LIMIT);
    expect(fewer.files.length).toBeLessThan(300);
    expect(fewer.files.at(-1)?.path).toContain("-299.md");
    expect(size(fewer)).toBeLessThanOrEqual(STATE_LIMIT);
  });

  it("names the file on screen only when it is kept", () => {
    expect(fitFiles([file("a.md")], "file:~/Notes/gone.md").shown).toBeNull();
  });
});

/** A plugin on the test host that keeps `open()` with keepFiles, and the handle it got. */
async function opener(open: () => OpenFile[], shown: () => string | null, restored?: unknown) {
  const host = createTestHost({
    pluginId: "example.files",
    ...(restored === undefined ? {} : { restored }),
  });
  let kept: ReturnType<typeof keepFiles> | undefined;
  await defineUiPlugin(
    {
      mount(ctx: PluginContext) {
        kept = keepFiles(ctx.surface, { files: open, shown });
      },
    },
    host.transport,
  );
  if (!kept) throw new Error("did not mount");
  return { host, kept };
}

describe("keepFiles", () => {
  it("answers ui.surface.state with the files open, and a cold start keeps none", async () => {
    const open = [file("a.md", { place: { page: 7 } })];
    const { host, kept } = await opener(
      () => open,
      () => open[0]?.buffer ?? null,
    );
    expect(kept.shown).toBeNull();
    expect(kept.files()).toEqual([]);
    const { state } = (await host.surfaceState()) as { state: KeptState };
    expect(state).toEqual({ v: 1, files: [{ ...open[0] }], shown: "file:~/Notes/a.md" });
  });

  it("reads the kept files back and hands each one out once", async () => {
    const before = {
      v: 1,
      files: [
        { buffer: "file:~/Notes/a.md", path: "~/Notes/a.md", place: { page: 7 } },
        { buffer: "file:~/Notes/b.md", path: "~/Notes/b.md", edit: { text: "b2" } },
      ],
      shown: "file:~/Notes/b.md",
    };
    const { kept } = await opener(
      () => [],
      () => null,
      before,
    );
    expect(kept.shown).toBe("file:~/Notes/b.md");
    expect(kept.files().map((f) => f.path)).toEqual(["~/Notes/a.md", "~/Notes/b.md"]);
    expect(kept.take("file:~/Notes/b.md")).toEqual(before.files[1]);
    expect(kept.take("file:~/Notes/b.md")).toBeUndefined();
    expect(kept.files().map((f) => f.path)).toEqual(["~/Notes/a.md"]);
  });

  it("still keeps the files it has not opened again when it sleeps once more", async () => {
    const before = {
      v: 1,
      files: [
        { buffer: "file:~/Notes/a.md", path: "~/Notes/a.md", edit: { text: "a2" } },
        { buffer: "file:~/Notes/b.md", path: "~/Notes/b.md", lost: true },
      ],
      shown: "file:~/Notes/a.md",
    };
    const open: OpenFile[] = [];
    const { host } = await opener(
      () => open,
      () => null,
      before,
    );
    open.push(file("c.md"));
    const { state } = (await host.surfaceState()) as { state: KeptState };
    expect(state.files).toEqual([...before.files, { ...open[0] }]);
    // The file on screen before is still the one to show: it has not been opened again yet.
    expect(state.shown).toBe("file:~/Notes/a.md");
  });

  it("drops what does not read back, and says an edit that did not is lost", async () => {
    const host = createTestHost({
      pluginId: "example.files",
      restored: {
        v: 1,
        files: [
          { buffer: "file:~/a.md", path: "~/a.md", place: { page: -1 }, edit: { text: 3 } },
          { buffer: "", path: "~/nobuffer.md" },
          { buffer: "file:~/a.md", path: "~/again.md" },
        ],
        shown: "file:~/missing.md",
      },
    });
    let kept: ReturnType<typeof keepFiles> | undefined;
    await defineUiPlugin(
      {
        mount(ctx) {
          kept = keepFiles(ctx.surface, {
            files: () => [],
            shown: () => null,
            readPlace: (v) => (((v as { page?: number }).page ?? -1) >= 0 ? v : undefined),
            readEdit: (v) => (typeof (v as { text?: unknown }).text === "string" ? v : undefined),
          });
        },
      },
      host.transport,
    );
    expect(kept?.files()).toEqual([{ buffer: "file:~/a.md", path: "~/a.md", lost: true }]);
    expect(kept?.shown).toBeNull();
  });

  it("reads nothing from another version's state", async () => {
    for (const restored of ["text", { files: [] }, { v: 2, files: [], shown: null }]) {
      const { kept } = await opener(
        () => [],
        () => null,
        restored,
      );
      expect(kept.files()).toEqual([]);
    }
  });

  it("never answers with more than 64 KiB, however much is unsaved", async () => {
    const open = [
      file("long.md", { edits: [{ text: big(114_000) }, { change: "typed" }] }),
      file("small.md", { edits: [{ text: "small, edited" }] }),
    ];
    const { host } = await opener(
      () => open,
      () => open[0]?.buffer ?? null,
    );
    const { state } = (await host.surfaceState()) as { state: KeptState };
    expect(state.files.map((f) => f.edit)).toEqual([
      { change: "typed" },
      { text: "small, edited" },
    ]);
  });
});
