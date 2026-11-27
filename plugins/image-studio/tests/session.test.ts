import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { createEngine } from "../ui/engine.js";
import { createFiles } from "../ui/files.js";
import { createSession } from "../ui/session.js";

it("protects revisions and only writes to the path accepted by the export dialog", async () => {
  const wasm = await createEngine(
    await readFile(new URL("../ui/image-studio.wasm", import.meta.url)),
  );
  const source = "~/Pictures/input.png";
  const output = "~/Pictures/result.png";
  const call = vi.fn(async (method, params) => {
    if (method === "dialog.open") return { paths: [source] };
    if (method === "dialog.save") return { path: output };
    if (method === "fs.write")
      return { bytesWritten: Buffer.from(params.content, "base64").length };
    throw new Error(method);
  });
  const pixels = new Uint8Array([10, 20, 30, 100, 40, 50, 60, 200]);
  const byteSource = vi.fn(async () => ({ size: pixels.length, read: async () => pixels.slice() }));
  const engine = {
    connected: () => true,
    async call(request: { type: string; bytes?: Uint8Array }) {
      return request.type === "open" && request.bytes
        ? { ...wasm.load(2, 1, request.bytes), digest: "original" }
        : wasm.call(request);
    },
    reset() {},
  };
  const session = createSession(createFiles({ bridge: { call } }, byteSource), engine, vi.fn());
  const opened = await session.open(undefined);
  expect(opened).toMatchObject({ path: source, revision: 0, width: 2, height: 1, dirty: false });
  expect(byteSource).toHaveBeenCalledWith(expect.anything(), {
    path: source,
    scope: { permission: "fs:read", paths: [source] },
  });
  const edited = await session.edit("apply", {
    ...opened,
    operations: [{ op: "rotate", degrees: 90 }],
  });
  expect(edited).toMatchObject({ revision: 1, width: 1, height: 2, dirty: true });
  await expect(session.edit("undo", opened)).rejects.toThrow("document changed");
  await expect(session.open("~/Pictures/other.png")).rejects.toThrow("current draft");
  expect(call.mock.calls.map(([method]) => method)).toEqual(["dialog.open"]);
  await expect(session.export()).resolves.toMatchObject({ path: output });
  expect(call.mock.calls.map(([method]) => method)).toEqual([
    "dialog.open",
    "dialog.save",
    "fs.write",
  ]);
  expect(call.mock.lastCall?.[1]).toMatchObject({
    path: output,
    encoding: "base64",
    scope: { permission: "fs:write", paths: [output] },
  });
  expect(session.inspect()).toMatchObject({ revision: 1, dirty: false });
});
