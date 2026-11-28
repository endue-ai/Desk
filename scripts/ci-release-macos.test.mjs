// A maintainer selects a published tag to build and attach the macOS app (ADR 0229).
// release-macos.yml builds both macOS targets through release-build.yml. The updater key enables
// the signed upgrade path. Installer-only builds still ship without signing credentials or R2.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { MAC_TARGETS } from "./release-assets.mjs";

const workflow = (name) =>
  parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
const expr = (body) => `\${{ ${body} }}`;
const scripts = (job) => (job.steps ?? []).map((step) => step.run ?? "").join("\n");
const TAG = expr("inputs.tag");

test("a maintainer starts the macOS build by selecting an existing release tag", () => {
  const mac = workflow("release-macos");
  assert.deepEqual(Object.keys(mac.on), ["workflow_dispatch"]);
  assert.equal(mac.on.workflow_dispatch.inputs.tag.required, true);
  assert.deepEqual(mac.permissions, { contents: "read" });
  const gate = mac.jobs.gate;
  assert.equal(gate.env.TAG, TAG);
  assert.match(scripts(gate), /release-assets\.mjs version "\$TAG"/u, "the tag names the version");
  assert.match(scripts(gate), /git rev-parse 'FETCH_HEAD\^\{commit\}'/u, "and the commit");
});

test("it builds macOS at the tag's commit, with signed packages when the updater is configured", () => {
  const mac = workflow("release-macos");
  const build = mac.jobs.build;
  assert.equal(build.uses, "./.github/workflows/release-build.yml");
  assert.deepEqual(build.with, {
    version: expr("needs.gate.outputs.version"),
    ref: expr("needs.gate.outputs.commit"),
    targets: "darwin",
    "installers-only": expr("needs.gate.outputs.updates != 'true'"),
    "upgrade-path": expr("needs.gate.outputs.updates == 'true' && 'manual' || ''"),
    "min-from": expr("inputs.min-from || vars.DESK_UPDATE_MIN_FROM"),
  });
  assert.equal(build.secrets, "inherit", "the Apple secrets reach the build");
  assert.doesNotMatch(JSON.stringify(mac), /R2_|release-publish/u);
  const gate = mac.jobs.gate.steps.find((step) => step.id === "version");
  assert.equal(gate.env.HAS_UPDATER_KEY, expr("vars.ENDUE_UPDATER_PUBLIC_KEY != ''"));
  assert.match(gate.run, /"\$author" = Bot \]; then HAS_UPDATER_KEY=false/u);
  const publish = mac.jobs.attach.steps.find((step) =>
    step.run?.includes("publish-upgrade-path.sh"),
  );
  assert.equal(publish.if, "needs.gate.outputs.updates == 'true'");
  assert.match(publish.run, /publish-upgrade-path\.sh signed dist "\$VERSION" upgrade-path/u);
  assert.equal(publish.env, undefined, "it publishes what the build signed, with no key");
  assert.match(mac.jobs.attach.env.SIGNED, /needs\.build\.outputs\.apple-signed == 'true'/u);
});

test("a person approves a run once: only build and cli hold the signing environment (#823)", () => {
  const mac = workflow("release-macos");
  const held = Object.entries(mac.jobs)
    .filter(([, job]) => job.environment || job.uses)
    .map(([name, job]) => [name, job.environment ?? "through release-build"]);
  assert.deepEqual(held, [
    ["build", "through release-build"],
    ["cli", "signing"],
  ]);
  assert.equal(mac.jobs.build.needs, "gate");
  assert.equal(mac.jobs.cli.needs, "gate", "so both wait for the same approval");
  for (const name of ["gate", "verify", "attach"]) {
    assert.doesNotMatch(JSON.stringify(mac.jobs[name]), /secrets\./u, `${name} reads no secret`);
  }
  const steps = workflow("release-build").jobs.build.steps;
  const path = steps.find((step) => step.name === "Write and sign the upgrade path");
  assert.equal(
    path.if,
    "inputs.upgrade-path == 'manual' && runner.os == 'macOS' && !inputs.installers-only",
  );
  assert.match(path.run, /publish-upgrade-path\.sh sign dist/u);
  const at = (step) => steps.indexOf(step);
  const uploads = steps.filter((step) => String(step.uses).startsWith("actions/upload-artifact@"));
  assert.ok(at(path) < at(uploads[0]), "signed before the packages leave");
  assert.equal(uploads[1].with.name, "endue-upgrade-path");
});

test("it attaches the disk images and their checksums and writes the notes' macOS section", () => {
  const attach = workflow("release-macos").jobs.attach;
  assert.deepEqual(attach.needs, ["gate", "build", "cli", "verify"]);
  assert.deepEqual(
    attach.permissions,
    { contents: "write", actions: "read" },
    "the only job that writes; it reads an earlier run's packages",
  );
  const download = attach.steps.find((step) => String(step.uses).startsWith("actions/download-"));
  assert.equal(download.with.pattern, "endue-app-darwin-*");
  assert.equal(download.with["run-id"], expr("inputs.artifacts-from || github.run_id"));
  const run = scripts(attach);
  assert.match(run, /sha256sum "\$DESKTOP_PREFIX"\*\.dmg > SHA256SUMS-macos/u);
  assert.match(run, /release-assets\.mjs files dist --version "\$VERSION"/u);
  assert.match(run, /gh release upload "\$TAG" "\$\{files\[@\]\}" --clobber/u);
  assert.match(run, /release-assets\.mjs notes body\.md .*--tag "\$TAG"/u);
  assert.match(run, /--signed "\$SIGNED"/u);
  assert.match(run, /gh release edit "\$TAG" .*--notes-file notes\.md/u);
  assert.doesNotMatch(run, /gh release create|git tag|git push/u, "it never makes a release");
});

test("release-build builds the macOS row alone for targets: darwin, else all three", () => {
  const build = workflow("release-build");
  const inputs = build.on.workflow_call.inputs;
  assert.equal(inputs.targets.default, "all");
  assert.equal(inputs["installers-only"].default, false);
  const include = build.jobs.build.strategy.matrix.include;
  assert.match(include, /^\$\{\{ fromJSON\(inputs\.targets == 'darwin' && '\[/u);
  const [darwin, all] = [...include.matchAll(/'(\[.*?\])'/gu)].map((list) => JSON.parse(list[1]));
  assert.deepEqual(
    all.map((row) => row.target),
    ["darwin-aarch64", "windows-x86_64", "linux-x86_64"],
  );
  assert.deepEqual(
    darwin,
    all.filter((row) => row.target.startsWith("darwin-")),
    "the same rows",
  );
  assert.deepEqual(
    darwin.map((row) => row.target),
    MAC_TARGETS.map((mac) => mac.target),
    "the targets whose images release-assets attaches",
  );
  for (const row of darwin) assert.equal(row.os, "macos-latest");
});

test("installers only: no updater signature is made or checked, and only the .dmg is collected", () => {
  const steps = workflow("release-build").jobs.build.steps;
  const sign = steps.find((step) => /tauri signer sign/u.test(step.run ?? ""));
  assert.equal(sign.if, "inputs.shell == 'cef' && !inputs.installers-only");
  const smoke = steps.find((step) => /install-and-launch\.sh/u.test(step.run ?? ""));
  assert.match(smoke.env.DESK_UPDATER_PUBKEY, /^\$\{\{ !inputs\.installers-only && \(/u);
  assert.match(smoke.env.DESK_UPDATER_PUBKEY, /\|\| '' \}\}$/u, "empty is no key");
  const collect = steps.find((step) => /release-collect\.mjs/u.test(step.run ?? ""));
  assert.equal(collect.env.INSTALLERS_ONLY, expr("inputs.installers-only"));
  assert.match(collect.run, /"\$INSTALLERS_ONLY" = true \]; then args\+=\(--installers\)/u);
});

test("canary, a line's candidate, its final and the dry run build every target with signatures", () => {
  for (const name of ["canary", "release", "release-final", "release-dry-run"]) {
    const build = workflow(name).jobs.build;
    assert.equal(build.uses, "./.github/workflows/release-build.yml", name);
    assert.equal(build.with.targets, undefined, name);
    assert.equal(build.with["installers-only"], undefined, name);
  }
});

test("a build's signed packages leave the job before any test, so a failed test keeps them (#820)", () => {
  const steps = workflow("release-build").jobs.build.steps;
  const at = (pattern) => steps.findIndex((step) => pattern.test(step.run ?? step.uses ?? ""));
  const upload = at(/^actions\/upload-artifact@/u);
  assert.ok(at(/tauri signer sign --app-version/u) < upload, "the updates are signed first");
  assert.ok(at(/release-collect\.mjs/u) < upload, "and collected");
  for (const test of [
    /install-and-launch\.sh/u,
    /cli-install-ci\.sh/u,
    /verify-signature\.sh dist/u,
  ]) {
    assert.ok(at(test) > upload, `${test} runs after the upload`);
  }
  const smoke = steps[at(/install-and-launch\.sh/u)];
  assert.equal(smoke.env.DESK_SMOKE_READY_WITHIN, expr("runner.os == 'macOS' && '180' || ''"));
  const cli = workflow("release-macos").jobs.cli.steps;
  const cliAt = (pattern) => cli.findIndex((step) => pattern.test(step.run ?? step.uses ?? ""));
  assert.ok(cliAt(/^actions\/upload-artifact@/u) < cliAt(/cli-install-ci\.sh/u));
});

test("artifacts-from publishes an earlier run's packages after verify, without building (#820)", () => {
  const mac = workflow("release-macos");
  assert.equal(mac.on.workflow_dispatch.inputs["artifacts-from"].required, false);
  const reuse = mac.jobs.gate.steps.find((step) => step.id === "reuse");
  assert.equal(reuse.env.FROM, expr("inputs.artifacts-from"));
  assert.match(
    reuse.run,
    /"\$path" != \.github\/workflows\/release-macos\.yml/u,
    "this workflow's run",
  );
  assert.match(reuse.run, /"\$branch" != main/u, "on main");
  assert.match(reuse.run, /"\$created" < "\$published"/u, "after the release was published");
  assert.match(reuse.run, /select\(\.expired \| not\)/u, "with the packages still there");
  assert.deepEqual(mac.jobs.gate.permissions, { contents: "read", actions: "read" });
  assert.equal(mac.jobs.build.if, "needs.gate.outputs.reuse != 'true'");
  assert.match(mac.jobs.cli.if, /needs\.gate\.outputs\.reuse != 'true'/u);
  const verify = mac.jobs.verify;
  assert.equal(verify.if, "needs.gate.outputs.reuse == 'true'");
  assert.equal(verify.environment, undefined, "verify reads no secret");
  assert.equal(verify["runs-on"], "macos-latest");
  assert.match(scripts(verify), /verify-signature\.sh --code "\$dmg"/u);
  assert.match(scripts(verify), /verify-signature\.sh --code "\$app"/u);
  assert.equal(verify.env.DESK_REQUIRE_SIGNED, "1", "only a Developer ID build is published again");
  assert.match(
    mac.jobs.attach.if,
    /needs\.build\.result == 'success' \|\| \(needs\.gate\.outputs\.reuse == 'true' && needs\.verify\.result == 'success'\)/u,
  );
});
