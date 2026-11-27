#!/usr/bin/env node
// Build the wasm shipped in the plugin folder so the installed plugin works from its own assets.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const target = resolve(root, process.env.CARGO_TARGET_DIR ?? "target");
const actual = join(target, "wasm32-unknown-unknown", "release", "desk_image_studio.wasm");
const asset = join(root, "plugins", "image-studio", "ui", "image-studio.wasm");
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
const flags = [
  `--remap-path-prefix=${homedir()}=/build-home`,
  `--remap-path-prefix=${cargoHome}=/cargo`,
  `--remap-path-prefix=${root}=/src`,
].join("\u001f");
const build = spawnSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "-p",
    "desk-image-studio",
    "--target",
    "wasm32-unknown-unknown",
    "--target-dir",
    target,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags, CARGO_PROFILE_RELEASE_STRIP: "symbols" },
  },
);
if (build.status !== 0) throw build.error ?? new Error("Could not build Image Studio's engine.");
copyFileSync(actual, asset);
chmodSync(asset, 0o644);
