// A GitHub Release a person publishes builds the macOS app and attaches it (ADR 0229):
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
const TAG = expr("github.event.release.tag_name || inputs.tag");

test("a published GitHub Release, or its tag by hand, starts the macOS build", () => {
  const mac = workflow("release-macos");
  assert.deepEqual(mac.on.release.types, ["published"]);
  assert.equal(mac.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(mac.on.push, undefined, "a tag alone starts nothing: the release does");
  assert.deepEqual(mac.permissions, { contents: "read" });
  const gate = mac.jobs.gate;
  assert.equal(
    gate.if,
    "github.event_name != 'release' || github.event.release.author.type != 'Bot'",
    "a final's release is the release app's: its build is on R2 (ADR 0092)",
  );
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
  });
  assert.equal(build.secrets, "inherit", "the Apple secrets reach the build");
  assert.doesNotMatch(JSON.stringify(mac), /R2_|release-publish/u);
  const gate = mac.jobs.gate.steps.find((step) => step.id === "version");
  assert.equal(gate.env.HAS_UPDATER_KEY, expr("vars.DESK_UPDATER_PUBKEY != ''"));
  assert.match(gate.run, /"\$author" = Bot \]; then HAS_UPDATER_KEY=false/u);
  const publish = mac.jobs.attach.steps.find((step) =>
    step.run?.includes("publish-upgrade-path.sh"),
  );
  assert.equal(publish.if, "needs.gate.outputs.updates == 'true'");
  assert.ok(publish.env.TAURI_SIGNING_PRIVATE_KEY);
  assert.equal(mac.jobs.attach.environment, "signing");
  const apple = mac.jobs.gate.steps.find((step) => step.id === "apple");
  assert.deepEqual(Object.keys(apple.env), ["APPLE_CERTIFICATE", "APPLE_SIGNING_IDENTITY"]);
  assert.match(apple.run, /::warning::No Apple signing secrets/u, "an ad-hoc build says so");
  assert.doesNotMatch(apple.run, /exit 1/u, "and still ships");
});

test("it attaches the disk images and their checksums and writes the notes' macOS section", () => {
  const attach = workflow("release-macos").jobs.attach;
  assert.deepEqual(attach.needs, ["gate", "build"]);
  assert.deepEqual(attach.permissions, { contents: "write" }, "the only job that writes");
  const download = attach.steps.find((step) => String(step.uses).startsWith("actions/download-"));
  assert.equal(download.with.pattern, "desk-darwin-*");
  const run = scripts(attach);
  assert.match(run, /sha256sum endue-desk_\*\.dmg > SHA256SUMS-macos/u);
  assert.match(run, /release-assets\.mjs files dist --version "\$VERSION"/u);
  assert.match(run, /gh release upload "\$TAG" "\$\{files\[@\]\}" --clobber/u);
  assert.match(run, /release-assets\.mjs notes body\.md .*--tag "\$TAG"/u);
  assert.match(run, /--signed "\$SIGNED"/u);
  assert.match(run, /gh release edit "\$TAG" .*--notes-file notes\.md/u);
  assert.doesNotMatch(run, /gh release create|git tag|git push/u, "it never makes a release");
});

test("release-build builds the macOS rows alone for targets: darwin, else all four", () => {
  const build = workflow("release-build");
  const inputs = build.on.workflow_call.inputs;
  assert.equal(inputs.targets.default, "all");
  assert.equal(inputs["installers-only"].default, false);
  const include = build.jobs.build.strategy.matrix.include;
  assert.match(include, /^\$\{\{ fromJSON\(inputs\.targets == 'darwin' && '\[/u);
  const [darwin, all] = [...include.matchAll(/'(\[.*?\])'/gu)].map((list) => JSON.parse(list[1]));
  assert.deepEqual(
    all.map((row) => row.target),
    ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "linux-x86_64"],
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
