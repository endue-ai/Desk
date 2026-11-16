// Finding files by name (#313): a filter narrows the current folder as the person types, and "search
// below" walks its sub-folders by name, with a limit and a way to stop, listing each result with its
// folder; Enter opens one, and reveal shows it in its folder.
import { describe, expect, it, vi } from "vitest";
import { narrow, searchBelow } from "../ui/find.js";
import { rows } from "../ui/tree.js";
import { DOCS, dir, disk, file, mount, sample, type Tree } from "./harness";

const WORK = `${DOCS}/Work`;
const lister = (tree: Tree) => async (path: string) => {
  const entries = tree[path];
  if (!entries) throw new Error(`no folder ${path}`);
  return entries;
};

describe("the filter", () => {
  it("keeps the folder's children whose name holds the letters, any case, and what is outside it", () => {
    const tree = sample();
    const folders = new Map(Object.entries(tree).map(([path, entries]) => [path, { entries }]));
    const list = rows([DOCS], folders, new Set([DOCS, WORK]), { showHidden: false, page: 500 });
    const names = (query: string, folder = DOCS) => narrow(list, folder, query).map((r) => r.name);
    expect(names("A")).toEqual(["Documents", "a2.md", "a10.md"]);
    // A folder that matches keeps what is open under it.
    expect(names("wor")).toEqual(["Documents", "Work", "deep", "c.md"]);
    expect(names("c", WORK)).toEqual(["Documents", "Work", "c.md", "a2.md", "a10.md", "b.txt", "zed"]);
    expect(names("")).toHaveLength(list.length);
  });
});

describe("search below", () => {
  const deep = (): Tree => ({
    ...sample(),
    [`${DOCS}/Work/deep`]: [file("x.md"), file("notes-x.txt"), dir("more")],
    [`${DOCS}/Work/deep/more`]: [file("X-ray.png")],
  });

  it("walks the sub-folders by name, breadth first, and gives each result its folder", async () => {
    const found = await searchBelow(lister(deep()), DOCS, "x", { showHidden: false });
    expect(found.results.map((r) => [r.name, r.folder])).toEqual([
      ["b.txt", DOCS],
      ["notes-x.txt", `${DOCS}/Work/deep`],
      ["x.md", `${DOCS}/Work/deep`],
      ["X-ray.png", `${DOCS}/Work/deep/more`],
    ]);
    expect(found.stopped).toBeUndefined();
    // Dotfolders are walked only when dotfiles show.
    const hidden = await searchBelow(lister(deep()), DOCS, "head", { showHidden: true });
    expect(hidden.results.map((r) => r.path)).toEqual([`${DOCS}/.git/HEAD`]);
  });

  it("stops at its limit of results or of folders listed, and when cancelled", async () => {
    const tree = deep();
    const one = await searchBelow(lister(tree), DOCS, "x", { showHidden: false, limit: 1 });
    expect(one.results).toHaveLength(1);
    expect(one.stopped).toBe("limit");
    const few = await searchBelow(lister(tree), DOCS, "x", { showHidden: false, folders: 2 });
    expect(few.results.map((r) => r.name)).toEqual(["b.txt"]);
    expect(few.stopped).toBe("folders");
    const stop = new AbortController();
    const walking = searchBelow(
      async (path) => {
        stop.abort();
        return lister(tree)(path);
      },
      DOCS,
      "x",
      { showHidden: false, signal: stop.signal },
    );
    expect((await walking).stopped).toBe("cancelled");
  });

  it("a folder it may not list is passed over", async () => {
    const tree = deep();
    delete tree[WORK];
    const found = await searchBelow(lister(tree), DOCS, "a", { showHidden: false });
    expect(found.results.map((r) => r.name)).toEqual(["a2.md", "a10.md"]);
  });
});

describe("finding in the explorer", () => {
  it("find narrows the selected folder; clearing it shows every row again", async () => {
    const { host, view } = await mount({ handlers: disk(sample()) });
    await host.command("endue.explorer.find", { query: "a" });
    expect(view.shown()).toEqual(["0:dir:Documents+", "1:file:a2.md", "1:file:a10.md"]);
    await host.command("endue.explorer.find", { query: "" });
    expect(view.shown()).toHaveLength(6);
  });

  it("find-below lists results with their folder; opening one opens it, reveal shows it in its folder", async () => {
    const tree: Tree = { ...sample(), [`${WORK}/deep`]: [file("x.md")] };
    const { app, host, view, ran } = await mount({ handlers: disk(tree) });
    const results = await host.command("endue.explorer.find-below", { query: "x" });
    expect(results).toEqual([
      { path: `${DOCS}/b.txt`, name: "b.txt", kind: "file", folder: DOCS },
      { path: `${WORK}/deep/x.md`, name: "x.md", kind: "file", folder: `${WORK}/deep` },
    ]);
    expect(view.statuses.at(-1)).toBe("2 found below Documents.");
    await app.openFound(`${WORK}/deep/x.md`);
    expect(ran("desk.files.open")).toEqual([{ path: `${WORK}/deep/x.md` }]);
    await app.revealFound(`${WORK}/deep/x.md`);
    expect(view.shown()).toContain("3:file:x.md");
    expect(view.selected()).toBe(`${WORK}/deep/x.md`);
  });

  it("a search can be stopped, and says so", async () => {
    // Work lists only when the test lets it, so the search is still walking when it is stopped.
    const tree = sample();
    const plain = disk(tree);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const list = plain["fs.list"] as (params: { path: string }) => unknown;
    const { app, host, view, params } = await mount({
      handlers: {
        ...plain,
        "fs.list": async (p) => {
          if (p.path === WORK) await held;
          return list(p);
        },
      } as typeof plain,
    });
    const searching = host.command("endue.explorer.find-below", { query: "x" });
    await vi.waitFor(() =>
      expect(params("fs.list")).toContainEqual(expect.objectContaining({ path: WORK })),
    );
    app.stopFind();
    release();
    await searching;
    expect(view.statuses.at(-1)).toBe("Search stopped.");
  });
});
