import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  entryFor,
  listed,
  promotable,
  pruned,
  readDist,
  releaseManifest,
  targetsOf,
  unlisted,
} from "./release-manifest.mjs";

const BASE = "https://releases.example.test/desk";

/** A release folder for 0.2.0 as the build jobs leave it. */
function dist() {
  const root = mkdtempSync(join(tmpdir(), "release-manifest-"));
  const files = {
    "endue-desk_0.2.0_darwin-aarch64.app.tar.gz": "mac arm",
    "endue-desk_0.2.0_darwin-aarch64.dmg": "mac arm image",
    "endue-desk_0.2.0_windows-x86_64-setup.exe": "windows",
    "endue-desk_0.2.0_linux-x86_64.AppImage": "linux appimage",
    "endue-desk_0.2.0_linux-x86_64.deb": "linux deb",
    SHA256SUMS: "sums",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(root, name), text);
    if (!name.endsWith(".dmg") && name !== "SHA256SUMS")
      writeFileSync(join(root, `${name}.sig`), `sig of ${name}\n`);
  }
  return root;
}

const entry = (version, date) => ({
  version,
  date,
  rollout: 100,
  targets: ["linux-x86_64"],
  release: `releases/${version}/release.json`,
});
const NOW = "2026-11-20T09:00:00Z";

describe("release-manifest", () => {
  it("release.json lists every updater artifact under each target name the updater looks up", () => {
    const files = readDist(dist(), "0.2.0");
    assert.deepEqual(files.map((f) => f.name).sort(), [
      "endue-desk_0.2.0_darwin-aarch64.app.tar.gz",
      "endue-desk_0.2.0_linux-x86_64.AppImage",
      "endue-desk_0.2.0_linux-x86_64.deb",
      "endue-desk_0.2.0_windows-x86_64-setup.exe",
    ]);
    const release = releaseManifest({
      version: "0.2.0",
      base: `${BASE}/`,
      notes: "https://github.com/endue-ai/Desk/releases/tag/v0.2.0",
      commit: "c46d12b",
      date: NOW,
      files,
    });
    assert.deepEqual(Object.keys(release.platforms).sort(), [
      "darwin-aarch64",
      "darwin-aarch64-app",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
    assert.deepEqual(release.platforms["windows-x86_64-nsis"], {
      url: `${BASE}/releases/0.2.0/endue-desk_0.2.0_windows-x86_64-setup.exe`,
      signature: "sig of endue-desk_0.2.0_windows-x86_64-setup.exe",
    });
    assert.equal(
      release.platforms["linux-x86_64"].url,
      release.platforms["linux-x86_64-appimage"].url,
    );
    // sha256 of the 9 bytes "linux deb".
    assert.deepEqual(release.desk.artifacts["linux-x86_64-deb"], {
      sha256: createHash("sha256").update("linux deb").digest("hex"),
      size: 9,
    });
    assert.equal(release.desk.minFrom, undefined);
    assert.equal(
      releaseManifest({
        version: "0.2.0",
        base: BASE,
        notes: "",
        commit: "c",
        date: NOW,
        minFrom: "0.1.0",
        files,
      }).desk.minFrom,
      "0.1.0",
    );
    assert.equal(
      targetsOf("endue-desk_0.2.0_darwin-aarch64.dmg", "0.2.0").length,
      0,
      "a disk image is for people",
    );
    assert.throws(
      () => releaseManifest({ version: "0.2.0", base: BASE, files: [] }),
      /no updater artifacts/u,
    );
  });

  it("list puts a build in version order, replaces its own version and raises the serial", () => {
    const first = listed(undefined, entry("0.2.1-pre.4", NOW), { channel: "canary", now: NOW });
    assert.equal(first.serial, 1);
    const second = listed(first, entry("0.2.1-pre.10", NOW), { channel: "canary", now: NOW });
    const third = listed(second, entry("0.2.1-pre.4", "2026-11-21T00:00:00Z"), {
      channel: "canary",
      now: NOW,
    });
    assert.deepEqual(
      third.releases.map((r) => r.version),
      ["0.2.1-pre.10", "0.2.1-pre.4"],
    );
    assert.equal(third.releases[1].date, "2026-11-21T00:00:00Z");
    assert.equal(third.serial, 3);
    assert.equal(third.channel, "canary");
    const release = releaseManifest({
      version: "0.2.0",
      base: BASE,
      notes: "n",
      commit: "c46d12b",
      date: NOW,
      files: readDist(dist(), "0.2.0"),
    });
    assert.deepEqual(entryFor(release), {
      version: "0.2.0",
      commit: "c46d12b",
      date: NOW,
      rollout: 100,
      targets: [
        "darwin-aarch64",
        "darwin-aarch64-app",
        "linux-x86_64",
        "linux-x86_64-appimage",
        "linux-x86_64-deb",
        "windows-x86_64",
        "windows-x86_64-nsis",
      ],
      release: "releases/0.2.0/release.json",
    });
  });

  it("unlist removes only the named build", () => {
    const index = listed(
      listed(undefined, entry("0.1.0", NOW), { channel: "stable", now: NOW }),
      entry("0.2.0", NOW),
      { channel: "stable", now: NOW },
    );
    const after = unlisted(index, "0.2.0", { now: NOW });
    assert.deepEqual(
      after.releases.map((r) => r.version),
      ["0.1.0"],
    );
    assert.equal(after.serial, index.serial + 1);
    assert.throws(() => unlisted(after, "0.3.0", { now: NOW }), /not on the stable index/u);
  });

  it("prune drops canary builds older than two weeks but the newest, deleting only unlisted files", () => {
    const old = "2026-11-01T00:00:00Z";
    let index;
    for (const [version, date] of [
      ["0.2.1-pre.1", old],
      ["0.2.1-pre.2", old],
      ["0.2.1-pre.3", "2026-11-10T00:00:00Z"],
    ]) {
      index = listed(index, entry(version, date), { channel: "canary", now: NOW });
    }
    const beta = { channel: "beta", serial: 1, releases: [entry("0.2.1-pre.2", old)] };
    const { index: kept, remove } = pruned(index, { now: NOW, days: 14, keep: [beta] });
    assert.deepEqual(
      kept.releases.map((r) => r.version),
      ["0.2.1-pre.3"],
    );
    assert.deepEqual(remove, ["0.2.1-pre.1"], "beta still lists pre.2");
    assert.equal(kept.serial, index.serial + 1);
    const lone = listed(undefined, entry("0.2.1-pre.1", old), { channel: "canary", now: NOW });
    assert.deepEqual(pruned(lone, { now: NOW }), { index: lone, remove: [] }, "the newest stays");
  });

  it("pick chooses the newest build that has been on canary three days", () => {
    let index;
    for (const [version, date] of [
      ["0.2.1-pre.5", "2026-11-15T00:00:00Z"],
      ["0.2.1-pre.6", "2026-11-17T08:00:00Z"],
      ["0.2.1-pre.7", "2026-11-19T00:00:00Z"],
    ]) {
      index = listed(index, entry(version, date), { channel: "canary", now: NOW });
    }
    assert.equal(promotable(index, { now: NOW, days: 3 }), "0.2.1-pre.6");
    assert.equal(promotable(index, { now: "2026-11-16T00:00:00Z", days: 3 }), undefined);
  });
});

/** specs/update/v0, the formats a desk reads (#319): one validator per document. */
function updateSpec() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const name of ["index", "release"]) {
    const url = new URL(`../specs/update/v0/${name}.schema.json`, import.meta.url);
    ajv.addSchema(JSON.parse(readFileSync(url, "utf8")));
  }
  const id = (doc, def) => `https://endue.ai/specs/update/v0/${doc}.schema.json#/$defs/${def}`;
  const check = (validate, value, what) =>
    assert.ok(validate(value), `${what}: ${JSON.stringify(validate.errors, null, 2)}`);
  const index = ajv.getSchema(id("index", "ReleaseIndex"));
  const release = ajv.getSchema(id("release", "ReleaseManifest"));
  return {
    index: (value, what) => check(index, value, what),
    release: (value, what) => check(release, value, what),
  };
}

describe("release-manifest and specs/update/v0", () => {
  it("release.json and index.json written by the scripts pass specs/update/v0", () => {
    const spec = updateSpec();
    const root = mkdtempSync(join(tmpdir(), "release-spec-"));
    for (const name of [
      "endue-desk_0.2.0_darwin-aarch64.app.tar.gz",
      "endue-desk_0.2.0_windows-x86_64-setup.exe",
      "endue-desk_0.2.0_linux-x86_64.deb",
    ]) {
      writeFileSync(join(root, name), `bytes of ${name}`);
      const signature = Buffer.from(`untrusted comment: signature of ${name}\n`).toString("base64");
      writeFileSync(join(root, `${name}.sig`), `${signature}\n`);
    }
    const release = releaseManifest({
      version: "0.2.0",
      base: BASE,
      notes: "https://github.com/endue-ai/Desk/releases/tag/v0.2.0",
      commit: "c46d12b7e1a0c46d12b7e1a0c46d12b7e1a0c46d",
      date: NOW,
      minFrom: "0.1.0",
      files: readDist(root, "0.2.0"),
    });
    spec.release(release, "release.json");
    const first = listed(undefined, entryFor(release), { channel: "canary", now: NOW });
    spec.index(first, "the first canary index");
    const older = { ...entryFor(release), version: "0.1.9", date: "2026-10-01T09:00:00Z" };
    const two = listed(first, older, { channel: "canary", now: NOW });
    spec.index(two, "an index of two");
    spec.index(unlisted(two, "0.1.9", { now: NOW }), "an index after a rollback");
    spec.index(pruned(two, { now: NOW, days: 14 }).index, "a pruned index");
    assert.equal(two.serial, 2);
  });
});

