// scripts/cef-sign-macos.sh on a miniature CEF desk bundle (#46): copies of /usr/bin/true stand in for
// the desk, the CEF framework and the five helpers. Ad-hoc, as every machine without the Apple
// identity signs; the identity, notarisation and Gatekeeper are #61's to run. macOS only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { helperApps, helperPlist } from "./cef-package/config.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SIGN = join(ROOT, "scripts/cef-sign-macos.sh");
const VERIFY = join(ROOT, "e2e/smoke/verify-signature.sh");
const skip = process.platform === "darwin" ? false : "codesign is macOS's";

const plist = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${Object.entries(entries)
    .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
    .join("")}</dict></plist>\n`;

/** `endue Desk.app` with `helpers` of the five helper apps. */
function bundle(helpers = 5) {
  const dir = mkdtempSync(join(tmpdir(), "cef-sign-"));
  const app = join(dir, "endue Desk.app");
  const contents = join(app, "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  writeFileSync(
    join(contents, "Info.plist"),
    plist({
      CFBundleExecutable: "endue-desk-cef",
      CFBundleIdentifier: "ai.endue.desk.test",
      CFBundlePackageType: "APPL",
    }),
  );
  copyFileSync("/usr/bin/true", join(contents, "MacOS/endue-desk-cef"));
  const cef = join(contents, "Frameworks/Chromium Embedded Framework.framework");
  mkdirSync(join(cef, "Resources"), { recursive: true });
  mkdirSync(join(cef, "Libraries"), { recursive: true });
  writeFileSync(
    join(cef, "Resources/Info.plist"),
    plist({
      CFBundleExecutable: "Chromium Embedded Framework",
      CFBundleIdentifier: "org.cef.framework",
      CFBundlePackageType: "FMWK",
    }),
  );
  copyFileSync("/usr/bin/true", join(cef, "Chromium Embedded Framework"));
  copyFileSync("/usr/bin/true", join(cef, "Libraries/libvulkan.dylib"));
  copyFileSync("/usr/bin/true", join(cef, "Libraries/libcef_sandbox.dylib"));
  const template = readFileSync(join(ROOT, "apps/desk/shell/packager/macos/helper.plist"), "utf8");
  for (const helper of helperApps("ai.endue.desk.test").slice(0, helpers)) {
    const own = join(contents, "Frameworks", `${helper.name}.app`, "Contents");
    mkdirSync(join(own, "MacOS"), { recursive: true });
    writeFileSync(
      join(own, "Info.plist"),
      helperPlist(template, { ...helper, version: "0.5.0", minimum: "12.0" }),
    );
    copyFileSync("/usr/bin/true", join(own, "MacOS", helper.name));
  }
  return { dir, app };
}

const sh = (script, args, env = {}) => {
  const clean = { ...process.env };
  for (const name of Object.keys(clean))
    if (name.startsWith("APPLE_") || name.startsWith("DESK_")) delete clean[name];
  const run = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...clean, ...env } });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
};
const entitlements = (path) =>
  spawnSync("codesign", ["-d", "--entitlements", "-", "--xml", path], { encoding: "utf8" }).stdout;
const flags = (path) => spawnSync("codesign", ["-dv", path], { encoding: "utf8" }).stderr;
const verify = (app) =>
  spawnSync("codesign", ["--verify", "--deep", "--strict", app], { encoding: "utf8" });

describe("cef-sign-macos", { skip }, () => {
  it("signs the framework, each helper with its entitlements and the app, under the hardened runtime", () => {
    const { dir, app } = bundle();
    assert.notEqual(verify(app).status, 0, "copied in, the bundle does not verify");
    const signed = sh(SIGN, ["app", app]);
    assert.equal(signed.code, 0, signed.out);
    assert.match(signed.out, /signed endue Desk\.app as ad-hoc/u);
    assert.match(signed.out, /not notarised: ad-hoc signed/u);
    assert.equal(verify(app).status, 0, verify(app).stderr);
    const helper = (suffix) =>
      join(app, "Contents/Frameworks", `endue-desk-cef Helper${suffix}.app`);
    const main = entitlements(app);
    assert.match(
      main,
      /allow-unsigned-executable-memory/u,
      "wasmtime compiles in the desk's process",
    );
    assert.match(main, /device\.audio-input/u);
    assert.match(entitlements(helper(" (Renderer)")), /cs\.allow-jit/u, "V8");
    assert.match(entitlements(helper(" (GPU)")), /cs\.allow-jit/u, "SwiftShader");
    assert.match(
      entitlements(helper("")),
      /cs\.allow-jit/u,
      "the GPU process, which CEF 156 starts from the base Helper (ADR 0148)",
    );
    assert.doesNotMatch(entitlements(helper(" (Alerts)")), /allow-jit|unsigned-executable/u);
    assert.doesNotMatch(entitlements(helper(" (Plugin)")), /allow-jit|unsigned-executable/u);
    assert.match(
      main,
      /disable-library-validation/u,
      "ad-hoc code has no Team ID to validate the framework by",
    );
    for (const path of [
      app,
      helper(" (Renderer)"),
      join(app, "Contents/Frameworks/Chromium Embedded Framework.framework"),
      // Each helper opens it to enter Chromium's sandbox before the framework loads (ADR 0148).
      join(
        app,
        "Contents/Frameworks/Chromium Embedded Framework.framework/Libraries/libcef_sandbox.dylib",
      ),
    ]) {
      assert.match(flags(path), /flags=0x10002\(adhoc,runtime\)/u, path);
    }
    const code = sh(VERIFY, ["--code", app]);
    assert.equal(code.code, 0, code.out);
    assert.match(code.out, /ad-hoc signed \(valid, not notarised\)/u);
    assert.equal(
      sh(VERIFY, ["--code", app], { DESK_REQUIRE_SIGNED: "1" }).code,
      1,
      "a release needs the identity",
    );
    rmSync(dir, { recursive: true });
  });

  it("acts as cargo-packager's hook only before the dmg, and refuses half a bundle", () => {
    const { dir, app } = bundle(4);
    assert.equal(
      sh(SIGN, ["hook", app], { CARGO_PACKAGER_FORMAT: "app" }).code,
      0,
      "nothing before the app format",
    );
    assert.notEqual(verify(app).status, 0, "and it signed nothing");
    const half = sh(SIGN, ["hook", app], { CARGO_PACKAGER_FORMAT: "dmg" });
    assert.equal(half.code, 1);
    assert.match(half.out, /holds 4 helper apps, CEF needs 5/u);
    rmSync(dir, { recursive: true });
  });

  it("fails a build that must be notarised when it cannot be", () => {
    const { dir, app } = bundle();
    const run = sh(SIGN, ["app", app], { DESK_REQUIRE_NOTARISATION: "1" });
    assert.equal(run.code, 1);
    assert.match(run.out, /is not notarised: ad-hoc signed/u);
    rmSync(dir, { recursive: true });
  });
});
