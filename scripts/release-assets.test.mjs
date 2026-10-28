import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { collect } from "./release-assets.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "release-assets-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const builds = {
  "desk-aarch64-apple-darwin/macos/endue Desk.app/Contents/Info.plist": "plist",
  "desk-aarch64-apple-darwin/macos/endue Desk.app.tar.gz": "app",
  "desk-aarch64-apple-darwin/macos/endue Desk.app.tar.gz.sig": "sig-mac\n",
  "desk-aarch64-apple-darwin/dmg/endue Desk_1.2.3_aarch64.dmg": "dmg",
  "desk-x86_64-pc-windows-msvc/nsis/endue Desk_1.2.3_x64-setup.exe": "exe",
  "desk-x86_64-pc-windows-msvc/nsis/endue Desk_1.2.3_x64-setup.exe.sig": "sig-win",
  "desk-x86_64-pc-windows-msvc/msi/endue Desk_1.2.3_x64_en-US.msi": "msi",
  "desk-x86_64-unknown-linux-gnu/appimage/endue Desk_1.2.3_amd64.AppImage": "appimage",
  "desk-x86_64-unknown-linux-gnu/appimage/endue Desk_1.2.3_amd64.AppImage.sig": "sig-linux",
  "desk-x86_64-unknown-linux-gnu/deb/endue Desk_1.2.3_amd64.deb": "deb",
};

describe("release-assets", () => {
  it("names every bundle by version and platform and points the updater at them", () => {
    const input = tree(builds);
    const { assets, manifest, problems } = collect({
      input,
      version: "1.2.3",
      repo: "endue-ai/Desk",
      date: "2026-10-28T00:00:00.000Z",
    });
    assert.deepEqual(problems, []);
    assert.deepEqual(assets.map((a) => a.name).sort(), [
      "endue-desk_1.2.3_darwin-aarch64.app.tar.gz",
      "endue-desk_1.2.3_darwin-aarch64.dmg",
      "endue-desk_1.2.3_linux-x86_64.AppImage",
      "endue-desk_1.2.3_linux-x86_64.deb",
      "endue-desk_1.2.3_windows-x86_64-setup.exe",
      "endue-desk_1.2.3_windows-x86_64.msi",
    ]);
    const base = "https://github.com/endue-ai/Desk/releases/download/v1.2.3";
    assert.deepEqual(manifest, {
      version: "1.2.3",
      notes: "https://github.com/endue-ai/Desk/releases/tag/v1.2.3",
      pub_date: "2026-10-28T00:00:00.000Z",
      platforms: {
        "darwin-aarch64": {
          signature: "sig-mac",
          url: `${base}/endue-desk_1.2.3_darwin-aarch64.app.tar.gz`,
        },
        "windows-x86_64": {
          signature: "sig-win",
          url: `${base}/endue-desk_1.2.3_windows-x86_64-setup.exe`,
        },
        "linux-x86_64": {
          signature: "sig-linux",
          url: `${base}/endue-desk_1.2.3_linux-x86_64.AppImage`,
        },
      },
    });
  });

  it("refuses unsigned updater bundles and builds without one", () => {
    const input = tree({
      "desk-x86_64-apple-darwin/macos/endue Desk.app.tar.gz": "app",
      "desk-x86_64-unknown-linux-gnu/deb/endue Desk_1.2.3_amd64.deb": "deb",
    });
    const { problems } = collect({ input, version: "1.2.3", repo: "endue-ai/Desk" });
    assert.deepEqual(problems, [
      "endue Desk.app.tar.gz has no .sig: was TAURI_SIGNING_PRIVATE_KEY set?",
      "desk-x86_64-apple-darwin: no updater bundle",
      "desk-x86_64-unknown-linux-gnu: no updater bundle",
    ]);
  });
});
