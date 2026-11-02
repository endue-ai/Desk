import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  type FsReadPermission,
  type FsWritePermission,
  stubCommands,
} from "./index";

const READ: FsReadPermission = { permission: "fs:read", paths: ["~/Notes/**"] };
const WRITE: FsWritePermission = { permission: "fs:write", paths: ["~/Notes/**"] };
const NOTES = { caller: "example.notes" };
const PATH = "~/Notes/plan.md";

/** SHA-256 of `text` as lowercase hex, as the core names a version's bytes. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function client() {
  const core = stubCommands(() => {}, {
    grants: { "example.notes": [READ, WRITE], "example.reader": [READ] },
    files: { [PATH]: "# one" },
    now: () => "2026-11-02T09:00:00.000Z",
  });
  return new BridgeClient(browserStub(core.handlers));
}

const write = (bridge: BridgeClient, content: string) =>
  bridge.call("fs.write", { path: PATH, content, scope: WRITE }, NOTES);
const read = async (bridge: BridgeClient) =>
  (await bridge.call("fs.read", { path: PATH, scope: READ }, NOTES)).content;

describe("the stub's history of its in-memory files", () => {
  it("fs.write keeps the bytes it replaces and fs.history lists them newest first", async () => {
    const bridge = client();
    const first = await write(bridge, "# two");
    expect(first).toEqual({ bytesWritten: 5, version: expect.stringMatching(/^\d+-[0-9a-f]{6}$/) });
    await write(bridge, "# three");
    expect(await read(bridge)).toBe("# three");

    const { versions } = await bridge.call("fs.history", { path: PATH, scope: READ }, NOTES);
    expect(versions).toEqual([
      expect.objectContaining({ caller: "example.notes", size: 5, sha256: await sha256("# two") }),
      {
        id: first.version,
        at: "2026-11-02T09:00:00.000Z",
        caller: "example.notes",
        size: 5,
        sha256: await sha256("# one"),
      },
    ]);
    const newest = await bridge.call("fs.history", { path: PATH, limit: 1, scope: READ }, NOTES);
    expect(newest.versions).toHaveLength(1);
  });

  it("a new file and the same bytes keep nothing", async () => {
    const bridge = client();
    const created = await bridge.call(
      "fs.write",
      { path: "~/Notes/new.md", content: "x", scope: WRITE },
      NOTES,
    );
    expect(created).toEqual({ bytesWritten: 1 });
    expect(await write(bridge, "# one")).toEqual({ bytesWritten: 5 });
    const { versions } = await bridge.call("fs.history", { path: PATH, scope: READ }, NOTES);
    expect(versions).toEqual([]);
  });

  it("fs.restore writes a version back and keeps what it replaced", async () => {
    const bridge = client();
    const { version } = await write(bridge, "# two");
    const restored = await bridge.call(
      "fs.restore",
      { path: PATH, version: version as string, scope: WRITE },
      NOTES,
    );
    expect(restored).toEqual({ bytesWritten: 5, version: expect.any(String) });
    expect(await read(bridge)).toBe("# one");
    const { versions } = await bridge.call("fs.history", { path: PATH, scope: READ }, NOTES);
    expect(versions.map((v) => v.id)).toEqual([restored.version, version]);
    await expect(
      bridge.call("fs.restore", { path: PATH, version: "1-abcdef", scope: WRITE }, NOTES),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("checks the scopes as the core does", async () => {
    const bridge = client();
    const { version } = await write(bridge, "# two");
    const reader = { caller: "example.reader" };
    expect(
      (await bridge.call("fs.history", { path: PATH, scope: READ }, reader)).versions,
    ).toHaveLength(1);
    await expect(
      bridge.call("fs.restore", { path: PATH, version: version as string, scope: WRITE }, reader),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      bridge.call("fs.write", { path: PATH, content: "x", scope: WRITE }, reader),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      bridge.call("fs.history", { path: PATH, scope: READ }, { caller: "example.other" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const outside = { permission: "fs:write" as const, paths: ["~/Other/**"] };
    await expect(
      bridge.call("fs.write", { path: PATH, content: "x", scope: outside }, NOTES),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});
