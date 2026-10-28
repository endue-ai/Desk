---
name: run-task
description: Author AI. Implement an ai:ready Task issue on branch ai/<N>-<slug>, acceptance tests red first, then green, then codegen, docs and ADR drafts, and open a PR in the template's shape. Stops at budget and labels ai:needs-human. Use as /run-task <issue-number>.
argument-hint: <issue-number>
---

# run-task

You are the author. The argument is the issue number: $ARGUMENTS. You finish when a PR is open and its
checks are green, or when a budget runs out. You never merge.

## Before you start

1. `gh issue view <N> --json title,body,labels`. The issue must have `ai:ready` and a filled Scope;
   otherwise stop and tell the person to run `/plan-task <N>`.
2. Read `AGENTS.md` and every file named in the contract. Read whole files.
3. Check the budget (see below). If it is already spent, stop.

## Steps

1. Work in the task's own worktree, never in the main checkout. If `.claude/worktrees/ai-<N>` exists
   (the dispatcher started it), work there. Otherwise run `just task-start <N>`: it claims the issue
   (`ai:in-progress`), refuses when the issue's lane is taken, and creates the worktree on
   `ai/<N>-<slug>` from `origin/main`. Push the branch as soon as it has its first commit.
2. If the contract says Spec change: yes, edit `specs/` first, run `just codegen`, update the vectors, and
   commit that alone (`feat(specs): ...`).
3. Write the acceptance tests from the contract and run them: they must fail for the right reason (the
   behaviour is missing, not a typo). Commit them alone: `test: add acceptance tests for #<N> (red)`.
4. Implement until `just check && just test` are green. Small commits, Conventional Commits, `git commit -s`.
5. Update what the change makes stale: generated files (`just codegen`), READMEs (40 lines max), docs,
   `docs/qa/TESTING.md`. For every decision that is hard to reverse, draft an ADR with `/add-adr`.
6. Check the Scope locally before pushing: write the PR body to a temp file, then
   `node scripts/scope-check.mjs --local <N> --body <file>`. Fix anything outside Scope by removing the
   change, not by editing the issue.
7. Push and open the PR: `gh pr create --title "<type>(<scope>): <summary>" --body-file <file>`. The body
   follows `.github/PULL_REQUEST_TEMPLATE.md`: `Closes #<N>`, the Requirement verbatim, the As-is → To-be
   table (every row has "How to verify"; every changed file belongs to a row), assumptions and decisions,
   out of scope, rollback, and the local gate results.
8. Watch the checks: `gh pr checks <PR> --watch`. On failure use `/fix-ci <PR>`. Answer review comments
   on the same branch.

## Budget (per issue)

| Budget | Limit | How to count |
| --- | --- | --- |
| CI failures | 3 | failed `ci` runs on the branch: `gh run list --branch <branch> --workflow ci --json conclusion` |
| Review rounds | 2 | reviews or comments that request changes after the PR was opened |
| Wall clock | 24 hours | since `ai:ready` was added (`gh issue view <N> --json timelineItems` or the label event) |

When any budget is exceeded: stop, comment on the PR (or the issue) with what is blocking and what you
tried, and run `gh issue edit <N> --add-label ai:needs-human` (and the same on the PR).

## Rules

- Never touch files outside the Scope. If the task cannot be done inside it, stop and say why.
- Never weaken a gate: do not skip, delete or loosen tests, lints, CI jobs or `scope-check`.
- No secrets, no new network endpoints, no widened permissions or capabilities unless the contract says so.
- Files stay under 400 lines; generated files are exempt.
- Other agents work in parallel (ADR 0015). Do not rebase or merge `main` just because it moved: the
  merge queue tests the PR on top of it. Update the branch (`git merge origin/main`) only for a
  conflict, a failing gate or a queue ejection. In a conflicting `Cargo.lock` or `pnpm-lock.yaml`, take
  main's version and regenerate (`cargo check`, `pnpm install`); never merge lockfile lines by hand.
- Never merge a PR or add it to the merge queue; a person does that after approving.
