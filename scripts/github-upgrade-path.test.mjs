import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { githubManifest, previewPath, tagPath } from "./github-upgrade-path.mjs";
import { entryFor, releaseManifest } from "./release-manifest.mjs";

const base = "https://github.com/endue-ai/Desk/releases/download";
const build = (version) => ({
  version,
  minFrom: "0.2.0",
  targets: ["darwin-aarch64"],
  rollout: 10,
  release: `releases/${version}/release.json`,
});
const index = { channel: "stable", serial: 3, releases: [build("1.0.0"), build("0.6.0")] };

test("both published tags keep the exact path Desk verifies before checking the version floor", (t) => {
  const dist = mkdtempSync(join(tmpdir(), "endue-tag-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  for (const [repo, version, floor] of [
    ["endue-ai/Desk", "0.3.1", "0.3.0"],
    [undefined, "0.4.0", "0.3.1"],
    ["endue-ai/endue", "0.6.0", "0.5.0"],
  ]) {
    const prefix = version === "0.3.1" ? "endue-desk" : "endue";
    const name = `${prefix}_${version}_linux-x86_64.deb`;
    writeFileSync(join(dist, name), version);
    writeFileSync(join(dist, `${name}.sig`), "test-signature");
    const manifest = githubManifest(dist, version, "c46d12b", floor, repo);
    const path = tagPath({ ...index, releases: [entryFor(manifest)] }, version);
    assert.equal(path.releases[0].release, `${base}/v${version}/release.json`);
    assert.equal(path.releases[0].minFrom, floor);
    const releases = `https://github.com/${repo ?? "endue-ai/endue"}/releases`;
    assert.equal(manifest.notes, `${releases}/tag/v${version}`);
    assert.equal(
      manifest.platforms["linux-x86_64-deb"].url,
      `${releases}/download/v${version}/${name}`,
    );
  }
});

test("an invalid minimum version fails manifest generation before a final is tagged", () => {
  for (const minFrom of ["invalid", "v0.2.0", "1.0.0", "1.1.0"]) {
    assert.throws(() => releaseManifest({ version: "1.0.0", minFrom, files: [] }), /minFrom/u);
  }
});

test("a signed path binds a tag to its own build, floor, rollout and manifest", () => {
  assert.deepEqual(tagPath(index, "0.6.0"), {
    channel: "stable",
    serial: 3,
    releases: [{ ...build("0.6.0"), release: `${base}/v0.6.0/release.json` }],
  });
  assert.deepEqual(tagPath(index, "0.7.0").releases, []);
  assert.throws(() => tagPath(index, "../main"));
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
