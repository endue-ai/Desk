---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# Parallel agents share one trunk: lanes, task worktrees and a merge queue

## Context and Problem Statement

Several author AIs now work on Desk at the same time, each on its own Task issue. The T2 harness assumed
one task at a time: branch protection required every PR to be up to date with `main`, so each merge sent
every other open PR back to rebase and rerun CI on three OSes; two agents could pick the same `ai:ready`
issue; Scopes were compared only when an issue was planned; and admins, the account agents run as,
could push to `main` directly. Runtime e2e runs from two worktrees could even test each other's code
through a reused fixture server. How do parallel agents integrate without stepping on each other?

## Decision Drivers

* `main` stays green and linear; people approve every task PR (ADR 0008)
* Agents spend their CI budget on their own failures, not on rebasing behind each other
* Conflicts are prevented before work starts, not resolved after
* Cheap mechanisms: labels, path globs and git refs, no new service

## Considered Options

* One trunk, short `ai/<issue>-<slug>` branches, lanes from Scopes, a GitHub merge queue
* A `develop` integration branch with `feature/*` branches (the Endue cell's GitLab strategy)
* Epic integration branches that collect the work of several agents before `main`
* Stacked PRs for every multi-step change

## Decision Outcome

Chosen option: "one trunk with lanes, task worktrees and a merge queue".

* **Lanes.** A task's Scope is its lane. `scripts/lanes.mjs` starts a ready task only when its Scope
  overlaps no task in flight, at most four at once. `Cargo.lock`, `pnpm-lock.yaml` and
  `docs/qa/TESTING.md` are shared: the later PR takes main's lockfile and regenerates it, or keeps both
  table rows. Claiming adds `ai:in-progress`; the lane frees when the PR merges and closes the issue.
  One dispatcher claims at a time.
* **Task worktrees.** `just task-start <issue>` claims the issue and creates
  `.claude/worktrees/ai-<issue>` on `ai/<issue>-<slug>` from `origin/main` with its own `node_modules`
  and `target/`. `just task-gc` removes merged ones. The runtime e2e fixture port is derived from the
  checkout path and never reused, so parallel runs stay apart.
* **Merge queue.** The `main` ruleset (`.github/rulesets/main.json`, applied by
  `scripts/sync-rulesets.sh`) requires `ci` and `scope-check`, squash only, linear history, and a merge
  queue (ALLGREEN, groups of up to 15), with no bypass actors. Branches no longer need to be up to
  date: the queue tests each PR on top of `main` and the PRs ahead of it. `ci` runs again there;
  `scope-check` reports success, since Scope was judged on the PR.
* **No rebase for its own sake.** Agents update a branch only for a conflict, a failing gate or a
  queue ejection, and never rerun CI to turn it green. People add approved PRs to the queue; agents
  never merge or enqueue.

### Consequences

* Good, because a merge no longer invalidates the CI of every other open PR.
* Good, because two agents never edit the same files, and the reason a task waits is printed.
* Good, because nobody, people or agents, can push to `main` outside the queue.
* Bad, because a queue entry runs `ci` once more, so a PR lands later than a direct merge would.
* Bad, because glob overlap is conservative: a Scope rooted high (for example `**/*.md`) serialises
  everything; planners keep Scopes narrow.
* Bad, because an emergency fix to a red `main` also goes through the queue; disabling the ruleset is
  the escape hatch.
* Desk diverges from the Endue cell's `develop`-based GitLab strategy; this record is that divergence.

## More Information

Applying the ruleset is a manual step after this change is on `main`: `scripts/sync-rulesets.sh`.
Procedures: `.claude/skills/dispatch/SKILL.md`, `.claude/skills/run-task/SKILL.md`.
