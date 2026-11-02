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
const WRITE = { permission: "fs:write", paths: ["~/data/**"] } as const;

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
      { path: A.path, content: base64(expected), encoding: "base64", scope: WRITE },
    ]);
    expect(ran("desk.palette.pick")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Saved a.json.");

    await app.edit([0, 1], "3");
    expect(ran("desk.buffers.update")).toHaveLength(2);
  });

  it("a refused write asks once for the file's folder, then writes", async () => {
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
      { permission: WRITE, reason: "To save ~/data/a.json" },
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

describe("saving YAML (text): Save as copy or Overwrite, asked once per file", () => {
  const yaml = async (pick: Commands[string]) => {
    const files: Record<string, string> = { [B.path]: YAML_TEXT };
    const mounted = await mount({ handlers: writable(files), commands: answering(pick) });
    await mounted.host.command("desk.files.visit", B);
    await mounted.app.edit([0, 0], "Desk");
    return { ...mounted, files };
  };

  it("asks first, Save as copy first; the copy is written beside it and the file stays", async () => {
    const { host, ran, params, view, files } = await yaml(() => "copy");
    expect(view.shown.at(-1)?.tier).toBe("text");
    await host.command("desk.files.save", B);
    expect(ran("desk.palette.pick")).toEqual([
      {
        title: "Save b.yaml: YAML is saved as text",
        items: [
          {
            id: "copy",
            label: "Save as copy",
            detail: "Writes b.copy.yaml beside it; b.yaml stays as it is",
          },
          {
            id: "overwrite",
            label: "Overwrite",
            detail: "Rewrites b.yaml; its formatting may change",
          },
        ],
      },
    ]);
    expect(params("fs.write")).toMatchObject([{ path: "~/data/b.copy.yaml", scope: WRITE }]);
    expect(files["~/data/b.copy.yaml"]).toBe("# made-up\nname: Desk # the name\ncount: 1\n");
    expect(files[B.path]).toBe(YAML_TEXT);
    expect(view.statuses.at(-1)).toBe("Saved a copy as b.copy.yaml; b.yaml is unchanged.");

    await host.command("desk.files.save", B);
    expect(ran("desk.palette.pick")).toHaveLength(1);
    expect(params("fs.write")).toMatchObject([
      { path: "~/data/b.copy.yaml" },
      { path: "~/data/b.copy.yaml" },
    ]);
  });

  it("says when the copy would replace one already there", async () => {
    const files: Record<string, string> = { [B.path]: YAML_TEXT, "~/data/b.copy.yaml": "old" };
    const { host, app, ran } = await mount({
      handlers: writable(files),
      commands: answering(() => "copy"),
    });
    await host.command("desk.files.visit", B);
    await app.edit([0, 1], "2");
    await host.command("desk.files.save", B);
    const [asked] = ran("desk.palette.pick") as Array<{ items: Array<{ detail: string }> }>;
    expect(asked?.items[0]?.detail).toBe("Replaces b.copy.yaml beside it; b.yaml stays as it is");
  });

  it("Overwrite writes the file, and is not asked again", async () => {
    const { host, app, ran, files } = await yaml(() => "overwrite");
    await host.command("desk.files.save", B);
    expect(files[B.path]).toBe("# made-up\nname: Desk # the name\ncount: 1\n");
    await app.edit([0, 1], "2");
    await host.command("desk.files.save", B);
    expect(files[B.path]).toContain("count: 2");
    expect(ran("desk.palette.pick")).toHaveLength(1);
    expect(files["~/data/b.copy.yaml"]).toBeUndefined();
  });

  it("a cancelled question writes nothing, and the next save asks again", async () => {
    const { host, ran, params, view } = await yaml(() => undefined);
    await expect(host.command("desk.files.save", B)).rejects.toThrow("Did not save b.yaml.");
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Did not save b.yaml.");
    await expect(host.command("desk.files.save", B)).rejects.toThrow();
    expect(ran("desk.palette.pick")).toHaveLength(2);
  });

  it("with the palette off it writes the copy, the default", async () => {
    const files: Record<string, string> = { [B.path]: YAML_TEXT };
    const { host, app, params } = await mount({
      handlers: writable(files),
      commands: { "desk.buffers.update": () => undefined },
    });
    await host.command("desk.files.visit", B);
    await app.edit([0, 0], "Desk");
    await host.command("desk.files.save", B);
    expect(params("fs.write")).toMatchObject([{ path: "~/data/b.copy.yaml" }]);
    expect(files[B.path]).toBe(YAML_TEXT);
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
