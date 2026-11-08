import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  committed,
  expected,
  FILES,
  recorded,
  sha256,
  TARBALL,
  TARBALL_SHA256,
  untar,
  VERSION,
  versions,
} from "./vendor-sheetjs.mjs";

/** One ustar header and its data, padded to 512-byte blocks. */
function entry(/** @type {string} */ name, /** @type {string} */ body) {
  const header = new Uint8Array(512);
  header.set(new TextEncoder().encode(name), 0);
  header.set(new TextEncoder().encode(`${body.length.toString(8).padStart(11, "0")}\0`), 124);
  header[156] = "0".charCodeAt(0);
  const data = new Uint8Array(Math.ceil(body.length / 512) * 512);
  data.set(new TextEncoder().encode(body));
  return [header, data];
}

describe("vendor-sheetjs", () => {
  it("the committed copy in plugins/sheets/ui/vendor matches the hashes VERSIONS records", () => {
    const files = committed();
    assert.deepEqual(Object.keys(files).sort(), [...Object.keys(FILES), "VERSIONS"].sort());
    const versionsText = files.VERSIONS ?? "";
    assert.equal(versionsText, versions(files), "VERSIONS is not what the script writes");
    const hashes = recorded(versionsText);
    assert.deepEqual(Object.keys(hashes).sort(), Object.keys(FILES).sort());
    for (const name of Object.keys(FILES)) {
      assert.equal(sha256(files[name] ?? ""), hashes[name], `${name} differs from VERSIONS`);
    }
  });

  it("VERSIONS pins the release tarball by its SHA-256", () => {
    const first = (committed().VERSIONS ?? "").split("\n")[0];
    assert.equal(first, `xlsx ${VERSION} ${TARBALL} sha256:${TARBALL_SHA256}`);
    assert.match(VERSION, /^\d+\.\d+\.\d+$/u);
  });

  it("vendored modules carry no source map comment", () => {
    for (const [name, text] of Object.entries(committed()).filter(([n]) => n.endsWith(".mjs"))) {
      assert.doesNotMatch(text, /sourceMappingURL/u, name);
    }
  });

  it("a tarball with another hash is refused", () => {
    assert.throws(() => expected(new Uint8Array([1, 2, 3])), /expected 8dc73fc3/u);
  });

  it("untar reads the regular files of a ustar archive", () => {
    const blocks = [
      ...entry("package/LICENSE", "Apache"),
      ...entry("package/xlsx.mjs", "x".repeat(600)),
      new Uint8Array(1024),
    ];
    const tar = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const block of blocks) {
      tar.set(block, at);
      at += block.length;
    }
    const files = untar(tar);
    assert.deepEqual([...files.keys()], ["package/LICENSE", "package/xlsx.mjs"]);
    assert.equal(new TextDecoder().decode(files.get("package/LICENSE")), "Apache");
    assert.equal(files.get("package/xlsx.mjs")?.length, 600);
  });
});
