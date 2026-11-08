import { describe, expect, it } from "vitest";
import { type Permission, StubError } from "../../../packages/bridge/src/index";
import { stubFileTree } from "../../../packages/runtime/src/bridge/fs";
import { DOCS, type Handlers, mount, READ, WRITE } from "./harness";

const WORK = `${DOCS}/Work`;
const paths = (...list: string[]) => [
  { type: "desk/paths" as const, paths: list.map((path) => ({ path })) },
];

/**
 * The explorer over the runtime's stub of the core's file tree (fs.list, fs.rename, fs.copy, fs.trash
 * as desk-core answers them, #553): ~/Documents with a2.md and b.txt, Work with its own a2.md and an
 * empty deep, and a USB stick.
 */
async function explorer(
  options: { pick?: (args: unknown) => string | undefined; trash?: boolean; check?: Check } = {},
) {
  const files = stubFileTree({
    files: {
      [`${DOCS}/a2.md`]: "# a2\n",
      [`${DOCS}/b.txt`]: "bi",
      [`${WORK}/a2.md`]: "# the other a2\n",
      "/Volumes/USB/photo.jpg": "jpeg",
      "/Volumes/USB/clip.mp4": "mp4",
    },
    folders: [`${WORK}/deep`],
    ...(options.trash === false ? { trash: false } : {}),
    ...(options.check ? { check: options.check } : {}),
  });
  const mounted = await mount({
    handlers: files.handlers as Handlers,
    store: { tree: { expanded: [DOCS, WORK], selected: null } },
    ...(options.pick ? { pick: options.pick } : {}),
  });
  const { host, view } = mounted;
  /** Drop on a folder's row, as the runtime delivers it, and settle what the explorer did next. */
  const drop = async (
    folder: string,
    list: string[],
    more: { keys?: { alt?: boolean; meta?: boolean }; from?: string } = {},
  ) => {
    const done = await host.dnd.drop({
      items: paths(...list),
      over: view.row(folder),
      from: more.from ?? "endue.explorer",
      ...(more.keys ? { keys: more.keys } : {}),
      ...(more.from === "os" ? { effectAllowed: ["copy", "link"] } : {}),
    });
    await mounted.settle();
    return done;
  };
  return { ...mounted, tree: files.tree, drop };
}
type Check = NonNullable<Parameters<typeof stubFileTree>[0]>["check"];

describe("dropping paths on an explorer folder", () => {
  it("takes desk/paths only, and shows move, or copy with Alt, before the drop", async () => {
    const { host, view } = await explorer();
    expect(host.dnd.accepts).toEqual(["desk/json:docker/file", "desk/paths"]);
    const over = view.row(WORK);
    expect(await host.dnd.hover({ items: paths(`${DOCS}/b.txt`), over })).toBe("move");
    expect(await host.dnd.hover({ items: paths(`${DOCS}/b.txt`), over, keys: { alt: true } })).toBe(
      "copy",
    );
    expect(await host.dnd.hover({ items: [{ type: "desk/text", text: "hi" }], over })).toBe("none");
  });

  it("moves them through fs.rename, one call per path under the explorer's scopes, and lists again", async () => {
    const { drop, params, view, tree } = await explorer();
    expect(await drop(`${WORK}/deep`, [`${DOCS}/b.txt`])).toBe("move");
    // One fs.rename per path: the core keeps it for the desk's undo (ADR 0077, ADR 0125).
    expect(params("fs.rename")).toEqual([
      { from: `${DOCS}/b.txt`, to: `${WORK}/deep/b.txt`, scope: WRITE, fromScope: WRITE },
    ]);
    expect(tree.read(`${WORK}/deep/b.txt`)).toBe("bi");
    expect(tree.read(`${DOCS}/b.txt`)).toBeUndefined();
    expect(view.shown()).toContain("3:file:b.txt");
    expect(view.shown()).not.toContain("1:file:b.txt");
    expect(view.selected()).toBe(`${WORK}/deep/b.txt`);
    expect(view.statuses.at(-1)).toBe("Moved b.txt to deep.");
  });

  it("copies with Alt, through fs.copy reading the source and writing the folder", async () => {
    const { drop, params, tree } = await explorer();
    expect(await drop(`${WORK}/deep`, [`${DOCS}/b.txt`], { keys: { alt: true } })).toBe("copy");
    expect(params("fs.copy")).toEqual([
      { from: `${DOCS}/b.txt`, to: `${WORK}/deep/b.txt`, scope: WRITE, fromScope: READ },
    ]);
    expect(tree.read(`${WORK}/deep/b.txt`)).toBe("bi");
    expect(tree.read(`${DOCS}/b.txt`)).toBe("bi");
  });

  it("copies what comes from the OS or another volume, as Finder does", async () => {
    const { drop, tree, params } = await explorer();
    expect(await drop(WORK, ["/Volumes/USB/photo.jpg"], { from: "os" })).toBe("copy");
    expect(await drop(WORK, ["/Volumes/USB/clip.mp4"])).toBe("copy");
    expect(params("fs.rename")).toEqual([]);
    expect(tree.read(`${WORK}/photo.jpg`)).toBe("jpeg");
    expect(tree.read(`${WORK}/clip.mp4`)).toBe("mp4");
    expect(tree.read("/Volumes/USB/clip.mp4")).toBe("mp4");
  });

  /** Drop ~/Documents/a2.md on Work, which has an a2.md, and answer the question with `answer`. */
  const conflict = async (
    answer: string | undefined,
    more: { keys?: { alt: boolean }; trash?: boolean } = {},
  ) => {
    const asked: unknown[] = [];
    const mounted = await explorer({
      pick: (args) => {
        asked.push(args);
        return answer;
      },
      ...(more.trash === false ? { trash: false } : {}),
    });
    const done = await mounted.drop(WORK, [`${DOCS}/a2.md`], more.keys ? { keys: more.keys } : {});
    return { ...mounted, done, asked };
  };

  it("asks when a name is already in the folder, before anything is written", async () => {
    const kept = await conflict("keep");
    expect(kept.asked).toEqual([
      expect.objectContaining({
        title: "a2.md is already in Work",
        items: [
          expect.objectContaining({ id: "keep", label: "Keep both" }),
          expect.objectContaining({ id: "replace", label: "Replace" }),
          expect.objectContaining({ id: "skip", label: "Skip" }),
        ],
      }),
    ]);
    expect(kept.done).toBe("move");
    expect(kept.tree.read(`${WORK}/a2 2.md`)).toBe("# a2\n");
    expect(kept.tree.read(`${WORK}/a2.md`)).toBe("# the other a2\n");
    // Skipped or cancelled (Escape in the palette): nothing moves.
    for (const answer of ["skip", undefined]) {
      const left = await conflict(answer);
      expect(left.done).toBe("none");
      expect(left.params("fs.rename")).toEqual([]);
      expect(left.tree.read(`${DOCS}/a2.md`)).toBe("# a2\n");
    }
  });

  it("replaces by moving what was there to the OS trash first, never by overwriting it", async () => {
    const replaced = await conflict("replace", { keys: { alt: true } });
    expect(replaced.done).toBe("copy");
    expect(replaced.tree.trashed()).toEqual([`${WORK}/a2.md`]);
    expect(replaced.tree.read(`${WORK}/a2.md`)).toBe("# a2\n");
  });

  it("replaces nothing on a desk with no trash, and says so", async () => {
    const kept = await conflict("replace", { trash: false });
    expect(kept.done).toBe("none");
    expect(kept.params("fs.rename")).toEqual([]);
    expect(kept.tree.read(`${WORK}/a2.md`)).toBe("# the other a2\n");
    expect(kept.view.statuses.at(-1)).toBe(
      "a2.md in Work was not replaced: there is no trash to put it in.",
    );
  });

  it("never puts a folder into itself", async () => {
    const { drop, params, view } = await explorer();
    expect(await drop(WORK, [WORK])).toBe("none");
    expect(view.statuses.at(-1)).toBe("Work cannot go into itself.");
    expect(await drop(`${WORK}/deep`, [WORK])).toBe("none");
    expect(params("fs.rename")).toEqual([]);
  });

  it("hands over paths, not access: a refused move asks once for the scope the core named", async () => {
    const elsewhere: Permission = { permission: "fs:write", paths: ["/Users/me/Downloads/**"] };
    let refused = 0;
    const check: Check = (_caller, scope) => {
      if (scope.paths.includes("/Users/me/Downloads/**") && refused++ === 0)
        throw new StubError("permission_denied", "not granted", elsewhere);
    };
    const files = stubFileTree({
      files: { "/Users/me/Downloads/a.pdf": "pdf" },
      folders: [WORK],
      check,
    });
    const { host, view } = await mount({
      handlers: files.handlers as Handlers,
      store: { tree: { expanded: [WORK], selected: null } },
      settings: { folders: [WORK] },
    });
    const done = await host.dnd.drop({
      items: paths("/Users/me/Downloads/a.pdf"),
      over: view.row(WORK),
      from: "endue.notes",
      keys: { meta: true },
    });
    expect(done).toBe("move");
    expect(files.tree.read(`${WORK}/a.pdf`)).toBe("pdf");
    const asked = host.calls.filter((c) => c.method === "perm.request").map((c) => c.params);
    expect(asked).toEqual([{ permission: elsewhere, reason: `To move a.pdf to ${WORK}` }]);
  });
});
