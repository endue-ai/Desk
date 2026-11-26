// Editing and saving on the SDK's test host: the unsaved mark, fs.write with one ask, the text tier's
// first-save question (Save as copy or Overwrite), read-only formats refusing, revert.
import { describe, expect, it } from "vitest";
import { plainOf } from "../ui/tree.js";
import { type Commands, denied, disk, file, type Handlers, mount } from "./harness";
import { rootOf } from "./nodes";

const A = file("~/data/a.json");
const B = file("~/data/b.yaml");
const X = file("~/data/feed.xml");
const JSON_TEXT = '{\n  "name": "desk",\n  "count": 1\n}\n';
const YAML_TEXT = "# made-up\nname: desk # the name\ncount: 1\n";
const WRITE = (path: string) => ({ permission: "fs:write", paths: [path] }) as const;

const base64 = (text: string) => Buffer.from(text).toString("base64");
const decoded = (content: unknown) => Buffer.from(String(content), "base64").toString("utf8");

/** The disk, with fs.write storing what the plugin writes. */
function writable(files: Record<string, string>, extra: Handlers = {}): Handlers {
  return {
    ...disk(files),
    "fs.write": ({ path, content }) => {
      files[path] = decoded(content);
      return { bytesWritten: Buffer.from(String(content), "base64").length };
    },
    ...extra,
  };
}

const answering = (pick: Commands[string]): Commands => ({
  "desk.buffers.update": () => undefined,
  "desk.palette.pick": pick,
});

describe("editing and saving JSON (lossless)", () => {
  it("the first edit marks the buffer unsaved once; save writes the edited bytes", async () => {
    const files = { [A.path]: JSON_TEXT };
    const { host, app, view, params, ran } = await mount({
      handlers: writable(files),
      commands: answering(() => "copy"),
    });
    await host.command("desk.files.visit", A);
    await expect(app.begin([0, 0])).resolves.toBe("desk");
    await app.edit([0, 0], "Desk");
    await app.edit([0, 1], "2");
    expect(ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: true }]);
    expect(plainOf(rootOf(view.shown.at(-1)?.opened.doc))).toEqual({ name: "Desk", count: 2 });

    await expect(host.command("desk.files.save", A)).resolves.toBeUndefined();
    const expected = '{\n  "name": "Desk",\n  "count": 2\n}\n';
    expect(params("fs.write")).toEqual([
      { path: A.path, content: base64(expected), encoding: "base64", scope: WRITE(A.path) },
    ]);
    expect(ran("desk.palette.pick")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Saved a.json.");

    await app.edit([0, 1], "3");
    expect(ran("desk.buffers.update")).toHaveLength(2);
  });

  it("a refused write asks once for the exact file, then writes", async () => {
    let writes = 0;
    const files = { [A.path]: JSON_TEXT };
    const { host, app, params } = await mount({
      handlers: writable(files, {
        "fs.write": ({ path, content }) => {
          if (++writes === 1) throw denied(`fs:write over ${path}`);
          files[path] = decoded(content);
          return { bytesWritten: 1 };
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission,
            duration: "session",
            grantedAt: "2026-11-02T09:00:00Z",
          },
        }),
      }),
      commands: answering(() => "copy"),
    });
    await host.command("desk.files.visit", A);
    await app.edit([0, 1], "5");
    await host.command("desk.files.save", A);
    expect(params("perm.request")).toEqual([
      { permission: WRITE(A.path), reason: "To save ~/data/a.json" },
    ]);
    expect(params("fs.write")).toHaveLength(2);
    expect(files[A.path]).toContain('"count": 5');
  });

  it("a refused ask is said in words and nothing is written", async () => {
    const { host, app, view } = await mount({
      handlers: writable(
        { [A.path]: JSON_TEXT },
        {
          "fs.write": ({ path }) => {
            throw denied(`fs:write over ${path}`);
          },
          "perm.request": () => ({ granted: false }),
        },
      ),
      commands: answering(() => "copy"),
    });
    await host.command("desk.files.visit", A);
    await app.edit([0, 1], "5");
    await expect(host.command("desk.files.save", A)).rejects.toThrow(
      "Not allowed to write ~/data/a.json.",
    );
    expect(view.statuses.at(-1)).toBe("Not allowed to write ~/data/a.json.");
  });

  it("revert drops the edits", async () => {
    const { host, app, view } = await mount({
      handlers: writable({ [A.path]: JSON_TEXT }),
      commands: answering(() => "copy"),
    });
    await host.command("desk.files.visit", A);
    await app.edit([0, 0], "changed");
    await host.command("desk.files.revert", A);
    expect(plainOf(rootOf(view.shown.at(-1)?.opened.doc))).toEqual({ name: "desk", count: 1 });
    expect(view.shown.at(-1)?.tier).toBe("lossless");
  });
});

describe("saving YAML (text): one writable destination choice per file", () => {
  const copy = "~/data/b.copy.yaml";
  const yaml = async (picked: string | undefined) => {
    const files: Record<string, string> = { [B.path]: YAML_TEXT };
    const mounted = await mount({
      handlers: writable(files, {
        "dialog.save": () => ({ path: picked, cancelled: picked === undefined }),
      }),
      commands: { "desk.buffers.update": () => undefined },
    });
    await mounted.host.command("desk.files.visit", B);
    await mounted.app.edit([0, 0], "Desk");
    return { ...mounted, files };
  };

  it("suggests a copy once and writes it under the dialog's exact grant", async () => {
    const { host, ran, params, view, files } = await yaml(copy);
    expect(view.shown.at(-1)?.tier).toBe("text");
    await host.command("desk.files.save", B);
    expect(params("dialog.save")).toEqual([
      { title: "Save b.yaml as YAML text", startIn: "~/data", suggestedName: "b.copy.yaml" },
    ]);
    expect(ran("desk.palette.pick")).toEqual([]);
    expect(params("perm.request")).toEqual([]);
    expect(params("fs.write")).toMatchObject([{ path: copy, scope: WRITE(copy) }]);
    expect(files[copy]).toBe("# made-up\nname: Desk # the name\ncount: 1\n");
    expect(files[B.path]).toBe(YAML_TEXT);
    expect(view.statuses.at(-1)).toBe("Saved a copy as b.copy.yaml; b.yaml is unchanged.");

    await host.command("desk.files.save", B);
    expect(params("dialog.save")).toHaveLength(1);
    expect(params("fs.write")).toMatchObject([{ path: copy }, { path: copy }]);
  });

  it("writes the original when chosen, and keeps that destination for later saves", async () => {
    const { host, app, params, files } = await yaml(B.path);
    await host.command("desk.files.save", B);
    expect(files[B.path]).toBe("# made-up\nname: Desk # the name\ncount: 1\n");
    await app.edit([0, 1], "2");
    await host.command("desk.files.save", B);
    expect(files[B.path]).toContain("count: 2");
    expect(params("dialog.save")).toHaveLength(1);
    expect(files[copy]).toBeUndefined();
  });

  it("a cancelled question writes nothing, and the next save asks again", async () => {
    const { host, params, view } = await yaml(undefined);
    await expect(host.command("desk.files.save", B)).rejects.toThrow("Did not save b.yaml.");
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Did not save b.yaml.");
    await expect(host.command("desk.files.save", B)).rejects.toThrow();
    expect(params("dialog.save")).toHaveLength(2);
  });

  it("can save a copy outside the source's folder using only the native file choice", async () => {
    const source = file("/outside/original/b.yaml");
    const target = "/outside/destination/b.copy.yaml";
    const files: Record<string, string> = { [source.path]: YAML_TEXT };
    let chosen = false;
    const { host, app, params } = await mount({
      handlers: writable(files, {
        "dialog.save": () => {
          chosen = true;
          return { path: target, cancelled: false };
        },
        "fs.write": ({ path, scope, content }) => {
          if (!chosen || scope.paths.join(",") !== target) throw denied("file was not chosen");
          files[path] = decoded(content);
          return { bytesWritten: 1 };
        },
      }),
    });
    await host.command("desk.files.visit", source);
    await app.edit([0, 0], "Desk");
    await host.command("desk.files.save", source);
    expect(params("dialog.save")).toHaveLength(1);
    expect(params("perm.request")).toEqual([]);
    expect(params("fs.write")).toMatchObject([{ path: target, scope: WRITE(target) }]);
    expect(files[source.path]).toBe(YAML_TEXT);
  });
});

describe("read-only files", () => {
  it("refuse save and edits in words", async () => {
    const { host, app, view, params } = await mount({
      handlers: writable({ [X.path]: "<feed><title>t</title></feed>" }),
      commands: answering(() => "overwrite"),
    });
    await host.command("desk.files.visit", X);
    expect(view.shown.at(-1)).toMatchObject({ tier: "read-only" });
    await expect(app.begin([0, 0])).rejects.toThrow(
      "feed.xml opens read-only: XML files are not edited here.",
    );
    await expect(host.command("desk.files.save", X)).rejects.toThrow(
      "feed.xml opens read-only: XML files are not edited here.",
    );
    expect(params("fs.write")).toEqual([]);
  });
});
