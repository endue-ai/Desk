/**
 * The window manager for the runtime's unit tests (#83): crates/desk-wm as WebAssembly, which
 * vitest's global setup builds (`scripts/desk-wm-wasm.mjs`), compiled once and instantiated afresh
 * for each desk. Only tests import this.
 */
import { readFileSync } from "node:fs";
import { WASM } from "../../../../scripts/desk-wm-wasm.mjs";
import { type LocalWindowManager, localWindowManager } from "./local";

let module: WebAssembly.Module | undefined;

/** A fresh desk-wm on an app `size` big (1440 × 900 by default). */
export function testWindowManager(size?: { w: number; h: number }): LocalWindowManager {
  module ??= new WebAssembly.Module(readFileSync(WASM));
  return localWindowManager(module, size);
}
