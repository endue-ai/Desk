import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVersion, compare, parse } from "./release-version.mjs";

describe("release-version", () => {
  it("a tag builds its own version", () => {
    assert.equal(buildVersion({ tag: "v0.2.0" }), "0.2.0");
    assert.equal(buildVersion({ tag: "1.4.12" }), "1.4.12");
    assert.throws(() => buildVersion({ tag: "v0.2.0-rc.1" }), /not a release tag/u);
    assert.throws(() => buildVersion({ tag: "latest" }), /not a release tag/u);
  });

  it("a main build is the next patch after the latest tag, as a pre-release of its run", () => {
    assert.equal(buildVersion({ run: 48, latest: "v0.2.0" }), "0.2.1-pre.48");
    assert.equal(buildVersion({ run: 7 }), "0.1.0-pre.7", "before any tag");
    assert.throws(() => buildVersion({ latest: "v0.2.0" }), /run number/u);
    assert.throws(() => buildVersion({ run: 0 }), /run number/u);
  });

  it("versions compare as semver, pre-releases below their release", () => {
    const sorted = [
      "0.2.0",
      "0.1.0",
      "0.2.1-pre.10",
      "0.2.1-pre.9",
      "0.2.1",
      "0.10.0",
      "0.2.1-pre.9.1",
    ];
    assert.deepEqual(sorted.sort(compare), [
      "0.1.0",
      "0.2.0",
      "0.2.1-pre.9",
      "0.2.1-pre.9.1",
      "0.2.1-pre.10",
      "0.2.1",
      "0.10.0",
    ]);
    assert.equal(compare("v1.0.0", "1.0.0"), 0);
    assert.equal(parse("01.0.0"), null);
    assert.throws(() => compare("x", "1.0.0"), /not a version/u);
  });
});
