// Exercise the installer against real, signed miniature bundles in a disposable Applications folder.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { PACKAGER } from "./config.mjs";

it("installs once, updates a user-renamed Desk, and leaves a foreign endue.app alone", {
  skip: process.platform !== "darwin",
}, () => {
  const root = mkdtempSync(join(tmpdir(), "endue-install-"));
  try {
    const apps = join(root, "Applications");
    mkdirSync(apps);
    const bundle = (dir, id) => {
      const contents = join(dir, "Contents");
      mkdirSync(join(contents, "MacOS"), { recursive: true });
      execFileSync("cp", ["/usr/bin/true", join(contents, "MacOS/endue-desk")]);
      writeFileSync(
        join(contents, "Info.plist"),
        `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>endue-desk</string></dict></plist>`,
      );
    };
    const source = join(root, "endue.app");
    bundle(source, "ai.endue.desktop");
    const resources = join(source, "Contents/Resources");
    mkdirSync(resources);
    const helper = join(resources, "install-endue");
    execFileSync("xcrun", [
      "clang",
      "-fobjc-arc",
      "-framework",
      "Foundation",
      "-framework",
      "Security",
      join(PACKAGER, "macos/install.m"),
      "-o",
      helper,
    ]);
    execFileSync("codesign", ["--force", "-s", "-", helper]);
    execFileSync("codesign", ["--force", "-s", "-", source]);
    const run = (...args) => spawnSync(helper, ["--apps-dir", apps, ...args], { encoding: "utf8" });
    const ok = (...args) => {
      const result = run(...args);
      assert.equal(result.status, 0, result.stderr);
    };
    ok();
    const canonical = join(apps, "endue.app");
    assert.ok(existsSync(join(canonical, "Contents/MacOS/endue-desk")));
    const mine = join(apps, "Studio.app");
    renameSync(canonical, mine);
    bundle(canonical, "org.example.unrelated");
    const foreign = join(canonical, "Contents/Info.plist");
    const original = readFileSync(foreign);
    ok();
    ok();
    assert.deepEqual(readFileSync(foreign), original);
    assert.deepEqual(readdirSync(apps).sort(), ["Studio.app", "endue.app"]);
    assert.notEqual(run("--to", canonical).status, 0);
    rmSync(mine, { recursive: true });
    assert.notEqual(run().status, 0);
    ok("--to", mine);
    assert.deepEqual(readFileSync(foreign), original);
    assert.equal(execFileSync("codesign", ["--verify", "--deep", "--strict", mine]).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
