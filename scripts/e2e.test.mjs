import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { e2eGuard } from "./e2e/guard.mjs";
import { leaseHeld, openLease, readLease } from "./e2e/lease.mjs";
import { isAgent, planRun, Refusal, WORKERS, workerArg } from "./e2e/plan.mjs";

const agent = { CLAUDECODE: "1" };
const temp = () => mkdtempSync(join(tmpdir(), "desk-e2e-test-"));
const plan = (command, args, platform, env = {}) => planRun({ command, args, platform, env });
const repo = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");

test("every OS runs headless Chromium natively with four workers, agents and people alike", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    for (const env of [{}, agent]) {
      const run = plan("test", ["e2e/eris.spec.ts"], platform, env);
      assert.equal(run.config, "playwright.config.ts");
      assert.equal(run.workers, 4);
      assert.deepEqual(run.args, ["e2e/eris.spec.ts"]);
      assert.equal("where" in run, false, "no container any more");
    }
  }
});

test("CI keeps Playwright's own worker count", () => {
  assert.equal(plan("test", [], "linux", { CI: "true" }).workers, undefined);
});

test("perf runs with one worker on every OS; an agent may record it now", () => {
  for (const env of [{}, agent]) {
    const run = plan("perf", ["check"], "darwin", env);
    assert.equal(run.workers, WORKERS.perf);
    assert.equal(run.config, "playwright.perf.config.ts");
    assert.deepEqual(run.env, {});
  }
  assert.deepEqual(plan("perf", ["record"], "darwin", agent).env, { PERF_RECORD: "1" });
  assert.throws(() => plan("perf", ["fast"], "darwin"), Refusal);
});

test("more workers than the cap are refused", () => {
  for (const args of [
    ["--workers=8"],
    ["-j", "6"],
    ["--workers", "12"],
    ["-j5"],
    ["--workers=50%"],
  ]) {
    assert.throws(() => plan("test", args, "darwin"), /at most 4 workers/, args.join(" "));
  }
  assert.equal(plan("test", ["--workers=2"], "darwin").workers, 4);
});

test("headed, UI and debug runs open Chromium windows: people only on macOS", () => {
  for (const flag of ["--headed", "--ui", "--debug"]) {
    assert.throws(() => plan("test", [flag], "darwin", agent), /person at the keyboard/);
    assert.deepEqual(plan("test", [flag], "darwin", {}).args, [flag]);
    assert.deepEqual(plan("test", [flag], "linux", agent).args, [flag]);
  }
});

test("workerArg reads every spelling", () => {
  assert.equal(workerArg(["--workers=3"]), "3");
  assert.equal(workerArg(["--workers", "3"]), "3");
  assert.equal(workerArg(["-j", "3"]), "3");
  assert.equal(workerArg(["-j3"]), "3");
  assert.equal(workerArg(["e2e/eris.spec.ts"]), null);
});

test("isAgent recognises Claude Code, Codex and DESK_AGENT", () => {
  assert.ok(isAgent({ CLAUDECODE: "1" }));
  assert.ok(isAgent({ CLAUDE_CODE_ENTRYPOINT: "cli" }));
  assert.ok(isAgent({ CODEX_SANDBOX: "seatbelt" }));
  assert.ok(isAgent({ DESK_AGENT: "1" }));
  assert.ok(!isAgent({ DESK_AGENT: "0" }));
  assert.ok(!isAgent({ HOME: "/Users/me" }));
});

test("a lease limits nothing: runs hold one each at once, and release removes it", () => {
  const root = temp();
  const runs = [1, 2, 3].map(() => openLease({ root, owner: { pid: process.pid } }));
  assert.equal(readdirSync(root).length, 3);
  for (const lease of runs) {
    assert.equal(readLease(lease.file).token, lease.token);
    assert.equal(readLease(lease.file).pid, process.pid);
  }
  for (const lease of runs) lease.release();
  assert.deepEqual(readdirSync(root), []);
});

test("a dead runner's lease is swept by the next run", () => {
  const root = temp();
  writeFileSync(join(root, "999999-old.json"), JSON.stringify({ pid: 999999, token: "old" }));
  writeFileSync(join(root, "broken.json"), "{");
  const lease = openLease({ root, owner: { pid: process.pid }, alive: (pid) => pid !== 999999 });
  assert.deepEqual(readdirSync(root), [lease.file.slice(root.length + 1)]);
  lease.release();
});

test("on macOS, Playwright refuses to start without a lease from the runner", () => {
  const argv = ["node", "playwright", "test"];
  assert.throws(() => e2eGuard({ platform: "darwin", env: {}, argv }), /just test-e2e/);
});

test("on macOS, a forged or dead lease is refused", () => {
  const root = temp();
  const lease = openLease({ root, owner: { pid: process.pid } });
  const argv = ["node", "playwright", "test"];
  const forged = { DESK_E2E_RUN: lease.file, DESK_E2E_TOKEN: "guess" };
  assert.throws(() => e2eGuard({ platform: "darwin", env: forged, argv }), /just test-e2e/);
  const real = { DESK_E2E_RUN: lease.file, DESK_E2E_TOKEN: lease.token };
  assert.ok(leaseHeld(real));
  const dead = () => false;
  assert.throws(() => e2eGuard({ platform: "darwin", env: real, argv, alive: dead }), /just/);
  lease.release();
  assert.ok(!leaseHeld(real));
});

test("on macOS, a leased run keeps four workers and traces; an agent's headed run is refused", () => {
  const root = temp();
  const lease = openLease({ root, owner: { pid: process.pid } });
  const env = { DESK_E2E_RUN: lease.file, DESK_E2E_TOKEN: lease.token, DESK_E2E_WORKERS: "4" };
  const guard = e2eGuard({ platform: "darwin", env, argv: ["node", "playwright", "test"] });
  assert.deepEqual(guard, { workers: 4 });
  const traced = ["node", "playwright", "test", "--trace", "on"];
  assert.deepEqual(e2eGuard({ platform: "darwin", env, argv: traced }), { workers: 4 });
  const wide = ["node", "playwright", "test", "--workers=6"];
  assert.throws(() => e2eGuard({ platform: "darwin", env, argv: wide }), /at most 4/);
  const headed = ["node", "playwright", "test", "--headed"];
  assert.throws(() => e2eGuard({ platform: "darwin", env: { ...env, ...agent }, argv: headed }));
  assert.deepEqual(e2eGuard({ platform: "darwin", env, argv: headed }), { workers: 4 });
  lease.release();
});

test("Linux and CI pass the guard, within the runner's worker cap", () => {
  const argv = ["node", "playwright", "test"];
  assert.deepEqual(e2eGuard({ platform: "linux", env: {}, argv }), { workers: undefined });
  const capped = { DESK_E2E_WORKERS: "4" };
  assert.equal(e2eGuard({ platform: "linux", env: capped, argv }).workers, 4);
  assert.throws(() => e2eGuard({ platform: "linux", env: capped, argv: [...argv, "-j", "8"] }));
});

test("listing tests launches no browser, so the guard lets it through", () => {
  const argv = ["node", "playwright", "test", "--list"];
  assert.doesNotThrow(() => e2eGuard({ platform: "darwin", env: {}, argv }));
});

test("both Playwright configs run Chromium only, and the container runner is gone", () => {
  for (const config of ["playwright.config.ts", "playwright.perf.config.ts"]) {
    const text = read(`packages/runtime/${config}`);
    assert.match(text, /name: "chromium"/, config);
    assert.match(text, /use: chromium/, config);
    assert.match(text, /globalSetup: chromiumSetup/, config);
    assert.doesNotMatch(text, /webkit|Safari/i, config);
    assert.match(text, /e2eGuard\(\)/, config);
  }
  // The engine is the CEF desk's own build, not Playwright's bundled one (e2e/chromium.ts).
  const engine = read("packages/runtime/e2e/chromium.ts");
  assert.match(engine, /devices\["Desktop Chrome"\]/);
  assert.match(engine, /executablePath: headlessShellPath\(\)/);
  for (const gone of [
    "scripts/e2e/container.mjs",
    "scripts/e2e/Dockerfile",
    "scripts/e2e/slots.mjs",
  ]) {
    assert.equal(existsSync(new URL(gone, repo)), false, gone);
  }
  assert.doesNotMatch(read("scripts/e2e.mjs"), /docker|container/i);
});
