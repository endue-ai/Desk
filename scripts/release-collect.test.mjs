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

  it("a_pre_release_carries_no_rpm_whose_version_takes_no_hyphen", () => {
    const linux = bundle({
      appimage: [
        "endue Desk_0.2.1-pre.48_amd64.AppImage",
        "endue Desk_0.2.1-pre.48_amd64.AppImage.sig",
      ],
      deb: ["endue Desk_0.2.1-pre.48_amd64.deb", "endue Desk_0.2.1-pre.48_amd64.deb.sig"],
    });
    const names = collect({
      bundle: linux,
      version: "0.2.1-pre.48",
      target: "linux-x86_64",
      out: join(linux, "dist"),
    });
    assert.deepEqual(names, [
      "endue-desk_0.2.1-pre.48_linux-x86_64.AppImage",
      "endue-desk_0.2.1-pre.48_linux-x86_64.AppImage.sig",
      "endue-desk_0.2.1-pre.48_linux-x86_64.deb",
      "endue-desk_0.2.1-pre.48_linux-x86_64.deb.sig",
    ]);
    const release = bundle({ appimage: [], deb: [] });
    assert.throws(
      () =>
        collect({
          bundle: release,
          version: "0.2.0",
          target: "linux-x86_64",
          out: join(release, "d"),
        }),
      /expected one \.AppImage/u,
    );
  });

  it("the_cef_desk_adds_an_msi_beside_nsis_and_ships_no_rpm", () => {
    const windows = bundle({
      nsis: ["endue Desk_0.5.0_x64-setup.exe", "endue Desk_0.5.0_x64-setup.exe.sig"],
      msi: ["endue Desk_0.5.0_x64_en-US.msi", "endue Desk_0.5.0_x64_en-US.msi.sig"],
    });
    assert.deepEqual(
      collect({
        bundle: windows,
        version: "0.5.0",
        target: "windows-x86_64",
        out: join(windows, "dist"),
        shell: "cef",
      }),
      [
        "endue-desk_0.5.0_windows-x86_64-setup.exe",
        "endue-desk_0.5.0_windows-x86_64-setup.exe.sig",
        "endue-desk_0.5.0_windows-x86_64.msi",
        "endue-desk_0.5.0_windows-x86_64.msi.sig",
      ],
      "an MSI install updates through the MSI, so it carries the updater signature (#47)",
    );
    assert.throws(
      () =>
        collect({
          bundle: bundle({ nsis: ["a-setup.exe", "a-setup.exe.sig"] }),
          version: "0.5.0",
          target: "windows-x86_64",
          out: join(windows, "d"),
          shell: "cef",
        }),
      /expected one \.msi/u,
    );
    const linux = bundle({
      appimage: ["endue-desk_0.5.0_x86_64.AppImage", "endue-desk_0.5.0_x86_64.AppImage.sig"],
      deb: ["endue-desk_0.5.0_amd64.deb", "endue-desk_0.5.0_amd64.deb.sig"],
    });
    const names = collect({
      bundle: linux,
      version: "0.5.0",
      target: "linux-x86_64",
      out: join(linux, "dist"),
      shell: "cef",
    });
    assert.equal(names.length, 4, "a final of the CEF desk has no .rpm: cargo-packager makes none");
    assert.throws(
      () =>
        collect({
          bundle: linux,
          version: "0.5.0",
          target: "linux-x86_64",
          out: "d",
          shell: "electron",
        }),
      /unknown shell/u,
    );
  });
});
