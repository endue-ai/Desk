// Which desk the release workflows build (#46, #97): since Stage 1 of #32 ended, the CEF desk only.
// .github/release-shell says `cef`, so the next line carries the CEF desk to beta and then stable
// (ADR 0092), and canary builds it too; release-build refuses any other desk. It fetches CEF by its
// pin, packages with cargo-packager, signs, runs the install smoke on every package and collects them
// in the shape the updater reads.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = (name) => parse(read(`.github/workflows/${name}.yml`));
const expr = (body) => `\${{ ${body} }}`;
const scripts = (job) => (job.steps ?? []).map((step) => step.run ?? "").join("\n");
const CEF = "inputs.shell == 'cef'";

test("release-shell names the CEF desk", () => {
  assert.equal(read(".github/release-shell"), "cef\n");
});

test("release-build builds the CEF desk and refuses any other", () => {
  const build = workflow("release-build");
  const input = build.on.workflow_call.inputs.shell;
  assert.equal(input.type, "string");
  assert.equal(input.default, "cef");
  const steps = build.jobs.build.steps;
  assert.equal(
    steps.find((step) => /tauri build/u.test(step.run ?? "")),
    undefined,
    "no Tauri build (#97)",
  );
  assert.doesNotMatch(
    JSON.stringify(build),
    /webkit2gtk|matrix\.bundles/u,
    "nor its SDK or bundles",
  );
  assert.equal(steps[0].if, "inputs.shell != 'cef'", "another desk stops before anything runs");
  assert.match(steps[0].run, /exit 1/u);
  const cef = steps.filter((step) => (step.if ?? "").includes(CEF));
  const runs = cef.map((step) => step.run ?? "").join("\n");
  assert.match(
    runs,
    /node scripts\/cef-fetch\.mjs --target "\$\{\{ matrix\.rust \}\}"/u,
    "CEF by its pin and hash",
  );
  assert.match(runs, /cargo build -p desk-shell --bins --release --target/u);
  assert.match(
    runs,
    /cargo install cargo-packager --version 0\.11\.8 --locked/u,
    "a pinned packager",
  );
  assert.match(runs, /node scripts\/cef-package\.mjs --target/u);
  assert.match(
    runs,
    /tauri signer sign --app-version "\$VERSION"/u,
    "updater signatures name their version",
  );
  assert.match(runs, /e2e\/smoke\/install-and-launch\.sh/u, "the smoke installs every package");
  assert.match(runs, /release-collect\.mjs .*--shell cef/u);
  const cache = cef.find((step) => String(step.uses ?? "").startsWith("actions/cache/restore"));
  assert.ok(cache, "the CEF archive is cached");
  assert.match(
    cache.with.path,
    /\.tar\.bz2$/u,
    "the archive only: every run checks its hash and unpacks it",
  );
  assert.match(cache.with.key, /hashFiles\('apps\/desk\/shell\/packager\/cef\.json'\)/u);
  const linuxBuild = cef.find((step) => /cargo build -p desk-shell/u.test(step.run ?? ""));
  assert.match(
    linuxBuild.env.RUSTFLAGS,
    /-rpath,\$ORIGIN/u,
    "the Linux desk finds libcef.so beside itself",
  );
});

test("a line's candidate and its final build the desk the line's commit names; canary the default, CEF", () => {
  const release = workflow("release");
  assert.match(scripts(release.jobs.gate), /\.github\/release-shell/u);
  assert.equal(release.jobs.build.with.shell, expr("needs.gate.outputs.shell"));
  const final = workflow("release-final");
  assert.match(
    scripts(final.jobs.gate),
    /git show "\$commit:\.github\/release-shell"/u,
    "the candidate's own commit",
  );
  assert.equal(final.jobs.build.with.shell, expr("needs.gate.outputs.shell"));
  assert.equal(
    workflow("canary").jobs.build.with.shell,
    undefined,
    "canary builds the default, the CEF desk",
  );
});

test("the release dry run rehearses the CEF desk, and runs when packaging changes", () => {
  const dry = workflow("release-dry-run");
  const input = dry.on.workflow_dispatch.inputs.shell;
  assert.deepEqual(input.options, ["release-shell", "cef"]);
  assert.equal(dry.jobs.build.with.shell, expr("needs.key.outputs.shell"));
  for (const path of [
    ".github/release-shell",
    "apps/desk/shell/packager/**",
    "scripts/cef-**",
    "e2e/smoke/install-and-launch.sh",
  ]) {
    assert.ok(dry.on.pull_request.paths.includes(path), path);
  }
  const ci = scripts(workflow("ci").jobs.changes);
  assert.ok(ci.includes("apps/desk/shell/packager/"), "ci runs it for a release pull request too");
});
