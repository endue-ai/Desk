import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  contentType,
  IMMUTABLE,
  indexPlan,
  releasePlan,
  removal,
  SHORT,
  upload,
} from "./release-publish.mjs";

const NAMES = [
  "release.json",
  "endue-desk_0.2.0_linux-x86_64.deb.sig",
  "SHA256SUMS",
  "endue-desk_0.2.0_darwin-aarch64.dmg",
  "release.json.sig",
  "endue-desk_0.2.0_linux-x86_64.deb",
  "endue-desk_0.2.0_darwin-aarch64.app.tar.gz",
  "endue-desk_0.2.0_darwin-aarch64.app.tar.gz.sig",
];

describe("release-publish", () => {
  it("uploads artifacts with their signatures, then the sums, then release.json", () => {
    const plan = releasePlan({ dist: "dist", names: NAMES, version: "0.2.0" });
    assert.deepEqual(
      plan.map((s) => s.key.replace("desk/releases/0.2.0/", "")),
      [
        "endue-desk_0.2.0_darwin-aarch64.app.tar.gz",
        "endue-desk_0.2.0_darwin-aarch64.app.tar.gz.sig",
        "endue-desk_0.2.0_darwin-aarch64.dmg",
        "endue-desk_0.2.0_linux-x86_64.deb",
        "endue-desk_0.2.0_linux-x86_64.deb.sig",
        "SHA256SUMS",
        "release.json.sig",
        "release.json",
      ],
    );
    assert.ok(plan.every((s) => s.cacheControl === IMMUTABLE));
    assert.equal(plan[0].file, join("dist", "endue-desk_0.2.0_darwin-aarch64.app.tar.gz"));
    assert.throws(
      () => releasePlan({ dist: "dist", names: ["a.deb"], version: "0.2.0" }),
      /release\.json/u,
    );
  });

  it("an index goes up after its release, cached for a minute", () => {
    const plan = indexPlan({ index: "canary.json", channel: "canary" });
    assert.deepEqual(
      plan.map((s) => [s.file, s.key, s.cacheControl]),
      [
        ["canary.json.sig", "desk/channels/canary/index.json.sig", SHORT],
        ["canary.json", "desk/channels/canary/index.json", SHORT],
      ],
    );
  });

  it("speaks the S3 API at the R2 endpoint with a type per file", () => {
    const target = {
      bucket: "endue-desk-releases",
      endpoint: "https://acct.r2.cloudflarestorage.com",
    };
    const [first] = releasePlan({ dist: "dist", names: NAMES, version: "0.2.0" });
    assert.deepEqual(upload(first, target), [
      "s3",
      "cp",
      join("dist", "endue-desk_0.2.0_darwin-aarch64.app.tar.gz"),
      "s3://endue-desk-releases/desk/releases/0.2.0/endue-desk_0.2.0_darwin-aarch64.app.tar.gz",
      "--endpoint-url",
      "https://acct.r2.cloudflarestorage.com",
      "--cache-control",
      IMMUTABLE,
      "--content-type",
      "application/gzip",
      "--only-show-errors",
    ]);
    assert.equal(contentType("release.json"), "application/json");
    assert.equal(contentType("endue-desk_0.2.0_linux-x86_64.AppImage"), "application/octet-stream");
    assert.deepEqual(removal("0.2.1-pre.3", target).slice(0, 4), [
      "s3",
      "rm",
      "s3://endue-desk-releases/desk/releases/0.2.1-pre.3/",
      "--recursive",
    ]);
    assert.throws(() => removal("../", target), /not a version/u);
  });
});
