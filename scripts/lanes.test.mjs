import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchName,
  globsOverlap,
  MAX_IN_FLIGHT,
  parseBlockedBy,
  plan,
  scopeConflicts,
} from "./lanes.mjs";

const task = (number, scope, blockedBy = []) => ({ number, scope, blockedBy });

test("globs in nested or equal directories overlap", () => {
  assert.ok(globsOverlap("crates/desk-core/**", "crates/**"));
  assert.ok(globsOverlap("crates/**", "crates/desk-core/src/*.rs"));
  assert.ok(globsOverlap("plugins/eris/**", "plugins/eris/**"));
  assert.ok(
    globsOverlap("**/*.md", "crates/desk-core/**"),
    "a glob rooted at the top overlaps everything",
  );
});

test("globs in sibling directories do not overlap", () => {
  assert.ok(!globsOverlap("crates/desk-core/**", "crates/desk-bridge/**"));
  assert.ok(!globsOverlap("plugins/eris/**", "plugins/onboarding/**"));
  assert.ok(
    !globsOverlap("crates/desk-core/**", "crates/desk-core-extra/**"),
    "a prefix is not a directory",
  );
});

test("a literal path overlaps exactly the globs that match it", () => {
  assert.ok(globsOverlap("AGENTS.md", "AGENTS.md"));
  assert.ok(globsOverlap("justfile", "*"));
  assert.ok(!globsOverlap("AGENTS.md", "crates/**"));
  assert.ok(
    globsOverlap("crates/desk-core", "crates/desk-core/src/*.rs"),
    "a literal directory holds its files",
  );
  assert.ok(globsOverlap("crates/desk-core/src/*.rs", "crates/desk-core"), "in either order");
  assert.ok(!globsOverlap("docs/adr/0015-x.md", "docs/adr/0016-y.md"));
});

test("shared files never take a lane", () => {
  assert.deepEqual(
    scopeConflicts(["Cargo.lock", "crates/desk-core/**"], ["Cargo.lock", "crates/desk-bridge/**"]),
    [],
  );
  assert.deepEqual(
    scopeConflicts(
      ["pnpm-lock.yaml", "docs/qa/TESTING.md"],
      ["./pnpm-lock.yaml", "docs/qa/TESTING.md"],
    ),
    [],
  );
  assert.deepEqual(scopeConflicts(["justfile"], ["justfile"]), ["justfile ~ justfile"]);
});

test("Blocked by lines are read from anywhere in the body", () => {
  assert.deepEqual(
    parseBlockedBy("### Assumptions\n- Blocked by #12: same files\n- blocked by #7"),
    [12, 7],
  );
  assert.deepEqual(parseBlockedBy(undefined), []);
});

test("plan starts non-overlapping tasks in issue order and waits on the rest", () => {
  const result = plan({
    ready: [
      task(31, ["plugins/eris/**"]),
      task(30, ["crates/desk-core/**", "Cargo.lock"]),
      task(32, ["crates/desk-core/src/lease.rs"]),
      task(33, ["packages/runtime/**", "Cargo.lock"]),
    ],
    inFlight: [task(20, ["plugins/eris/ui/**"])],
    openIssues: new Set([20, 30, 31, 32, 33]),
  });
  assert.deepEqual(result.start, [30, 33]);
  assert.deepEqual(
    result.waiting.map((w) => w.number),
    [31, 32],
  );
  assert.match(result.waiting[0].reason, /lane held by #20/);
  assert.match(
    result.waiting[1].reason,
    /lane held by #30/,
    "a task started in this plan takes its lane",
  );
});

test("plan honours open blockers, missing Scopes and the in-flight cap", () => {
  const busy = Array.from({ length: MAX_IN_FLIGHT }, (_, i) =>
    task(100 + i, [`crates/desk-x${i}/**`]),
  );
  const capped = plan({ ready: [task(1, ["docs/**"])], inFlight: busy, openIssues: new Set() });
  assert.deepEqual(capped.start, []);
  assert.match(capped.waiting[0].reason, /max 4/);

  const result = plan({
    ready: [task(2, ["docs/a/**"], [9]), task(3, ["docs/b/**"], [8]), task(4, [])],
    inFlight: [],
    openIssues: new Set([9]),
  });
  assert.deepEqual(result.start, [3], "a closed blocker no longer blocks");
  assert.match(result.waiting.find((w) => w.number === 2).reason, /blocked by #9/);
  assert.match(result.waiting.find((w) => w.number === 4).reason, /no Scope/);
});

test("branch names come from the title without its type prefix", () => {
  assert.equal(
    branchName(42, "task: Restore the layout on start, again"),
    "ai/42-restore-the-layout-on",
  );
  assert.equal(branchName(7, "feat(runtime): Eris"), "ai/7-eris");
  assert.equal(branchName(8, ""), "ai/8-task");
});
