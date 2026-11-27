// The database plugin's vendored SQL parser (ADR 0283) against what VERSIONS records: every file's
// SHA-256, the pinned tarball and libpg_query commit, the three licences, and the glue's two edits.
// Updating is: change the pins, run `node scripts/vendor-libpg-query.mjs`, commit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMIT,
  committed,
  esm,
  expected,
  LICENCES,
  NAMES,
  PACKAGE,
  recorded,
  TARBALL,
  TARBALL_SHA256,
  VERSION,
  versions,
} from "./vendor-libpg-query.mjs";
import { sha256 } from "./vendor-sheetjs.mjs";

const text = (/** @type {Uint8Array | undefined} */ bytes) => new TextDecoder().decode(bytes);

describe("vendor-libpg-query", () => {
  it("the committed copy in plugins/database/ui/vendor matches the hashes VERSIONS records", () => {
    const files = committed();
    assert.deepEqual(Object.keys(files).sort(), [...NAMES, "VERSIONS"].sort());
    const versionsText = text(files.VERSIONS);
    assert.equal(versionsText, versions(files), "VERSIONS is not what the script writes");
    const hashes = recorded(versionsText);
    assert.deepEqual(Object.keys(hashes).sort(), [...NAMES].sort());
    for (const name of NAMES) {
      assert.equal(sha256(files[name] ?? ""), hashes[name], `${name} differs from VERSIONS`);
    }
  });

  it("VERSIONS pins the release tarball by its SHA-256 and names the libpg_query commit", () => {
    const [first, second] = text(committed().VERSIONS).split("\n");
    assert.equal(first, `${PACKAGE} ${VERSION} ${TARBALL} sha256:${TARBALL_SHA256}`);
    assert.match(second ?? "", new RegExp(`^libpg_query ${COMMIT} https://`, "u"));
    assert.match(VERSION, /^\d+\.\d+\.\d+$/u);
  });

  it("carries the wrapper's, libpg_query's and PostgreSQL's licences", () => {
    const files = committed();
    assert.match(text(files.LICENSE), /MIT License/u);
    assert.match(
      text(files["LICENSE.libpg_query"]),
      /Redistribution and use in source and binary/u,
    );
    assert.match(text(files["COPYRIGHT.postgresql"]), /PostgreSQL Global Development Group/u);
    for (const [name, { sha256: pinned }] of Object.entries(LICENCES))
      assert.equal(sha256(files[name] ?? ""), pinned, name);
  });

  it("the glue is an ES module that never takes Node's paths, and the wasm is WebAssembly", () => {
    const files = committed();
    const glue = text(files["libpg-query.mjs"]);
    assert.match(glue, /export default PgQueryModule;\n$/u);
    assert.match(glue, /var ENVIRONMENT_IS_NODE=false;/u);
    assert.doesNotMatch(glue, /module\.exports|sourceMappingURL/u);
    assert.deepEqual([...(files["libpg-query.wasm"] ?? []).subarray(0, 4)], [0, 0x61, 0x73, 0x6d]);
  });

  it("refuses glue of another shape, and a tarball with another hash", () => {
    assert.throws(() => esm("var PgQueryModule=1;"), /changed/u);
    assert.throws(() => expected(new Uint8Array([1, 2, 3]), {}), /expected 4dcb2660/u);
  });
});
