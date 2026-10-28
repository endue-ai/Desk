import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { APP, check, ROOT } from "./os-declarations.mjs";

/** A copy of the app's declarations to break in one place. */
function copy() {
  const root = mkdtempSync(join(tmpdir(), "os-declarations-"));
  for (const file of ["tauri.conf.json", "Info.plist", "Entitlements.plist"]) {
    cpSync(join(ROOT, APP, file), join(root, APP, file), { recursive: true });
  }
  return root;
}

const edit = (root, file, change) => {
  const path = join(root, APP, file);
  writeFileSync(path, change(readFileSync(path, "utf8")));
};

describe("os-declarations", () => {
  it("finds the app's declarations complete", () => {
    assert.deepEqual(check(), []);
  });

  it("names a missing microphone sentence", () => {
    const root = copy();
    edit(root, "Info.plist", (text) => text.replace("NSMicrophoneUsageDescription", "Nothing"));
    assert.deepEqual(check(root), [
      "Info.plist NSMicrophoneUsageDescription is missing; the microphone (audio.capture) needs it",
    ]);
  });

  it("names a missing or false entitlement", () => {
    const root = copy();
    edit(root, "Entitlements.plist", (text) =>
      text.replace(/(virtualization<\/key>\s*)<true\/>/, "$1<false/>"),
    );
    assert.deepEqual(check(root), [
      "entitlement com.apple.security.virtualization is missing; the tool VM (desk-vm) needs it",
    ]);
  });

  it("names unset files and Linux packages without ALSA", () => {
    const root = copy();
    edit(root, "tauri.conf.json", (text) => {
      const config = JSON.parse(text);
      delete config.bundle.macOS.entitlements;
      config.bundle.linux.deb.depends = [];
      return JSON.stringify(config);
    });
    assert.deepEqual(check(root), [
      "bundle.macOS.entitlements is not set",
      "bundle.linux.deb.depends lacks libasound2 (the microphone)",
    ]);
  });
});
