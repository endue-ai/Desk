---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Git file discard keeps a scoped inverse

## Context and Problem Statement

Whole-file discard used Git restore or clean, which lost the previous worktree content.
The desk already remembered a reversible command for selected hunks. Eris also needed
repository queries that leave the window and recent repository list alone.

## Decision Drivers

- Keep one review for a discard and preserve staged changes.
- Restore the original worktree, including binary and untracked files.
- Reject restoration when newer changes conflict with the saved inverse.
- Use the manifest's read-only tools without changing the person's active repository.

## Considered Options

- Keep bounded Git patches in the open plugin and pass a scoped token to the desk Undo.
- Create a Git stash for every discard.
- Copy the working files to a persistent backup folder.

## Decision Outcome

The explicit file or selected group is reviewed, then captured as a Git binary-capable
patch. A whole-file discard applies the reverse to the worktree while leaving the
index in place. The desk's Undo supplies a token for the original repository and
forward patch. Git validates the whole patch against the current worktree before
restoring it. An inapplicable patch leaves both the newer work and the inverse intact
so the person can resolve the conflict and retry.

Each capture is limited to 1 MiB and 256 untracked files. The open Git plugin retains
up to 8 MiB of captures. Older captures may be evicted, and closing the plugin ends
that undo history. Oversized selections refuse before removing anything. Hunk discard
keeps its existing inverse command; explicit stage and unstage apply a supplied patch
to the index only.

Repository state, commit, branch and diff reads use independent Git calls. The branch
palette keeps its candidate results for a typed query. A named local stash uses Git's
regular stash storage and reinstates the staged state on a successful pop.

## More Information

- ADR 0077, command undo and redo.
- ADR 0248, stdin for Git patch applications.
