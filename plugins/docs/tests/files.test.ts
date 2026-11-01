import { describe, expect, it } from "vitest";
import { denied, disk, file, mount } from "./harness";
import { utf8 } from "./zip";

const A = file("~/Documents/a.rtf");
const B = file("~/Documents/b.rtf");
const DOCS = { permission: "fs:read", paths: ["~/Documents/**"] } as const;
const rtf = (text: string) => utf8(`{\\rtf1\\ansi ${text}\\par}`);
const granted = ({ permission }: { permission: unknown }) => ({
  granted: true,
  grant: { grantId: "g1", permission, duration: "session", grantedAt: "2026-11-01T09:00:00Z" },
});

/** The words of the document on screen, or null for "No document open". */
const words = (shown: unknown) => {
  if (!shown) return null;
  const { doc } = shown as { doc: { kind: string; sections?: Array<{ blocks: unknown[] }> } };
  if (doc.kind !== "document") return doc.kind;
  return JSON.stringify(doc.sections?.[0]?.blocks).match(/"text":"([^"]*)"/)?.[1];
};

describe("the desk's file requests", () => {
  it("visit reads the file in ranges, shows it and watches it", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: rtf("Alpha") }) });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    // Without fs.url (the test host has none), readBytes asks fs.read for the size, then the bytes.
    expect(host.calls.map((c) => c.method)).toEqual(["fs.url", "fs.read", "fs.read", "fs.watch"]);
    const size = rtf("Alpha").length;
    expect(params("fs.read")).toEqual([
      { path: A.path, encoding: "base64", offset: 0, length: 0, scope: DOCS },
      { path: A.path, encoding: "base64", offset: 0, length: size, scope: DOCS },
    ]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: DOCS }]);
    expect(view.shown.at(-1)).toMatchObject({ ...A, name: "a.rtf", size });
    expect(view.shown.at(-1)).toMatchObject({ doc: { kind: "document", format: "rtf" } });
    expect(words(view.shown.at(-1))).toBe("Alpha");
    expect(view.focused).toBe(1);
    expect(view.statuses).toEqual(["Opening a.rtf…", ""]);
  });

  it("revert reads the file again", async () => {
    const files = { [A.path]: rtf("Alpha") };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    files[A.path] = rtf("Changed");
    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(4);
    expect(words(view.shown.at(-1))).toBe("Changed");
  });

  it("show switches between open documents and closed forgets one", async () => {
    const files = { [A.path]: rtf("Alpha"), [B.path]: rtf("Beta") };
    const { host, view } = await mount({ handlers: disk(files) });
    expect(view.shown.at(-1)).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(words(view.shown.at(-1))).toBe("Beta");

    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.rtf" });
    expect(view.focused).toBe(3);

    await host.command("desk.buffers.closed", { buffer: A.buffer });
    expect(view.shown.at(-1)).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(`No document ${A.buffer}.`);
    await host.command("desk.buffers.show", B);
    expect(words(view.shown.at(-1))).toBe("Beta");
  });

  it("save is refused: the plugin reads and never writes", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: rtf("Alpha") }) });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow("Docs opens files read-only.");
    expect(params("fs.write")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Docs opens files read-only.");
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({ handlers: disk({ [A.path]: rtf("Alpha") }) });
    await host.command("desk.files.visit", A);
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
    await host.command("desk.buffers.closed", { buffer: A.buffer });
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toHaveLength(1);
  });
});

describe("a file the grants do not cover", () => {
  it("is asked for once, for its folder, and refused in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/a.rtf");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", A)).rejects.toThrow(
      "Not allowed to read ~/Documents/a.rtf.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS, reason: "To open ~/Documents/a.rtf in Docs" },
    ]);
    expect(params("fs.read")).toHaveLength(1);
    expect(view.phases.at(-1)).toBeNull();
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/a.rtf.");
    expect(view.shown.at(-1)).toBeNull();
  });

  it("a granted ask reads again and opens the document", async () => {
    let reads = 0;
    const files = disk({ [A.path]: rtf("Alpha") });
    const { host, view, params } = await mount({
      handlers: {
        ...files,
        "fs.read": (params, caller) => {
          if (++reads === 1) throw denied("fs:read over ~/Documents/a.rtf");
          return files["fs.read"]?.(params, caller) as never;
        },
        "perm.request": granted as never,
      },
    });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(3);
    expect(params("perm.request")).toHaveLength(1);
    expect(words(view.shown.at(-1))).toBe("Alpha");
  });

  it("other errors are reported with their code and no ask", async () => {
    const { host, view, params } = await mount({ handlers: disk({}) });
    await expect(host.command("desk.files.visit", A)).rejects.toThrow(
      "Could not read ~/Documents/a.rtf: not_found.",
    );
    expect(params("perm.request")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Could not read ~/Documents/a.rtf: not_found.");
  });
});
