#!/usr/bin/env node
// desk-wm as WebAssembly (#83): the window manager the runtime's unit tests and fixture pages run,
// since they have no compositor (crates/desk-wm-wasm). Built with cargo for wasm32-unknown-unknown
// when a source of the window manager is newer than the module (cargo itself does nothing when it
// is up to date, but asking costs a second per test file); its path is what the tests and the
// fixture server read.
//
//   node scripts/desk-wm-wasm.mjs        build it, print its path
//   import { deskWmWasm } from ...       the same, from a script; vitest's global setup runs it

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, "target");
export const WASM = join(TARGET, "wasm32-unknown-unknown/release/desk_wm_wasm.wasm");
const SOURCES = ["crates/desk-wm", "crates/desk-wm-wasm", "crates/desk-bridge"].map((d) =>
  join(REPO, d),
);

/** The newest change under `dir`, in milliseconds. */
function newest(dir) {
  let at = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "target" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    at = Math.max(at, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return at;
}

/** Whether the module is older than the window manager's sources. */
export function stale(wasm = WASM, sources = SOURCES) {
  if (!existsSync(wasm)) return true;
  const built = statSync(wasm).mtimeMs;
  return sources.some((dir) => newest(dir) > built);
}

/** Build the module if it is stale; its path. */
export function deskWmWasm() {
  if (!stale()) return WASM;
  const args = ["build", "-q", "-p", "desk-wm-wasm", "--target", "wasm32-unknown-unknown"];
  const built = spawnSync("cargo", [...args, "--release"], {
    cwd: REPO,
    stdio: "inherit",
    env: { CARGO_INCREMENTAL: "0", ...process.env },
  });
  if (built.status !== 0) throw new Error("cargo could not build desk-wm-wasm");
  return WASM;
}

/** vitest's global setup: the tests read the module from DESK_WM_WASM. */
export default function setup() {
  process.env.DESK_WM_WASM = deskWmWasm();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(deskWmWasm());
