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

test("runtime and app build install with configured APT while retaining commands, deadlines and gates", async () => {
  const { jobs } = await workflow("ci");
  const runtime = jobs["runtime-e2e"];
  configuredBefore(runtime, "playwright install --with-deps webkit");
  assert.equal(runtime["timeout-minutes"], 15);
  assert.ok(runtime.steps.some((step) => step.run === "just test-e2e"));
  const build = jobs["app-build"];
  const step = configuredBefore(build, "sudo apt-get update");
  assert.equal(step.if, "runner.os == 'Linux'");
  assert.equal(build["timeout-minutes"], 30);
  assert.ok(build.steps.some((step) => step.run === "just check-app"));
  assert.ok(build.steps.some((step) => step.run === "just build-app"));
  assert.match(
    build.steps.find((item) => item.run?.includes("apt-get install")).run,
    /sudo apt-get install -y libwebkit2gtk-4\.1-dev build-essential file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev/,
  );
  assert.deepEqual(jobs.ci.needs, [
    "changes",
    "check-linux",
    "runtime-e2e",
    "check-macos",
    "check-windows",
    "app-build",
    "codegen-check",
    "red-on-base",
  ]);
});

test("app e2e configures APT and changes to the helper exercise the existing packaged-app gates", async () => {
  const config = await workflow("e2e");
  const job = config.jobs["app-e2e"];
  configuredBefore(job, "sudo apt-get update");
  assert.equal(job["timeout-minutes"], 45);
  assert.ok(config.on.pull_request.paths.includes("scripts/ci-apt.mjs"));
  assert.ok(config.on.pull_request.paths.includes("scripts/ci-apt.test.mjs"));
  assert.ok(job.steps.some((step) => step.run === "just bundle-app"));
  assert.ok(
    job.steps.some(
      (step) => step.run === 'xvfb-run -a --server-args="-screen 0 1280x800x24" just test-app-e2e',
    ),
  );
  assert.ok(
    job.steps.some(
      (step) => step.run === 'xvfb-run -a --server-args="-screen 0 1280x800x24" just smoke',
    ),
  );
  assert.match(
    job.steps.find((step) => step.run?.includes("apt-get install")).run,
    /sudo apt-get install -y libwebkit2gtk-4\.1-dev build-essential file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev webkit2gtk-driver xvfb/,
  );
});
