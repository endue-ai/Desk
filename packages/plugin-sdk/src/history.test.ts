import type { FsReadPermission, FsWritePermission } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { connect, fileHistory, restoreFile } from "./index";
import { createTestHost } from "./testing/index";

const READ: FsReadPermission = { permission: "fs:read", paths: ["~/Notes/**"] };
const WRITE: FsWritePermission = { permission: "fs:write", paths: ["~/Notes/**"] };
const PATH = "~/Notes/plan.md";

async function plugin() {
  const host = createTestHost({
    pluginId: "example.notes",
    grants: [READ, WRITE],
    files: { [PATH]: "# one" },
    now: () => "2026-11-02T09:00:00.000Z",
  });
  const ctx = await connect(host.transport);
  return { host, ctx };
}

describe("a file's history", () => {
  it("fileHistory lists the versions the desk kept, newest first, with fs.history", async () => {
    const { host, ctx } = await plugin();
    await ctx.bridge.call("fs.write", { path: PATH, content: "# two", scope: WRITE });
    await ctx.bridge.call("fs.write", { path: PATH, content: "# three", scope: WRITE });

    const versions = await fileHistory(ctx, { path: PATH, scope: READ });
    expect(versions.map((v) => v.size)).toEqual([5, 5]);
    expect(versions[0]).toMatchObject({ caller: "example.notes", at: "2026-11-02T09:00:00.000Z" });
    const newest = await fileHistory(ctx, { path: PATH, scope: READ }, { limit: 1 });
    expect(newest).toEqual(versions.slice(0, 1));
    const asked = host.calls.filter((call) => call.method === "fs.history");
    expect(asked.map((call) => call.params)).toEqual([
      { path: PATH, scope: READ },
      { path: PATH, limit: 1, scope: READ },
    ]);
  });

  it("restoreFile writes a version back with fs.restore and answers what it kept", async () => {
    const { host, ctx } = await plugin();
    const written = await ctx.bridge.call("fs.write", { path: PATH, content: "# two", scope: WRITE });
    const restored = await restoreFile(ctx, { path: PATH, scope: WRITE }, written.version as string);
    expect(restored).toEqual({ bytesWritten: 5, version: expect.any(String) });
    const read = await ctx.bridge.call("fs.read", { path: PATH, scope: READ });
    expect(read.content).toBe("# one");
    expect(host.calls.filter((call) => call.method === "fs.restore")).toHaveLength(1);
  });

  it("a refused restore rejects as fs.restore does", async () => {
    const { ctx } = await plugin();
    await expect(
      restoreFile(ctx, { path: PATH, scope: WRITE }, "1-abcdef"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
