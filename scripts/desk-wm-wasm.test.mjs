import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stale, WASM } from "./desk-wm-wasm.mjs";

/** A built module and one source folder, `ahead` ms newer than the module. */
function scene(ahead) {
  const dir = mkdtempSync(join(tmpdir(), "desk-wm-wasm-"));
  const wasm = join(dir, "desk_wm_wasm.wasm");
  const src = join(dir, "src");
  mkdirSync(src);
  writeFileSync(wasm, "");
  writeFileSync(join(src, "lib.rs"), "");
  const at = Date.now() / 1000;
  utimesSync(wasm, at, at);
  utimesSync(join(src, "lib.rs"), at + ahead / 1000, at + ahead / 1000);
  return { wasm, src };
}

test("the module is built where the release build for wasm32-unknown-unknown puts it", () => {
  assert.match(WASM, /wasm32-unknown-unknown[\\/]release[\\/]desk_wm_wasm\.wasm$/);
});

test("a module older than a source of the window manager is built again", () => {
  const { wasm, src } = scene(5_000);
  assert.equal(stale(wasm, [src]), true);
});

test("a module newer than every source is kept, and a missing one is built", () => {
  const { wasm, src } = scene(-5_000);
  assert.equal(stale(wasm, [src]), false);
  assert.equal(stale(join(src, "nothing.wasm"), [src]), true);
});
