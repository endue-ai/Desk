// The status line says what the person's last action did or why it failed, in words: until the next
// action, and not about another file. A change on disk that lists a folder again keeps it (#160, 20).
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { stubFileTree } from "../../../packages/runtime/src/bridge/fs";
import { DOCS, disk, file, type Handlers, mount, sample } from "./harness";

const changed = (watchId: string, path = DOCS) =>
  ({ event: "fs.changed", data: { watchId, path, change: "modified" } }) as const;

/** ~/Documents with a2.md and b.txt over the runtime's stub of the core's file tree. */
async function explorer(pick?: (args: unknown) => string | undefined) {
  const files = stubFileTree({
    files: { [`${DOCS}/a2.md`]: "# a2\n", [`${DOCS}/b.txt`]: "bi" },
  });
  return mount({
    handlers: files.handlers as Handlers,
    store: { tree: { expanded: [DOCS], selected: null } },
    ...(pick ? { pick } : {}),
  });
}

describe("words, not codes", () => {
  it("a folder that is not there says so: briefly on its row, in a sentence on the status line", async () => {
    const { view } = await mount({ handlers: disk({}) });
    expect(view.trees.at(-1)?.rows[0]?.error).toBe("not there");
    expect(view.statuses.at(-1)).toBe(`Could not list ${DOCS}: it is not there.`);
  });

  it("a refused folder is 'not allowed' on its row", async () => {
    const { view } = await mount({
      handlers: {
        ...disk(sample()),
        "fs.list": () => {
          throw new StubError("permission_denied", "fs:read is not granted");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    expect(view.trees.at(-1)?.rows[0]?.error).toBe("not allowed");
    expect(view.statuses.at(-1)).toBe(`Not allowed to list ${DOCS}.`);
  });

  it("a disk error is said in words", async () => {
    const { view } = await mount({
      handlers: {
        ...disk(sample()),
        "fs.list": () => {
          throw new StubError("io_error", "EIO");
        },
      },
    });
    expect(view.trees.at(-1)?.rows[0]?.error).toBe("could not list");
    expect(view.statuses.at(-1)).toBe(`Could not list ${DOCS}: the disk answered with an error.`);
  });
});

describe("what the status line keeps", () => {
  it("a rename's result stays when the change on disk lists the folder again", async () => {
    const { app, host, view, settle } = await explorer(() => "notes.md");
    app.select(`${DOCS}/a2.md`);
    await host.command("endue.explorer.rename");
    expect(view.statuses.at(-1)).toBe("Renamed a2.md to notes.md.");
    host.emit(changed("tree-w-1"));
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await settle();
    expect(view.statuses.at(-1)).toBe("Renamed a2.md to notes.md.");
  });

  it("a trash's result stays when the change on disk lists the folder again", async () => {
    const { app, host, view, settle } = await explorer(() => "trash");
    app.select(`${DOCS}/a2.md`);
    await host.command("endue.explorer.trash");
    expect(view.statuses.at(-1)).toBe("Moved a2.md to the Trash.");
    host.emit(changed("tree-w-1"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await settle();
    expect(view.statuses.at(-1)).toBe("Moved a2.md to the Trash.");
  });

  it("a file that did not open is not said about the next one the person selects", async () => {
    const { app, view } = await mount({
      handlers: disk(sample()),
      commands: {
        "desk.files.open": () => {
          throw new Error("the plugin did not answer");
        },
      },
    });
    app.select(`${DOCS}/a2.md`);
    await app.activate(`${DOCS}/a2.md`);
    expect(view.statuses.at(-1)).toBe("Could not open a2.md: the plugin did not answer.");
    await app.key("ArrowDown");
    expect(view.selected()).toBe(`${DOCS}/a10.md`);
    expect(view.statuses.at(-1)).toBe("");
  });

  it("the next command starts from a clear line", async () => {
    const { app, host, view } = await explorer(() => "notes.md");
    app.select(`${DOCS}/a2.md`);
    await host.command("endue.explorer.rename");
    await host.command("endue.explorer.refresh");
    expect(view.statuses.at(-1)).toBe("");
  });

  it("a folder's failure goes once it lists, and only then", async () => {
    let fail = true;
    const tree = disk({ [DOCS]: [file("a.md")] });
    const list = tree["fs.list"] as NonNullable<Handlers["fs.list"]>;
    const { app, view, settle } = await mount({
      handlers: {
        ...tree,
        "fs.list": (p, caller) => {
          if (fail) throw new StubError("not_found", "gone");
          return list(p, caller);
        },
      },
    });
    expect(view.statuses.at(-1)).toBe(`Could not list ${DOCS}: it is not there.`);
    // Closed and opened again (no selection moved, no command): it fails, and is still said.
    await app.activate(DOCS);
    await app.activate(DOCS);
    expect(view.statuses.at(-1)).toBe(`Could not list ${DOCS}: it is not there.`);
    fail = false;
    await app.activate(DOCS);
    await app.activate(DOCS);
    await settle();
    expect(view.statuses.at(-1)).toBe("");
    expect(view.trees.at(-1)?.rows[0]?.error).toBeUndefined();
  });
});

describe("a file no plugin opens", () => {
  it("shows in the quick preview, and the status line says why", async () => {
    const previews: unknown[] = [];
    const { app, view, settle } = await mount({
      handlers: {
        ...disk({ [DOCS]: [file("code.js", 6)] }),
        "fs.read": () => ({ content: btoa("let x"), encoding: "base64", size: 5 }),
      },
      commands: {
        "desk.files.open": (args) => {
          throw new Error(`no plugin opens ${(args as { path: string }).path}`);
        },
      },
    });
    Object.assign(view, { preview: (model: unknown) => previews.push(model) });
    await app.activate(`${DOCS}/code.js`);
    await settle();
    expect(view.statuses.at(-1)).toBe("No plugin opens code.js: its preview is below.");
    expect(previews.at(-1)).toMatchObject({ kind: "text", name: "code.js", text: "let x" });
  });
});
