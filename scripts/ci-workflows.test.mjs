// Which workflows run when (ADR 0081, ADR 0092): pull requests into main and the merge queue run the
// Linux gates; a pull request into a release line release/vX.Y also runs macOS, Windows and the CEF
// shell on every OS; a push to a line builds a candidate for beta; a final, by hand, tags it and
// lists it on stable for a tenth of the desks; canary builds nightly or by hand, with macOS and
// Windows checks.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = async (name) =>
  parse(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));

const RELEASE_PR = "startsWith(github.base_ref, 'release/')";

/** A workflow expression as the YAML spells it: expr("github.sha") is "${{ github.sha }}". */
const expr = (body) => `\${{ ${body} }}`;

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

test("the CEF shell is built on every OS for an app change and for a release", async () => {
  const { jobs } = await workflow("ci");
  assert.equal(jobs["app-build"], undefined, "the Tauri app's build went with it (#97)");
  const build = jobs["shell-build"];
  assert.match(build.if, /needs\.changes\.outputs\.app == 'true'/u);
  assert.ok(build.if.includes(RELEASE_PR), build.if);
  assert.deepEqual(build.strategy.matrix.os, ["ubuntu-latest", "macos-latest", "windows-latest"]);
  for (const recipe of ["just check-shell", "just build-shell"]) {
    assert.ok(
      build.steps.some((step) => step.run === recipe),
      recipe,
    );
  }
});

test("a release pull request runs the release dry run inside ci when it changes the release files", async () => {
  const dry = await workflow("release-dry-run");
  assert.ok("workflow_call" in dry.on, "release-dry-run can be called");
  assert.ok(dry.on.pull_request.paths.includes(".github/workflows/release-final.yml"));
  const { jobs } = await workflow("ci");
  const call = jobs["release-dry-run"];
  assert.equal(call.uses, "./.github/workflows/release-dry-run.yml");
  assert.equal(call.if, `${RELEASE_PR} && needs.changes.outputs.release == 'true'`);
  assert.match(
    scripts(jobs.changes),
    /release-final\|canary\)\\\.yml/u,
    "the filter knows the release files",
  );
  assert.ok(jobs.ci.needs.includes("release-dry-run"), "the required check waits for it");
});

test("a push to a release line builds a candidate and lists it on beta, never on stable", async () => {
  const release = await workflow("release");
  assert.deepEqual(release.on.push.branches, ["release/v*"]);
  assert.equal(release.on.push.tags, undefined, "a tag starts nothing");
  assert.match(
    scripts(release.jobs.gate),
    /release-version\.mjs --line "\$GITHUB_REF_NAME" --run/u,
  );
  assert.deepEqual(release.jobs.check.strategy.matrix.os, [
    "ubuntu-latest",
    "macos-latest",
    "windows-latest",
  ]);
  assert.deepEqual(
    release.jobs.build.needs,
    ["gate", "check"],
    "every OS is checked before building",
  );
  const publish = scripts(release.jobs.publish);
  assert.match(publish, /--channel beta/u);
  assert.doesNotMatch(publish, /stable|gh release create/u, "a candidate is not a release");
});

test("a final builds the soaked candidate's commit, tags it, and only then lists it on stable at 10%", async () => {
  const final = await workflow("release-final");
  assert.deepEqual(Object.keys(final.on), ["workflow_dispatch"], "by hand only");
  assert.match(
    scripts(final.jobs.gate),
    /release-manifest\.mjs pick-candidate beta\.json --line "\$LINE"/u,
  );
  assert.match(scripts(final.jobs.gate), /--label release-blocker/u);
  assert.equal(final.jobs.build.with.ref, expr("needs.gate.outputs.commit"));
  const publish = final.jobs.publish;
  assert.equal(publish.environment, "stable", "a person approves it");
  const steps = publish.steps.map((step) => step.run ?? "");
  const tag = steps.findIndex((run) => /gh release create "v\$VERSION"/u.test(run));
  const list = steps.findIndex((run) =>
    /--channel stable --release dist\/release\.json --rollout 10/u.test(run),
  );
  const upload = steps.findIndex((run) => /release-publish\.mjs release dist/u.test(run));
  assert.ok(upload >= 0 && tag > upload && list > tag, "upload, then tag, then list");
  assert.equal(
    publish.steps[tag].env.GH_TOKEN,
    expr("steps.app.outputs.token"),
    "the release app tags",
  );
});

test("cut, rollout and rollback are by hand; every beta and stable index writer takes one lock", async () => {
  const cut = await workflow("release-cut");
  assert.deepEqual(Object.keys(cut.on), ["workflow_dispatch"]);
  assert.equal(cut.jobs.cut.environment, "stable");
  assert.match(scripts(cut.jobs.cut), /--new-line/u, "a line is never cut twice");
  assert.match(scripts(cut.jobs.cut), /git\/refs" -f ref="refs\/heads\/\$NEW_LINE"/u);
  const rollout = await workflow("rollout");
  assert.deepEqual(Object.keys(rollout.on), ["workflow_dispatch"]);
  assert.equal(rollout.jobs.rollout.environment, "stable");
  assert.match(scripts(rollout.jobs.rollout), /release-manifest\.mjs rollout/u);
  const writers = [
    (await workflow("release")).jobs.publish,
    (await workflow("release-final")).jobs.publish,
    rollout.jobs.rollout,
  ];
  for (const job of writers) assert.equal(job.concurrency.group, "release-index");
  const rollback = (await workflow("rollback")).jobs.rollback;
  assert.equal(
    rollback.concurrency.group,
    expr("inputs.channel == 'canary' && 'canary' || 'release-index'"),
  );
  assert.ok(
    !existsSync(new URL("../.github/workflows/promote.yml", import.meta.url)),
    "beta is fed by lines only",
  );
});

test("release lines and release tags are created only by the release app and admins", () => {
  const ruleset = (name) =>
    JSON.parse(readFileSync(new URL(`../.github/rulesets/${name}.json`, import.meta.url), "utf8"));
  const release = ruleset("release");
  assert.deepEqual(release.conditions.ref_name.include, ["refs/heads/release/v*"]);
  const tags = ruleset("release-tags");
  assert.deepEqual(tags.conditions.ref_name.include, ["refs/tags/v*"]);
  for (const set of [release, tags]) {
    assert.ok(
      set.rules.some((rule) => rule.type === "creation"),
      `${set.name} limits creation`,
    );
    assert.deepEqual(
      set.bypass_actors.map((a) => [a.actor_type, a.actor_id]),
      [
        ["RepositoryRole", 5],
        ["Integration", "$RELEASE_APP_ID"],
      ],
    );
  }
  const review = release.rules.find((rule) => rule.type === "pull_request").parameters;
  assert.equal(review.required_approving_review_count, 1, "a person reviews what reaches desks");
});

test("canary builds nightly or by hand, not on every push, and checks macOS and Windows", async () => {
  const canary = await workflow("canary");
  assert.equal(canary.on.push, undefined);
  assert.ok(Array.isArray(canary.on.schedule) && canary.on.schedule.length === 1);
  assert.ok("workflow_dispatch" in canary.on);
  const gate = scripts(canary.jobs.gate);
  assert.match(gate, /gh run list --workflow canary/u, "it compares main with the last canary");
  assert.match(gate, /moved=false/u);
  assert.match(canary.jobs.build.if, /needs\.gate\.outputs\.moved == 'true'/u);
  const check = canary.jobs.check;
  assert.equal(
    check.if,
    "needs.gate.outputs.moved == 'true'",
    "checks run before the secrets exist",
  );
  assert.deepEqual(check.strategy.matrix.os, ["macos-latest", "windows-latest"]);
});
