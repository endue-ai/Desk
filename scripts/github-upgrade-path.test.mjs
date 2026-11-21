import assert from "node:assert/strict";
import { test } from "node:test";
import { previewPath, tagPath } from "./github-upgrade-path.mjs";
import { releaseManifest } from "./release-manifest.mjs";

const base = "https://github.com/endue-ai/Desk/releases/download";
const build = (version) => ({
  version,
  minFrom: "0.2.0",
  targets: ["darwin-aarch64"],
  rollout: 10,
  release: `releases/${version}/release.json`,
});
const index = { channel: "stable", serial: 3, releases: [build("1.0.0"), build("0.6.0")] };

test("an invalid minimum version fails manifest generation before a final is tagged", () => {
  for (const minFrom of ["invalid", "v0.2.0", "1.0.0", "1.1.0"]) {
    assert.throws(() => releaseManifest({ version: "1.0.0", minFrom, files: [] }), /minFrom/u);
  }
});

test("a signed path binds a tag to its own build, floor, rollout and manifest", () => {
  assert.deepEqual(tagPath(index, "0.6.0", base), {
    channel: "stable",
    serial: 3,
    releases: [{ ...build("0.6.0"), release: `${base}/v0.6.0/release.json` }],
  });
  assert.deepEqual(tagPath(index, "0.7.0", base).releases, []);
  assert.throws(() => tagPath(index, "../main", base));
});

test("a preview snapshot preserves stepping stones and points to their signed manifests", () => {
  const original = { ...index, channel: "beta" };
  const url = "https://releases.example.test/desk";
  const path = previewPath(original, url);
  assert.deepEqual(
    path.releases.map((r) => r.release),
    [`${url}/releases/1.0.0/release.json`, `${url}/releases/0.6.0/release.json`],
  );
  assert.equal(path.releases[0].minFrom, "0.2.0");
  assert.equal(original.releases[0].release, "releases/1.0.0/release.json");
});
