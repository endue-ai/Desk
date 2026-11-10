#!/usr/bin/env node
// e2e: the one way to run the runtime's Playwright tests (ADR 0018, ADR 0144).
//
//   node scripts/e2e.mjs test [playwright args]    (just test-e2e)      the runtime e2e
//   node scripts/e2e.mjs perf [check|record]       (just perf-opening)  the opening frame time
//
// Every OS runs Playwright's headless Chromium natively, at most four workers a run (one for perf).
// Outside CI the run holds a lease the Playwright configs' guard checks, so on macOS a Playwright that
// skipped this runner refuses to start; an AI agent never asks for a headed, UI or debug run there,
// since those open Chromium windows on WindowServer (scripts/e2e/plan.mjs).

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSession, report } from "./doctor.mjs";
import { leaseRoot, openLease } from "./e2e/lease.mjs";
import { planRun, Refusal } from "./e2e/plan.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNALS = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

let child = null;
let lease = null;

function release() {
  lease?.release();
  lease = null;
}

for (const [signal, code] of Object.entries(SIGNALS)) {
  process.on(signal, () => {
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

function playwright(plan) {
  const env = { ...process.env, ...plan.env };
  if (lease) {
    env.DESK_E2E_RUN = lease.file;
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
  if (!process.env.CI) {
    lease = openLease({ root: leaseRoot(), owner: { pid: process.pid, cwd: REPO, command } });
  }
  try {
    return await playwright(plan);
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
