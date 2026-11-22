// Installation and PATH activation of the two names supplied by the public CLI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { readPin } from "./cef-fetch.mjs";
import { PACKAGER, packagerConfig } from "./cef-package/config.mjs";

const base = JSON.parse(readFileSync(join(PACKAGER, "packager.json"), "utf8"));
const paths = { binaries: "/bin-build", out: "/out", stage: "/stage", cef: "/cef", dist: "/dist" };

it("ships the canonical CLI, the compatibility command and the opt-in activator", () => {
  for (const target of [
    "aarch64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
  ]) {
    const config = packagerConfig({ base, pin: readPin(), target, version: "0.4.0", paths });
    const resources = Object.fromEntries(config.resources.map(({ src, target }) => [target, src]));
    const windows = target.includes("windows");
    for (const name of ["endue", "desk"]) {
      const file = windows ? name + ".exe" : name;
      assert.equal(resources["cli/" + file], join(paths.binaries, file));
    }
    const script = windows ? "activate.ps1" : "activate";
    assert.equal(resources["cli/" + script], join(PACKAGER, "cli", script));
    assert.ok(existsSync(resources["cli/" + script]));
  }
});

it("activates both Unix names, preserves a foreign command and repeats safely", {
  skip: process.platform === "win32",
}, () => {
  const dir = mkdtempSync(join(tmpdir(), "endue-cli-path-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(dir, "owned app", "cli");
  const bin = join(dir, "path bin");
  const foreign = join(dir, "other provider");
  for (const path of [cli, bin, foreign]) mkdirSync(path, { recursive: true });
  for (const name of ["endue", "desk"]) {
    writeFileSync(join(cli, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  const script = join(cli, "activate");
  writeFileSync(script, readFileSync(join(PACKAGER, "cli", "activate")));
  chmodSync(script, 0o755);
  const activate = (path) =>
    spawnSync(script, [bin], { env: { ...process.env, PATH: path }, encoding: "utf8" });
  const other = join(foreign, "endue");
  writeFileSync(other, "#!/bin/sh\nexit 23\n", { mode: 0o755 });
  const path = [foreign, bin, "/usr/bin", "/bin"].join(":");
  const conflict = activate(path);
  assert.notEqual(conflict.status, 0);
  assert.ok(!existsSync(join(bin, "desk")));
  assert.ok(!existsSync(join(bin, "endue")));
  assert.equal(spawnSync(other).status, 23);
  rmSync(other);
  writeFileSync(join(bin, "desk"), "owned by someone else");
  assert.notEqual(activate(path).status, 0);
  assert.ok(!existsSync(join(bin, "endue")));
  assert.equal(readFileSync(join(bin, "desk"), "utf8"), "owned by someone else");
  rmSync(join(bin, "desk"));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = activate(path);
    assert.equal(result.status, 0, result.stderr);
    for (const name of ["endue", "desk"])
      assert.equal(realpathSync(join(bin, name)), realpathSync(join(cli, name)));
  }
});
