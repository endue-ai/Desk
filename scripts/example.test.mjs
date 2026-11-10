// scripts/example.mjs: a native example's program goes where its manifest names it for this
// platform; other examples need no build.
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { plan, platform } from "./example.mjs";

const root = resolve(import.meta.dirname, "..");

test("platforms are named as Rust names them", () => {
  assert.equal(platform("darwin", "arm64"), "macos-aarch64");
  assert.equal(platform("linux", "x64"), "linux-x86_64");
  assert.equal(platform("win32", "x64"), "windows-x86_64");
  assert.throws(() => platform("aix", "ppc64"), /no native plugins/);
});

test("the native example builds its crate into the path its manifest names", () => {
  const steps = plan("plugin-native-wgpu", root, "macos-aarch64");
  assert.deepEqual(steps, {
    crate: "plugin-native-wgpu",
    built: join(root, "target/debug/plugin-native-wgpu"),
    to: join(root, "examples/plugin-native-wgpu/bin/macos-aarch64/plugin-native-wgpu"),
  });
  const windows = plan("plugin-native-wgpu", root, "windows-x86_64");
  assert.ok(windows.built.endsWith("plugin-native-wgpu.exe"));
  assert.ok(windows.to.endsWith("bin/windows-x86_64/plugin-native-wgpu.exe"));
});

test("a web example needs no build, and a name never leaves examples/", () => {
  assert.equal(plan("plugin-hello-ui", root), undefined);
  assert.throws(() => plan("../plugins/sidebar", root), /not an example name/);
});
