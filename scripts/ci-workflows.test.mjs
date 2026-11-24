// Cross-platform gates and release operations selected by a manual workflow dispatch.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = async (name) =>
  parse(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));

const RELEASE_PR = "needs.changes.outputs.release-line == 'true'";

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
    assert.ok(jobs[name], `${name} exists`);
    assert.equal(jobs[name].if, undefined, `${name} runs for every CI dispatch`);
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
  assert.equal(dry.on.workflow_call.inputs.ref.required, true);
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

test("dispatching on a release line builds a candidate and lists it on beta", async () => {
  const release = await workflow("release");
  assert.deepEqual(Object.keys(release.on), ["workflow_dispatch"]);
  assert.equal(release.jobs.gate.if, "startsWith(github.ref, 'refs/heads/release/v')");
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

test("a manual canary checks macOS and Windows from the default branch", async () => {
  const canary = await workflow("canary");
  assert.deepEqual(Object.keys(canary.on), ["workflow_dispatch"]);
  assert.match(canary.jobs.gate.if, /github\.event\.repository\.default_branch/u);
  assert.equal(canary.jobs.build.if, "needs.gate.outputs.publish == 'true'");
  const check = canary.jobs.check;
  assert.equal(check.needs, "gate");
  assert.equal(check.if, undefined, "the OS checks run even before signing is configured");
  assert.deepEqual(check.strategy.matrix.os, ["macos-latest", "windows-latest"]);
});
