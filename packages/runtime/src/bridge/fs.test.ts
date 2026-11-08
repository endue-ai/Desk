import {
  type BridgeEvent,
  type FsReadPermission,
  type FsWritePermission,
  StubError,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "./core";
import { normalizePath, stubFileTree } from "./fs";

const WRITE: FsWritePermission = {
  permission: "fs:write",
  paths: ["~/Documents/**", "~/Desktop/**"],
};
const READ: FsReadPermission = { permission: "fs:read", paths: ["~/Documents/**", "~/Desktop/**"] };
const NOW = Date.parse("2026-11-07T09:00:00.000Z");

const tree = (options: Parameters<typeof stubFileTree>[0] = {}) =>
  stubFileTree({
    files: { "~/Documents/plan.md": "# plan", "~/Documents/Trips/rome.md": "Roma" },
    folders: ["~/Desktop"],
    now: () => NOW,
    ...options,
  });

/** The error code a handler throws. */
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof StubError) return error.code;
    throw error;
  }
  throw new Error("it did not throw");
};

describe("the browser stub's file tree (ADR 0125)", () => {
  it("normalizes paths as desk-core does", () => {
    expect(normalizePath("~/a/./b/../c/")).toBe("~/a/c");
    expect(normalizePath("/srv//x")).toBe("/srv/x");
    expect(() => normalizePath("relative/x")).toThrow(StubError);
  });

  it("fs.stat answers kind, size, modifiedAt and readOnly", () => {
    const { handlers } = tree();
    expect(handlers["fs.stat"]({ path: "~/Documents/plan.md", scope: READ }, "p")).toEqual({
      kind: "file",
      size: 6,
      modifiedAt: "2026-11-07T09:00:00.000Z",
      readOnly: false,
    });
    expect(handlers["fs.stat"]({ path: "~/Documents/Trips", scope: READ }, "p")).toMatchObject({
      kind: "dir",
      readOnly: false,
    });
    expect(code(() => handlers["fs.stat"]({ path: "~/Documents/x", scope: READ }, "p"))).toBe(
      "not_found",
    );
  });

  it("fs.mkdir creates a folder with its missing parents and answers what it created", () => {
    const { handlers, tree: files } = tree();
    const deep = { path: "~/Documents/2026/11", scope: WRITE };
    expect(code(() => handlers["fs.mkdir"](deep, "p"))).toBe("not_found");
    expect(handlers["fs.mkdir"]({ ...deep, parents: true }, "p")).toEqual({
      created: ["~/Documents/2026", "~/Documents/2026/11"],
    });
    expect(files.entries()["~/Documents/2026/11"]).toBeNull();
    expect(code(() => handlers["fs.mkdir"](deep, "p"))).toBe("already_exists");
  });

  it("fs.rename moves a file and a folder with its contents, and never overwrites", () => {
    const { handlers, tree: files } = tree();
    const moved = handlers["fs.rename"](
      { from: "~/Documents/plan.md", to: "~/Desktop/plan.md", scope: WRITE },
      "p",
    );
    expect(moved).toEqual({ crossedDevices: false });
    expect(files.read("~/Desktop/plan.md")).toBe("# plan");
    expect(files.read("~/Documents/plan.md")).toBeUndefined();
    handlers["fs.rename"]({ from: "~/Documents/Trips", to: "~/Desktop/Trips", scope: WRITE }, "p");
    expect(files.read("~/Desktop/Trips/rome.md")).toBe("Roma");
    expect(Object.keys(files.entries()).some((p) => p.startsWith("~/Documents/Trips"))).toBe(false);

    const onto = { from: "~/Desktop/plan.md", to: "~/Desktop/Trips/rome.md", scope: WRITE };
    expect(code(() => handlers["fs.rename"](onto, "p"))).toBe("already_exists");
    expect(files.read("~/Desktop/Trips/rome.md")).toBe("Roma");
    const inside = { from: "~/Desktop/Trips", to: "~/Desktop/Trips/deeper", scope: WRITE };
    expect(code(() => handlers["fs.rename"](inside, "p"))).toBe("invalid_params");
  });

  it("checks the scope at both ends before anything moves", () => {
    const { handlers, tree: files } = tree();
    const out = { from: "~/Documents/plan.md", to: "~/Music/plan.md", scope: WRITE };
    expect(code(() => handlers["fs.rename"](out, "p"))).toBe("permission_denied");
    const copyOut = { ...out, fromScope: READ };
    expect(code(() => handlers["fs.copy"](copyOut, "p"))).toBe("permission_denied");
    expect(files.read("~/Documents/plan.md")).toBe("# plan");
    // The grants decide too: `check` refuses a caller that holds nothing.
    const refuse = tree({
      check: (caller, scope) => {
        if (caller !== "desk") throw new StubError("permission_denied", "no grant", scope);
      },
    });
    const inside = { from: "~/Documents/plan.md", to: "~/Desktop/plan.md", scope: WRITE };
    expect(code(() => refuse.handlers["fs.rename"](inside, "example.other"))).toBe(
      "permission_denied",
    );
    expect(refuse.handlers["fs.rename"](inside, "desk")).toEqual({ crossedDevices: false });
  });

  it("fs.copy copies a folder tree and answers the bytes copied", () => {
    const { handlers, tree: files } = tree();
    const copied = handlers["fs.copy"](
      { from: "~/Documents", to: "~/Desktop/Documents", scope: WRITE, fromScope: READ },
      "p",
    );
    expect(copied).toEqual({ bytesCopied: 10 });
    expect(files.read("~/Desktop/Documents/Trips/rome.md")).toBe("Roma");
    expect(files.read("~/Documents/Trips/rome.md")).toBe("Roma");
  });

  it("fs.trash moves a path to the trash, or answers unsupported where there is none", () => {
    const { handlers, tree: files } = tree();
    expect(handlers["fs.trash"]({ path: "~/Documents/Trips", scope: WRITE }, "p")).toEqual({});
    expect(files.trashed()).toEqual(["~/Documents/Trips"]);
    expect(files.read("~/Documents/Trips/rome.md")).toBeUndefined();
    const everything: FsWritePermission = { permission: "fs:write", paths: ["~/**"] };
    const home = { path: "~", scope: everything };
    expect(code(() => handlers["fs.trash"](home, "p"))).toBe("invalid_params");

    const none = tree({ trash: false });
    const plan = { path: "~/Documents/plan.md", scope: WRITE };
    expect(code(() => none.handlers["fs.trash"](plan, "p"))).toBe("unsupported");
    expect(none.tree.read("~/Documents/plan.md")).toBe("# plan");
  });

  it("serves a browser core, and its watches hear the moves", async () => {
    const events: BridgeEvent[] = [];
    const files = tree({ emit: (event) => core.stub.emit(event) });
    const core = browserCore({ manifests: [], handlers: files.handlers });
    core.client.onEvent((event) => events.push(event));
    const { watchId } = await core.client.call("fs.watch", { path: "~/Desktop", scope: READ });
    await core.client.call("fs.rename", {
      from: "~/Documents/plan.md",
      to: "~/Desktop/plan.md",
      scope: WRITE,
    });
    const listed = await core.client.call("fs.list", { path: "~/Desktop", scope: READ });
    expect(listed.entries.map((entry) => entry.name)).toEqual(["plan.md"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual({
      event: "fs.changed",
      data: { watchId, path: "~/Desktop/plan.md", change: "created" },
    });
  });
});
