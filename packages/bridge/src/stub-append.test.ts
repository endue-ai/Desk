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
const PATH = "~/Notes/rows.tsv";

function client() {
  const core = stubCommands(() => {}, {
    grants: { "example.notes": [READ, WRITE] },
    files: { [PATH]: "1\tone\n" },
    now: () => "2026-11-22T09:00:00.000Z",
  });
  return new BridgeClient(browserStub(core.handlers));
}

describe("the stub's fs.write with append (ADR 0356)", () => {
  it("fs.write appends at the end in place and keeps no version", async () => {
    const bridge = client();
    const append = (path: string, content: string, encoding?: "base64") =>
      bridge.call(
        "fs.write",
        { path, content, append: true, scope: WRITE, ...(encoding ? { encoding } : {}) },
        NOTES,
      );
    expect(await append(PATH, "2\ttwo\n")).toEqual({ bytesWritten: 6 });
    expect(await append(PATH, btoa("3\tthree\n"), "base64")).toEqual({ bytesWritten: 8 });
    const read = await bridge.call("fs.read", { path: PATH, scope: READ }, NOTES);
    expect(read.content).toBe("1\tone\n2\ttwo\n3\tthree\n");
    const { versions } = await bridge.call("fs.history", { path: PATH, scope: READ }, NOTES);
    expect(versions).toEqual([]);
    await expect(append("~/Notes/missing.tsv", "x")).rejects.toMatchObject({ code: "not_found" });
  });
});
