import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createEngine } from "../ui/engine.js";

async function engine() {
  return createEngine(await readFile(new URL("../ui/image-studio.wasm", import.meta.url)));
}

it("replays a saved draft and restores the redo stack from the same bytes", async () => {
  const wasm = await engine();
  expect(wasm.digest(new TextEncoder().encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  wasm.load(2, 1, new Uint8Array([1, 2, 3, 255, 11, 22, 33, 255]));
  const restored = wasm.call({
    type: "replay",
    batches: [[{ op: "rotate", degrees: 90 }], [{ op: "invert" }]],
    undo: 1,
  });
  expect(restored.details).toMatchObject({ width: 1, height: 2, canUndo: true, canRedo: true });
  expect([...wasm.call({ type: "redo" }).data]).toEqual([254, 253, 252, 255, 244, 233, 222, 255]);
});

it("ships a runnable Rust module that rotates pixels, undoes, redoes and exports PNG", async () => {
  const wasm = await engine();
  const a = [255, 0, 0, 255];
  const b = [0, 255, 0, 127];
  const c = [0, 0, 255, 255];
  const d = [255, 255, 255, 255];
  expect(wasm.load(2, 2, new Uint8Array([...a, ...b, ...c, ...d])).details).toEqual({
    width: 2,
    height: 2,
    canUndo: false,
    canRedo: false,
  });
  const rotated = wasm.call({ type: "apply", operations: [{ op: "rotate", degrees: 90 }] });
  expect([...rotated.data]).toEqual([...c, ...a, ...d, ...b]);
  expect([...wasm.call({ type: "undo" }).data]).toEqual([...a, ...b, ...c, ...d]);
  expect([...wasm.call({ type: "redo" }).data]).toEqual([...c, ...a, ...d, ...b]);
  expect([...wasm.call({ type: "export" }).data.subarray(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
});

it("leaves a document untouched when the second edit in a batch fails", async () => {
  const wasm = await engine();
  const original = [255, 0, 0, 255, 0, 0, 255, 0];
  wasm.load(2, 1, new Uint8Array(original));
  expect(() =>
    wasm.call({
      type: "apply",
      operations: [{ op: "invert" }, { op: "crop", x: 3, y: 0, width: 1, height: 1 }],
    }),
  ).toThrow("crop");
  const preview = wasm.call({ type: "preview" });
  expect([...preview.data]).toEqual(original);
  expect(preview.details.canUndo).toBe(false);
  expect([
    ...wasm.call({ type: "apply", operations: [{ op: "resize", width: 1, height: 1 }] }).data,
  ]).toEqual([255, 0, 0, 128]);
});
