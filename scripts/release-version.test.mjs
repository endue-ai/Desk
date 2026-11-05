import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canaryVersion,
  candidateVersion,
  compare,
  finalVersion,
  lineOf,
  newLine,
  nextLine,
  notesStart,
  parse,
} from "./release-version.mjs";

describe("release-version", () => {
  it("a line is a branch release/vX.Y or a release tag vX.Y.Z", () => {
    assert.deepEqual(lineOf("release/v0.4"), { major: 0, minor: 4 });
    assert.deepEqual(lineOf("v0.4.2"), { major: 0, minor: 4 });
    assert.equal(lineOf("release/v0.4.0"), null, "a version branch is not a line");
    assert.equal(lineOf("v0.4.0-rc.1"), null, "a pre-release tag is not a line");
    assert.equal(lineOf("0.4.0"), null, "a tag starts with v");
    assert.equal(lineOf("main"), null);
  });

  it("the next line follows the newest line or tag", () => {
    assert.equal(nextLine([]), "release/v0.1");
    assert.equal(nextLine(["release/v0.4", "v0.4.1", "release/v0.3", "v0.10.0"]), "release/v0.11");
    assert.equal(nextLine(["release/v1.0", "release/v0.9"]), "release/v1.1");
  });

  it("a new line must be above every line that exists", () => {
    const refs = ["release/v0.4", "v0.4.1"];
    assert.equal(newLine("release/v0.5", refs), "release/v0.5");
    assert.equal(newLine("release/v1.0", refs), "release/v1.0", "a major may skip ahead");
    assert.throws(() => newLine("release/v0.4", refs), /next one is release\/v0\.5/u);
    assert.throws(() => newLine("release/v0.3", refs), /not above/u);
    assert.throws(() => newLine("release/v0.5.0", refs), /not a release line/u);
    assert.equal(newLine("release/v0.1"), "release/v0.1");
  });

  it("a final's notes start at the patch before it, or at the last line's .0", () => {
    const refs = ["v0.3.0", "v0.3.1", "v0.3.2", "v0.4.0", "v0.4.1", "v0.4.0-rc.1", "release/v0.4"];
    assert.equal(notesStart("0.4.2", refs), "v0.4.1");
    assert.equal(notesStart("0.4.1", refs), "v0.4.0");
    assert.equal(notesStart("0.5.0", refs), "v0.4.0", "a line's .0 starts at the last line's .0");
    assert.equal(notesStart("0.4.0", ["v0.3.2", "v0.3.0"]), "v0.3.0");
    assert.equal(notesStart("0.1.0", []), undefined, "the first release has no start");
    assert.throws(() => notesStart("0.4.0-rc.1", refs), /not a release version/u);
  });

  it("a canary build is the next line's .0 as a pre-release of its run", () => {
    assert.equal(canaryVersion({ run: 7 }), "0.1.0-pre.7", "before any line");
    assert.equal(canaryVersion({ run: 212, refs: ["release/v0.4"] }), "0.5.0-pre.212");
    assert.equal(
      canaryVersion({ run: 9, refs: ["release/v0.4", "v0.4.0", "v0.4.1"] }),
      "0.5.0-pre.9",
    );
    assert.throws(() => canaryVersion({ run: 0 }), /run number/u);
    assert.throws(() => canaryVersion({}), /run number/u);
  });

  it("a candidate is the patch after its line's newest tag, as -rc.<run>", () => {
    assert.equal(candidateVersion({ line: "release/v0.4", run: 31 }), "0.4.0-rc.31");
    const refs = ["v0.4.0", "v0.4.1", "v0.5.0", "v0.3.7", "release/v0.4"];
    assert.equal(candidateVersion({ line: "release/v0.4", run: 40, refs }), "0.4.2-rc.40");
    assert.equal(candidateVersion({ line: "release/v0.3", run: 41, refs }), "0.3.8-rc.41");
    assert.throws(
      () => candidateVersion({ line: "release/v0.4.0", run: 1 }),
      /not a release line/u,
    );
    assert.throws(() => candidateVersion({ line: "release/v0.4" }), /run number/u);
  });

  it("a final is its candidate without the suffix", () => {
    assert.equal(finalVersion("0.4.2-rc.40"), "0.4.2");
    assert.equal(finalVersion("v1.0.0-rc.3"), "1.0.0");
    assert.throws(() => finalVersion("0.5.0-pre.212"), /not a release candidate/u);
    assert.throws(() => finalVersion("0.4.2"), /not a release candidate/u);
  });

  it("canary sorts above a candidate, a candidate above the release before it and below its own", () => {
    const refs = ["release/v0.4", "v0.4.0"];
    const canary = canaryVersion({ run: 300, refs });
    const candidate = candidateVersion({ line: "release/v0.4", run: 301, refs });
    assert.ok(compare(canary, candidate) > 0, `${canary} > ${candidate}`);
    assert.ok(compare(candidate, "0.4.0") > 0, `${candidate} > 0.4.0`);
    assert.ok(compare(candidate, finalVersion(candidate)) < 0, "below its own final");
    assert.ok(
      compare("0.4.0-pre.90", "0.4.0-rc.1") < 0,
      "a canary of the line before its cut is below its candidates",
    );
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
