import { describe, expect, it } from "vitest";
import { BridgeClient, browserStub, stubCommands } from "./index";

const MOVIES = { permission: "fs:read", paths: ["~/Movies/**"] } as const;
const PLAYER = { caller: "example.player" };
/** 100 bytes, `3 * i` for byte `i`: not UTF-8 from byte 43 on. */
const BLOB = Uint8Array.from({ length: 100 }, (_, i) => (i * 3) & 0xff);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function client() {
  const core = stubCommands(() => {}, {
    grants: { "example.player": [MOVIES] },
    files: { "~/Movies/clip.mp4": BLOB, "~/Movies/notes.txt": "# Héllo" },
  });
  return new BridgeClient(browserStub(core.handlers));
}

describe("the stub's in-memory files", () => {
  it("fs.read reads a byte range and reports the file's size", async () => {
    const bridge = client();
    const range = { path: "~/Movies/clip.mp4", encoding: "base64", offset: 10, length: 5 } as const;
    expect(await bridge.call("fs.read", { ...range, scope: MOVIES }, PLAYER)).toEqual({
      content: base64(BLOB.subarray(10, 15)),
      encoding: "base64",
      size: 100,
    });
    const whole = await bridge.call(
      "fs.read",
      { path: "~/Movies/notes.txt", scope: MOVIES },
      PLAYER,
    );
    expect(whole).toEqual({ content: "# Héllo", encoding: "utf8", size: 8 });
    const text = { path: "~/Movies/notes.txt", offset: 2, scope: MOVIES };
    expect(await bridge.call("fs.read", text, PLAYER)).toMatchObject({ content: "Héllo" });
  });

  it("a range past the end returns what is there, and length 0 only the size", async () => {
    const bridge = client();
    const read = (offset: number, length?: number) =>
      bridge.call(
        "fs.read",
        { path: "~/Movies/clip.mp4", encoding: "base64", offset, length, scope: MOVIES },
        PLAYER,
      );
    expect(await read(95, 50)).toEqual({
      content: base64(BLOB.subarray(95)),
      encoding: "base64",
      size: 100,
    });
    expect(await read(400, 8)).toEqual({ content: "", encoding: "base64", size: 100 });
    expect(await read(40, 0)).toEqual({ content: "", encoding: "base64", size: 100 });
    const asText = { path: "~/Movies/clip.mp4", offset: 50, scope: MOVIES };
    await expect(bridge.call("fs.read", asText, PLAYER)).rejects.toMatchObject({
      code: "invalid_params",
    });
  });

  it("reads only under a covering grant, and a missing file is not_found", async () => {
    const bridge = client();
    const params = { path: "~/Movies/clip.mp4", scope: MOVIES };
    await expect(
      bridge.call("fs.read", params, { caller: "example.other" }),
    ).rejects.toMatchObject({ code: "permission_denied", permission: MOVIES });
    await expect(
      bridge.call("fs.url", { path: "~/Documents/a.md", scope: MOVIES }, PLAYER),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      bridge.call("fs.read", { path: "~/Movies/none.mp4", scope: MOVIES }, PLAYER),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("fs.url answers a data: URL of the file, with its size and type", async () => {
    const bridge = client();
    const answer = await bridge.call(
      "fs.url",
      { path: "~/Movies/clip.mp4", scope: MOVIES },
      PLAYER,
    );
    expect(answer).toEqual({
      url: `data:video/mp4;base64,${base64(BLOB)}`,
      size: 100,
      type: "video/mp4",
    });
    const bytes = new Uint8Array(await (await fetch(answer.url)).arrayBuffer());
    expect(bytes).toEqual(BLOB);
    const notes = await bridge.call(
      "fs.url",
      { path: "~/Movies/notes.txt", scope: MOVIES },
      PLAYER,
    );
    expect(notes).toMatchObject({ size: 8, type: "application/octet-stream" });
  });
});
