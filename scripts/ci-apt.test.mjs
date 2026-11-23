import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const canonical = "https://archive.ubuntu.com/ubuntu/";
const mirror = "mirror+file:/etc/apt/apt-mirrors.txt";

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), "desk-ci-apt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "sources.list.d"));
  await mkdir(join(root, "apt.conf.d"));
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  return root;
}

async function setup(root) {
  const { configureApt } = await import("./ci-apt.mjs");
  return configureApt(root);
}

test("Deb822 runner mirror transport becomes the canonical archive without changing trust or suites", async (t) => {
  const source = `Types: deb\nURIs: ${mirror}\nSuites: noble noble-updates noble-backports noble-security\nComponents: main universe restricted multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`;
  const security = "deb https://security.ubuntu.com/ubuntu noble-security main\n";
  const foreign =
    "deb [signed-by=/keys/vendor.gpg] https://packages.microsoft.com/ubuntu noble main\n";
  const root = await fixture(t, {
    "sources.list.d/ubuntu.sources": source,
    "sources.list.d/security.list": security,
    "sources.list.d/vendor.list": foreign,
    "sources.list.d/backup.txt": source,
  });
  await setup(root);
  assert.equal(
    await readFile(join(root, "sources.list.d/ubuntu.sources"), "utf8"),
    source.replace(mirror, canonical),
  );
  assert.equal(await readFile(join(root, "sources.list.d/security.list"), "utf8"), security);
  assert.equal(await readFile(join(root, "sources.list.d/vendor.list"), "utf8"), foreign);
  assert.equal(await readFile(join(root, "sources.list.d/backup.txt"), "utf8"), source);
});

test("legacy sources replace exact Azure Ubuntu URLs, including no trailing slash, but not lookalikes", async (t) => {
  const urls = [
    "http://azure.archive.ubuntu.com/ubuntu/",
    "https://azure.archive.ubuntu.com/ubuntu",
    "http://azureXarchive.ubuntu.com/ubuntu/",
    "https://azure.archive.ubuntu.com/ubuntu-extra/",
    "https://azure.archive.ubuntu.com.example/ubuntu/",
    "mirror+file:/etc/apt/another-mirrors.txt",
  ];
  const lines = urls.map((url) => `deb [signed-by=/keys/ubuntu.gpg] ${url} jammy main\n`);
  const root = await fixture(t, { "sources.list": lines.join("") });
  await setup(root);
  const expected = lines.map((line, i) => (i < 2 ? line.replace(urls[i], canonical) : line));
  assert.equal(await readFile(join(root, "sources.list"), "utf8"), expected.join(""));
});

test("APT configuration is idempotent, overrides image retry fragments and keeps verification enabled", async (t) => {
  const root = await fixture(t, {
    "sources.list": `deb ${mirror} noble main\n`,
    "apt.conf.d/zz-retries": 'Acquire::Retries "10";\n',
  });
  await setup(root);
  const names = (await readdir(join(root, "apt.conf.d"))).sort();
  assert.equal(names.at(-1), "zzzz-desk-ci");
  const config = await readFile(join(root, "apt.conf.d/zzzz-desk-ci"), "utf8");
  assert.match(config, /Acquire::Retries "1";/);
  assert.match(config, /Acquire::http::Timeout "30";/);
  assert.match(config, /Acquire::https::Timeout "30";/);
  assert.match(config, /APT::Update::Error-Mode "any";/);
  assert.doesNotMatch(
    config,
    /AllowInsecure|AllowUnauthenticated|Verify-Peer|Verify-Host|Check-Valid-Until/,
  );
  const sources = await readFile(join(root, "sources.list"), "utf8");
  await setup(root);
  assert.equal(await readFile(join(root, "sources.list"), "utf8"), sources);
  assert.equal(await readFile(join(root, "apt.conf.d/zzzz-desk-ci"), "utf8"), config);
  assert.equal(
    await readFile(join(root, "apt.conf.d/zz-retries"), "utf8"),
    'Acquire::Retries "10";\n',
  );
});

const workflow = async (name) =>
  parse(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));

function configuredBefore(job, install) {
  const steps = job.steps;
  const installAt = steps.findIndex((step) => step.run?.includes(install));
  const setupAt = steps.findIndex((step) => step.run?.includes("scripts/ci-apt.mjs"));
  assert.ok(installAt >= 0, `${install} must still run`);
  assert.ok(
    setupAt >= 0 && setupAt < installAt,
    "APT setup must run before dependency installation",
  );
  assert.equal(steps[setupAt]["continue-on-error"], undefined);
  assert.equal(steps[installAt]["continue-on-error"], undefined);
  return steps[setupAt];
}

test("the runtime e2e installs with configured APT while retaining commands, deadlines and gates", async () => {
  const { jobs } = await workflow("ci");
  const runtime = jobs["runtime-e2e-shard"];
  assert.ok(runtime, "Chromium runs on independent Linux shards");
  configuredBefore(runtime, "playwright install --with-deps chromium");
  assert.equal(runtime["timeout-minutes"], 15);
  assert.deepEqual(runtime.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(runtime.strategy["fail-fast"], false);
  const expression = (body) => `\${{ ${body} }}`;
  const shard = expression("matrix.shard");
  assert.ok(
    runtime.steps.some((step) => step.run === `just test-e2e --shard=${shard}/4 --workers=1`),
  );
  const report = runtime.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(report.if, "failure()");
  assert.equal(report.with.name, `playwright-report-${shard}`);
  const gate = jobs["runtime-e2e"];
  assert.equal(gate.name, "runtime-e2e");
  assert.equal(gate.if, "always()");
  assert.equal(gate.needs, "runtime-e2e-shard");
  const result = gate.steps.find((step) => step.env?.SHARD_RESULT);
  assert.equal(result.env.SHARD_RESULT, expression("needs.runtime-e2e-shard.result"));
  assert.equal(result.run, 'test "$SHARD_RESULT" = success');
  assert.deepEqual(jobs.ci.needs, [
    "changes",
    "check-linux",
    "runtime-e2e",
    "check-macos",
    "check-windows",
    "codegen-check",
    "red-on-base",
    "release-dry-run",
  ]);
});

test("the Linux unit tests have the Vulkan loader and software driver for offscreen rendering", async () => {
  const { jobs } = await workflow("ci");
  const job = jobs["check-linux"];
  configuredBefore(job, "mesa-vulkan-drivers");
  const install = job.steps.find((step) => step.run?.includes("mesa-vulkan-drivers"));
  for (const pkg of ["libasound2-dev", "libvulkan1", "mesa-vulkan-drivers"]) {
    assert.ok(install.run.split(/\s+/u).includes(pkg), pkg);
  }
  assert.ok(
    job.steps.indexOf(install) < job.steps.findIndex((step) => step.run === "just test-unit"),
  );
});

test("the Linux compositor can draw Hangul, Han and kana window titles", async () => {
  const job = (await workflow("ci")).jobs["check-linux"];
  configuredBefore(job, "fonts-noto-cjk");
  const installAt = job.steps.findIndex((step) =>
    /\bapt-get install [^\n]*\bfonts-noto-cjk\b/u.test(step.run ?? ""),
  );
  const testsAt = job.steps.findIndex((step) => step.run === "just test-unit");
  assert.ok(installAt >= 0 && installAt < testsAt);
});

test("the Linux shell builds install the native headers before checking or launching the app", async () => {
  const ci = await workflow("ci");
  const e2e = await workflow("e2e");
  const headers = [
    "cmake",
    "ninja-build",
    "libgtk-3-dev",
    "libxdo-dev",
    "libayatana-appindicator3-dev",
    "libasound2-dev",
  ];
  for (const [job, recipe, condition, packages] of [
    [ci.jobs["shell-build"], "just check-shell", "runner.os == 'Linux'", headers],
    [e2e.jobs["app-e2e"], "just build-shell", "runner.os == 'Linux'", [...headers, "xvfb"]],
    [e2e.jobs.perf, "just build-shell", undefined, [...headers, "xvfb"]],
  ]) {
    const apt = configuredBefore(job, "libgtk-3-dev");
    assert.equal(apt.if, condition);
    const install = job.steps.find((step) => step.run?.includes("libgtk-3-dev"));
    assert.equal(install.if, condition);
    for (const pkg of packages) assert.ok(install.run.split(/\s+/u).includes(pkg), pkg);
    assert.ok(job.steps.indexOf(install) < job.steps.findIndex((step) => step.run === recipe));
  }
});

test("app e2e configures APT and changes to the helper exercise the existing packaged-app gates", async () => {
  const config = await workflow("e2e");
  assert.ok(config.on.pull_request.paths.includes("scripts/ci-apt.mjs"));
  assert.ok(config.on.pull_request.paths.includes("scripts/ci-apt.test.mjs"));
  const xvfb = (recipe) => `xvfb-run -a --server-args="-screen 0 1280x800x24" just ${recipe}`;

  // The CEF desk on three OSes (ADR 0144): APT on Linux only, before its packages.
  const cef = config.jobs["app-e2e"];
  assert.deepEqual(cef.strategy.matrix.os, ["ubuntu-latest", "macos-latest", "windows-latest"]);
  const apt = configuredBefore(cef, "sudo apt-get update");
  assert.equal(apt.if, "runner.os == 'Linux'");
  assert.equal(cef["timeout-minutes"], 60);
  assert.ok(cef.steps.some((step) => step.run === "just build-shell"));
  for (const recipe of ["test-app-e2e", "smoke"]) {
    assert.ok(
      cef.steps.some(
        (step) => step.run?.includes(xvfb(recipe)) && step.run.includes(`'just ${recipe}'`),
      ),
      recipe,
    );
  }

  // The Tauri app's run went with the Tauri app at the end of Stage 1 (#97).
  assert.equal(config.jobs["app-e2e-tauri"], undefined);
});
