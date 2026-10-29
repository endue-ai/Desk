#!/usr/bin/env node
// lanes: which Task issues may run in parallel. Two tasks share a lane when their Scopes can touch the
// same file; a task starts only when its lane is free. Node 22, no dependencies; reads GitHub via `gh`.
//
//   node scripts/lanes.mjs status            in-flight tasks, their branches and Scopes
//   node scripts/lanes.mjs next [--max N]    ai:ready issues that can start now (default: fill to 15)
//   node scripts/lanes.mjs claim <issue>     check the lane, then label the issue ai:in-progress
//   node scripts/lanes.mjs release <issue>   drop ai:in-progress from an abandoned task

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { globToRegExp, parseLinkedIssue, parseScope } from "./scope-check.mjs";

/** Parallel tasks at once (ADR 0015); each one still ends in a PR a person approves. */
export const MAX_IN_FLIGHT = 15;

/**
 * Files every task may list without taking a lane. Conflicts in them are resolved mechanically: the
 * later PR takes main's version and regenerates (lockfiles) or keeps both rows (TESTING.md).
 */
export const SHARED_FILES = new Set(["Cargo.lock", "pnpm-lock.yaml", "docs/qa/TESTING.md"]);

const BLOCKED_BY = /\bblocked by\s+#(\d+)/gi;
const WILDCARD = /[*?{]/;

/** Issue numbers named as "Blocked by #M" anywhere in the issue body. */
export function parseBlockedBy(body) {
  return [...(body ?? "").matchAll(BLOCKED_BY)].map((match) => Number(match[1]));
}

/** The literal directory a glob is rooted at, or the literal path when it has no wildcard. */
function root(glob) {
  const pattern = glob.trim().replace(/^\.?\//, "");
  const index = pattern.search(WILDCARD);
  if (index === -1) return { literal: true, path: pattern.replace(/\/$/, "") };
  return { literal: false, path: pattern.slice(0, pattern.lastIndexOf("/", index) + 1) };
}

function under(path, dir) {
  return (
    dir === "" ||
    path === dir.replace(/\/$/, "") ||
    path.startsWith(dir.endsWith("/") ? dir : `${dir}/`)
  );
}

/**
 * Whether two globs can match a common file. Exact when either side is a literal path; otherwise
 * conservative: globs rooted in nested or equal directories overlap.
 */
export function globsOverlap(a, b) {
  const ra = root(a);
  const rb = root(b);
  if (ra.literal)
    return globToRegExp(b).test(ra.path) || under(ra.path, rb.path) || under(rb.path, ra.path);
  if (rb.literal) return globsOverlap(b, a);
  return under(ra.path, rb.path) || under(rb.path, ra.path);
}

/** The globs of two Scopes that collide, as "a ~ b" strings; shared files never collide. */
export function scopeConflicts(a, b) {
  const own = (globs) =>
    globs.filter((glob) => !SHARED_FILES.has(glob.trim().replace(/^\.?\//, "")));
  const conflicts = [];
  for (const x of own(a))
    for (const y of own(b)) if (globsOverlap(x, y)) conflicts.push(`${x} ~ ${y}`);
  return conflicts;
}

/**
 * Pick the ready tasks that can start. Input tasks: { number, scope, blockedBy, openIssues } where
 * openIssues is the set of open issue numbers. Ready tasks are tried in issue order, so older work
 * goes first, and each started task takes its lane from the ones after it.
 * Returns { start: number[], waiting: { number, reason }[] }.
 */
export function plan({ ready, inFlight, openIssues, max = MAX_IN_FLIGHT }) {
  const taken = [...inFlight];
  const start = [];
  const waiting = [];
  for (const task of [...ready].sort((x, y) => x.number - y.number)) {
    const blocker = task.blockedBy.find((number) => openIssues.has(number));
    if (task.scope.length === 0) {
      waiting.push({ number: task.number, reason: "no Scope: run /plan-task first" });
    } else if (blocker !== undefined) {
      waiting.push({ number: task.number, reason: `blocked by #${blocker}` });
    } else if (taken.length >= max) {
      waiting.push({ number: task.number, reason: `${taken.length} tasks in flight (max ${max})` });
    } else {
      const holder = taken.find((other) => scopeConflicts(task.scope, other.scope).length > 0);
      if (holder) {
        const [first] = scopeConflicts(task.scope, holder.scope);
        waiting.push({ number: task.number, reason: `lane held by #${holder.number} (${first})` });
      } else {
        start.push(task.number);
        taken.push(task);
      }
    }
  }
  return { start, waiting };
}

/** Branch name for a task: ai/<issue>-<two to four words of the title>. */
export function branchName(number, title) {
  const words = (title ?? "")
    .replace(/^[a-z]+(\([^)]*\))?:\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 4);
  return `ai/${number}-${words.join("-") || "task"}`;
}

function gh(...args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }) || "null");
}

function task(issue) {
  return {
    number: issue.number,
    title: issue.title,
    scope: parseScope(issue.body),
    blockedBy: parseBlockedBy(issue.body),
    labels: issue.labels.map((label) => label.name),
  };
}

/** Read the board: ready tasks, in-flight tasks (claimed or with an open ai/ PR) and open issues. */
function board() {
  const fields = "number,title,body,labels";
  const open = gh("issue", "list", "--state", "open", "--limit", "500", "--json", fields).map(task);
  const byNumber = new Map(open.map((t) => [t.number, t]));
  const prs = gh(
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "number,headRefName,body",
  );
  const branches = new Map();
  for (const pr of prs) {
    const issue = parseLinkedIssue(pr.body);
    if (pr.headRefName.startsWith("ai/") && issue != null)
      branches.set(issue, `${pr.headRefName} (#${pr.number})`);
  }
  const inFlight = open.filter(
    (t) => t.labels.includes("ai:in-progress") || branches.has(t.number),
  );
  const ready = open.filter(
    (t) =>
      t.labels.includes("ai:ready") &&
      !t.labels.includes("ai:needs-human") &&
      !inFlight.includes(t),
  );
  return { ready, inFlight, branches, byNumber, openIssues: new Set(byNumber.keys()) };
}

function remoteBranches(number) {
  const out = execFileSync("git", ["ls-remote", "--heads", "origin", `refs/heads/ai/${number}-*`], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("refs/heads/")[1]);
}

function maxArg(args, inFlight) {
  const index = args.indexOf("--max");
  return index === -1 ? MAX_IN_FLIGHT : inFlight + Number(args[index + 1]);
}

function status() {
  const { inFlight, branches, ready } = board();
  console.log(`In flight: ${inFlight.length} (max ${MAX_IN_FLIGHT})`);
  for (const t of inFlight) {
    const human = t.labels.includes("ai:needs-human") ? "  [ai:needs-human]" : "";
    console.log(`  #${t.number} ${t.title}${human}`);
    console.log(`    branch: ${branches.get(t.number) ?? "(not pushed yet)"}`);
    console.log(`    scope:  ${t.scope.join(", ") || "(none)"}`);
  }
  console.log(`Ready: ${ready.map((t) => `#${t.number}`).join(" ") || "none"}`);
}

function next(args) {
  const { ready, inFlight, openIssues } = board();
  const result = plan({ ready, inFlight, openIssues, max: maxArg(args, inFlight.length) });
  console.log(`Start: ${result.start.map((n) => `#${n}`).join(" ") || "none"}`);
  for (const { number, reason } of result.waiting) console.log(`  wait #${number}: ${reason}`);
}

function claim(number) {
  const { ready, inFlight, openIssues, byNumber } = board();
  const target = byNumber.get(number);
  if (!target) throw new Error(`#${number} is not an open issue`);
  if (inFlight.some((t) => t.number === number)) throw new Error(`#${number} is already in flight`);
  if (!ready.some((t) => t.number === number)) throw new Error(`#${number} is not ai:ready`);
  const pushed = remoteBranches(number);
  if (pushed.length > 0) throw new Error(`#${number} already has ${pushed.join(", ")} on origin`);
  const result = plan({ ready: [target], inFlight, openIssues });
  if (result.start.length === 0)
    throw new Error(`#${number} cannot start: ${result.waiting[0].reason}`);
  // stdout carries only the branch name, so `just task-start` can pass it on.
  execFileSync("gh", ["issue", "edit", String(number), "--add-label", "ai:in-progress"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log(branchName(number, target.title));
}

function release(number) {
  execFileSync("gh", ["issue", "edit", String(number), "--remove-label", "ai:in-progress"], {
    stdio: "inherit",
  });
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const number = Number(args[0]);
  if (command === "status") status();
  else if (command === "next") next(args);
  else if (command === "claim" && number) claim(number);
  else if (command === "release" && number) release(number);
  else
    throw new Error("usage: lanes.mjs status | next [--max N] | claim <issue> | release <issue>");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(`lanes: ${error.message}`);
    process.exitCode = 1;
  }
}
