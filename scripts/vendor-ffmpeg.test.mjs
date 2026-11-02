// The player's vendored FFmpeg build (ADR 0050) against what VERSIONS records: every file's SHA-256,
// the glue it was linked with, an LGPL 2.1 configuration, and the release, its SHA-256 and the
// Emscripten image that scripts/vendor-ffmpeg.sh pins. Rebuilding is `scripts/vendor-ffmpeg.sh`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "plugins/player/ui/vendor/ffmpeg");
const SCRIPT = readFileSync(join(ROOT, "scripts/vendor-ffmpeg.sh"), "utf8");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** VERSIONS as { key: value }, with its repeated `file <name> <sha256>` lines in `files`. */
function versions() {
  /** @type {Record<string, string>} */
  const one = {};
  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Record<string, string>} */
  const glue = {};
  for (const line of readFileSync(join(VENDOR, "VERSIONS"), "utf8").split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const at = line.indexOf(" ");
    const key = line.slice(0, at);
    const value = line.slice(at + 1);
    const [first = "", second = ""] = value.split(" ");
    if (key === "file") files[first] = second;
    else if (key === "glue") glue[first] = second;
    else one[key] = value;
  }
  return { ...one, files, glue };
}

/** A NAME=value assignment in the script, with ${OTHER} expanded. */
function pinned(name) {
  const value = new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(SCRIPT)?.[1];
  assert.ok(value, `scripts/vendor-ffmpeg.sh pins no ${name}`);
  return value.replace(/\$\{(\w+)\}/g, (_, other) => pinned(other));
}

describe("vendor-ffmpeg", () => {
  it("every vendored file matches the SHA-256 in VERSIONS, and nothing else is there", () => {
    const { files } = versions();
    assert.deepEqual(readdirSync(VENDOR).sort(), [...Object.keys(files), "VERSIONS"].sort());
    for (const [name, hash] of Object.entries(files))
      assert.equal(sha256(join(VENDOR, name)), hash, `${name} differs from VERSIONS`);
    assert.ok(files["ffmpeg.wasm"], "VERSIONS records no ffmpeg.wasm");
    assert.ok(files["COPYING.LGPLv2.1"], "VERSIONS records no licence");
  });

  it("the wasm was linked with the committed glue, every file of it", () => {
    const { glue } = versions();
    const folder = "plugins/player/wasm";
    const committed = readdirSync(join(ROOT, folder)).map((name) => `${folder}/${name}`);
    assert.deepEqual(Object.keys(glue).sort(), committed.sort());
    for (const [path, hash] of Object.entries(glue))
      assert.equal(sha256(join(ROOT, path)), hash, `${path} changed: run the script`);
  });

  it("the build is LGPL 2.1: no GPL, nonfree or version 3 parts and no external library", () => {
    const { configure = "" } = versions();
    for (const line of [configure, SCRIPT])
      for (const flag of ["--enable-gpl", "--enable-nonfree", "--enable-version3", "--enable-lib"])
        assert.ok(!line.includes(flag), `${flag} in the build`);
    for (const flag of ["--disable-everything", "--disable-autodetect", "--disable-network"])
      assert.ok(configure.includes(flag), `${flag} missing`);
    const licence = readFileSync(join(VENDOR, "COPYING.LGPLv2.1"), "utf8");
    assert.match(licence, /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/);
  });

  it("the script pins the release, its SHA-256 and the image that VERSIONS records", () => {
    const recorded = versions();
    assert.equal(recorded.release, pinned("FFMPEG_URL"));
    assert.equal(recorded["release-sha256"], pinned("FFMPEG_SHA256"));
    assert.equal(recorded.image, pinned("EMSDK_IMAGE"));
    assert.match(pinned("FFMPEG_URL"), /^https:\/\/ffmpeg\.org\/releases\/ffmpeg-[\d.]+\.tar\.xz$/);
    assert.match(pinned("FFMPEG_SHA256"), /^[0-9a-f]{64}$/);
    assert.match(pinned("EMSDK_IMAGE"), /^emscripten\/emsdk:[\d.]+@sha256:[0-9a-f]{64}$/);
  });
});
