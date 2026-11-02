import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collect } from "./release-collect.mjs";

/** A bundle folder as Tauri leaves it: `files` by folder. */
function bundle(files) {
  const root = mkdtempSync(join(tmpdir(), "release-collect-"));
  for (const [folder, names] of Object.entries(files)) {
    mkdirSync(join(root, folder), { recursive: true });
    for (const name of names) writeFileSync(join(root, folder, name), `${folder}/${name}`);
  }
  return root;
}

describe("release-collect", () => {
  it("renames a macOS build's updater archive, its signature and the disk image", () => {
    const root = bundle({
      macos: ["endue Desk.app.tar.gz", "endue Desk.app.tar.gz.sig"],
      dmg: ["endue Desk_0.2.0_aarch64.dmg"],
    });
    const out = join(root, "dist");
    const names = collect({ bundle: root, version: "0.2.0", target: "darwin-aarch64", out });
    assert.deepEqual(names, [
      "endue-desk_0.2.0_darwin-aarch64.app.tar.gz",
      "endue-desk_0.2.0_darwin-aarch64.app.tar.gz.sig",
      "endue-desk_0.2.0_darwin-aarch64.dmg",
    ]);
    assert.deepEqual(readdirSync(out).sort(), [...names].sort());
    const signature = readFileSync(
      join(out, "endue-desk_0.2.0_darwin-aarch64.app.tar.gz.sig"),
      "utf8",
    );
    assert.equal(signature, "macos/endue Desk.app.tar.gz.sig");
  });

  it("takes the NSIS installer on Windows and the AppImage, deb and rpm on Linux", () => {
    const windows = bundle({
      nsis: ["endue Desk_0.2.0_x64-setup.exe", "endue Desk_0.2.0_x64-setup.exe.sig"],
    });
    const out = join(windows, "dist");
    assert.deepEqual(
      collect({ bundle: windows, version: "0.2.0", target: "windows-x86_64", out }),
      [
        "endue-desk_0.2.0_windows-x86_64-setup.exe",
        "endue-desk_0.2.0_windows-x86_64-setup.exe.sig",
      ],
    );
    const linux = bundle({
      appimage: ["endue Desk_0.2.0_amd64.AppImage", "endue Desk_0.2.0_amd64.AppImage.sig"],
      deb: ["endue Desk_0.2.0_amd64.deb", "endue Desk_0.2.0_amd64.deb.sig"],
      rpm: ["endue Desk-0.2.0-1.x86_64.rpm", "endue Desk-0.2.0-1.x86_64.rpm.sig"],
    });
    const names = collect({
      bundle: linux,
      version: "0.2.0",
      target: "linux-x86_64",
      out: join(linux, "dist"),
    });
    assert.equal(names.length, 6);
    assert.ok(names.includes("endue-desk_0.2.0_linux-x86_64.rpm.sig"));
  });

  it("fails with the name of a missing artifact or signature", () => {
    const unsigned = bundle({ nsis: ["endue Desk_0.2.0_x64-setup.exe"] });
    assert.throws(
      () =>
        collect({
          bundle: unsigned,
          version: "0.2.0",
          target: "windows-x86_64",
          out: join(unsigned, "d"),
        }),
      /no signature beside .*setup\.exe/u,
    );
    const empty = bundle({ macos: [] });
    assert.throws(
      () =>
        collect({
          bundle: empty,
          version: "0.2.0",
          target: "darwin-x86_64",
          out: join(empty, "d"),
        }),
      /expected one \.app\.tar\.gz/u,
    );
    assert.throws(
      () => collect({ bundle: empty, version: "0.2.0", target: "darwin-universal", out: "d" }),
      /unknown target/u,
    );
  });
});
