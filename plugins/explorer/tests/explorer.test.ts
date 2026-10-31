import { describe, expect, it } from "vitest";
import { DOCS, denied, disk, file, mount, READ, sample, WRITE } from "./harness";

const WORK = `${DOCS}/Work`;
const changed = (watchId: string, path = DOCS) =>
  ({ event: "fs.changed", data: { watchId, path, change: "created" } }) as const;

describe("the tree", () => {
  it("lists and watches the first folder at start, folders first in natural order", async () => {
    const { view, params } = await mount({ handlers: disk(sample()) });
    expect(params("fs.list")).toEqual([{ path: DOCS, scope: READ }]);
    expect(params("fs.watch")).toEqual([{ path: DOCS, scope: READ }]);
    expect(view.shown()).toEqual([
      "0:dir:Documents+",
      "1:dir:Work",
      "1:file:a2.md",
      "1:file:a10.md",
      "1:file:b.txt",
      "1:symlink:zed",
    ]);
    expect(view.headers.at(-1)).toEqual({ showHidden: false, folders: [DOCS] });
    expect(view.statuses).toEqual([]);
  });

  it("a folder lists when it first opens, keeps its listing closed, and is remembered", async () => {
    const store: Record<string, unknown> = {};
    const { app, view, params } = await mount({ handlers: disk(sample()), store });
    await app.activate(WORK);
    expect(params("fs.list")).toHaveLength(2);
    expect(view.shown().slice(1, 4)).toEqual(["1:dir:Work+", "2:dir:deep", "2:file:c.md"]);
    expect(store.tree).toEqual({ expanded: [DOCS, WORK], selected: null });

    await app.activate(WORK);
    expect(view.shown().slice(1, 3)).toEqual(["1:dir:Work", "1:file:a2.md"]);
    await app.activate(WORK);
    expect(params("fs.list")).toHaveLength(2);
    expect(view.shown()[1]).toBe("1:dir:Work+");
  });

  it("shows a page of entries and the rest on request", async () => {
    const { app, view } = await mount({
      handlers: disk(sample()),
      init: { "endue.explorer.page": 2 },
    });
    expect(view.shown()).toEqual([
      "0:dir:Documents+",
      "1:dir:Work",
      "1:file:a2.md",
      "1:more:3 more",
    ]);
    await app.activate(`more:${DOCS}`);
    expect(view.shown().slice(3)).toEqual(["1:file:a10.md", "1:file:b.txt", "1:more:1 more"]);
    expect(view.selected()).toBe(`${DOCS}/a10.md`);
    await app.activate(`more:${DOCS}`);
    expect(view.shown()).toHaveLength(6);
  });

  it("dotfiles show when asked, and the choice is kept as a setting", async () => {
    const { host, view } = await mount({ handlers: disk(sample()) });
    await expect(host.command("endue.explorer.toggle-hidden")).resolves.toBe(true);
    expect(view.shown().slice(0, 3)).toEqual(["0:dir:Documents+", "1:dir:.git", "1:dir:Work"]);
    expect(view.headers.at(-1)?.showHidden).toBe(true);
    await host.settle();
    expect(host.settings["show-hidden"]).toBe(true);

    const shown = await mount({ handlers: disk(sample()), settings: { "show-hidden": true } });
    expect(shown.view.shown()[1]).toBe("1:dir:.git");
  });

  it("comes back as it was: the expanded folders and the selection, inside the folders", async () => {
    const back = await mount({
      handlers: disk(sample()),
      store: { tree: { expanded: [DOCS, WORK, "~/Elsewhere"], selected: `${WORK}/c.md` } },
    });
    expect(back.params("fs.list").map((p) => (p as { path: string }).path)).toEqual([DOCS, WORK]);
    expect(back.view.shown()).toContain("2:file:c.md");
    expect(back.view.selected()).toBe(`${WORK}/c.md`);

    const fresh = await mount({
      handlers: disk({ ...sample(), "~/Projects": [file("p.md")] }),
      store: { tree: { expanded: ["~/Elsewhere"] } },
      init: { "endue.explorer.folders": ["~/Projects"] },
    });
    expect(fresh.view.shown()).toEqual(["0:dir:Projects+", "1:file:p.md"]);
  });
});

describe("opening files", () => {
  it("a file opens through desk.files.open; the desk picks the plugin", async () => {
    const { app, ran, view } = await mount({ handlers: disk(sample()) });
    await app.activate(`${DOCS}/a2.md`);
    expect(ran("desk.files.open")).toEqual([{ path: `${DOCS}/a2.md` }]);
    expect(view.statuses).toEqual([]);
  });

  it("a file that does not open is said in words", async () => {
    const { app, view } = await mount({
      handlers: disk(sample()),
      commands: {
        "desk.files.open": () => {
          throw new Error(`no plugin opens ${DOCS}/a2.md`);
        },
      },
    });
    await app.activate(`${DOCS}/a2.md`);
    expect(view.statuses.at(-1)).toBe(`Could not open a2.md: no plugin opens ${DOCS}/a2.md.`);
  });
});

describe("permissions", () => {
  it("a refused listing is asked for once and reported on the row and the status line", async () => {
    const { view, params } = await mount({
      handlers: {
        ...disk(sample()),
        "fs.list": () => {
          throw denied("fs:read over ~/Documents");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    expect(params("perm.request")).toEqual([
      { permission: READ, reason: `To show ${DOCS} in the explorer` },
    ]);
    expect(params("fs.list")).toHaveLength(1);
    expect(params("fs.watch")).toEqual([]);
    expect(view.shown()).toEqual(["0:dir:Documents+!"]);
    expect(view.trees.at(-1)?.rows[0]?.error).toBe(`Not allowed to list ${DOCS}.`);
    expect(view.statuses.at(-1)).toBe(`Not allowed to list ${DOCS}.`);
  });

  it("a granted ask lists again", async () => {
    let lists = 0;
    const tree = disk(sample());
    const listAll = tree["fs.list"] as NonNullable<(typeof tree)["fs.list"]>;
    const { view, params } = await mount({
      handlers: {
        ...tree,
        "fs.list": (p) => {
          if (++lists === 1) throw denied("fs:read over ~/Documents");
          return listAll(p, undefined);
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission,
            duration: "session",
            grantedAt: "2026-10-31T09:00:00Z",
          },
        }),
      },
    });
    expect(params("fs.list")).toHaveLength(2);
    expect(params("perm.request")).toHaveLength(1);
    expect(view.shown()).toHaveLength(6);
    expect(view.statuses).toEqual([]);
  });

  it("other errors are reported with their code and no ask", async () => {
    const { view, params } = await mount({
      handlers: { ...disk({}), "perm.request": () => ({ granted: true }) },
    });
    expect(params("perm.request")).toEqual([]);
    expect(view.statuses.at(-1)).toBe(`Could not list ${DOCS}: not_found.`);
  });
});

describe("changes on disk", () => {
  it("a burst of changes under an expanded folder lists it again once", async () => {
    const { host, params, settle } = await mount({ handlers: disk(sample()) });
    host.emit(changed("w1"));
    host.emit(changed("w1"));
    await settle();
    expect(params("fs.list")).toEqual([
      { path: DOCS, scope: READ },
      { path: DOCS, scope: READ },
    ]);
  });

  it("changes under a collapsed folder or an unknown watch list nothing", async () => {
    const { host, app, params, settle } = await mount({ handlers: disk(sample()) });
    await app.activate(WORK);
    await settle();
    expect(params("fs.watch").map((p) => (p as { path: string }).path)).toEqual([DOCS, WORK]);
    await app.activate(WORK);
    host.emit(changed("w2", WORK));
    host.emit(changed("w9"));
    await settle();
    expect(params("fs.list")).toHaveLength(2);
  });
});

describe("the keyboard", () => {
  it("arrows move, expand and collapse; type-ahead jumps; Enter opens", async () => {
    const { app, view, ran, settle } = await mount({ handlers: disk(sample()) });
    expect(view.selected()).toBeNull();
    await app.key("ArrowDown");
    expect(view.selected()).toBe(DOCS);
    expect(view.focused.at(-1)).toBe(DOCS);
    await app.key("ArrowDown");
    expect(view.selected()).toBe(WORK);
    await app.key("ArrowRight");
    expect(view.shown()[1]).toBe("1:dir:Work+");
    expect(view.selected()).toBe(WORK);
    await app.key("ArrowRight");
    expect(view.selected()).toBe(`${WORK}/deep`);
    await app.key("ArrowLeft");
    expect(view.selected()).toBe(WORK);
    await app.key("ArrowLeft");
    expect(view.shown()[1]).toBe("1:dir:Work");
    await app.key("End");
    expect(view.selected()).toBe(`${DOCS}/zed`);
    await app.key("Home");
    expect(view.selected()).toBe(DOCS);

    expect(app.type("b", 1000)).toBe(true);
    expect(view.selected()).toBe(`${DOCS}/b.txt`);
    expect(app.type("a", 2000)).toBe(true);
    expect(app.type("1", 2100)).toBe(true);
    expect(view.selected()).toBe(`${DOCS}/a10.md`);
    expect(app.type("q", 3000)).toBe(false);

    expect(await app.key("Enter")).toBe(true);
    await settle();
    expect(ran("desk.files.open")).toEqual([{ path: `${DOCS}/a10.md` }]);
    expect(await app.key("Tab")).toBe(false);
  });

  it("endue.explorer.open shows the surface and focuses the selection", async () => {
    const { host, view } = await mount({ handlers: disk(sample()) });
    await expect(host.command("endue.explorer.open")).resolves.toBe(DOCS);
    expect(host.visible).toBe(true);
    expect(view.focused.at(-1)).toBe(DOCS);
  });
});

describe("reveal", () => {
  const buffer = (path: string) => ({
    id: `file:${path}`,
    name: path.slice(path.lastIndexOf("/") + 1),
    plugin: "endue.notes",
    path,
    modified: false,
    surface: false,
  });

  it("expands down to the file in use and selects it", async () => {
    const target = `${WORK}/deep/x.md`;
    const { host, view, params } = await mount({
      handlers: disk(sample()),
      buffers: [buffer(target), buffer(`${DOCS}/a2.md`)],
    });
    await expect(host.command("endue.explorer.reveal")).resolves.toBe(target);
    expect(params("fs.list").map((p) => (p as { path: string }).path)).toEqual([
      DOCS,
      WORK,
      `${WORK}/deep`,
    ]);
    expect(view.shown()).toContain("3:file:x.md");
    expect(view.selected()).toBe(target);
    expect(view.focused.at(-1)).toBe(target);
    expect(host.visible).toBe(true);
  });

  it("says when nothing is in use, or the file is outside the explorer's folders", async () => {
    const none = await mount({ handlers: disk(sample()) });
    await expect(none.host.command("endue.explorer.reveal")).rejects.toThrow("No file is in use.");
    expect(none.view.statuses.at(-1)).toBe("No file is in use.");

    const outside = await mount({ handlers: disk(sample()), buffers: [buffer("~/Other/y.md")] });
    await expect(outside.host.command("endue.explorer.reveal")).rejects.toThrow(
      "~/Other/y.md is outside the explorer's folders.",
    );
    await expect(
      outside.host.command("endue.explorer.reveal", { path: `${DOCS}/missing.md` }),
    ).rejects.toThrow(`${DOCS}/missing.md is not in ${DOCS}.`);
  });
});

describe("folders", () => {
  it("add-folder asks for a path, lists it, and keeps it in the folders setting", async () => {
    const { host, view, ran, settle } = await mount({
      handlers: disk({ ...sample(), "~/Projects": [file("p.md")] }),
      pick: () => "~/Projects/",
    });
    await expect(host.command("endue.explorer.add-folder")).resolves.toBe("~/Projects");
    expect(ran("desk.palette.pick")).toEqual([
      { title: "Add a folder", items: [], free: true, placeholder: "~/path/to/folder" },
    ]);
    expect(view.shown().slice(-2)).toEqual(["0:dir:Projects+", "1:file:p.md"]);
    expect(view.headers.at(-1)?.folders).toEqual([DOCS, "~/Projects"]);
    expect(view.selected()).toBe("~/Projects");
    await settle();
    expect(host.settings.folders).toEqual([DOCS, "~/Projects"]);
  });

  it("a cancelled pick adds nothing; a path that is not one is refused", async () => {
    const cancelled = await mount({ handlers: disk(sample()), pick: () => undefined });
    await expect(cancelled.host.command("endue.explorer.add-folder")).resolves.toBeNull();
    expect(cancelled.view.headers.at(-1)?.folders).toEqual([DOCS]);

    const bad = await mount({ handlers: disk(sample()), pick: () => "nope" });
    await expect(bad.host.command("endue.explorer.add-folder")).rejects.toThrow(
      "nope is not a folder path.",
    );
    expect(bad.view.statuses.at(-1)).toBe("nope is not a folder path.");
  });

  it("a folder inside one already shown is uncovered instead of added", async () => {
    const { host, view } = await mount({ handlers: disk(sample()) });
    await expect(host.command("endue.explorer.add-folder", { path: WORK })).resolves.toBe(WORK);
    expect(view.headers.at(-1)?.folders).toEqual([DOCS]);
    expect(view.shown()[1]).toBe("1:dir:Work+");
    expect(view.selected()).toBe(WORK);
  });

  it("remove-folder drops the folder, its listing and its setting", async () => {
    const { host, view, settle } = await mount({ handlers: disk(sample()) });
    await expect(host.command("endue.explorer.remove-folder", { path: DOCS })).resolves.toEqual([]);
    expect(view.shown()).toEqual([]);
    expect(view.headers.at(-1)?.folders).toEqual([]);
    await settle();
    expect(host.settings.folders).toEqual([]);
    await expect(host.command("endue.explorer.remove-folder", { path: "~/Nope" })).rejects.toThrow(
      "~/Nope is not one of the explorer's folders.",
    );
  });

  it("the folders setting changed elsewhere applies", async () => {
    const { host, view } = await mount({ handlers: disk(sample()) });
    host.emit({
      event: "settings.changed",
      data: { owner: "endue.explorer", key: "folders", value: ["~/Projects"] },
    });
    expect(view.headers.at(-1)?.folders).toEqual(["~/Projects"]);
    expect(view.shown()).toEqual(["0:dir:Projects"]);
  });
});

describe("new file", () => {
  it("lists the folder afresh, writes an empty file, selects and opens it", async () => {
    const written: Array<{ path: string; content: string }> = [];
    const { host, view, params, ran } = await mount({ handlers: disk(sample(), written) });
    const path = `${DOCS}/new.md`;
    await expect(
      host.command("endue.explorer.new-file", { folder: DOCS, name: "new.md" }),
    ).resolves.toBe(path);
    expect(params("fs.list")).toHaveLength(3);
    expect(params("fs.write")).toEqual([{ path, content: "", encoding: "utf8", scope: WRITE }]);
    expect(written).toEqual([{ path, content: "" }]);
    expect(view.shown()).toContain("1:file:new.md");
    expect(view.selected()).toBe(path);
    expect(ran("desk.files.open")).toEqual([{ path }]);
  });

  it("never overwrites: a name already in the folder is refused", async () => {
    const { host, params } = await mount({ handlers: disk(sample()) });
    await expect(host.command("endue.explorer.new-file", { name: "a2.md" })).rejects.toThrow(
      `${DOCS}/a2.md already exists.`,
    );
    await expect(host.command("endue.explorer.new-file", { name: "a/b" })).rejects.toThrow(
      "a/b is not a file name.",
    );
    expect(params("fs.write")).toEqual([]);
  });

  it("goes in the selected folder, and the name comes from the palette when none is given", async () => {
    const { host, app, params } = await mount({ handlers: disk(sample()), pick: () => "typed.md" });
    await app.activate(WORK);
    app.select(`${WORK}/c.md`);
    await expect(host.command("endue.explorer.new-file")).resolves.toBe(`${WORK}/typed.md`);
    expect(params("fs.write")).toEqual([
      { path: `${WORK}/typed.md`, content: "", encoding: "utf8", scope: WRITE },
    ]);
  });

  it("a refused write is asked for and reported in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        ...disk(sample()),
        "fs.write": () => {
          throw denied("fs:write over ~/Documents");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("endue.explorer.new-file", { name: "n.md" })).rejects.toThrow(
      `Not allowed to write ${DOCS}/n.md.`,
    );
    expect(params("perm.request")).toEqual([
      { permission: WRITE, reason: `To create ${DOCS}/n.md` },
    ]);
    expect(view.statuses.at(-1)).toBe(`Not allowed to write ${DOCS}/n.md.`);
  });
});

describe("adding a folder the plugin may not list", () => {
  it("is refused and not kept as a root", async () => {
    const { app, view } = await mount({
      handlers: {
        ...disk(sample()),
        "fs.list": ({ path }) => {
          if (path === "/tmp") throw denied("fs:read over /tmp");
          return { entries: sample()[path] ?? [] };
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(app.addFolder("/tmp")).rejects.toThrow("Not allowed to list /tmp.");
    expect(view.shown().some((row) => row.includes(":tmp"))).toBe(false);
    expect(view.headers.at(-1)?.folders ?? []).not.toContain("/tmp");
    expect(view.statuses.at(-1)).toBe("Not allowed to list /tmp.");
  });
});
