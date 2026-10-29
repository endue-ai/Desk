#!/usr/bin/env node
// e2e: the one way to run the runtime's Playwright tests on a developer machine (ADR 0018).
//
//   node scripts/e2e.mjs test [playwright args]    (just test-e2e)      the runtime e2e
//   node scripts/e2e.mjs perf [check|record]       (just perf-opening)  the opening frame time
//
// CI runs Playwright directly. Linux and Windows run it natively, holding one of the machine's e2e
// slots. macOS runs it in a Linux container (Docker), holding a slot; DESK_E2E_NATIVE=1 runs native
// WebKit for a person at the keyboard, and perf runs natively with the machine to itself. AI agents
// never start native WebKit on macOS: dozens of them crashed WindowServer and ended the login session.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSession, report } from "./doctor.mjs";
import {
  ensureDocker,
  ensureImage,
  killContainer,
  removeContainer,
  runArgs,
} from "./e2e/container.mjs";
import { planRun, Refusal } from "./e2e/plan.mjs";
import { acquire, slotCount, slotRoot } from "./e2e/slots.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

let child = null;
let container = null;
let lease = null;

function release() {
  lease?.release();
  lease = null;
}

for (const [signal, code] of Object.entries(SIGNALS)) {
  process.on(signal, () => {
    if (container) killContainer(container);
    child?.kill(signal);
    release();
    process.exit(code);
  });
}
process.on("exit", release);

function run(command, args, options = {}) {
  return new Promise((done, fail) => {
    child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", fail);
    child.on("exit", (code, signal) => {
      child = null;
      done(code ?? SIGNALS[signal] ?? 1);
    });
  });
}

function holders(owners) {
  return owners.map((o) => `${o.command ?? "e2e"} in ${o.cwd ?? "?"} (pid ${o.pid})`).join("; ");
}

async function takeSlot(plan, command) {
  const count = slotCount();
  let last = 0;
  lease = await acquire({
    root: slotRoot(),
    count,
    exclusive: plan.slots === "all",
    owner: { pid: process.pid, cwd: REPO, command, where: plan.where },
    onStale: (owner) => removeContainer(owner.container),
    onWait: (owners) => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      const what = plan.slots === "all" ? "the machine to itself" : "an e2e slot";
      console.error(`e2e: waiting for ${what} (${count} per machine). Held by: ${holders(owners)}`);
    },
  });
}

async function inContainer(plan) {
  await ensureDocker();
  const image = ensureImage(REPO);
  const name = `desk-e2e-${process.pid}-${Date.now().toString(36)}`;
  lease?.update({ container: name });
  mkdirSync(join(REPO, "packages/runtime/test-results"), { recursive: true });
  mkdirSync(join(REPO, "packages/runtime/e2e/__snapshots__"), { recursive: true });
  const memory = process.env.DESK_E2E_MEMORY || "3g";
  console.error(`e2e: Linux container ${image}, ${plan.workers} workers, ${memory} (ADR 0018)`);
  container = name;
  const color = Boolean(process.stdout.isTTY);
  const args = runArgs({
    repo: REPO,
    image,
    name,
    workers: plan.workers,
    memory,
    color,
    args: plan.args,
  });
  const code = await run("docker", args);
  container = null;
  if (code === 137) {
    console.error(
      `e2e: the container was killed (exit 137), usually for running out of its ${memory}. ` +
        "Run fewer workers (--workers 2) or raise DESK_E2E_MEMORY.",
    );
  }
  return code;
}

function natively(plan) {
  const env = { ...process.env, ...plan.env };
  if (lease) {
    env.DESK_E2E_SLOT = lease.dirs[0];
    env.DESK_E2E_TOKEN = lease.token;
  }
  if (plan.workers) env.DESK_E2E_WORKERS = String(plan.workers);
  const args = [
    "--filter",
    "@endue-ai/runtime",
    "exec",
    "playwright",
    "test",
    "--config",
    plan.config,
  ];
  return run("pnpm", [...args, ...plan.args], { env, cwd: REPO });
}

async function main([command, ...args]) {
  let plan;
  try {
    plan = planRun({ command, args, platform: process.platform, env: process.env });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`e2e: ${error.message}`);
    return 2;
  }
  if (process.platform === "darwin" && !process.env.CI) {
    const session = await checkSession();
    if (!session.ok) {
      console.error(report(session));
      return 3;
    }
  }
  if (plan.slots) await takeSlot(plan, command);
  try {
    return plan.where === "container" ? await inContainer(plan) : await natively(plan);
  } finally {
    release();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`e2e: ${error.message}`);
  process.exitCode = 1;
}
