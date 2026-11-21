// What Eris reads and moves through the explorer (ADR 0088): its folders, a folder's entries, files
// found by name, a file's text and a move or copy into a folder, each by path with data back, and the
// person's commands that now take a path instead of the selection.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { stubFileTree } from "../../../packages/runtime/src/bridge/fs";
import { DOCS, type Handlers, mount } from "./harness";

const WORK = `${DOCS}/Work`;

async function explorer(handlers: Handlers = {}) {
  const commands = { "endue.terminal.new": () => ({ opened: true }) };
  const files = stubFileTree({
    files: {
      [`${DOCS}/a2.md`]: "# a2\n",
      [`${DOCS}/b.txt`]: "bi",
      [`${DOCS}/.env`]: "x",
      [`${WORK}/c.md`]: "c",
      [`${WORK}/deep/notes-c.md`]: "deep",
      [`${DOCS}/pic.bin`]: "a\u0000b",
    },
    folders: [`${WORK}/deep`],
  });
  const store: Record<string, unknown> = { tree: { expanded: [DOCS], selected: null } };
  const all = { ...(files.handlers as Handlers), ...handlers };
  const mounted = await mount({ handlers: all, store, commands });
  return { ...mounted, tree: files.tree };
}

describe("an agent's explorer commands", () => {
  it("answers the explorer's folders, and a folder's entries folders first without dotfiles", async () => {
    const { host } = await explorer();
    await expect(host.command("endue.explorer.folders")).resolves.toEqual({
      folders: [DOCS],
      showHidden: false,
      selected: null,
      marked: [],
    });
    const listed = (await host.command("endue.explorer.list", { path: DOCS })) as {
      entries: Array<{ name: string; path: string; kind: string }>;
      total: number;
      more: boolean;
    };
    expect(listed.entries.map((e) => [e.name, e.kind])).toEqual([
      ["Work", "dir"],
      ["a2.md", "file"],
      ["b.txt", "file"],
      ["pic.bin", "file"],
    ]);
    expect(listed.entries[1]?.path).toBe(`${DOCS}/a2.md`);
    expect([listed.total, listed.more]).toEqual([4, false]);
    const some = (await host.command("endue.explorer.list", { hidden: true, limit: 2 })) as {
      entries: unknown[];
      total: number;
      more: boolean;
    };
    expect([some.entries.length, some.total, some.more]).toEqual([2, 5, true]);
  });

  it("finds files by name below a folder, and refuses an empty query", async () => {
    const { host } = await explorer();
    const found = (await host.command("endue.explorer.search", { query: "C.MD" })) as {
      results: Array<{ path: string }>;
      stopped: unknown;
    };
    expect(found.results.map((r) => r.path)).toEqual([`${WORK}/c.md`, `${WORK}/deep/notes-c.md`]);
    expect(found.stopped).toBeNull();
    await expect(host.command("endue.explorer.search", { query: " " })).rejects.toThrow(/empty/);
  });

  it("reads a file's text, says when it is cut or binary, and refuses a relative path", async () => {
    const { host } = await explorer();
    await expect(host.command("endue.explorer.read", { path: `${DOCS}/a2.md` })).resolves.toEqual({
      path: `${DOCS}/a2.md`,
      size: 5,
      binary: false,
      text: "# a2\n",
      truncated: false,
    });
    const cut = await host.command("endue.explorer.read", { path: `${DOCS}/a2.md`, maxBytes: 2 });
    expect(cut).toMatchObject({ text: "# ", truncated: true, size: 5 });
    const binary = await host.command("endue.explorer.read", { path: `${DOCS}/pic.bin` });
    expect(binary).toMatchObject({ binary: true, text: null });
    await expect(host.command("endue.explorer.read", { path: "a2.md" })).rejects.toThrow(
      /absolute path/,
    );
    await expect(host.command("endue.explorer.read", { path: `${DOCS}/../x` })).rejects.toThrow(
      /absolute path/,
    );
  });

  it("moves and copies files into a folder by path, as one drop", async () => {
    const { host, tree, params } = await explorer();
    const moved = await host.command("endue.explorer.move", {
      paths: [`${DOCS}/a2.md`],
      folder: WORK,
    });
    expect(moved).toEqual({ done: true, effect: "move", folder: WORK, from: [`${DOCS}/a2.md`] });
    expect(tree.read(`${WORK}/a2.md`)).toBe("# a2\n");
    expect(tree.read(`${DOCS}/a2.md`)).toBeUndefined();
    const copied = await host.command("endue.explorer.move", {
      paths: [`${DOCS}/b.txt`],
      folder: WORK,
      copy: true,
    });
    expect(copied).toMatchObject({ done: true, effect: "copy" });
    expect([tree.read(`${WORK}/b.txt`), tree.read(`${DOCS}/b.txt`)]).toEqual(["bi", "bi"]);
    expect(params("fs.copy")).toHaveLength(1);
  });

  it("opens, and opens a terminal at, a path it names rather than the selection", async () => {
    const { host, ran } = await explorer();
    await host.command("endue.explorer.open-selected", { path: `${WORK}/c.md` });
    expect(ran("desk.files.open")).toEqual([{ path: `${WORK}/c.md` }]);
    await host.command("endue.explorer.terminal-here", { path: `${WORK}/c.md` });
    expect(ran("endue.terminal.new")).toEqual([{ cwd: WORK }]);
    await expect(
      host.command("endue.explorer.open-selected", { path: "/elsewhere/x.md" }),
    ).rejects.toThrow(/outside/);
  });
});

describe("the manifest offers them to agents", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
  ) as PluginManifest;
  const commands = manifest.contributes?.commands ?? [];
  const byId = (id: string) => commands.find((c) => c.id === `endue.explorer.${id}`);

  it("marks the data commands read-only and every agent command described", () => {
    for (const id of ["folders", "list", "search", "read"])
      expect(byId(id), id).toMatchObject({ agent: true, readOnly: true });
    expect(byId("move")).toMatchObject({ agent: true });
    expect(byId("move")?.readOnly).toBeUndefined();
    // The explorer asks the person before every trash itself (edits.js), which no agent answers.
    expect(byId("trash")).toMatchObject({ agent: true });
    for (const c of commands.filter((c) => c.agent)) {
      expect(c.description, c.id).toBeTruthy();
      expect(c.args, c.id).toMatchObject({ type: "object", additionalProperties: false });
    }
  });
});
