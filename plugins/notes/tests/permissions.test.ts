import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { denied, disk, mount, note } from "./harness";

const X = note("~/Documents/x.md");
const DOCS_READ = { permission: "fs:read", paths: ["~/Documents/**"] } as const;
const DOCS_WRITE = { permission: "fs:write", paths: ["~/Documents/**"] } as const;

describe("files outside the declared grants", () => {
  it("a refused read is asked for and reported in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/x.md");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.md.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS_READ, reason: "To open ~/Documents/x.md in Notes" },
    ]);
    expect(params("fs.read")).toEqual([{ path: X.path, encoding: "utf8", scope: DOCS_READ }]);
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.md.");
    expect(view.notes.at(-1)).toBeNull();
  });

  it("a granted ask retries the read", async () => {
    let reads = 0;
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          reads++;
          if (reads === 1) throw denied("fs:read over ~/Documents/x.md");
          return { content: "x\n", encoding: "utf8" };
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission,
            duration: "session",
            grantedAt: "2026-10-30T09:00:00Z",
          },
        }),
        "fs.watch": () => ({ watchId: "w1" }),
      },
    });
    await expect(host.command("desk.files.visit", X)).resolves.toBeUndefined();
    const read = { path: X.path, encoding: "utf8", scope: DOCS_READ };
    expect(params("fs.read")).toEqual([read, read]);
    expect(params("perm.request")).toHaveLength(1);
    expect(params("fs.watch")).toEqual([{ path: X.path, scope: DOCS_READ }]);
    expect(view.notes.at(-1)).toEqual({ ...X, name: "x.md", text: "x\n", modified: false });
  });

  it("a refused write keeps the note modified", async () => {
    const { host, view, app, params, settle } = await mount({
      handlers: {
        ...disk({ [X.path]: "x\n" }),
        "fs.write": () => {
          throw denied("fs:write over ~/Documents/x.md");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await host.command("desk.files.visit", X);
    app.edit("x, edited\n");
    await settle();

    await expect(host.command("desk.files.save", X)).rejects.toThrow(
      "Not allowed to write ~/Documents/x.md.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS_WRITE, reason: "To save ~/Documents/x.md" },
    ]);
    expect(params("fs.write")).toHaveLength(1);
    expect(view.notes.at(-1)).toMatchObject({ text: "x, edited\n", modified: true });
    expect(view.statuses.at(-1)).toBe("Not allowed to write ~/Documents/x.md.");
  });

  it("other errors are reported with their code and no ask", async () => {
    const missing = note("~/Notes/missing.md");
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": ({ path }) => {
          throw new StubError("not_found", `no file ${path}`);
        },
        "perm.request": () => ({ granted: true }),
      },
    });
    await expect(host.command("desk.files.visit", missing)).rejects.toThrow(
      "Could not read ~/Notes/missing.md: not_found.",
    );
    expect(params("perm.request")).toEqual([]);
    expect(params("fs.read")).toHaveLength(1);
    expect(view.statuses.at(-1)).toBe("Could not read ~/Notes/missing.md: not_found.");
  });
});
