// The CEF desk's cargo-packager config per OS (#46): the helper apps CEF needs on macOS, CEF's files
// beside the executable on Windows and Linux, nothing that would make cargo-packager sign, and the
// bundle layout scripts/release-collect.mjs reads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { readPin } from "./cef-fetch.mjs";
import {
  bundleFolder,
  helperApps,
  helperPlist,
  numericVersion,
  packagerConfig,
} from "./cef-package/config.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGER = join(ROOT, "apps/desk/shell/packager");
const base = JSON.parse(readFileSync(join(PACKAGER, "packager.json"), "utf8"));
const pin = readPin();
const paths = { binaries: "/b", out: "/o/raw", stage: "/o/stage", cef: "/cef", dist: "/dist" };
const render = (target, extra = {}) =>
  packagerConfig({ base, pin, target, version: "0.5.0-rc.3", paths, ...extra });
const targets = (config) => Object.fromEntries(config.resources.map((r) => [r.target, r.src]));

describe("cef-package", () => {
  it("lays out the CEF framework and the five helper apps CEF looks for on macOS", () => {
    const config = render("aarch64-apple-darwin", { hook: "bash sign.sh hook app" });
    assert.deepEqual(config.formats, ["app", "dmg"]);
    assert.equal(config.productName, "endue Desk");
    assert.deepEqual(config.binaries, [{ path: "endue-desk-cef", main: true }]);
    assert.deepEqual(config.macos.frameworks, [
      "/cef/Chromium Embedded Framework.framework",
      "/o/stage/helpers/endue-desk-cef Helper.app",
      "/o/stage/helpers/endue-desk-cef Helper (Alerts).app",
      "/o/stage/helpers/endue-desk-cef Helper (GPU).app",
      "/o/stage/helpers/endue-desk-cef Helper (Plugin).app",
      "/o/stage/helpers/endue-desk-cef Helper (Renderer).app",
    ]);
    const ids = helperApps("ai.endue.desk").map((h) => h.identifier);
    assert.equal(new Set(ids).size, 5, "every helper has an identifier of its own");
    assert.ok(ids.includes("ai.endue.desk.helper.renderer"));
    assert.equal(targets(config).shell, "/dist", "the shell's files in Contents/Resources/shell");
    assert.equal(
      targets(config)["licenses/CEF-LICENSE.txt"],
      "/cef/LICENSE.txt",
      "CEF's BSD licence ships",
    );
    assert.equal(
      config.beforeEachPackageCommand,
      "bash sign.sh hook app",
      "the app is signed before the dmg",
    );
  });

  it("never lets cargo-packager sign or show a licence, and passes only fields it knows", () => {
    for (const target of [
      "aarch64-apple-darwin",
      "x86_64-pc-windows-msvc",
      "x86_64-unknown-linux-gnu",
    ]) {
      const config = render(target);
      assert.equal(config.$comment, undefined, `${target}: cargo-packager refuses unknown fields`);
      assert.equal(
        config.macos?.signingIdentity,
        undefined,
        "cef-sign-macos.sh signs, one helper at a time",
      );
      assert.equal(config.macos?.entitlements, undefined);
      assert.equal(
        config.licenseFile,
        undefined,
        "no licence to accept in the .dmg or the installers",
      );
      assert.equal(config.windows?.signCommand, undefined, "no Windows signing without a command");
      assert.equal(config.name, "desk-shell");
      for (const icon of config.icons) assert.ok(icon.startsWith(ROOT), icon);
    }
  });

  it("puts CEF's files beside the executable on Windows and signs through the given command", () => {
    const config = render("x86_64-pc-windows-msvc", { signCommand: "signer sign %1" });
    assert.deepEqual(config.formats, ["nsis", "wix"]);
    assert.equal(config.binariesDir, "/b");
    const t = targets(config);
    for (const name of [
      "libcef.dll",
      "chrome_elf.dll",
      "icudtl.dat",
      "resources.pak",
      "v8_context_snapshot.bin",
      "locales",
    ]) {
      assert.equal(t[name], `/o/stage/cef/${name}`, name);
    }
    assert.equal(t.shell, "/dist", "the shell beside the exe, where paths::dist looks");
    assert.equal(config.windows.signCommand, "signer sign %1");
    assert.equal(
      config.nsis.installMode,
      "currentUser",
      "NSIS installs and updates per user (ADR 0054)",
    );
  });

  it("puts the executable beside libcef.so in /usr/lib on Linux, with a launcher on PATH", () => {
    const config = render("x86_64-unknown-linux-gnu");
    assert.deepEqual(config.formats, ["deb", "appimage"]);
    assert.equal(config.binariesDir, "/o/stage/bin", "the launcher is what lands in /usr/bin");
    const t = targets(config);
    assert.equal(t["endue-desk-cef"], "/b/endue-desk-cef", "the real executable is a resource");
    for (const name of ["libcef.so", "chrome-sandbox", "libvulkan.so.1", "locales"]) {
      assert.equal(t[name], `/o/stage/cef/${name}`, name);
    }
    assert.equal(
      config.deb.packageName,
      "endue-desk",
      "the same package as the Tauri desk, so apt upgrades it",
    );
    assert.ok(
      config.appimage.excludedLibs.includes("libcef.so"),
      "linuxdeploy does not copy libcef.so twice",
    );
    const launcher = readFileSync(join(PACKAGER, "linux/launcher.sh"), "utf8");
    assert.match(launcher, /exec "\$here\/\.\.\/lib\/endue-desk-cef\/endue-desk-cef" "\$@"/u);
  });

  it("writes each helper's Info.plist with Apple's numeric version", () => {
    const template = readFileSync(join(PACKAGER, "macos/helper.plist"), "utf8");
    const [gpu] = helperApps("ai.endue.desk").filter((h) => h.suffix === " (GPU)");
    const plist = helperPlist(template, { ...gpu, version: "0.5.0-pre.212", minimum: "12.0" });
    assert.match(
      plist,
      /<key>CFBundleExecutable<\/key>\s*<string>endue-desk-cef Helper \(GPU\)<\/string>/u,
    );
    assert.match(
      plist,
      /<key>CFBundleIdentifier<\/key>\s*<string>ai\.endue\.desk\.helper\.gpu<\/string>/u,
    );
    assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>0\.5\.0<\/string>/u);
    assert.match(
      plist,
      /<key>LSUIElement<\/key>\s*<string>1<\/string>/u,
      "helpers never show in the Dock",
    );
    assert.doesNotMatch(plist, /@[A-Z]+@/u);
    assert.equal(numericVersion("1.2.3+build.4"), "1.2.3");
    assert.throws(
      () => helperPlist("@NOPE@", { ...gpu, version: "1.0.0", minimum: "12.0" }),
      /unknown placeholder/u,
    );
  });

  it("files every output where release-collect looks for it", () => {
    assert.equal(bundleFolder("endue Desk.app.tar.gz"), "macos");
    assert.equal(bundleFolder("endue Desk_0.5.0_aarch64.dmg"), "dmg");
    assert.equal(bundleFolder("endue Desk_0.5.0_x64-setup.exe"), "nsis");
    assert.equal(bundleFolder("endue Desk_0.5.0_x64_en-US.msi"), "msi");
    assert.equal(bundleFolder("endue-desk-cef_0.5.0_x86_64.AppImage"), "appimage");
    assert.equal(bundleFolder("endue-desk-cef_0.5.0_amd64.deb"), "deb");
    assert.equal(
      bundleFolder("endue Desk.app"),
      undefined,
      "the .app itself ships inside the archive",
    );
  });

  it("a dry run prints the config for any target without CEF or a build", () => {
    const run = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts/cef-package.mjs"),
        "--target",
        "x86_64-pc-windows-msvc",
        "--version",
        "1.0.0",
        "--cef",
        "/nowhere",
        "--dry-run",
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const config = JSON.parse(run.stdout);
    assert.equal(config.version, "1.0.0");
    assert.ok(config.resources.some((r) => r.target === "libcef.dll"));
  });
});
