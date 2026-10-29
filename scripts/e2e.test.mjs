import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { imageTag, manifestPaths, playwrightVersion, runArgs } from "./e2e/container.mjs";
import { e2eGuard } from "./e2e/guard.mjs";
import { isAgent, planRun, Refusal, workerArg } from "./e2e/plan.mjs";
import { acquire, readOwner } from "./e2e/slots.mjs";

const agent = { CLAUDECODE: "1" };
const temp = () => mkdtempSync(join(tmpdir(), "desk-e2e-test-"));
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const plan = (command, args, platform, env = {}) => planRun({ command, args, platform, env });

test("CI runs natively, without a slot", () => {
  const run = plan("test", [], "linux", { CI: "true" });
  assert.equal(run.where, "native");
  assert.equal(run.slots, 0);
});

test("Linux and Windows run natively and hold one slot", () => {
  for (const platform of ["linux", "win32"]) {
    const run = plan("test", [], platform);
    assert.equal(run.where, "native");
    assert.equal(run.slots, 1);
  }
});

test("macOS runs the tests in the Linux container, agents and people alike", () => {
  for (const env of [{}, agent]) {
    const run = plan("test", ["e2e/eris.spec.ts"], "darwin", env);
    assert.equal(run.where, "container");
    assert.equal(run.slots, 1);
    assert.equal(run.workers, 4);
    assert.deepEqual(run.args, ["e2e/eris.spec.ts"]);
  }
});

test("a person can ask for native WebKit on macOS; it keeps two workers", () => {
  const run = plan("test", [], "darwin", { DESK_E2E_NATIVE: "1" });
  assert.equal(run.where, "native");
  assert.equal(run.workers, 2);
  assert.equal(run.config, "playwright.config.ts");
});

test("an agent can never start native WebKit on macOS", () => {
  assert.throws(() => plan("test", [], "darwin", { ...agent, DESK_E2E_NATIVE: "1" }), Refusal);
  assert.throws(() => plan("perf", ["check"], "darwin", agent), /person/);
});

test("perf runs natively on macOS with one worker and every slot", () => {
  const run = plan("perf", ["check"], "darwin");
  assert.equal(run.where, "native");
  assert.equal(run.slots, "all");
  assert.equal(run.workers, 1);
  assert.equal(run.config, "playwright.perf.config.ts");
  assert.deepEqual(run.env, {});
  assert.deepEqual(plan("perf", ["record"], "darwin").env, { PERF_RECORD: "1" });
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
  assert.equal(plan("test", ["--workers=2"], "darwin").where, "container");
  assert.throws(
    () => plan("test", ["--workers=3"], "darwin", { DESK_E2E_NATIVE: "1" }),
    /at most 2/,
  );
});

test("headed, UI and debug runs need a display, which the container has not", () => {
  for (const flag of ["--headed", "--ui", "--debug"]) {
    assert.throws(() => plan("test", [flag], "darwin"), /DESK_E2E_NATIVE=1/);
  }
  assert.equal(plan("test", ["--headed"], "darwin", { DESK_E2E_NATIVE: "1" }).where, "native");
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

test("two runs hold slots at once and a third waits until one ends", async () => {
  const root = temp();
  const first = await acquire({ root, count: 2, owner: { pid: process.pid } });
  const second = await acquire({ root, count: 2, owner: { pid: process.pid } });
  let waits = 0;
  const third = await acquire({
    root,
    count: 2,
    owner: { pid: process.pid },
    sleep: async () => {
      waits += 1;
      first.release();
    },
  });
  assert.equal(waits, 1);
  assert.deepEqual(third.dirs, first.dirs);
  second.release();
  third.release();
});

test("a dead owner's slot is taken over and its leftovers cleaned", async () => {
  const root = temp();
  mkdirSync(join(root, "slot-0"), { recursive: true });
  writeFileSync(join(root, "slot-0", "owner.json"), JSON.stringify({ pid: 999999, token: "old" }));
  const stale = [];
  const lease = await acquire({
    root,
    count: 1,
    owner: { pid: process.pid },
    alive: (pid) => pid !== 999999,
    onStale: (owner) => stale.push(owner.token),
  });
  assert.deepEqual(stale, ["old"]);
  assert.equal(readOwner(lease.dirs[0]).token, lease.token);
  lease.release();
});

test("a slot still being created is respected; an abandoned empty one is freed", async () => {
  const root = temp();
  mkdirSync(join(root, "slot-0"), { recursive: true });
  await assert.rejects(
    acquire({ root, count: 1, owner: { pid: process.pid }, sleep: tick, timeoutMs: 30 }),
    /no e2e slot/,
  );
  const old = new Date(Date.now() - 120_000);
  utimesSync(join(root, "slot-0"), old, old);
  const lease = await acquire({ root, count: 1, owner: { pid: process.pid }, sleep: tick });
  assert.equal(readOwner(lease.dirs[0]).token, lease.token);
  lease.release();
});

test("perf takes every slot, and runs that arrive while it waits queue behind it", async () => {
  const root = temp();
  const running = await acquire({ root, count: 2, owner: { pid: process.pid } });
  const perf = acquire({
    root,
    count: 2,
    exclusive: true,
    owner: { pid: process.pid },
    sleep: tick,
  });
  await tick(20);
  let late = false;
  const next = acquire({ root, count: 2, owner: { pid: process.pid }, sleep: tick }).then((l) => {
    late = true;
    return l;
  });
  await tick(30);
  assert.equal(late, false, "a new run must not slip in while perf waits");
  running.release();
  const alone = await perf;
  assert.equal(alone.dirs.length, 2);
  await tick(30);
  assert.equal(late, false);
  alone.release();
  (await next).release();
});

test("release leaves a slot that someone else took over alone", async () => {
  const root = temp();
  const lease = await acquire({ root, count: 1, owner: { pid: process.pid } });
  writeFileSync(join(lease.dirs[0], "owner.json"), JSON.stringify({ pid: 1, token: "other" }));
  lease.release();
  assert.ok(existsSync(lease.dirs[0]));
});

test("the lease records the container it started, for cleanup after a crash", async () => {
  const root = temp();
  const lease = await acquire({ root, count: 1, owner: { pid: process.pid } });
  lease.update({ container: "desk-e2e-1-0" });
  assert.equal(readOwner(lease.dirs[0]).container, "desk-e2e-1-0");
  lease.release();
});

test("the Playwright version comes from the lockfile", () => {
  const lock = "  '@playwright/test@1.64.1':\n    resolution: {integrity: sha512-x}\n";
  assert.equal(playwrightVersion(lock), "1.64.1");
  assert.throws(() => playwrightVersion("lockfileVersion: '9.0'\n"), /@playwright\/test/);
});

test("the dependency image follows the manifests and nothing else", () => {
  const repo = temp();
  writeFileSync(join(repo, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  writeFileSync(join(repo, "package.json"), "{}");
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(join(repo, "packages/a"), { recursive: true });
  mkdirSync(join(repo, "packages/notes"), { recursive: true });
  writeFileSync(join(repo, "packages/a/package.json"), '{"name":"a"}');
  writeFileSync(join(repo, "packages/a/index.ts"), "export {}");
  const paths = manifestPaths(repo);
  assert.deepEqual(paths, [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "packages/a/package.json",
  ]);
  const tag = () =>
    imageTag({ repo, paths, dockerfile: "FROM x", playwright: "1.64.1", pnpm: "9" });
  const before = tag();
  assert.match(before, /^desk-e2e:[0-9a-f]{12}$/);
  writeFileSync(join(repo, "packages/a/index.ts"), "export const changed = 1");
  assert.equal(tag(), before, "source changes reuse the image");
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n");
  assert.notEqual(tag(), before, "a lockfile change builds a new image");
});

test("the container reads the checkout and writes only snapshots and results", () => {
  const args = runArgs({
    repo: "/Users/me/desk",
    image: "desk-e2e:0123456789ab",
    name: "desk-e2e-42-0",
    workers: 4,
    memory: "3g",
    args: ["--update-snapshots"],
  });
  const mounts = args.flatMap((arg, i) => (args[i - 1] === "-v" ? [arg] : []));
  assert.deepEqual(mounts, [
    "/Users/me/desk:/src:ro",
    "/Users/me/desk/packages/runtime/e2e/__snapshots__:/work/packages/runtime/e2e/__snapshots__",
    "/Users/me/desk/packages/runtime/test-results:/results",
  ]);
  assert.deepEqual(args.slice(0, 2), ["run", "--rm"]);
  assert.ok(args.includes("--init"));
  assert.equal(args[args.indexOf("--name") + 1], "desk-e2e-42-0");
  assert.equal(args[args.indexOf("--memory") + 1], "3g");
  assert.ok(args.includes("DESK_E2E_WORKERS=4"));
  assert.ok(args.indexOf("desk-e2e:0123456789ab") < args.indexOf("--update-snapshots"));
  assert.equal(args.at(-1), "--update-snapshots");
});

test("on macOS, Playwright refuses to start without a slot from the runner", () => {
  const argv = ["node", "playwright", "test"];
  assert.throws(() => e2eGuard({ platform: "darwin", env: {}, argv }), /just test-e2e/);
});

test("on macOS, a forged or dead slot is refused", async () => {
  const root = temp();
  const lease = await acquire({ root, count: 1, owner: { pid: process.pid } });
  const argv = ["node", "playwright", "test"];
  const env = { DESK_E2E_SLOT: lease.dirs[0], DESK_E2E_TOKEN: "guess" };
  assert.throws(() => e2eGuard({ platform: "darwin", env, argv }), /just test-e2e/);
  const real = { DESK_E2E_SLOT: lease.dirs[0], DESK_E2E_TOKEN: lease.token };
  const dead = () => false;
  assert.throws(() => e2eGuard({ platform: "darwin", env: real, argv, alive: dead }), /just/);
  lease.release();
});

test("on macOS, a slotted run keeps two workers and no traces, screenshots or video", async () => {
  const root = temp();
  const lease = await acquire({ root, count: 1, owner: { pid: process.pid } });
  const env = { DESK_E2E_SLOT: lease.dirs[0], DESK_E2E_TOKEN: lease.token, DESK_E2E_WORKERS: "2" };
  const guard = e2eGuard({ platform: "darwin", env, argv: ["node", "playwright", "test"] });
  assert.deepEqual(guard, { workers: 2, use: { trace: "off", screenshot: "off", video: "off" } });
  for (const extra of [["--workers=4"], ["--trace", "on"], ["--trace=retain-on-failure"]]) {
    const argv = ["node", "playwright", "test", ...extra];
    assert.throws(() => e2eGuard({ platform: "darwin", env, argv }), Error, extra.join(" "));
  }
  assert.throws(() => e2eGuard({ platform: "darwin", env: { ...env, ...agent }, argv: [] }));
  lease.release();
});

test("Linux and CI pass the guard, within the runner's worker cap", () => {
  const argv = ["node", "playwright", "test"];
  assert.deepEqual(e2eGuard({ platform: "linux", env: {}, argv }), { workers: undefined, use: {} });
  const capped = { DESK_E2E_WORKERS: "4" };
  assert.equal(e2eGuard({ platform: "linux", env: capped, argv }).workers, 4);
  assert.throws(() => e2eGuard({ platform: "linux", env: capped, argv: [...argv, "-j", "8"] }));
});

test("listing tests launches no browser, so the guard lets it through", () => {
  const argv = ["node", "playwright", "test", "--list"];
  assert.doesNotThrow(() => e2eGuard({ platform: "darwin", env: {}, argv }));
});
