import { describe, expect, it } from "vitest";
import { stubFileTree } from "../../../packages/runtime/src/bridge/fs";
import { DOCS, denied, type Handlers, mount, WRITE } from "./harness";

const WORK = `${DOCS}/Work`;
type Check = NonNullable<Parameters<typeof stubFileTree>[0]>["check"];

/**
 * The explorer over the runtime's stub of the core's file tree (fs.list, fs.mkdir, fs.rename and
 * fs.trash as desk-core answers them, ADR 0125): ~/Documents with a2.md, b.txt and Work, which holds
 * c.md and an empty deep.
 */
async function explorer(
  options: {
    pick?: (args: unknown) => string | undefined;
    trash?: boolean;
    check?: Check;
    handlers?: Handlers;
  } = {},
) {
  const files = stubFileTree({
    files: { [`${DOCS}/a2.md`]: "# a2\n", [`${DOCS}/b.txt`]: "bi", [`${WORK}/c.md`]: "c" },
    folders: [`${WORK}/deep`],
    ...(options.trash === false ? { trash: false } : {}),
    ...(options.check ? { check: options.check } : {}),
  });
  const store: Record<string, unknown> = { tree: { expanded: [DOCS], selected: null } };
  const mounted = await mount({
    handlers: { ...(files.handlers as Handlers), ...options.handlers },
    store,
    ...(options.pick ? { pick: options.pick } : {}),
  });
  return { ...mounted, tree: files.tree, store };
}

describe("rename", () => {
  it("rename asks for the new name starting from the old one, renames once through fs.rename and selects it", async () => {
    const { app, host, view, params, ran, tree } = await explorer({ pick: () => "notes.md" });
    app.select(`${DOCS}/a2.md`);
    await expect(host.command("endue.explorer.rename")).resolves.toBe(`${DOCS}/notes.md`);
    expect(ran("desk.palette.pick")).toEqual([
      { title: "Rename a2.md", items: [], free: true, placeholder: "a2.md", query: "a2.md" },
    ]);
    // One fs.rename: the core keeps it on the desk's undo stack (ADR 0125).
    expect(params("fs.rename")).toEqual([
      { from: `${DOCS}/a2.md`, to: `${DOCS}/notes.md`, scope: WRITE },
    ]);
    expect(tree.read(`${DOCS}/notes.md`)).toBe("# a2\n");
    expect(tree.read(`${DOCS}/a2.md`)).toBeUndefined();
    expect(view.shown()).toContain("1:file:notes.md");
    expect(view.shown()).not.toContain("1:file:a2.md");
    expect(view.selected()).toBe(`${DOCS}/notes.md`);
    expect(view.statuses.at(-1)).toBe("Renamed a2.md to notes.md.");
  });

  it("rename never overwrites: a name in the folder is refused before any fs.rename, and an unchanged name does nothing", async () => {
    const { app, host, params, tree } = await explorer({ pick: () => "b.txt" });
    app.select(`${DOCS}/a2.md`);
    await expect(host.command("endue.explorer.rename")).rejects.toThrow(
      "b.txt is already in Documents.",
    );
    await expect(host.command("endue.explorer.rename", { name: "a2.md" })).resolves.toBeNull();
    await expect(host.command("endue.explorer.rename", { name: "x/y.md" })).rejects.toThrow(
      "x/y.md is not a file name.",
    );
    expect(params("fs.rename")).toEqual([]);
    expect(tree.read(`${DOCS}/b.txt`)).toBe("bi");
  });

  it("a renamed folder keeps its place: still expanded, its entries under the new name", async () => {
    const { app, host, view, store } = await explorer();
    await app.activate(WORK);
    app.select(WORK);
    await expect(host.command("endue.explorer.rename", { name: "Jobs" })).resolves.toBe(
      `${DOCS}/Jobs`,
    );
    expect(view.shown()).toEqual([
      "0:dir:Documents+",
      "1:dir:Jobs+",
      "2:dir:deep",
      "2:file:c.md",
      "1:file:a2.md",
      "1:file:b.txt",
    ]);
    expect(view.selected()).toBe(`${DOCS}/Jobs`);
    expect(store.tree).toEqual({ expanded: [DOCS, `${DOCS}/Jobs`], selected: `${DOCS}/Jobs` });
  });
});

describe("new folder", () => {
  it("new folder makes the folder in the selected folder through fs.mkdir and selects it; a taken name or a path is refused", async () => {
    const { app, host, view, params, ran, tree } = await explorer({ pick: () => "Plans" });
    await app.activate(WORK);
    app.select(`${WORK}/c.md`);
    await expect(host.command("endue.explorer.new-folder")).resolves.toBe(`${WORK}/Plans`);
    expect(ran("desk.palette.pick")).toEqual([
      { title: `New folder in ${WORK}`, items: [], free: true, placeholder: "New folder" },
    ]);
    expect(params("fs.mkdir")).toEqual([{ path: `${WORK}/Plans`, scope: WRITE }]);
    expect(tree.entries()[`${WORK}/Plans`]).toBeNull();
    expect(view.shown()).toContain("2:dir:Plans");
    expect(view.selected()).toBe(`${WORK}/Plans`);
    expect(view.statuses.at(-1)).toBe("Made the folder Plans in Work.");

    await expect(
      host.command("endue.explorer.new-folder", { folder: DOCS, name: "Work" }),
    ).rejects.toThrow(`${WORK} already exists.`);
    await expect(host.command("endue.explorer.new-folder", { name: "a/b" })).rejects.toThrow(
      "a/b is not a folder name.",
    );
    expect(params("fs.mkdir")).toHaveLength(1);
  });
});

describe("move to trash", () => {
  it("move to trash asks first and, confirmed, trashes once through fs.trash and selects the next row", async () => {
    const { app, host, view, params, ran, tree } = await explorer({ pick: () => "trash" });
    app.select(`${DOCS}/a2.md`);
    await expect(host.command("endue.explorer.trash")).resolves.toBe(`${DOCS}/a2.md`);
    // The question opens on the answer that keeps (the palette's first row): Enter alone keeps.
    expect(ran("desk.palette.pick")).toMatchObject([
      {
        title: "Move a2.md to the Trash?",
        items: [
          { id: "keep", label: "Keep it" },
          { id: "trash", label: "Move to Trash" },
        ],
      },
    ]);
    expect(params("fs.trash")).toEqual([{ path: `${DOCS}/a2.md`, scope: WRITE }]);
    expect(tree.trashed()).toEqual([`${DOCS}/a2.md`]);
    expect(view.shown()).toEqual(["0:dir:Documents+", "1:dir:Work", "1:file:b.txt"]);
    expect(view.selected()).toBe(`${DOCS}/b.txt`);
    expect(view.statuses.at(-1)).toBe("Moved a2.md to the Trash.");

    app.select(WORK);
    await expect(host.command("endue.explorer.trash", { path: WORK })).resolves.toBe(WORK);
    expect(ran("desk.palette.pick")[1]).toMatchObject({
      title: "Move Work and everything in it to the Trash?",
    });
    expect(tree.trashed()).toEqual([`${DOCS}/a2.md`, WORK]);
    expect(view.selected()).toBe(`${DOCS}/b.txt`);
  });

  it("a cancelled trash moves nothing, and a desk without a trash says the entry stays", async () => {
    let answer: string | undefined;
    const { app, host, view, params, tree } = await explorer({
      pick: () => answer,
      trash: false,
    });
    app.select(`${DOCS}/a2.md`);
    await expect(host.command("endue.explorer.trash")).resolves.toBeNull();
    answer = "keep";
    await expect(host.command("endue.explorer.trash")).resolves.toBeNull();
    expect(params("fs.trash")).toEqual([]);

    answer = "trash";
    await expect(host.command("endue.explorer.trash")).rejects.toThrow(
      "There is no Trash here: a2.md stays where it is.",
    );
    expect(params("fs.trash")).toHaveLength(1);
    expect(tree.read(`${DOCS}/a2.md`)).toBe("# a2\n");
    expect(view.shown()).toContain("1:file:a2.md");
    expect(view.statuses.at(-1)).toBe("There is no Trash here: a2.md stays where it is.");
  });

  it("the explorer's own folders are never renamed or trashed", async () => {
    const { app, host, params, ran } = await explorer({ pick: () => "trash" });
    app.select(DOCS);
    await expect(host.command("endue.explorer.rename", { name: "Docs" })).rejects.toThrow(
      `${DOCS} is one of the explorer's folders`,
    );
    await expect(host.command("endue.explorer.trash")).rejects.toThrow(
      `${DOCS} is one of the explorer's folders`,
    );
    expect(params("fs.rename")).toEqual([]);
    expect(params("fs.trash")).toEqual([]);
    expect(ran("desk.palette.pick")).toEqual([]);
  });
});

describe("grants", () => {
  it("a refused write is asked for once for the folder and reported in words", async () => {
    let grant = false;
    let granted = false;
    const { app, host, view, params, tree } = await explorer({
      check: (_caller, scope) => {
        if (scope.permission === "fs:write" && !granted) throw denied("fs:write over ~/Documents");
      },
      handlers: {
        "perm.request": () => {
          granted = grant;
          return { granted: grant };
        },
      },
    });
    app.select(`${DOCS}/a2.md`);
    await expect(host.command("endue.explorer.rename", { name: "n.md" })).rejects.toThrow(
      `Not allowed to rename ${DOCS}/a2.md.`,
    );
    expect(params("perm.request")).toEqual([
      { permission: WRITE, reason: `To rename ${DOCS}/a2.md` },
    ]);
    expect(view.statuses.at(-1)).toBe(`Not allowed to rename ${DOCS}/a2.md.`);

    grant = true;
    await expect(
      host.command("endue.explorer.new-folder", { folder: DOCS, name: "Later" }),
    ).resolves.toBe(`${DOCS}/Later`);
    expect(params("perm.request")).toEqual([
      { permission: WRITE, reason: `To rename ${DOCS}/a2.md` },
      { permission: WRITE, reason: `To create ${DOCS}/Later` },
    ]);
    expect(params("fs.mkdir")).toHaveLength(2);
    expect(tree.entries()[`${DOCS}/Later`]).toBeNull();
  });
});
