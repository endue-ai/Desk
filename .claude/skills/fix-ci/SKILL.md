---
name: fix-ci
description: Read the failing checks of a PR and fix them on the same branch, within the issue's budget. Use as /fix-ci <pr-number>.
argument-hint: <pr-number>
---

# fix-ci

The argument is the PR number: $ARGUMENTS. You fix the cause of failing checks on the PR's own branch.

## Steps

1. `gh pr view <PR> --json number,headRefName,body,labels` and find the linked issue (`Closes #<N>`).
2. Count the budget: failed `ci` runs on the branch
   (`gh run list --branch <branch> --workflow ci --json conclusion --jq 'map(select(.conclusion=="failure")) | length'`).
   If it is 3 or more, stop: comment on the PR with the failure and what you tried, and add
   `ai:needs-human` to the PR and the issue.
3. `gh pr checks <PR>` to list failures, then `gh run view <run-id> --log-failed` for each failing job.
   Read the first real error, not the last line.
4. Check out the branch (`git fetch origin && git switch <branch>`), reproduce locally with the same
   `just` recipe the job runs, and fix the cause.
5. `just check && just test`, then commit (`fix: ...` or `test: ...`, `git commit -s`) and push.
6. `gh pr checks <PR> --watch`. Report what failed, why, and what changed.

## Removed from the merge queue

A PR that passed on its own can fail in the merge queue, where it runs on top of `main` and the PRs
ahead of it. Find the failed `merge_group` run (`gh run list --event merge_group --workflow ci`), read
its log, then `git merge origin/main` on the branch, reproduce and fix. It counts against the budget
like any other failed `ci` run. Ask a person to re-add the PR to the queue; never add it yourself.

## Rules

- Stay inside the issue's Scope.
- Fix causes, never symptoms: do not skip, delete, retry-loop or loosen tests, lints or gates. A flaky
  test is reported (label `quarantine` plus an issue), not silenced.
- If the failure is outside the PR (runner outage, a broken main), say so and stop; it does not count
  against the budget.
