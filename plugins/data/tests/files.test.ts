import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { plainOf } from "../ui/tree.js";
import { denied, disk, file, folderRead, mount } from "./harness";
import { rootOf } from "./nodes";

const A = file("~/data/a.json");
const B = file("~/data/b.yaml");
const READ = folderRead(A.path);

describe("the desk's file requests", () => {
  it("visit uses bounded base64 fallback ranges, shows its tree and watches it", async () => {
    const { host, view, params } = await mount({
      handlers: disk({ [A.path]: '{ "name": "desk" }\n' }),
    });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(params("fs.read").slice(0, 2)).toEqual([
      { path: A.path, encoding: "base64", scope: READ, offset: 0, length: 0 },
      { path: A.path, encoding: "base64", scope: READ, offset: 0, length: 19 },
    ]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: READ }]);
    const shown = view.shown.at(-1);
    expect(shown).toMatchObject({ ...A, name: "a.json", size: 19, maskKeys: true });
    expect(shown?.opened).toMatchObject({ format: "json", label: "JSON" });
    expect(plainOf(rootOf(shown?.opened.doc))).toEqual({ name: "desk" });
    expect(view.focused).toBe(1);
    expect(view.statuses.at(-1)).toBe("Opened a.json as JSON.");
  });

  it("revert reads the file again", async () => {
    const files: Record<string, string> = { [A.path]: '{ "v": 1 }' };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    files[A.path] = '{ "v": 2 }';
    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(
      params("fs.read").filter(
        (p) =>
          (p as { path: string; length: number }).path === A.path &&
          (p as { length: number }).length > 0,
      ),
    ).toHaveLength(2);
    expect(plainOf(rootOf(view.shown.at(-1)?.opened.doc))).toEqual({ v: 2 });
  });

  it("show switches between open files and closed forgets one", async () => {
    const files = { [A.path]: "[1]", [B.path]: "b: 2\n" };
    const { host, view } = await mount({ handlers: disk(files) });
    expect(view.shown.at(-1)).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(view.shown.at(-1)).toMatchObject({ buffer: B.buffer, name: "b.yaml" });
    expect(view.shown.at(-1)?.opened.format).toBe("yaml");

    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.json" });
    expect(view.focused).toBe(3);

    await host.command("desk.buffers.closed", { buffer: A.buffer, path: A.path });
    expect(view.shown.at(-1)).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(`No file ${A.buffer}.`);
    await host.command("desk.buffers.show", B);
    expect(view.shown.at(-1)).toMatchObject({ buffer: B.buffer });
  });

  it("save is refused: the plugin opens files read-only", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: "{}" }) });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow("Data opens files read-only.");
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Data opens files read-only.");
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({ handlers: disk({ [A.path]: "{}" }) });
    await host.command("desk.files.visit", A);
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
    host.emit({ event: "fs.changed", data: { watchId: "w9", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toHaveLength(1);
  });
});

describe("files outside the grants", () => {
  const X = file("~/Documents/x.toml");
  const DOCS = folderRead(X.path);

  it("a refused read asks once for the file's folder and reports a refusal in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/x.toml");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.toml.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS, reason: "To open ~/Documents/x.toml in Data" },
    ]);
    expect(params("fs.read")).toEqual([
      { path: X.path, encoding: "base64", scope: DOCS, offset: 0, length: 0 },
    ]);
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.toml.");
    expect(view.shown.at(-1)).toBeNull();
  });

  it("a granted ask reads again", async () => {
    let reads = 0;
    const { host, view, params } = await mount({
      handlers: {
        ...disk({ [X.path]: 'title = "x"\n' }),
        "fs.read": ({ path, offset = 0, length }) => {
          reads++;
          if (reads === 1) throw denied(`fs:read over ${path}`);
          const bytes = Buffer.from('title = "x"\n');
          return {
            content: bytes
              .subarray(offset, length === undefined ? undefined : offset + length)
              .toString("base64"),
            encoding: "base64",
            size: bytes.length,
          };
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission,
            duration: "session",
            grantedAt: "2026-11-01T09:00:00Z",
          },
        }),
      },
    });
    await expect(host.command("desk.files.visit", X)).resolves.toBeUndefined();
    expect(params("perm.request")).toHaveLength(1);
    expect(params("fs.read").slice(0, 2)).toEqual([
      { path: X.path, encoding: "base64", scope: DOCS, offset: 0, length: 0 },
      { path: X.path, encoding: "base64", scope: DOCS, offset: 0, length: 0 },
    ]);
    expect(plainOf(rootOf(view.shown.at(-1)?.opened.doc))).toEqual({ title: "x" });
  });

  it("other errors say their code and ask nothing", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": ({ path }) => {
          throw new StubError("not_found", `no file ${path}`);
        },
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Could not read ~/Documents/x.toml: not_found.",
    );
    expect(params("perm.request")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Could not read ~/Documents/x.toml: not_found.");
  });
});

describe("files it cannot show", () => {
  it("opens them as a details view with the name, size, format and why", async () => {
    const damaged = file("~/data/broken.plist");
    const newer = file("~/data/new.plist");
    const empty = file("~/data/empty.json");
    const nul = file("~/data/blob.yaml");
    const { host, view } = await mount({
      handlers: disk({
        [damaged.path]: "bplist00\x00\x01",
        [newer.path]: "bplist16\x00\x01\x02",
        [empty.path]: "",
        [nul.path]: new Uint8Array([0x00, 0xff, 0x00, 0xfe, 0x00, 0x01]),
      }),
    });
    await host.command("desk.files.visit", damaged);
    expect(view.shown.at(-1)).toMatchObject({ name: "broken.plist", size: 10 });
    expect(view.shown.at(-1)?.opened).toMatchObject({ label: "Property list (binary)" });
    expect(view.shown.at(-1)?.opened.reason).toMatch(/damaged|ends early/i);
    expect(view.statuses.at(-1)).toMatch(/^broken\.plist: /);

    await host.command("desk.files.visit", newer);
    expect(view.shown.at(-1)?.opened.reason).toMatch(/bplist16/);

    await host.command("desk.files.visit", empty);
    expect(view.shown.at(-1)?.opened.reason).toBe("The file is empty.");

    await host.command("desk.files.visit", nul);
    expect(view.shown.at(-1)?.opened.reason).toMatch(/not text/);
    expect(view.shown.at(-1)?.opened.doc).toBeUndefined();
  });
});
