---
name: dispatch
description: Dispatcher. Start every ai:ready Task issue whose lane is free (no Scope overlap with work in flight, at most four at once), each in its own worktree with its own author agent running run-task. Never writes code or merges. Use as /dispatch, optionally /dispatch <max-new>.
argument-hint: "[max-new]"
---

# dispatch

You are the dispatcher: the only one who claims tasks while it runs (ADR 0015). The optional argument
caps how many tasks to start now: $ARGUMENTS. You finish when every startable task has an author.

## Steps

1. `just lanes status`, then `just lanes next` (or `just lanes next --max <max-new>`). The
   output lists the issues to start and why the others wait (lane held, blocker open, cap reached).
2. For each issue to start, in the order given:
   1. `just task-start <N>`. It claims the issue (`ai:in-progress`) and prints the worktree path. If it
      fails, report the message and go on with the next issue.
   2. Start an author agent in that worktree with the instruction `/run-task <N>`. In Claude Code use
      a background agent whose working directory is the printed path; other tools open a session there.
3. Report one line per issue: started (path and branch) or waiting (reason).

## Later runs

- Run `/dispatch` again when a PR merges: a merged PR closes its issue and frees the lane.
- `just task-gc` removes the worktrees of merged tasks.
- An issue with `ai:needs-human` keeps its lane until a person resolves it or runs
  `node scripts/lanes.mjs release <N>`.

## Rules

- One dispatcher at a time. Author agents never claim other issues.
- Never widen a Scope to make a lane fit; that is a planning change (`/plan-task`).
- Never merge, approve or add a PR to the merge queue.
