// Which workflows run when (ADR 0081): pull requests into main and the merge queue run the Linux
// gates; a pull request into release/vX.Y.Z also runs macOS, Windows, the app on every OS and the
// release dry run; merging it publishes that version; canary builds nightly or by hand.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = async (name) =>
  parse(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));

const RELEASE_PR = "startsWith(github.base_ref, 'release/')";

/** Every `run:` script of a job, joined. */
const scripts = (job) => (job.steps ?? []).map((step) => step.run ?? "").join("\n");

test("macOS and Windows checks run only for a pull request into release/**", async () => {
  const { jobs } = await workflow("ci");
  for (const name of ["check-macos", "check-windows"]) {
    assert.equal(jobs[name].if, RELEASE_PR, `${name} runs for release pull requests only`);
  }
  for (const name of ["check-linux", "runtime-e2e", "codegen-check"]) {
    assert.equal(jobs[name].if, undefined, `${name} runs on every pull request`);
  }
});

test("the app is built on Linux for an app change and on every OS for a release", async () => {
  const { jobs } = await workflow("ci");
  const build = jobs["app-build"];
  assert.match(build.if, /needs\.changes\.outputs\.app == 'true'/u);
  assert.ok(build.if.includes(RELEASE_PR), build.if);
  const matrix = build.strategy.matrix.os;
  assert.equal(typeof matrix, "string", "the matrix is chosen by the base branch");
  assert.ok(matrix.includes(RELEASE_PR), matrix);
  const lists = [...matrix.matchAll(/'(\[[^\]]*\])'/gu)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(lists, [["ubuntu-latest", "macos-latest", "windows-latest"], ["ubuntu-latest"]]);
});

test("a release pull request runs the release dry run inside ci", async () => {
  const dry = await workflow("release-dry-run");
  assert.ok("workflow_call" in dry.on, "release-dry-run can be called");
  const { jobs } = await workflow("ci");
  const call = jobs["release-dry-run"];
  assert.equal(call.uses, "./.github/workflows/release-dry-run.yml");
  assert.equal(call.if, RELEASE_PR);
  assert.ok(jobs.ci.needs.includes("release-dry-run"), "the required check waits for it");
});

test("merging into release/vX.Y.Z publishes that version", async () => {
  const release = await workflow("release");
  assert.deepEqual(release.on.push.branches, ["release/v*"]);
  assert.equal(release.on.push.tags, undefined, "a tag no longer starts a release");
  const gate = scripts(release.jobs.gate);
  assert.match(gate, /GITHUB_REF_NAME#release\//u, "the version comes from the branch name");
  assert.match(gate, /git ls-remote --exit-code --tags origin/u, "an existing tag stops it");
  const publish = scripts(release.jobs.publish);
  assert.match(publish, /gh release create "v\$VERSION" --target "\$GITHUB_SHA"/u);
  assert.doesNotMatch(publish, /--verify-tag/u);
});

test("canary builds nightly or by hand, not on every push", async () => {
  const canary = await workflow("canary");
  assert.equal(canary.on.push, undefined);
  assert.ok(Array.isArray(canary.on.schedule) && canary.on.schedule.length === 1);
  assert.ok("workflow_dispatch" in canary.on);
  const gate = scripts(canary.jobs.gate);
  assert.match(gate, /gh run list --workflow canary/u, "it compares main with the last canary");
  assert.match(gate, /moved=false/u);
  assert.match(canary.jobs.build.if, /needs\.gate\.outputs\.moved == 'true'/u);
});
