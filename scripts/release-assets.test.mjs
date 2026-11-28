import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  macFiles,
  macImages,
  macSection,
  SUMS,
  tagVersion,
  withMacSection,
} from "./release-assets.mjs";

const SCRIPT = fileURLToPath(new URL("./release-assets.mjs", import.meta.url));
const RELEASE = { repo: "endue-ai/Desk", tag: "v0.1.0", version: "0.1.0" };

describe("release-assets", () => {
  it("uses the endue name in every download and installation note from the 0.4 line", () => {
    for (const version of ["0.4.0-beta.1", "0.4.0", "1.0.0"]) {
      assert.deepEqual(macImages(version), [`endue_${version}_darwin-aarch64.dmg`]);
      const notes = macSection({
        repo: "endue-ai/endue",
        tag: `v${version}`,
        version,
        signed: false,
      });
      assert.match(notes, /endue app for macOS/u);
      assert.doesNotMatch(notes, /\bdesk\b/iu);
    }
    assert.equal(macImages("0.3.1")[0], "endue-desk_0.3.1_darwin-aarch64.dmg");
  });

  it("reads the version a release tag names and refuses any other tag", () => {
    assert.equal(tagVersion("v0.1.0"), "0.1.0");
    assert.equal(tagVersion("v1.2.3-beta.2"), "1.2.3-beta.2");
    for (const tag of ["0.1.0", "v0.1", "vv0.1.0", "v0.1.0+build", "release/v0.1", "v01.0.0", ""]) {
      assert.throws(() => tagVersion(tag), /is not a release tag/u, tag);
    }
  });

  it("attaches the Apple silicon disk image and its checksums, all or nothing (ADR 0402)", () => {
    const images = ["endue-desk_0.1.0_darwin-aarch64.dmg"];
    assert.deepEqual(macImages("0.1.0"), images);
    assert.deepEqual(
      macFiles("dist", "0.1.0", () => true),
      [...images, SUMS],
    );
    assert.throws(
      () => macFiles("dist", "0.1.0", (path) => !path.includes("aarch64")),
      /dist lacks endue-desk_0\.1\.0_darwin-aarch64\.dmg$/u,
    );
  });

  it("links the image and says an ad-hoc build is not notarised and how to open it", () => {
    const adhoc = macSection({ ...RELEASE, signed: false });
    assert.match(
      adhoc,
      /- Apple silicon: \[endue-desk_0\.1\.0_darwin-aarch64\.dmg\]\(https:\/\/github\.com\/endue-ai\/Desk\/releases\/download\/v0\.1\.0\/endue-desk_0\.1\.0_darwin-aarch64\.dmg\)/u,
    );
    assert.doesNotMatch(adhoc, /Intel|x86_64/u);
    assert.match(adhoc, /releases\/download\/v0\.1\.0\/SHA256SUMS-macos\)/u);
    assert.match(adhoc, /not signed with a Developer ID and not notarised/u);
    assert.match(adhoc, /xattr -dr com\.apple\.quarantine "\/Applications\/endue Desk\.app"/u);
    const signed = macSection({ ...RELEASE, signed: true });
    assert.match(signed, /Signed with a Developer ID and notarised by Apple\./u);
    assert.doesNotMatch(signed, /quarantine/u);
  });

  it("keeps the person's notes and replaces the section an earlier run wrote", () => {
    const first = withMacSection("What changed.\n", macSection({ ...RELEASE, signed: false }));
    assert.ok(first.startsWith("What changed.\n\n<!-- release-macos:start -->\n## macOS\n"));
    const second = withMacSection(first, macSection({ ...RELEASE, signed: true }));
    assert.equal(second.match(/## macOS/gu).length, 1);
    assert.ok(second.startsWith("What changed.\n\n"));
    assert.doesNotMatch(second, /quarantine/u);
    assert.ok(withMacSection("", macSection({ ...RELEASE, signed: true })).startsWith("<!--"));
  });

  it("runs from the command line as the workflow calls it", () => {
    assert.equal(
      execFileSync("node", [SCRIPT, "version", "v0.4.1"], { encoding: "utf8" }),
      "0.4.1\n",
    );
    const bad = spawnSync("node", [SCRIPT, "version", "main"], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /release-assets: main is not a release tag/u);
    const dist = mkdtempSync(join(tmpdir(), "release-assets-"));
    for (const name of [...macImages("0.4.1"), SUMS]) writeFileSync(join(dist, name), name);
    const files = execFileSync("node", [SCRIPT, "files", dist, "--version", "0.4.1"], {
      encoding: "utf8",
    });
    assert.deepEqual(
      files.trim().split("\n"),
      [...macImages("0.4.1"), SUMS].map((name) => join(dist, name)),
    );
    const body = join(dist, "body.md");
    writeFileSync(body, "Notes.\n");
    const args = [SCRIPT, "notes", body, "--repo", "endue-ai/Desk", "--tag", "v0.4.1"];
    const notes = execFileSync("node", [...args, "--version", "0.4.1", "--signed", "false"], {
      encoding: "utf8",
    });
    assert.ok(notes.startsWith("Notes.\n\n<!-- release-macos:start -->"));
    const other = spawnSync("node", [...args, "--version", "0.4.2", "--signed", "false"], {
      encoding: "utf8",
    });
    assert.equal(other.status, 1);
    assert.match(other.stderr, /v0\.4\.1 is not version 0\.4\.2/u);
  });
});

it("requires a signed Linux CLI and lists each app and CLI download once on a retry", (t) => {
  const dist = mkdtempSync(join(tmpdir(), "endue-release-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  const version = "0.4.0";
  const tag = `v${version}`;
  const cli = `endue-cli_${version}_linux-x86_64.tar.gz`;
  const desktop = [...macImages(version), SUMS];
  for (const file of desktop) writeFileSync(join(dist, file), file);
  const files = [SCRIPT, "files", dist, "--version", version, "--cli"];
  assert.notEqual(spawnSync("node", files).status, 0);
  for (const file of [cli, `${cli}.sig`, "SHA256SUMS-cli"]) writeFileSync(join(dist, file), file);
  const listed = execFileSync("node", files, { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(
    listed,
    [...desktop, cli, `${cli}.sig`, "SHA256SUMS-cli"].map((file) => join(dist, file)),
  );
  const body = join(dist, "body.md");
  writeFileSync(body, "Release notes.\n");
  const notes = () =>
    execFileSync(
      "node",
      [
        SCRIPT,
        "notes",
        body,
        "--repo",
        "endue-ai/endue",
        "--tag",
        tag,
        "--version",
        version,
        "--signed",
        "true",
        "--cli",
      ],
      { encoding: "utf8" },
    );
  const first = notes();
  writeFileSync(body, first);
  assert.equal(notes(), first);
  assert.ok(first.includes("endue app") && first.includes("endue CLI"));
  assert.ok(
    first.includes(`https://github.com/endue-ai/endue/releases/download/${tag}/${cli}.sig`),
  );
  assert.ok(first.includes("SHA256SUMS-cli") && first.includes("Linux x86_64"));
});
