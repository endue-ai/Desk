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

/**
 * The same, with each batch of edits applied a task later, in order, as the compositor's window
 * manager does (the edit travels to the shell and its desk comes back): the runtime asks again
 * before the desk of what it asked first is in (issue 160).
 */
export function lateWindowManager(size?: { w: number; h: number }): LocalWindowManager {
  const wm = testWindowManager(size);
  return {
    ...wm,
    edit: (edits) => new Promise((later) => setTimeout(later, 0)).then(() => wm.edit(edits)),
  };
}
