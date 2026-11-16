// Acting on every selected entry (#313): copy, cut and paste, a drop and Move to Trash take the whole
// selection. The renames and copies of one action share one undo group, so the desk's undo takes
// them back as one step (ADR 0247); a trash asks once, and the OS Trash keeps every entry.
import { describe, expect, it } from "vitest";
import { stubFileTree } from "../../../packages/runtime/src/bridge/fs";
import { DOCS, type Handlers, mount } from "./harness";

const WORK = `${DOCS}/Work`;
const groups = (calls: unknown[]) => calls.map((c) => (c as { group?: unknown }).group);

/** ~/Documents with a2.md, b.txt and Work, which holds c.md and an empty deep. */
async function explorer(options: { pick?: (args: unknown) => string | undefined } = {}) {
  const files = stubFileTree({
    files: { [`${DOCS}/a2.md`]: "# a2\n", [`${DOCS}/b.txt`]: "bi", [`${WORK}/c.md`]: "c" },
    folders: [`${WORK}/deep`],
  });
  const mounted = await mount({
    handlers: files.handlers as Handlers,
    store: { tree: { expanded: [DOCS, WORK], selected: null } },
    ...(options.pick ? { pick: options.pick } : {}),
  });
  /** Select a2.md and b.txt, as a click and a Mod-click would. */
  const both = () => {
    mounted.app.pick(`${DOCS}/a2.md`, {});
    mounted.app.pick(`${DOCS}/b.txt`, { mod: true });
  };
  return { ...mounted, tree: files.tree, both };
}

describe("copy, cut and paste", () => {
  it("copy and paste copies every selected entry through fs.copy, all in one undo group", async () => {
    const { app, host, both, params, tree, view } = await explorer();
    both();
    await host.command("endue.explorer.copy");
    expect(view.statuses.at(-1)).toBe("Copied 2 items: paste them in a folder.");
    app.pick(`${WORK}/deep`, {});
    await host.command("endue.explorer.paste");
    expect(params("fs.copy").map((c) => (c as { to: string }).to)).toEqual([
      `${WORK}/deep/a2.md`,
      `${WORK}/deep/b.txt`,
    ]);
    const [first, second] = groups(params("fs.copy"));
    expect(typeof first).toBe("string");
    expect(second).toBe(first);
    expect(tree.read(`${WORK}/deep/b.txt`)).toBe("bi");
    expect(tree.read(`${DOCS}/b.txt`)).toBe("bi");
    expect(view.statuses.at(-1)).toBe("Copied 2 items to deep.");
    // What was copied can be pasted again, as a new step of its own.
    app.pick(WORK, {});
    await host.command("endue.explorer.paste");
    const later = groups(params("fs.copy")).slice(2);
    expect(later).toHaveLength(2);
    expect(later[0]).toBe(later[1]);
    expect(later[0]).not.toBe(first);
  });

  it("cut and paste moves every selected entry through fs.rename in one group, once", async () => {
    const { app, host, both, params, tree, view } = await explorer();
    both();
    await host.command("endue.explorer.cut");
    app.pick(WORK, {});
    await host.command("endue.explorer.paste");
    expect(params("fs.rename").map((c) => (c as { to: string }).to)).toEqual([
      `${WORK}/a2.md`,
      `${WORK}/b.txt`,
    ]);
    const [first, second] = groups(params("fs.rename"));
    expect(typeof first).toBe("string");
    expect(second).toBe(first);
    expect(tree.read(`${DOCS}/a2.md`)).toBeUndefined();
    expect(tree.read(`${WORK}/a2.md`)).toBe("# a2\n");
    expect(view.statuses.at(-1)).toBe("Moved 2 items to Work.");
    // A cut is pasted once.
    await expect(host.command("endue.explorer.paste")).rejects.toThrow("Nothing to paste.");
  });

  it("a folder and an entry inside it go as the folder alone", async () => {
    // Pasted beside itself, the copy keeps both: Work 2.
    const { app, host, params, tree } = await explorer({ pick: () => "keep" });
    app.pick(WORK, {});
    app.pick(`${WORK}/c.md`, { mod: true });
    await host.command("endue.explorer.copy");
    await host.command("endue.explorer.paste", { folder: DOCS });
    expect(params("fs.copy").map((c) => (c as { from: string }).from)).toEqual([WORK]);
    expect(tree.read(`${DOCS}/Work 2/c.md`)).toBe("c");
  });
});

describe("a drop of several entries", () => {
  it("drops every path in one undo group, and each drop is a group of its own", async () => {
    const { host, params, view } = await explorer();
    const paths = [`${DOCS}/a2.md`, `${DOCS}/b.txt`];
    const items = [{ type: "desk/paths" as const, paths: paths.map((path) => ({ path })) }];
    await host.dnd.drop({ items, over: view.row(`${WORK}/deep`), from: "endue.explorer" });
    const [first, second] = groups(params("fs.rename"));
    expect(typeof first).toBe("string");
    expect(second).toBe(first);
  });
});

describe("move to trash", () => {
  it("asks once for every selected entry, then trashes each through fs.trash", async () => {
    const asked: unknown[] = [];
    const { host, both, params, tree, view } = await explorer({
      pick: (args) => {
        asked.push(args);
        return "trash";
      },
    });
    both();
    await host.command("endue.explorer.trash");
    expect(asked).toHaveLength(1);
    expect((asked[0] as { title: string }).title).toBe("Move 2 items to the Trash?");
    expect(params("fs.trash").map((c) => (c as { path: string }).path)).toEqual([
      `${DOCS}/a2.md`,
      `${DOCS}/b.txt`,
    ]);
    expect(tree.trashed()).toEqual([`${DOCS}/a2.md`, `${DOCS}/b.txt`]);
    expect(view.statuses.at(-1)).toBe("Moved 2 items to the Trash.");
  });

  it("leaves the explorer's own folders out, and keeps everything on Keep it", async () => {
    const { app, host, params } = await explorer({ pick: () => "keep" });
    app.pick(DOCS, {});
    app.pick(`${DOCS}/b.txt`, { mod: true });
    app.pick(`${DOCS}/a2.md`, { mod: true });
    await expect(host.command("endue.explorer.trash")).resolves.toBeNull();
    expect(params("fs.trash")).toEqual([]);
  });
});
